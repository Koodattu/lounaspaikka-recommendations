import { afterEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";

import { createCustomSourceService } from "../src/custom-sources.js";
import { openDatabase } from "../src/database.js";
import { OpenAiRequestBudget } from "../src/openai-request-budget.js";
import { getDayMenus, getOfferingHistory, getRestaurantWeek } from "../src/queries.js";
import { assessAndRankDay, type AssessmentAdapter } from "../src/recommendations.js";
import type { LounaspaikkaCatchmentAdapter } from "../src/lounaspaikka-catchment.js";
import { createRestaurantCatchment } from "../src/restaurant-catchment.js";
import { capturedOffering, catchmentAdapterForOfferings } from "./catchment-fixture.js";

const serviceDates = ["2026-07-14", "2026-07-15"];

function lounaspaikkaAdapter(): LounaspaikkaCatchmentAdapter {
  return catchmentAdapterForOfferings([
    capturedOffering("api-restaurant", "API-ravintola", "Paahdettua kuhaa"),
  ]);
}

describe("custom menu sources", () => {
  let db: Database.Database | undefined;

  afterEach(() => db?.close());

  it("unions source-scoped snapshots and reuses an unchanged page extraction", async () => {
    db = openDatabase(":memory:");
    expect(db.pragma("user_version", { simple: true })).toBe(5);
    await createRestaurantCatchment({
      db,
      lounaspaikka: lounaspaikkaAdapter(),
      now: () => new Date("2026-07-14T03:00:00.000Z"),
    }).refresh(serviceDates[0]!);

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

    const extractionBudget = new OpenAiRequestBudget(1);
    const first = await service.addAndCrawl(
      "https://backyard.fi/ideapark/",
      serviceDates,
      extractionBudget,
    );

    expect(first).toMatchObject({ createdRevisionCount: 2, reusedExtraction: false });
    expect(extractionBudget).toMatchObject({ remaining: 0, used: 1 });
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

    const assess = vi.fn<AssessmentAdapter["assess"]>(async (facts) => ({
      assessment: {
        rationaleFi: `${facts.menuText} kiinnostaa tänään.`,
        scores: {
          appeal: 9,
          distinctiveness: 8,
          value: 8,
          variety: 8,
        },
        structuredMenu: {
          courses: [{
            category: "main" as const,
            dietaryMarkers: [],
            explicitAllergens: [],
            nameFi: facts.menuText.split("\n")[0]!,
          }],
        },
      },
    }));
    const assessor = { assess };
    await assessAndRankDay({
      assessor,
      db,
      serviceDate: "2026-07-14",
    });
    expect(assess).toHaveBeenCalledTimes(2);
    expect(
      assess.mock.calls.map(([facts]) => facts.menuText),
    ).toEqual([
      "Paahdettua kuhaa",
      "Lihapullat sipuli-kermakastikkeessa\nPaahdetut perunat",
    ]);
    expect(assess.mock.calls.every(([facts]) => !("restaurantName" in facts))).toBe(true);

    const cachedBudget = new OpenAiRequestBudget(0);
    await service.crawlAll(serviceDates, cachedBudget);

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(extractor).toHaveBeenCalledTimes(1);
    expect(cachedBudget).toMatchObject({ remaining: 0, used: 0 });
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
