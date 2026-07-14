import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import type Database from "better-sqlite3";

import { createAdminAuth } from "./admin-auth.js";
import { getAdminOverview } from "./admin-overview.js";
import { isMonday, parseIsoDate } from "./dates.js";
import { normalizeMenuPageUrl, PageFetchError } from "./page-fetcher.js";
import {
  getDailyRecommendations,
  getDayMenus,
  getFetchState,
  getRestaurantWeek,
} from "./queries.js";
import type { RecommendationVersions } from "./recommendations.js";
import type { RefreshStatus } from "./refresh.js";

interface CreateServerOptions {
  addCustomSource?: (url: string) => Promise<unknown>;
  adminPassword?: string;
  db: Database.Database;
  openAiConfigured?: boolean;
  recommendationVersions?: Partial<RecommendationVersions>;
  refreshStatus?: () => RefreshStatus;
}

const source = {
  name: "Lounaspaikka",
  url: "https://lounaspaikka.ilkkapohjalainen.fi/",
};

const invalidDate = {
  error: { code: "INVALID_DATE", message: "Päivämäärä ei kelpaa." },
};

export function createServer(options: CreateServerOptions): FastifyInstance {
  const app = Fastify({ logger: false, trustProxy: true });
  const adminAuth = createAdminAuth({ password: options.adminPassword });
  const disabledAdmin = {
    error: { code: "ADMIN_DISABLED", message: "Ylläpito ei ole käytössä." },
  };
  const unauthorizedAdmin = {
    error: { code: "UNAUTHORIZED", message: "Kirjaudu sisään jatkaaksesi." },
  };

  app.addHook("onSend", async (request, reply) => {
    if (request.raw.url?.startsWith("/api/admin")) {
      reply.header("cache-control", "no-store");
    }
  });

  async function requireAdmin(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    if (!adminAuth.enabled) return reply.code(503).send(disabledAdmin);
    if (!adminAuth.authenticate(request.headers.cookie)) {
      return reply.code(401).send(unauthorizedAdmin);
    }
  }

  app.post<{ Body: { password?: unknown } }>("/api/admin/login", async (request, reply) => {
    if (!adminAuth.enabled) return reply.code(503).send(disabledAdmin);
    const result = adminAuth.login(request.body?.password, request.ip);
    if (!result.ok) {
      if (result.throttled) {
        return reply.code(429).send({
          error: { code: "TOO_MANY_ATTEMPTS", message: "Liian monta yritystä. Yritä myöhemmin uudelleen." },
        });
      }
      return reply.code(401).send({
        error: { code: "INVALID_PASSWORD", message: "Salasana ei kelpaa." },
      });
    }
    reply.header("set-cookie", adminAuth.sessionCookie(result.token, request.protocol === "https"));
    return { status: "ok" };
  });

  app.post("/api/admin/logout", { preHandler: requireAdmin }, async (request, reply) => {
    adminAuth.logout(request.headers.cookie);
    reply.header("set-cookie", adminAuth.clearCookie());
    return { status: "ok" };
  });

  app.get("/api/admin/overview", { preHandler: requireAdmin }, async () =>
    getAdminOverview(options.db, {
      openAiConfigured: options.openAiConfigured ?? false,
      refresh: options.refreshStatus?.() ?? {
        currentTarget: null,
        lastError: null,
        lastFinishedAt: null,
        running: false,
        startedAt: null,
      },
    }),
  );

  app.post<{ Body: { url?: unknown } }>(
    "/api/admin/sources",
    { preHandler: requireAdmin },
    async (request, reply) => {
      if (!options.addCustomSource) {
        return reply.code(503).send({
          error: {
            code: "CUSTOM_SOURCES_DISABLED",
            message: "Sivulähteiden lisäys ei ole käytössä.",
          },
        });
      }
      if (typeof request.body?.url !== "string" || request.body.url.length > 2_048) {
        return reply.code(400).send({
          error: { code: "INVALID_URL", message: "Anna kelvollinen HTTPS-osoite." },
        });
      }
      let url: string;
      try {
        url = normalizeMenuPageUrl(request.body.url);
      } catch (error) {
        if (error instanceof PageFetchError) {
          return reply.code(400).send({
            error: { code: "INVALID_URL", message: "Anna kelvollinen HTTPS-osoite." },
          });
        }
        throw error;
      }
      try {
        const result = await options.addCustomSource(url);
        return reply.code(201).send(result);
      } catch {
        return reply.code(422).send({
          error: {
            code: "SOURCE_PROCESSING_FAILED",
            message: "Lähteen käsittely epäonnistui. Tarkista virhe yhteenvedosta.",
          },
        });
      }
    },
  );

  app.get("/api/health", async (_request, reply) => {
    try {
      options.db.prepare("SELECT 1").get();
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "error" });
    }
  });

  app.get<{ Params: { serviceDate: string } }>(
    "/api/days/:serviceDate",
    async (request, reply) => {
      const { serviceDate } = request.params;
      if (!parseIsoDate(serviceDate)) return reply.code(400).send(invalidDate);

      const menus = getDayMenus(options.db, serviceDate, options.recommendationVersions);
      const fetchState = getFetchState(options.db, serviceDate);
      const recommendationData = getDailyRecommendations(
        options.db,
        serviceDate,
        options.recommendationVersions,
      );
      const hasPublishedMenu = menus.some((entry) => entry.menu.status === "published");
      const status =
        recommendationData.recommendations.length > 0
          ? "ready"
          : hasPublishedMenu
            ? "pending"
            : "unavailable";

      return {
        generatedAt: recommendationData.generatedAt,
        lastAttemptAt: fetchState.lastAttemptAt,
        lastSuccessfulFetchAt: fetchState.lastSuccessfulFetchAt,
        menus,
        recommendations: recommendationData.recommendations,
        serviceDate,
        source,
        stale: fetchState.lastOutcome !== null && fetchState.lastOutcome !== "success",
        status,
      };
    },
  );

  app.get<{ Params: { restaurantId: string; weekStart: string } }>(
    "/api/restaurants/:restaurantId/weeks/:weekStart",
    async (request, reply) => {
      const { restaurantId, weekStart } = request.params;
      if (!parseIsoDate(weekStart) || !isMonday(weekStart)) {
        return reply.code(400).send(invalidDate);
      }
      const week = getRestaurantWeek(
        options.db,
        restaurantId,
        weekStart,
        options.recommendationVersions,
      );
      if (!week) {
        return reply.code(404).send({
          error: { code: "RESTAURANT_NOT_FOUND", message: "Ravintolaa ei löytynyt." },
        });
      }
      return week;
    },
  );

  return app;
}
