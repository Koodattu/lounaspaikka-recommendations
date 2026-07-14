import { afterEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";

import { createCustomSourceService } from "../src/custom-sources.js";
import { openDatabase } from "../src/database.js";
import { ingestLunchDay } from "../src/ingestion.js";
import { getDayMenus, getOfferingHistory, getRestaurantWeek } from "../src/queries.js";
import { assessAndRankDay, type Assessor } from "../src/recommendations.js";
import type { LunchSource } from "../src/source.js";

const serviceDates = ["2026-07-14", "2026-07-15"];

function lounaspaikkaSource(): LunchSource {
  const items = [
    {
      ads: [
        {
          ad: {
            body: "Paahdettua kuhaa",
            contentType: 32,
            header: "Lounas 14.7.",
            lunchOh: "10.30-14",
          },
        },
      ],
      id: "api-restaurant",
      marker: { latitude: "62.79", longitude: "22.84" },
      name: "API-ravintola",
    },
  ];
  return {
    fetchLunchDay: async (serviceDate) => ({
      items,
      pages: [{ body: JSON.stringify({ items }), status: 200, url: "fixture" }],
      request: { latitude: 62.7907, longitude: 22.8396, maxDistance: 50_000, serviceDate },
    }),
  };
}

describe("custom menu sources", () => {
  let db: Database.Database | undefined;

  afterEach(() => db?.close());

  it("unions source-scoped snapshots and reuses an unchanged page extraction", async () => {
    db = openDatabase(":memory:");
    expect(db.pragma("user_version", { simple: true })).toBe(4);
    await ingestLunchDay({
      db,
      now: () => new Date("2026-07-14T03:00:00.000Z"),
      serviceDate: serviceDates[0]!,
      source: lounaspaikkaSource(),
    });

    const fetchPage = vi.fn(async () => ({
      body: "<h2>Lounasbuffet</h2><h4>Ti 14.7.</h4><p>Lihapullat</p>",
      finalUrl: "https://backyard.fi/ideapark/",
      httpStatus: 200,
      text: "Lounasbuffet\nTi 14.7.\nLihapullat",
      truncated: false,
    }));
    const extractor = vi.fn(async () => ({
      extraction: {
        menus: [
          {
            lunchHours: "10.30–15.00",
            menuText: "Lihapullat sipuli-kermakastikkeessa\nPaahdetut perunat",
            priceText: "14 €",
            serviceDate: "2026-07-14",
            status: "published" as const,
            title: "Lounasbuffet",
          },
          {
            lunchHours: null,
            menuText: null,
            priceText: null,
            serviceDate: "2026-07-15",
            status: "not_found" as const,
            title: null,
          },
        ],
        pageType: "restaurant_page" as const,
        restaurant: {
          address: "Suupohjantie 57",
          city: "Seinäjoki",
          description: "Ravintola Ideaparkissa.",
          name: "Backyard Ideapark",
          openingHours: [
            { close: "20.00", open: "10.30", weekday: "TU" as const },
          ],
          phone: "+358 50 588 2085",
        },
      },
      inputTokens: 500,
      outputTokens: 180,
      providerResponseId: "resp_custom_1",
    }));
    const service = createCustomSourceService({
      db,
      extractor,
      fetchPage,
      model: "gpt-5.4-nano",
      now: () => new Date("2026-07-14T04:00:00.000Z"),
    });

    const first = await service.addAndCrawl(
      "https://backyard.fi/ideapark/",
      serviceDates,
    );

    expect(first).toMatchObject({ createdRevisionCount: 2, reusedExtraction: false });
    expect(getDayMenus(db, "2026-07-14")).toEqual([
      expect.objectContaining({ restaurant: expect.objectContaining({ id: "api-restaurant" }) }),
      expect.objectContaining({
        menu: expect.objectContaining({
          priceText: "14 €",
          source: {
            name: "Backyard Ideapark",
            url: "https://backyard.fi/ideapark/",
          },
        }),
        restaurant: expect.objectContaining({
          id: `custom:${first.sourceId}`,
          name: "Backyard Ideapark",
        }),
      }),
    ]);
    expect(getDayMenus(db, "2026-07-15")[0]?.menu.status).toBe("not_published");
    expect(getRestaurantWeek(db, `custom:${first.sourceId}`, "2026-07-20")?.source).toEqual({
      name: "Backyard Ideapark",
      url: "https://backyard.fi/ideapark/",
    });

    const assessor = vi.fn<Assessor>(async ({ offerings }) =>
      offerings.map((offering, index) => ({
        rationaleFi: `${offering.restaurantName} kiinnostaa tänään.`,
        revisionId: offering.revisionId,
        scores: {
          appeal: 9 - index,
          distinctiveness: 8 - index,
          value: 8 - index,
          variety: 8 - index,
        },
        structuredMenu: {
          courses: [{
            category: "main" as const,
            dietaryMarkers: [],
            explicitAllergens: [],
            nameFi: offering.restaurantName,
          }],
        },
      })),
    );
    await assessAndRankDay({
      assessor,
      db,
      serviceDate: "2026-07-14",
    });
    expect(assessor).toHaveBeenCalledTimes(2);
    expect(
      assessor.mock.calls.map(([request]) => request.offerings[0]?.restaurantName),
    ).toEqual(["API-ravintola", "Backyard Ideapark"]);
    expect(assessor.mock.calls.every(([request]) => request.offerings.length === 1)).toBe(true);

    await service.crawlAll(serviceDates);

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(extractor).toHaveBeenCalledTimes(1);
    expect(getOfferingHistory(db, `custom:${first.sourceId}`, "2026-07-14")).toHaveLength(1);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM custom_source_runs").get(),
    ).toEqual({ count: 2 });

    const updatedModelService = createCustomSourceService({
      db,
      extractor,
      fetchPage,
      model: "gpt-next",
      now: () => new Date("2026-07-14T05:00:00.000Z"),
    });
    await updatedModelService.crawlAll(serviceDates);
    expect(extractor).toHaveBeenCalledTimes(2);
  });

  it("records a truncated page as a failure without extracting partial content", async () => {
    db = openDatabase(":memory:");
    const extractor = vi.fn();
    const service = createCustomSourceService({
      db,
      extractor,
      fetchPage: async () => ({
        body: "long page",
        finalUrl: "https://example.com/menu",
        httpStatus: 200,
        text: "partial page",
        truncated: true,
      }),
      model: "gpt-5.4-nano",
    });

    await expect(
      service.addAndCrawl("https://example.com/menu", serviceDates),
    ).rejects.toThrow("too long");

    expect(extractor).not.toHaveBeenCalled();
    expect(db.prepare("SELECT COUNT(*) AS count FROM offering_revisions").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT outcome FROM custom_source_runs").get()).toEqual({
      outcome: "invalid_response",
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM source_fetches").get()).toEqual({ count: 2 });
  });
});
