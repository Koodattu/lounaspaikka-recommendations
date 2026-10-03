import { afterEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";

import { createCustomSourceService, type CustomSourceService } from "../src/custom-sources.js";
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

  it("publishes overlapping scheduled and source-add runs without duplicate assessments or failed dates", async () => {
    db = openDatabase(":memory:");
    const serviceDate = "2026-07-14";
    persistDate(db, serviceDate);
    let signalStarted!: () => void;
    let releaseAssessment!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseAssessment = resolve; });
    const assess = vi.fn(async (facts: { menuText: string }) => {
      signalStarted();
      await release;
      return assessment(facts.menuText);
    });
    const customSources = createCustomSourceService({
      db, model: "test",
      fetchPage: async (url) => ({ body: "fixture", text: "Kasviskeitto", finalUrl: url, httpStatus: 200, truncated: false }),
      extractor: async () => ({ extraction: {
        pageType: "restaurant_page",
        restaurant: { name: "Testikeittiö", address: null, city: null, description: null, phone: null, openingHours: [] },
        menus: [{ serviceDate, status: "published", menuText: "Kasviskeitto", lunchHours: null, priceText: null, title: null }],
      } }),
    });
    const publication = createRecommendationPublication({
      db, assessor: { assess }, customSources, versions: {},
      adminRequestBudget: 5, refreshRequestBudget: 5,
    });
    const scheduled = publication.runScheduled([serviceDate]);
    await started;
    const added = publication.addCustomSource("https://example.com/menu", [serviceDate]);
    // Allow the second caller to reach the pending provider call, if not coordinated.
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseAssessment();
    const [scheduledResult, addedResult] = await Promise.all([scheduled, added]);
    expect(scheduledResult.dates).toMatchObject([{ serviceDate, status: "succeeded" }]);
    expect(addedResult.outcome.dates[0]).not.toHaveProperty("error");
    expect(addedResult.outcome.dates).toMatchObject([{ serviceDate, status: "succeeded" }]);
    expect(assess.mock.calls.map(([facts]) => facts.menuText)).toEqual([
      "Lounas 2026-07-14", "Kasviskeitto",
    ]);
  });

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

  it("continues queued publication after a source-add request rejects", async () => {
    db = openDatabase(":memory:");
    persistDate(db, "2026-07-14");
    const publication = createRecommendationPublication({
      db,
      assessor: { assess: async (facts) => assessment(facts.menuText) },
      customSources: createCustomSourceService({
        db, model: "test",
        fetchPage: async () => { throw new Error("Source unavailable"); },
        extractor: async () => { throw new Error("Extraction must not run"); },
      }),
      adminRequestBudget: 1, refreshRequestBudget: 1, versions: {},
    });
    const failed = publication.addCustomSource("https://example.com/menu", ["2026-07-14"]);
    const scheduled = publication.runScheduled(["2026-07-14"]);
    await expect(failed).rejects.toThrow("Source unavailable");
    expect((await scheduled).dates).toMatchObject([{ serviceDate: "2026-07-14", status: "succeeded" }]);
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
