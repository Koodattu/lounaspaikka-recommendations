import { afterEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import { openDatabase } from "../src/database.js";
import { createServer } from "../src/http-app.js";

describe("admin API", () => {
  let app: FastifyInstance | undefined;
  let db: Database.Database | undefined;

  afterEach(async () => {
    await app?.close();
    db?.close();
  });

  it("requires the shared password and exposes only a small operational overview", async () => {
    db = openDatabase(":memory:");
    db.prepare(
      `INSERT INTO source_fetches (
        service_date, started_at, finished_at, outcome, error_message, request_json
      ) VALUES (?, ?, ?, 'network_error', ?, ?)`,
    ).run(
      "2026-07-14",
      "2026-07-14T04:00:00.000Z",
      "2026-07-14T04:00:01.000Z",
      "internal upstream stack and host detail",
      JSON.stringify({ secret: "raw-request" }),
    );
    const addCustomSource = vi.fn().mockResolvedValue({
      createdRevisionCount: 5,
      restaurantId: "custom:1",
      sourceId: 1,
    });
    app = createServer({
      addCustomSource,
      adminPassword: "a-long-test-password",
      db,
      openAiConfigured: true,
      recommendationVersions: { model: "test-model" },
      refreshStatus: () => ({
        currentTarget: null,
        lastError: null,
        lastFinishedAt: "2026-07-14T04:05:00.000Z",
        running: false,
        startedAt: "2026-07-14T04:00:00.000Z",
      }),
    });

    const anonymous = await app.inject({ method: "GET", url: "/api/admin/overview" });
    expect(anonymous.statusCode).toBe(401);

    const wrong = await app.inject({
      method: "POST",
      payload: { password: "wrong-password" },
      url: "/api/admin/login",
    });
    expect(wrong.statusCode).toBe(401);

    const login = await app.inject({
      method: "POST",
      payload: { password: "a-long-test-password" },
      url: "/api/admin/login",
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers["set-cookie"] as string;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/api/admin");
    expect(setCookie).toContain("Max-Age=28800");
    const cookie = setCookie.split(";")[0]!;

    const overview = await app.inject({
      headers: { cookie },
      method: "GET",
      url: "/api/admin/overview",
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.headers["cache-control"]).toBe("no-store");
    expect(overview.json()).toMatchObject({
      counts: {
        assessments: 0,
        customSources: 0,
        fetches: 1,
        offeringRevisions: 0,
        recommendationSets: 0,
        restaurants: 0,
      },
      openAiConfigured: true,
      refresh: { lastFinishedAt: "2026-07-14T04:05:00.000Z", running: false },
      sources: [],
    });
    expect(overview.json().errors[0].message).toBe("Verkkoyhteys lähteeseen epäonnistui.");
    expect(JSON.stringify(overview.json())).not.toContain("internal upstream stack");
    expect(JSON.stringify(overview.json())).not.toContain("raw-request");

    const added = await app.inject({
      headers: { cookie },
      method: "POST",
      payload: { url: "https://backyard.fi/ideapark/" },
      url: "/api/admin/sources",
    });
    expect(added.statusCode).toBe(201);
    expect(addCustomSource).toHaveBeenCalledWith("https://backyard.fi/ideapark/");

    db.prepare(
      `INSERT INTO restaurants (
        id, name, opening_hours_json, first_seen_at, last_seen_at
      ) VALUES ('restaurant-1', 'Testiravintola', '[]', ?, ?)`,
    ).run("2026-07-14T04:10:00.000Z", "2026-07-14T04:10:00.000Z");
    const staleFetch = db.prepare(
      `INSERT INTO source_fetches (
        service_date, started_at, finished_at, outcome, request_json, item_count
      ) VALUES ('2026-07-14', ?, ?, 'success', '{}', 1)`,
    ).run("2026-07-14T04:08:00.000Z", "2026-07-14T04:08:01.000Z");
    const staleRevision = db.prepare(
      `INSERT INTO offering_revisions (
        restaurant_id, service_date, content_hash, availability, menu_text,
        source_snapshot_json, first_seen_fetch_id, created_at
      ) VALUES ('restaurant-1', '2026-07-14', 'stale-assessment-hash', 'published',
        'Aiempi ruokalista', '{}', ?, ?)`,
    ).run(staleFetch.lastInsertRowid, "2026-07-14T04:08:01.000Z");
    db.prepare(
      `INSERT INTO fetch_observations (fetch_id, restaurant_id, revision_id)
       VALUES (?, 'restaurant-1', ?)`,
    ).run(staleFetch.lastInsertRowid, staleRevision.lastInsertRowid);
    db.prepare(
      `INSERT INTO assessments (
        revision_id, profile_version, rubric_version, prompt_version,
        schema_version, model, scores_json, total_score, rationale_fi,
        structured_menu_json, assessed_at
      ) VALUES (?, 'shared-v1', 'v2', 'v5', 'v4', 'test-model', ?, 9.9,
        'Vanha arvio ei kuulu kalibrointiin.', ?, ?)`,
    ).run(
      staleRevision.lastInsertRowid,
      JSON.stringify({ appeal: 10, distinctiveness: 10, value: 9, variety: 10 }),
      JSON.stringify({ courses: [] }),
      "2026-07-14T04:09:00.000Z",
    );
    const fetch = db.prepare(
      `INSERT INTO source_fetches (
        service_date, started_at, finished_at, outcome, request_json, item_count
      ) VALUES ('2026-07-14', ?, ?, 'success', '{}', 1)`,
    ).run("2026-07-14T04:10:00.000Z", "2026-07-14T04:10:01.000Z");
    const revision = db.prepare(
      `INSERT INTO offering_revisions (
        restaurant_id, service_date, content_hash, availability, menu_text,
        source_snapshot_json, first_seen_fetch_id, created_at
      ) VALUES ('restaurant-1', '2026-07-14', 'assessment-hash', 'published',
        'Paahdettua kuhaa', '{}', ?, ?)`,
    ).run(fetch.lastInsertRowid, "2026-07-14T04:10:01.000Z");
    db.prepare(
      `INSERT INTO fetch_observations (fetch_id, restaurant_id, revision_id)
       VALUES (?, 'restaurant-1', ?)`,
    ).run(fetch.lastInsertRowid, revision.lastInsertRowid);
    const assessment = db.prepare(
      `INSERT INTO assessments (
        revision_id, profile_version, rubric_version, prompt_version,
        schema_version, model, scores_json, total_score, rationale_fi,
        structured_menu_json, assessed_at
      ) VALUES (?, 'shared-v1', 'v2', 'v5', 'v4', 'test-model', ?, 0, ?, ?, ?)`,
    ).run(
      revision.lastInsertRowid,
      JSON.stringify({ appeal: 0, distinctiveness: 0, value: 0, variety: 0 }),
      "Kuha tekee listasta kiinnostavan.",
      JSON.stringify({
        courses: [{
          category: "main",
          dietaryMarkers: [],
          explicitAllergens: [],
          nameFi: "Paahdettua kuhaa",
        }],
      }),
      "2026-07-14T04:11:00.000Z",
    );
    const assessmentId = Number(assessment.lastInsertRowid);
    db.prepare(
      `INSERT INTO assessments (
        revision_id, profile_version, rubric_version, prompt_version,
        schema_version, model, scores_json, total_score, rationale_fi,
        structured_menu_json, assessed_at
      ) VALUES (?, 'shared-v1', 'v2', 'inactive-prompt', 'v4', 'inactive-model',
        ?, 9.9, 'Tätä versiota ei julkaista.', ?, ?)`,
    ).run(
      revision.lastInsertRowid,
      JSON.stringify({ appeal: 10, distinctiveness: 10, value: 9, variety: 10 }),
      JSON.stringify({ courses: [] }),
      "2026-07-14T04:12:00.000Z",
    );

    for (const serviceDate of [
      "2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18",
      "2026-07-19", "2026-07-20", "2026-07-21", "2026-07-22",
    ]) {
      const oldFetch = db.prepare(
        `INSERT INTO source_fetches (
          service_date, started_at, finished_at, outcome, request_json, item_count
        ) VALUES (?, ?, ?, 'success', '{}', 1)`,
      ).run(serviceDate, `${serviceDate}T04:00:00.000Z`, `${serviceDate}T04:00:01.000Z`);
      const oldRevision = db.prepare(
        `INSERT INTO offering_revisions (
          restaurant_id, service_date, content_hash, availability, menu_text,
          source_snapshot_json, first_seen_fetch_id, created_at
        ) VALUES ('restaurant-1', ?, ?, 'published', 'Aiempi ruokalista', '{}', ?, ?)`,
      ).run(serviceDate, `old-${serviceDate}`, oldFetch.lastInsertRowid, `${serviceDate}T04:00:01.000Z`);
      db.prepare(
        `INSERT INTO fetch_observations (fetch_id, restaurant_id, revision_id)
         VALUES (?, 'restaurant-1', ?)`,
      ).run(oldFetch.lastInsertRowid, oldRevision.lastInsertRowid);
      db.prepare(
        `INSERT INTO assessments (
          revision_id, profile_version, rubric_version, prompt_version,
          schema_version, model, scores_json, total_score, rationale_fi,
          structured_menu_json, assessed_at
        ) VALUES (?, 'shared-v1', 'v2', 'v5', 'v4', 'test-model', ?, 9.9,
          'Korvattu arvio.', ?, ?)`,
      ).run(
        oldRevision.lastInsertRowid,
        JSON.stringify({ appeal: 10, distinctiveness: 10, value: 9, variety: 10 }),
        JSON.stringify({ courses: [] }),
        `${serviceDate}T04:01:00.000Z`,
      );
      const replacementFetch = db.prepare(
        `INSERT INTO source_fetches (
          service_date, started_at, finished_at, outcome, request_json, item_count
        ) VALUES (?, ?, ?, 'success', '{}', 1)`,
      ).run(serviceDate, `${serviceDate}T05:00:00.000Z`, `${serviceDate}T05:00:01.000Z`);
      const replacementRevision = db.prepare(
        `INSERT INTO offering_revisions (
          restaurant_id, service_date, content_hash, availability, menu_text,
          source_snapshot_json, first_seen_fetch_id, created_at
        ) VALUES ('restaurant-1', ?, ?, 'published', 'Uusi ruokalista', '{}', ?, ?)`,
      ).run(
        serviceDate,
        `replacement-${serviceDate}`,
        replacementFetch.lastInsertRowid,
        `${serviceDate}T05:00:01.000Z`,
      );
      db.prepare(
        `INSERT INTO fetch_observations (fetch_id, restaurant_id, revision_id)
         VALUES (?, 'restaurant-1', ?)`,
      ).run(replacementFetch.lastInsertRowid, replacementRevision.lastInsertRowid);
    }

    const anonymousFeedback = await app.inject({
      method: "PUT",
      payload: { direction: "lower" },
      url: `/api/admin/assessments/${assessmentId}/feedback`,
    });
    expect(anonymousFeedback.statusCode).toBe(401);
    const invalidFeedback = await app.inject({
      headers: { cookie },
      method: "PUT",
      payload: { direction: "sideways" },
      url: `/api/admin/assessments/${assessmentId}/feedback`,
    });
    expect(invalidFeedback.statusCode).toBe(400);
    const missingAssessment = await app.inject({
      headers: { cookie },
      method: "PUT",
      payload: { direction: "lower" },
      url: "/api/admin/assessments/999999/feedback",
    });
    expect(missingAssessment.statusCode).toBe(404);

    const lowered = await app.inject({
      headers: { cookie },
      method: "PUT",
      payload: { direction: "lower" },
      url: `/api/admin/assessments/${assessmentId}/feedback`,
    });
    expect(lowered.statusCode).toBe(200);
    expect(lowered.json()).toEqual({ assessmentId, direction: "lower" });
    const raised = await app.inject({
      headers: { cookie },
      method: "PUT",
      payload: { direction: "higher" },
      url: `/api/admin/assessments/${assessmentId}/feedback`,
    });
    expect(raised.statusCode).toBe(200);
    expect(db.prepare(
      "SELECT direction FROM assessment_feedback WHERE assessment_id = ?",
    ).get(assessmentId)).toEqual({ direction: "higher" });

    const feedbackOverview = await app.inject({
      headers: { cookie },
      method: "GET",
      url: "/api/admin/overview",
    });
    expect(feedbackOverview.json().recentAssessments).toEqual([
      expect.objectContaining({
        assessmentId,
        feedbackDirection: "higher",
        restaurantName: "Testiravintola",
        score: 0,
        scores: { appeal: 0, distinctiveness: 0, value: 0, variety: 0 },
      }),
    ]);

    const cleared = await app.inject({
      headers: { cookie },
      method: "PUT",
      payload: { direction: null },
      url: `/api/admin/assessments/${assessmentId}/feedback`,
    });
    expect(cleared.statusCode).toBe(200);
    expect(db.prepare(
      "SELECT direction FROM assessment_feedback WHERE assessment_id = ?",
    ).get(assessmentId)).toBeUndefined();

    const logout = await app.inject({
      headers: { cookie },
      method: "POST",
      url: "/api/admin/logout",
    });
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");
    const afterLogout = await app.inject({
      headers: { cookie },
      method: "GET",
      url: "/api/admin/overview",
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it("keeps admin disabled when no password is configured", async () => {
    db = openDatabase(":memory:");
    app = createServer({ db });

    const response = await app.inject({ method: "GET", url: "/api/admin/overview" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: { code: "ADMIN_DISABLED", message: "Ylläpito ei ole käytössä." },
    });
  });
});
