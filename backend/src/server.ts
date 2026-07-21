import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createCustomSourceService } from "./custom-sources.js";
import { openDatabase } from "./database.js";
import { createServer } from "./http-app.js";
import { createLounaspaikkaCatchmentAdapter } from "./lounaspaikka-catchment.js";
import { createOpenAiAssessor } from "./openai-assessor.js";
import { createOpenAiMenuExtractor } from "./openai-menu-extractor.js";
import { parseOpenAiRequestBudget } from "./openai-request-budget.js";
import { createMenuPageFetcher } from "./page-fetcher.js";
import {
  createRecommendationPublication,
  type RecommendationPublicationOutcome,
} from "./recommendation-publication.js";
import { createRestaurantCatchment } from "./restaurant-catchment.js";
import {
  createRefreshCoordinator,
  datesToRefresh,
  startRefreshSchedule,
} from "./refresh.js";

function reportPublication(
  outcome: RecommendationPublicationOutcome,
  trigger: "scheduled" | "source-add",
): unknown {
  let firstError: unknown;
  for (const date of outcome.dates) {
    if (date.status === "succeeded") {
      if (trigger === "scheduled") {
        console.info(
          `[recommendations] ${date.serviceDate}: ${date.result.createdAssessmentCount} assessed`,
        );
      }
      continue;
    }
    if (date.status !== "failed") continue;
    firstError ??= date.error;
    const message = date.error instanceof Error
      ? date.error.message
      : "Unknown recommendation error";
    const suffix = trigger === "source-add" ? " after source add" : "";
    console.error(`[recommendations] ${date.serviceDate} failed${suffix}: ${message}`);
  }
  return firstError;
}

async function start(): Promise<void> {
  const databasePath = resolve(process.env.DATABASE_PATH ?? "data/lunch.sqlite");
  const model = process.env.OPENAI_MODEL ?? "gpt-5.4-nano";
  const adminOpenAiRequestBudget = parseOpenAiRequestBudget(
    "OPENAI_ADMIN_SOURCE_REQUEST_BUDGET",
    process.env.OPENAI_ADMIN_SOURCE_REQUEST_BUDGET,
    20,
  );
  const refreshOpenAiRequestBudget = parseOpenAiRequestBudget(
    "OPENAI_REFRESH_REQUEST_BUDGET",
    process.env.OPENAI_REFRESH_REQUEST_BUDGET,
    100,
  );
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  mkdirSync(dirname(databasePath), { recursive: true });
  const db = openDatabase(databasePath);
  const restaurantCatchment = createRestaurantCatchment({
    db,
    lounaspaikka: createLounaspaikkaCatchmentAdapter(),
  });
  const assessor = process.env.OPENAI_API_KEY
    ? createOpenAiAssessor({ apiKey: process.env.OPENAI_API_KEY, model })
    : null;
  const customSourceService = process.env.OPENAI_API_KEY
    ? createCustomSourceService({
        db,
        extractor: createOpenAiMenuExtractor({ apiKey: process.env.OPENAI_API_KEY, model }),
        fetchPage: createMenuPageFetcher(),
        model,
      })
    : null;
  const publication = createRecommendationPublication({
    adminRequestBudget: adminOpenAiRequestBudget,
    assessor,
    customSources: customSourceService,
    db,
    refreshRequestBudget: refreshOpenAiRequestBudget,
    versions: { model },
  });
  const coordinator = createRefreshCoordinator({
    async afterDates(serviceDates) {
      const outcome = await publication.runScheduled(serviceDates);
      const firstError = reportPublication(outcome, "scheduled");
      if (firstError) throw firstError;
    },
    async runDate(serviceDate) {
      const result = await restaurantCatchment.refresh(serviceDate);
      console.info(
        `[refresh] ${serviceDate}: ${result.itemCount} restaurants, ${result.createdRevisionCount} changed`,
      );
    },
    onError(serviceDate, error) {
      const message = error instanceof Error ? error.message : "Unknown refresh error";
      console.error(`[refresh] ${serviceDate} failed: ${message}`);
    },
  });
  const app = createServer({
    addCustomSource: customSourceService
      ? async (url) => {
          const serviceDates = datesToRefresh(new Date());
          const result = await publication.addCustomSource(url, serviceDates);
          reportPublication(result.outcome, "source-add");
          return result.source;
        }
      : undefined,
    adminPassword: process.env.ADMIN_PASSWORD,
    db,
    openAiConfigured: Boolean(process.env.OPENAI_API_KEY),
    recommendationVersions: { model },
    refreshStatus: coordinator.getStatus,
  });
  const schedule = startRefreshSchedule(coordinator.run);
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`[server] ${signal}, shutting down`);
    schedule.stop();
    coordinator.stop();
    await app.close();
    await coordinator.waitForIdle();
    db.close();
  }

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  try {
    await app.listen({ host: "0.0.0.0", port });
    console.info(`[server] listening on port ${port}`);
    if (!assessor) {
      console.warn("[recommendations] OPENAI_API_KEY is not set; menu ingestion will continue");
    }
    void coordinator.run();
  } catch (error) {
    schedule.stop();
    db.close();
    throw error;
  }
}

start().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
