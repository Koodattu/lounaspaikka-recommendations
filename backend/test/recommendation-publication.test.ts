import { afterEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";

import type { CustomSourceService } from "../src/custom-sources.js";
import { openDatabase } from "../src/database.js";
import { persistSuccessfulFetch, type StoredOffering } from "../src/offering-store.js";
import { createRecommendationPublication } from "../src/recommendation-publication.js";

function offering(serviceDate: string): StoredOffering {
  return {
    address: null,
    availability: "published",
    city: "Seinäjoki",
    customSourceId: null,
    descriptionText: null,
    id: `restaurant-${serviceDate}`,
    latitude: null,
    longitude: null,
    lunchHours: null,
    menuText: `Lounas ${serviceDate}`,
    menuTitle: null,
    name: `Ravintola ${serviceDate}`,
    openingHours: [],
    phone: null,
    photoUrl: null,
    priceText: null,
    snapshot: {},
    websiteUrl: null,
  };
}

function persistDate(db: Database.Database, serviceDate: string): void {
  persistSuccessfulFetch({
    db,
    finishedAt: `${serviceDate}T03:00:00.000Z`,
    offerings: [offering(serviceDate)],
    request: { serviceDate },
    responseHash: serviceDate,
    serviceDate,
    startedAt: `${serviceDate}T02:59:00.000Z`,
  });
}

function assessment(menuText: string) {
  return {
    assessment: {
      rationaleFi: `${menuText} kiinnostaa tänään.`,
      scores: { appeal: 8, distinctiveness: 8, value: 8, variety: 8 },
      structuredMenu: { courses: [] },
    },
  };
}

describe("Recommendation publication run", () => {
  let db: Database.Database | undefined;

  afterEach(() => db?.close());

  it("returns every date outcome and continues after an assessment failure", async () => {
    db = openDatabase(":memory:");
    const serviceDates = ["2026-07-14", "2026-07-15"];
    serviceDates.forEach((serviceDate) => persistDate(db!, serviceDate));
    const assess = vi
      .fn()
      .mockRejectedValueOnce(new Error("first date failed"))
      .mockImplementationOnce(async (facts) => assessment(facts.menuText));
    const crawlAll = vi.fn(async () => undefined);
    const customSources = {
      addAndCrawl: vi.fn(),
      crawlAll,
    } as unknown as CustomSourceService;
    const publication = createRecommendationPublication({
      adminRequestBudget: 2,
      assessor: { assess },
      customSources,
      db,
      refreshRequestBudget: 2,
      versions: {},
    });

    const outcome = await publication.runScheduled(serviceDates);

    expect(crawlAll).toHaveBeenCalledTimes(1);
    expect(assess).toHaveBeenCalledTimes(2);
    expect(outcome.dates).toMatchObject([
      { serviceDate: "2026-07-14", status: "failed" },
      { serviceDate: "2026-07-15", status: "succeeded" },
    ]);
  });

  it("shares the admin run budget between extraction and assessment", async () => {
    db = openDatabase(":memory:");
    const serviceDate = "2026-07-14";
    persistDate(db, serviceDate);
    const assess = vi.fn(async (facts) => assessment(facts.menuText));
    const addAndCrawl = vi.fn<CustomSourceService["addAndCrawl"]>(
      async (_url, _serviceDates, budget) => {
        budget?.consume();
        return {
          createdRevisionCount: 1,
          restaurantId: "custom:1",
          reusedExtraction: false,
          sourceId: 1,
        };
      },
    );
    const customSources = {
      addAndCrawl,
      crawlAll: vi.fn(),
    } as CustomSourceService;
    const publication = createRecommendationPublication({
      adminRequestBudget: 1,
      assessor: { assess },
      customSources,
      db,
      refreshRequestBudget: 1,
      versions: {},
    });

    const result = await publication.addCustomSource(
      "https://example.com/menu",
      [serviceDate],
    );

    expect(result.source).toMatchObject({ sourceId: 1 });
    expect(result.outcome.dates).toMatchObject([
      { serviceDate, status: "failed" },
    ]);
    expect(assess).not.toHaveBeenCalled();
    expect(result.outcome.dates[0]).toMatchObject({
      error: expect.objectContaining({ name: "OpenAiRequestBudgetExceededError" }),
    });
  });
});
