import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { openDatabase } from "./database.js";
import { createServer } from "./http-app.js";
import { ingestLunchDay } from "./ingestion.js";
import { createOpenAiAssessor } from "./openai-assessor.js";
import { assessAndRankDay } from "./recommendations.js";
import { createRefreshCoordinator, startRefreshSchedule } from "./refresh.js";
import { createLounaspaikkaClient } from "./source.js";

async function start(): Promise<void> {
  const databasePath = resolve(process.env.DATABASE_PATH ?? "data/lunch.sqlite");
  const model = process.env.OPENAI_MODEL ?? "gpt-5.4-nano";
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
  const app = createServer({ db, recommendationVersions: { model } });
  const coordinator = createRefreshCoordinator({
    async runDate(serviceDate) {
      const result = await ingestLunchDay({ db, serviceDate, source });
      console.info(
        `[refresh] ${serviceDate}: ${result.itemCount} restaurants, ${result.createdRevisionCount} changed`,
      );
      if (assessor) {
        const recommendations = await assessAndRankDay({
          assessor,
          db,
          serviceDate,
          versions: { model },
        });
        console.info(
          `[recommendations] ${serviceDate}: ${recommendations.createdAssessmentCount} assessed`,
        );
      }
    },
    onError(serviceDate, error) {
      const message = error instanceof Error ? error.message : "Unknown refresh error";
      console.error(`[refresh] ${serviceDate} failed: ${message}`);
    },
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
