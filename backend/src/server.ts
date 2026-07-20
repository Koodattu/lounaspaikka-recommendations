import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createCustomSourceService } from "./custom-sources.js";
import { openDatabase } from "./database.js";
import { createServer } from "./http-app.js";
import { ingestLunchDay } from "./ingestion.js";
import { createOpenAiAssessor } from "./openai-assessor.js";
import { createOpenAiMenuExtractor } from "./openai-menu-extractor.js";
import {
  OpenAiRequestBudget,
  parseOpenAiRequestBudget,
} from "./openai-request-budget.js";
import { createMenuPageFetcher } from "./page-fetcher.js";
import { assessAndRankDay } from "./recommendations.js";
import {
  createRefreshCoordinator,
  datesToRefresh,
  startRefreshSchedule,
} from "./refresh.js";
import { createLounaspaikkaClient } from "./source.js";

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
  const source = createLounaspaikkaClient();
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
  const coordinator = createRefreshCoordinator({
    async afterDates(serviceDates) {
      const budget = new OpenAiRequestBudget(refreshOpenAiRequestBudget);
      await customSourceService?.crawlAll(serviceDates, budget);
      if (!assessor) return;
      let firstError: unknown;
      for (const serviceDate of serviceDates) {
        try {
          const recommendations = await assessAndRankDay({
            assessor,
            budget,
            db,
            serviceDate,
            versions: { model },
          });
          console.info(
            `[recommendations] ${serviceDate}: ${recommendations.createdAssessmentCount} assessed`,
          );
        } catch (error) {
          firstError ??= error;
          const message = error instanceof Error ? error.message : "Unknown recommendation error";
          console.error(`[recommendations] ${serviceDate} failed: ${message}`);
        }
      }
      if (firstError) throw firstError;
    },
    async runDate(serviceDate) {
      const result = await ingestLunchDay({ db, serviceDate, source });
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
          const budget = new OpenAiRequestBudget(adminOpenAiRequestBudget);
          const result = await customSourceService.addAndCrawl(url, serviceDates, budget);
          if (assessor) {
            for (const serviceDate of serviceDates) {
              try {
                await assessAndRankDay({
                  assessor,
                  budget,
                  db,
                  serviceDate,
                  versions: { model },
                });
              } catch (error) {
                const message = error instanceof Error ? error.message : "Unknown recommendation error";
                console.error(`[recommendations] ${serviceDate} failed after source add: ${message}`);
              }
            }
          }
          return result;
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
