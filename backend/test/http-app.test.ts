import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import { openDatabase } from "../src/database.js";
import { createServer } from "../src/http-app.js";
import { ingestLunchDay } from "../src/ingestion.js";
import { assessAndRankDay } from "../src/recommendations.js";
import type { LunchSource } from "../src/source.js";

function item(id: string, name: string, body: string) {
  return {
    address: `${name}ntie 1`,
    ads: [
      {
        ad: {
          body,
          contentType: 32,
          header: "Lounas 14.7.",
          lunchOh: "10.30-14",
        },
      },
    ],
    city: "Seinäjoki",
    desc: "Lounasravintola<br>",
    id,
    marker: { latitude: "62.79", longitude: "22.84" },
    name,
    openingHours: [{ mon: [{ close: "14.00", open: "10.30" }] }],
    www: `https://example.com/${id}`,
  };
}

describe("reader API", () => {
  let app: FastifyInstance | undefined;
  let db: Database.Database | undefined;

  afterEach(async () => {
    await app?.close();
    db?.close();
  });

  it("serves health, a Finnish-ready day and a seven-day restaurant week", async () => {
    const items = [
      item("a", "A-ravintola", "Kasviscurry"),
      item("b", "B-ravintola", "Paahdettua kuhaa<br>13,50 €"),
      item("c", "C-ravintola", "Lihapullat"),
      item("d", "D-ravintola", "Hernekeitto"),
    ];
    const source: LunchSource = {
      fetchLunchDay: async (serviceDate) => ({
        items,
        pages: [{ body: JSON.stringify({ items }), status: 200, url: "fixture" }],
        request: { latitude: 62.7907, longitude: 22.8396, maxDistance: 50_000, serviceDate },
      }),
    };
    db = openDatabase(":memory:");
    await ingestLunchDay({
      db,
      now: () => new Date("2026-07-14T03:10:00.000Z"),
      serviceDate: "2026-07-14",
      source,
    });
    await assessAndRankDay({
      assessor: async ({ offerings }) =>
        offerings.map((offering, index) => ({
          rationaleFi: `${offering.restaurantName} tarjoaa päivän kiinnostavimman annoksen.`,
          revisionId: offering.revisionId,
          scores: {
            appeal: 10 - index,
            distinctiveness: 10 - index,
            value: 10 - index,
            variety: 10 - index,
          },
        })),
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
      rank: 1,
      rationale: "A-ravintola tarjoaa päivän kiinnostavimman annoksen.",
      restaurant: { id: "a", name: "A-ravintola" },
      score: 10,
    });
    expect(dayBody.menus).toHaveLength(4);
    expect(dayBody.menus[1].menu.text).toBe("Paahdettua kuhaa\n13,50 €");

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
