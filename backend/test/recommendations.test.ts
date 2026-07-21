import { afterEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";

import { openDatabase } from "../src/database.js";
import { OpenAiRequestBudget } from "../src/openai-request-budget.js";
import { assessAndRankDay, structuredMenuSchema } from "../src/recommendations.js";
import { createRestaurantCatchment } from "../src/restaurant-catchment.js";
import { capturedOffering, catchmentAdapterForOfferings } from "./catchment-fixture.js";

function sourceItem(id: string, name: string, menu: string) {
  return capturedOffering(id, name, menu);
}

describe("daily recommendations", () => {
  let db: Database.Database | undefined;

  afterEach(() => db?.close());

  it("assesses only unseen revisions and creates a deterministic shared top three", async () => {
    let items = [
      sourceItem("a", "A-ravintola", "Kasviscurry"),
      sourceItem("b", "B-ravintola", "Paahdettua kuhaa"),
      sourceItem("c", "C-ravintola", "Lihapullat"),
      sourceItem("d", "D-ravintola", "Hernekeitto"),
    ];
    const lounaspaikka = catchmentAdapterForOfferings(() => items);
    const scores = new Map([
      ["Kasviscurry", 8],
      ["Paahdettua kuhaa", 9],
      ["Lihapullat", 7],
      ["Hernekeitto", 7],
    ]);
    const assess = vi.fn(async (facts: { menuText: string }) => {
      const score = scores.get(facts.menuText) ?? 0;
      return {
        assessment: {
          rationaleFi: `${facts.menuText} tarjoaa kiinnostavan lounaan.`,
          scores: {
            appeal: score,
            distinctiveness: score,
            value: score,
            variety: score,
          },
          structuredMenu: {
            courses: [{
              category: "main" as const,
              dietaryMarkers: [],
              explicitAllergens: [],
              nameFi: facts.menuText === "Paahdettua kuhaa" ? "Paahdettua kuhaa" : "Päivän lounas",
            }],
          },
        },
      };
    });
    const assessor = { assess };
    db = openDatabase(":memory:");
    const catchment = createRestaurantCatchment({ db, lounaspaikka });
    await catchment.refresh("2026-07-14");

    const first = await assessAndRankDay({
      assessor,
      db,
      serviceDate: "2026-07-14",
    });

    expect(assess).toHaveBeenCalledTimes(4);
    expect(assess.mock.calls.every(([facts]) => !("restaurantId" in facts))).toBe(true);
    expect(first.createdAssessmentCount).toBe(4);
    expect(first.recommendations.map(({ restaurantId }) => restaurantId)).toEqual(["b", "a", "c"]);
    expect(first.recommendations.map(({ rank }) => rank)).toEqual([1, 2, 3]);
    const storedMenu = db.prepare(
      `SELECT assessment.structured_menu_json AS structuredMenuJson, revision.menu_text AS menuText
       FROM assessments assessment
       JOIN offering_revisions revision ON revision.id = assessment.revision_id
       WHERE revision.restaurant_id = 'b' AND assessment.prompt_version = 'v5'
         AND assessment.schema_version = 'v4'`,
    ).get() as { menuText: string; structuredMenuJson: string };
    expect(storedMenu.menuText).toBe("Paahdettua kuhaa");
    expect(JSON.parse(storedMenu.structuredMenuJson)).toEqual({
      courses: [{
        category: "main",
        dietaryMarkers: [],
        explicitAllergens: [],
        nameFi: "Paahdettua kuhaa",
      }],
    });

    const repeated = await assessAndRankDay({
      assessor,
      db,
      serviceDate: "2026-07-14",
    });

    expect(assess).toHaveBeenCalledTimes(4);
    expect(repeated.recommendationSetId).toBe(first.recommendationSetId);
    expect(repeated.reusedRecommendationSet).toBe(true);

    items = [
      ...items.slice(0, 3),
      sourceItem("d", "D-ravintola", "Hirvenfileetä ja paahdettuja juureksia"),
    ];
    scores.set("Hirvenfileetä ja paahdettuja juureksia", 10);
    await catchment.refresh("2026-07-14");

    const changed = await assessAndRankDay({
      assessor,
      db,
      serviceDate: "2026-07-14",
    });

    expect(assess).toHaveBeenCalledTimes(5);
    expect(assess.mock.calls[4]?.[0]).toMatchObject({
      menuText: "Hirvenfileetä ja paahdettuja juureksia",
      serviceDate: "2026-07-14",
    });
    expect(changed.createdAssessmentCount).toBe(1);
    expect(changed.recommendations.map(({ restaurantId }) => restaurantId)).toEqual(["d", "b", "a"]);
  });

  it("rolls back a recommendation set when its entries cannot be saved", async () => {
    const items = [sourceItem("a", "A-ravintola", "Kasviscurry")];
    const lounaspaikka = catchmentAdapterForOfferings(items);
    db = openDatabase(":memory:");
    await createRestaurantCatchment({ db, lounaspaikka }).refresh("2026-07-14");
    db.exec(`
      CREATE TRIGGER reject_recommendation_entries
      BEFORE INSERT ON recommendation_entries
      BEGIN
        SELECT RAISE(ABORT, 'entry failure');
      END;
    `);

    await expect(
      assessAndRankDay({
        assessor: {
          assess: async () => ({
            assessment: {
              rationaleFi: "Kiinnostava päivän lounas.",
              scores: { appeal: 8, distinctiveness: 8, value: 8, variety: 8 },
              structuredMenu: { courses: [] },
            },
          }),
        },
        db,
        serviceDate: "2026-07-14",
      }),
    ).rejects.toThrow("entry failure");

    const count = db.prepare("SELECT COUNT(*) AS count FROM recommendation_sets").get() as {
      count: number;
    };
    expect(count.count).toBe(0);
  });

  it("owns the request budget before crossing the assessment seam", async () => {
    const items = [sourceItem("a", "A-ravintola", "Kasviscurry")];
    const lounaspaikka = catchmentAdapterForOfferings(items);
    db = openDatabase(":memory:");
    await createRestaurantCatchment({ db, lounaspaikka }).refresh("2026-07-14");
    const assess = vi.fn().mockRejectedValue(new Error("provider unavailable"));

    await expect(
      assessAndRankDay({
        assessor: { assess },
        budget: new OpenAiRequestBudget(0),
        db,
        serviceDate: "2026-07-14",
      }),
    ).rejects.toThrow("budget");
    expect(assess).not.toHaveBeenCalled();

    const budget = new OpenAiRequestBudget(1);
    await expect(
      assessAndRankDay({
        assessor: { assess },
        budget,
        db,
        serviceDate: "2026-07-14",
      }),
    ).rejects.toThrow("provider unavailable");
    expect(assess).toHaveBeenCalledTimes(1);
    expect(budget).toMatchObject({ remaining: 0, used: 1 });
  });
});

describe("structured menu schema", () => {
  it("allows an unknown category and a complete explicit allergen declaration", () => {
    const course = {
      category: "unknown",
      dietaryMarkers: [],
      explicitAllergens: Array.from({ length: 16 }, (_, index) => `allergeeni-${index + 1}`),
      nameFi: "Päivän annos",
    };

    expect(structuredMenuSchema.safeParse({ courses: [course] }).success).toBe(true);
    expect(
      structuredMenuSchema.safeParse({
        courses: [{ ...course, explicitAllergens: [...course.explicitAllergens, "liikaa"] }],
      }).success,
    ).toBe(false);
  });

  it("preserves a long published course name without allowing unbounded output", () => {
    const longName = "Keitetyt naudanliha-sipulidumplingit tai keitetyt porsaanliha-purjo-kiinankaali-sieni-maissi-ruohosipuli-katkarapudumplingit";

    expect(longName.length).toBeGreaterThan(120);
    expect(structuredMenuSchema.safeParse({
      courses: [{
        category: "main",
        dietaryMarkers: [],
        explicitAllergens: [],
        nameFi: longName,
      }],
    }).success).toBe(true);
    expect(structuredMenuSchema.safeParse({
      courses: [{
        category: "main",
        dietaryMarkers: [],
        explicitAllergens: [],
        nameFi: "x".repeat(301),
      }],
    }).success).toBe(false);
  });
});
