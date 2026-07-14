import Fastify, { type FastifyInstance } from "fastify";
import type Database from "better-sqlite3";

import { isMonday, parseIsoDate } from "./dates.js";
import {
  getDailyRecommendations,
  getDayMenus,
  getFetchState,
  getRestaurantWeek,
} from "./queries.js";
import type { RecommendationVersions } from "./recommendations.js";

interface CreateServerOptions {
  db: Database.Database;
  recommendationVersions?: Partial<RecommendationVersions>;
}

const source = {
  name: "Lounaspaikka",
  url: "https://lounaspaikka.ilkkapohjalainen.fi/",
};

const invalidDate = {
  error: { code: "INVALID_DATE", message: "Päivämäärä ei kelpaa." },
};

export function createServer(options: CreateServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });

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

      const menus = getDayMenus(options.db, serviceDate);
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
      const week = getRestaurantWeek(options.db, restaurantId, weekStart);
      if (!week) {
        return reply.code(404).send({
          error: { code: "RESTAURANT_NOT_FOUND", message: "Ravintolaa ei löytynyt." },
        });
      }
      return { ...week, source };
    },
  );

  return app;
}
