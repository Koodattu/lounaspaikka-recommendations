import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import { openDatabase } from "../src/database.js";
import { createServer } from "../src/http-app.js";
import { createCustomSourceService } from "../src/custom-sources.js";
import { assessAndRankDay } from "../src/recommendations.js";
import { createRestaurantCatchment } from "../src/restaurant-catchment.js";
import { capturedOffering, catchmentAdapterForOfferings } from "./catchment-fixture.js";

function item(id: string, name: string, body: string) {
  return capturedOffering(id, name, body.replaceAll("<br>", "\n"), {
    address: `${name}ntie 1`,
    descriptionText: "Lounasravintola",
    openingHours: [{ mon: [{ close: "14.00", open: "10.30" }] }],
    priceText: body.includes("13,50 €") ? "13,50 €" : null,
    websiteUrl: `https://example.com/${id}`,
  });
}

describe("reader API", () => {
  let app: FastifyInstance | undefined;
  let db: Database.Database | undefined;

  afterEach(async () => {
    await app?.close();
    db?.close();
  });

  it("identifies failed source updates beside retained menus without marking healthy sources stale", async () => {
    db = openDatabase(":memory:");
    let timestamp = "2026-07-14T03:00:00.000Z";
    let fail = false;
    const custom = createCustomSourceService({
      db, model: "synthetic-test", now: () => new Date(timestamp),
      fetchPage: async (url) => {
        if (fail) throw new Error("synthetic connection failure");
        return { body: "menu", text: "menu", finalUrl: url, httpStatus: 200, truncated: false };
      },
      extractor: async ({ serviceDates }) => ({ extraction: {
        pageType: "restaurant_page",
        restaurant: { name: "Oma ravintola", address: null, city: "Seinäjoki", description: null, phone: null, openingHours: [] },
        menus: serviceDates.map((serviceDate) => ({
          serviceDate, status: "published", menuText: "Kasviskeitto", lunchHours: null, priceText: null, title: "Lounas",
        })),
      } }),
    });
    const source = await custom.addAndCrawl("https://example.com/menu", ["2026-07-14"]);
    fail = true;
    timestamp = "2026-07-14T04:00:00.000Z";
    await expect(custom.addAndCrawl("https://example.com/menu", ["2026-07-14", "2026-07-15"]))
      .rejects.toThrow();
    await createRestaurantCatchment({
      db, now: () => new Date("2026-07-14T05:00:00.000Z"),
      lounaspaikka: catchmentAdapterForOfferings([item("main", "Pääravintola", "Kuhaa")]),
    }).refresh("2026-07-14");
    app = createServer({ db });

    const day = (await app.inject("/api/days/2026-07-14")).json();
    expect(day.stale).toBe(true);
    expect(day.menus.find((entry: { restaurant: { id: string } }) => entry.restaurant.id === source.restaurantId))
      .toMatchObject({
        stale: true, lastAttemptAt: "2026-07-14T04:00:00.000Z", fetchedAt: "2026-07-14T03:00:00.000Z",
        menu: { text: "Kasviskeitto" },
      });
    expect(day.menus.find((entry: { restaurant: { id: string } }) => entry.restaurant.id === "main"))
      .toMatchObject({ stale: false, lastAttemptAt: "2026-07-14T05:00:00.000Z" });
    const week = (await app.inject(`/api/restaurants/${source.restaurantId}/weeks/2026-07-13`)).json();
    expect(week.days[0]).toMatchObject({ status: "missing", stale: false, lastAttemptAt: null });
    expect(week.days[1]).toMatchObject({
      stale: true, lastAttemptAt: "2026-07-14T04:00:00.000Z", fetchedAt: "2026-07-14T03:00:00.000Z", text: "Kasviskeitto",
    });
    expect(week.days[2]).toMatchObject({
      stale: true, lastAttemptAt: "2026-07-14T04:00:00.000Z", fetchedAt: null, status: "missing", text: null,
    });

    fail = false;
    timestamp = "2026-07-14T06:00:00.000Z";
    await custom.addAndCrawl("https://example.com/menu", ["2026-07-14", "2026-07-15"]);
    const recovered = (await app.inject(`/api/restaurants/${source.restaurantId}/weeks/2026-07-13`)).json();
    expect(recovered.days[1]).toMatchObject({
      stale: false, fetchedAt: "2026-07-14T06:00:00.000Z", lastAttemptAt: "2026-07-14T06:00:00.000Z", text: "Kasviskeitto",
    });
    expect((await app.inject("/api/days/2026-07-14")).json().stale).toBe(false);

    await expect(createRestaurantCatchment({
      db, now: () => new Date("2026-07-14T07:00:00.000Z"),
      lounaspaikka: { observe: async () => { throw new Error("synthetic primary-source failure"); } },
    }).refresh("2026-07-14")).rejects.toThrow("synthetic primary-source failure");
    const primaryFailure = (await app.inject("/api/restaurants/main/weeks/2026-07-13")).json();
    expect(primaryFailure.days[1]).toMatchObject({
      stale: true, lastAttemptAt: "2026-07-14T07:00:00.000Z", fetchedAt: "2026-07-14T05:00:00.000Z", text: "Kuhaa",
    });
    expect((await app.inject(`/api/restaurants/${source.restaurantId}/weeks/2026-07-13`)).json().days[1].stale)
      .toBe(false);
  });

  it("serves health, a Finnish-ready day and a seven-day restaurant week", async () => {
    const items = [
      item("a", "A-ravintola", "Kasviscurry"),
      item("b", "B-ravintola", "Paahdettua kuhaa<br>13,50 €"),
      item("c", "C-ravintola", "Lihapullat"),
      item("d", "D-ravintola", "Hernekeitto"),
    ];
    db = openDatabase(":memory:");
    await createRestaurantCatchment({
      db,
      lounaspaikka: catchmentAdapterForOfferings(items),
      now: () => new Date("2026-07-14T03:10:00.000Z"),
    }).refresh("2026-07-14");
    await assessAndRankDay({
      assessor: {
        assess: async (facts) => ({
          assessment: {
            rationaleFi: `${facts.menuText} tarjoaa päivän kiinnostavimman annoksen.`,
            scores: {
              appeal: 10,
              distinctiveness: 10,
              value: 10,
              variety: 10,
            },
            structuredMenu: {
              courses: [{
                category: "main" as const,
                dietaryMarkers: ["G"],
                explicitAllergens: [],
                nameFi: facts.menuText.split("\n")[0]!,
              }],
            },
          },
        }),
      },
      db,
      now: () => new Date("2026-07-14T03:11:00.000Z"),
      serviceDate: "2026-07-14",
    });
    app = createServer({ db });

    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok" });

    const day = await app.inject({ method: "GET", url: "/api/days/2026-07-14" });
    expect(day.statusCode).toBe(200);
    const dayBody = day.json();
    expect(dayBody).toMatchObject({
      lastSuccessfulFetchAt: "2026-07-14T03:10:00.000Z",
      serviceDate: "2026-07-14",
      source: {
        name: "Lounaspaikka",
        url: "https://lounaspaikka.ilkkapohjalainen.fi/",
      },
      stale: false,
      status: "ready",
    });
    expect(dayBody.recommendations).toHaveLength(3);
    expect(dayBody.recommendations[0]).toMatchObject({
      menu: {
        structuredMenu: {
          courses: [expect.objectContaining({ nameFi: "Kasviscurry" })],
        },
      },
      rank: 1,
      rationale: "Kasviscurry tarjoaa päivän kiinnostavimman annoksen.",
      restaurant: { id: "a", name: "A-ravintola" },
      score: 10,
      scores: { appeal: 10, distinctiveness: 10, value: 10, variety: 10 },
    });
    expect(dayBody.menus).toHaveLength(4);
    expect(dayBody.menus[1].menu.text).toBe("Paahdettua kuhaa\n13,50 €");
    expect(dayBody.menus[1].menu.priceText).toBe("13,50 €");
    expect(dayBody.menus[1].menu.structuredMenu).toEqual({
      courses: [{
        category: "main",
        dietaryMarkers: ["G"],
        explicitAllergens: [],
        nameFi: "Paahdettua kuhaa",
      }],
    });

    const week = await app.inject({
      method: "GET",
      url: "/api/restaurants/a/weeks/2026-07-13",
    });
    expect(week.statusCode).toBe(200);
    expect(week.json()).toMatchObject({
      restaurant: {
        description: "Lounasravintola",
        id: "a",
        name: "A-ravintola",
        websiteUrl: "https://example.com/a",
      },
      weekEnd: "2026-07-19",
      weekStart: "2026-07-13",
    });
    expect(week.json().days).toHaveLength(7);
    expect(week.json().days[1]).toMatchObject({
      serviceDate: "2026-07-14",
      status: "published",
      structuredMenu: {
        courses: [expect.objectContaining({ nameFi: "Kasviscurry" })],
      },
      text: "Kasviscurry",
    });
  });

  it("rejects invalid dates and reports an unavailable day without a 404", async () => {
    db = openDatabase(":memory:");
    app = createServer({ db });

    const invalid = await app.inject({ method: "GET", url: "/api/days/2026-02-31" });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({
      error: { code: "INVALID_DATE", message: "Päivämäärä ei kelpaa." },
    });

    const missing = await app.inject({ method: "GET", url: "/api/days/2026-07-15" });
    expect(missing.statusCode).toBe(200);
    expect(missing.json()).toMatchObject({ menus: [], recommendations: [], status: "unavailable" });
  });
});
