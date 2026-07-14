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
