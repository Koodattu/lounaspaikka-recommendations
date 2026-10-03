import { afterEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import { createCustomSourceService } from "../src/custom-sources.js";
import { openDatabase } from "../src/database.js";
import { createServer } from "../src/http-app.js";
import { createRecommendationPublication } from "../src/recommendation-publication.js";
import { createRestaurantCatchment } from "../src/restaurant-catchment.js";
import { capturedOffering, catchmentAdapterForOfferings } from "./catchment-fixture.js";

describe("custom source controls", () => {
  let db: Database.Database;
  let app: FastifyInstance;
  afterEach(async () => { await app?.close(); db?.close(); });

  it("disables and restores a source without fetching, reassessing or deleting its history", async () => {
    db = openDatabase(":memory:");
    const dates = ["2026-07-14"];
    await createRestaurantCatchment({
      db, lounaspaikka: catchmentAdapterForOfferings([capturedOffering("primary", "Pääravintola", "Kalakeitto")]),
    }).refresh(dates[0]!);
    const fetchPage = vi.fn(async (url: string) => ({
      body: "menu", text: "menu", finalUrl: url, httpStatus: 200, truncated: false,
    }));
    const extractor = vi.fn(async () => ({ extraction: {
      pageType: "restaurant_page" as const,
      restaurant: { name: "Oma ravintola", address: null, city: null, description: null, phone: null, openingHours: [] },
      menus: [{ serviceDate: dates[0]!, status: "published" as const, menuText: "Kasviskeitto", lunchHours: null, priceText: null, title: null }],
    } }));
    const assess = vi.fn(async (facts: { menuText: string }) => ({ assessment: {
      rationaleFi: "Lounas on kiinnostava.", scores: { appeal: 8, distinctiveness: 8, value: 8, variety: 8 },
      structuredMenu: { courses: [{ nameFi: facts.menuText, category: "main" as const, dietaryMarkers: [], explicitAllergens: [] }] },
    } }));
    const publication = createRecommendationPublication({
      db, assessor: { assess }, customSources: createCustomSourceService({ db, model: "test", fetchPage, extractor }),
      versions: {}, adminRequestBudget: 5, refreshRequestBudget: 5,
    });
    const { source } = await publication.addCustomSource("https://example.com/menu", dates);
    app = createServer({
      db, adminPassword: "a-long-test-password",
      addCustomSource: (url) => publication.addCustomSource(url, dates),
      setCustomSourceEnabled: (id, enabled) => publication.setCustomSourceEnabled(id, enabled, dates),
    });
    const url = `/api/admin/sources/${source.sourceId}`;
    expect((await app.inject({ method: "PATCH", url, payload: { enabled: false } })).statusCode).toBe(401);
    const login = await app.inject({ method: "POST", url: "/api/admin/login", payload: { password: "a-long-test-password" } });
    const headers = { cookie: String(login.headers["set-cookie"]).split(";")[0]! };
    const before = (await app.inject({ url: "/api/admin/overview", headers })).json();
    const paused = await app.inject({ method: "PATCH", url, headers, payload: { enabled: false } });
    expect(paused.statusCode).toBe(200);
    expect(paused.json()).toEqual({ sourceId: source.sourceId, enabled: false });
    const day = (await app.inject(`/api/days/${dates[0]}`)).json();
    expect(day.menus.map((entry: { restaurant: { id: string } }) => entry.restaurant.id)).toEqual(["primary"]);
    expect(day.recommendations.map((entry: { restaurant: { id: string } }) => entry.restaurant.id)).toEqual(["primary"]);
    await publication.runScheduled(dates);
    const disabledAdd = await app.inject({ method: "POST", url: "/api/admin/sources", headers, payload: { url: "https://example.com/menu" } });
    expect(disabledAdd.statusCode).toBe(409);
    expect(disabledAdd.json().error.code).toBe("SOURCE_DISABLED");
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(extractor).toHaveBeenCalledTimes(1);
    expect(assess).toHaveBeenCalledTimes(2);
    const restored = await app.inject({ method: "PATCH", url, headers, payload: { enabled: true } });
    expect(restored.statusCode).toBe(200);
    const after = (await app.inject({ url: "/api/admin/overview", headers })).json();
    expect(after.sources[0].enabled).toBe(true);
    expect(after.counts.offeringRevisions).toBe(before.counts.offeringRevisions);
    expect(after.counts.fetches).toBe(before.counts.fetches);
    expect(after.counts.assessments).toBe(before.counts.assessments);
    expect((await app.inject(`/api/days/${dates[0]}`)).json().recommendations).toHaveLength(2);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(assess).toHaveBeenCalledTimes(2);
    for (const payload of [{}, { enabled: "false" }, { enabled: 0 }]) {
      expect((await app.inject({ method: "PATCH", url, headers, payload })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: "PATCH", url: "/api/admin/sources/nope", headers, payload: { enabled: false } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/api/admin/sources/99999", headers, payload: { enabled: false } })).statusCode).toBe(404);
    let releaseFetch!: () => void;
    let startedFetch!: () => void;
    const fetching = new Promise<void>((resolve) => { startedFetch = resolve; });
    const release = new Promise<void>((resolve) => { releaseFetch = resolve; });
    fetchPage.mockImplementationOnce(async (url) => {
      startedFetch();
      await release;
      return { body: "menu", text: "menu", finalUrl: url, httpStatus: 200, truncated: false };
    });
    const scheduled = publication.runScheduled(dates);
    await fetching;
    const queuedDisable = app.inject({ method: "PATCH", url, headers, payload: { enabled: false } }).then((response) => response);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect((await app.inject({ url: "/api/admin/overview", headers })).json().sources[0].enabled).toBe(true);
    releaseFetch();
    await scheduled;
    expect((await queuedDisable).statusCode).toBe(200);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect((await app.inject(`/api/days/${dates[0]}`)).json().menus).toHaveLength(1);
  });

  it("removes a disabled source's failure from active health while retaining its history and not assessing unseen menus", async () => {
    db = openDatabase(":memory:");
    const date = "2026-07-14";
    await createRestaurantCatchment({
      db, lounaspaikka: catchmentAdapterForOfferings([capturedOffering("primary", "Pääravintola", "Kalakeitto")]),
    }).refresh(date);
    const assess = vi.fn();
    const publication = createRecommendationPublication({
      db, assessor: { assess }, versions: {}, adminRequestBudget: 5, refreshRequestBudget: 5,
      customSources: createCustomSourceService({
        db, model: "test", fetchPage: async () => { throw new Error("Synthetic connection failure"); },
        extractor: vi.fn(),
      }),
    });
    await expect(publication.addCustomSource("https://example.com/failure", [date])).rejects.toThrow("Synthetic connection failure");
    app = createServer({
      db, adminPassword: "a-long-test-password",
      setCustomSourceEnabled: (id, enabled) => publication.setCustomSourceEnabled(id, enabled, [date]),
    });
    const login = await app.inject({ method: "POST", url: "/api/admin/login", payload: { password: "a-long-test-password" } });
    const headers = { cookie: String(login.headers["set-cookie"]).split(";")[0]! };
    const before = (await app.inject({ url: "/api/admin/overview", headers })).json();
    expect(before.latestFetch.outcome).toBe("network_error");
    expect((await app.inject({ method: "PATCH", url: `/api/admin/sources/${before.sources[0].id}`, headers, payload: { enabled: false } })).statusCode).toBe(200);
    const after = (await app.inject({ url: "/api/admin/overview", headers })).json();
    expect(after.latestFetch.outcome).toBe("success");
    expect(after.sources[0].lastOutcome).toBe("network_error");
    expect(after.errors).toEqual(before.errors);
    expect(after.counts.fetches).toBe(before.counts.fetches);
    expect(assess).not.toHaveBeenCalled();
    expect((await app.inject(`/api/days/${date}`)).json().menus).toHaveLength(1);
  });
});
