import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../src/database.js";

describe("database migrations", () => {
  let directory: string | undefined;

  afterEach(() => {
    if (directory) rmSync(directory, { force: true, recursive: true });
  });

  it("upgrades version 2 data without changing existing source records", () => {
    directory = mkdtempSync(join(tmpdir(), "lunch-migration-"));
    const path = join(directory, "lunch.sqlite");
    const fixture = openDatabase(path);
    fixture.exec(`
      DROP TABLE assessment_feedback;
      DROP INDEX restaurants_by_custom_source;
      DROP INDEX source_fetches_by_date_source;
      DROP INDEX custom_source_runs_by_source;
      ALTER TABLE restaurants DROP COLUMN custom_source_id;
      ALTER TABLE source_fetches DROP COLUMN custom_source_id;
      ALTER TABLE source_fetches DROP COLUMN custom_run_id;
      ALTER TABLE offering_revisions DROP COLUMN price_text;
      ALTER TABLE assessments DROP COLUMN structured_menu_json;
      DROP TABLE custom_source_runs;
      DROP TABLE custom_sources;
      PRAGMA user_version = 2;
    `);
    fixture.prepare(
      `INSERT INTO restaurants (
        id, name, opening_hours_json, first_seen_at, last_seen_at
      ) VALUES (?, ?, '[]', ?, ?)`,
    ).run("api-1", "Vanha ravintola", "2026-07-13T04:00:00.000Z", "2026-07-13T04:00:00.000Z");
    fixture.prepare(
      `INSERT INTO source_fetches (
        service_date, started_at, finished_at, outcome, request_json, item_count
      ) VALUES (?, ?, ?, 'success', '{}', 1)`,
    ).run("2026-07-14", "2026-07-13T04:00:00.000Z", "2026-07-13T04:00:01.000Z");
    fixture.close();

    const migrated = openDatabase(path);

    expect(migrated.pragma("user_version", { simple: true })).toBe(5);
    expect(migrated.prepare(
      "SELECT name, custom_source_id AS customSourceId FROM restaurants WHERE id = 'api-1'",
    ).get()).toEqual({ customSourceId: null, name: "Vanha ravintola" });
    expect(migrated.prepare(
      "SELECT custom_source_id AS customSourceId, custom_run_id AS customRunId FROM source_fetches",
    ).get()).toEqual({ customRunId: null, customSourceId: null });
    expect(migrated.prepare(
      "SELECT structured_menu_json AS structuredMenuJson FROM assessments LIMIT 1",
    ).get()).toBeUndefined();
    expect(migrated.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'assessment_feedback'",
    ).get()).toEqual({ name: "assessment_feedback" });
    migrated.close();
  });

  it("upgrades version 3 assessments without losing their scores", () => {
    directory = mkdtempSync(join(tmpdir(), "lunch-migration-"));
    const path = join(directory, "lunch.sqlite");
    const fixture = openDatabase(path);
    fixture.exec(`
      DROP TABLE assessment_feedback;
      ALTER TABLE assessments DROP COLUMN structured_menu_json;
      PRAGMA user_version = 3;
    `);
    fixture.prepare(
      `INSERT INTO restaurants (
        id, name, opening_hours_json, first_seen_at, last_seen_at
      ) VALUES ('api-1', 'Vanha ravintola', '[]', ?, ?)`,
    ).run("2026-07-13T04:00:00.000Z", "2026-07-13T04:00:00.000Z");
    const fetch = fixture.prepare(
      `INSERT INTO source_fetches (
        service_date, started_at, finished_at, outcome, request_json, item_count
      ) VALUES ('2026-07-14', ?, ?, 'success', '{}', 1)`,
    ).run("2026-07-13T04:00:00.000Z", "2026-07-13T04:00:01.000Z");
    const revision = fixture.prepare(
      `INSERT INTO offering_revisions (
        restaurant_id, service_date, content_hash, availability, menu_text,
        source_snapshot_json, first_seen_fetch_id, created_at
      ) VALUES ('api-1', '2026-07-14', 'hash', 'published', 'Lohikeitto', '{}', ?, ?)`,
    ).run(fetch.lastInsertRowid, "2026-07-13T04:00:01.000Z");
    fixture.prepare(
      `INSERT INTO assessments (
        revision_id, profile_version, rubric_version, prompt_version,
        schema_version, model, scores_json, total_score, rationale_fi, assessed_at
      ) VALUES (?, 'shared-v1', 'v1', 'v2', 'v1', 'old-model', '{}', 8, ?, ?)`,
    ).run(
      revision.lastInsertRowid,
      "Lohikeitto on päivän hyvä valinta.",
      "2026-07-13T04:01:00.000Z",
    );
    fixture.close();

    const migrated = openDatabase(path);

    expect(migrated.pragma("user_version", { simple: true })).toBe(5);
    expect(migrated.prepare(
      `SELECT rationale_fi AS rationaleFi, structured_menu_json AS structuredMenuJson
       FROM assessments`,
    ).get()).toEqual({
      rationaleFi: "Lohikeitto on päivän hyvä valinta.",
      structuredMenuJson: null,
    });
    migrated.close();
  });
});
