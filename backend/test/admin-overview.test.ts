import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";

import { getAdminOverview } from "../src/admin-overview.js";
import { openDatabase } from "../src/database.js";
import { persistFailedFetch } from "../src/offering-store.js";

describe("admin overview", () => {
  let db: Database.Database | undefined;

  afterEach(() => db?.close());

  it("groups one custom crawl failure and sanitizes its stored error", () => {
    db = openDatabase(":memory:");
    const source = db.prepare(
      "INSERT INTO custom_sources (url, enabled, created_at) VALUES (?, 1, ?)",
    ).run("https://example.com/menu", "2026-07-14T04:00:00.000Z");
    const sourceId = Number(source.lastInsertRowid);
    const run = db.prepare(
      `INSERT INTO custom_source_runs (
        custom_source_id, started_at, finished_at, outcome, error_message
      ) VALUES (?, ?, ?, 'network_error', ?)`,
    ).run(
      sourceId,
      "2026-07-14T04:00:00.000Z",
      "2026-07-14T04:00:01.000Z",
      "private upstream detail",
    );
    const runId = Number(run.lastInsertRowid);
    for (const serviceDate of ["2026-07-14", "2026-07-15"]) {
      persistFailedFetch({
        customRunId: runId,
        customSourceId: sourceId,
        db,
        errorMessage: "private upstream detail",
        finishedAt: "2026-07-14T04:00:01.000Z",
        outcome: "network_error",
        request: { secret: "raw request" },
        serviceDate,
        startedAt: "2026-07-14T04:00:00.000Z",
      });
    }

    const overview = getAdminOverview(db, {
      openAiConfigured: true,
      refresh: {
        currentTarget: null,
        lastError: null,
        lastFinishedAt: null,
        running: false,
        startedAt: null,
      },
    });

    expect(overview.errors).toEqual([
      expect.objectContaining({
        affectedDateCount: 2,
        message: "Verkkoyhteys lähteeseen epäonnistui.",
        sourceUrl: "https://example.com/menu",
      }),
    ]);
    expect(JSON.stringify(overview)).not.toContain("private upstream detail");
    expect(JSON.stringify(overview)).not.toContain("raw request");
  });
});
