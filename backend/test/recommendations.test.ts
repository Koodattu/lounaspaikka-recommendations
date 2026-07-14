import { afterEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";

import { openDatabase } from "../src/database.js";
import { ingestLunchDay } from "../src/ingestion.js";
import { assessAndRankDay, structuredMenuSchema } from "../src/recommendations.js";
import type { LunchSource } from "../src/source.js";

function sourceItem(id: string, name: string, menu: string) {
  return {
    ads: [
      {
        ad: {
          body: menu,
          contentType: 32,
          header: "Päivän lounas",
          lunchOh: "10.30-14",
        },
      },
    ],
    city: "Seinäjoki",
    id,
    marker: { latitude: "62.79", longitude: "22.84" },
    name,
  };
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
    const source: LunchSource = {
      fetchLunchDay: async (serviceDate) => ({
        items,
        pages: [{ body: JSON.stringify({ items }), status: 200, url: "fixture" }],
        request: { latitude: 62.7907, longitude: 22.8396, maxDistance: 50_000, serviceDate },
      }),
    };
    const scores = new Map([
      ["a", 8],
      ["b", 9],
      ["c", 7],
      ["d", 7],
    ]);
    const assessor = vi.fn(async ({ offerings }) =>
      offerings.map((offering: { restaurantId: string; revisionId: number }) => {
        const score = scores.get(offering.restaurantId) ?? 0;
        return {
          rationaleFi: `${offering.restaurantId.toUpperCase()} tarjoaa kiinnostavan lounaan.`,
          revisionId: offering.revisionId,
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
              nameFi: offering.restaurantId === "b" ? "Paahdettua kuhaa" : "Päivän lounas",
            }],
          },
        };
      }),
    );
    db = openDatabase(":memory:");
    await ingestLunchDay({ db, serviceDate: "2026-07-14", source });

    const first = await assessAndRankDay({
      assessor,
      db,
      serviceDate: "2026-07-14",
    });

    expect(assessor).toHaveBeenCalledTimes(4);
    expect(assessor.mock.calls.every(([request]) => request.offerings.length === 1)).toBe(true);
    expect(first.createdAssessmentCount).toBe(4);
    expect(first.recommendations.map(({ restaurantId }) => restaurantId)).toEqual(["b", "a", "c"]);
    expect(first.recommendations.map(({ rank }) => rank)).toEqual([1, 2, 3]);
    const storedMenu = db.prepare(
      `SELECT assessment.structured_menu_json AS structuredMenuJson, revision.menu_text AS menuText
       FROM assessments assessment
       JOIN offering_revisions revision ON revision.id = assessment.revision_id
       WHERE revision.restaurant_id = 'b' AND assessment.prompt_version = 'v4'
         AND assessment.schema_version = 'v3'`,
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

    expect(assessor).toHaveBeenCalledTimes(4);
    expect(repeated.recommendationSetId).toBe(first.recommendationSetId);
    expect(repeated.reusedRecommendationSet).toBe(true);

    items = [
      ...items.slice(0, 3),
      sourceItem("d", "D-ravintola", "Hirvenfileetä ja paahdettuja juureksia"),
    ];
    scores.set("d", 10);
    await ingestLunchDay({ db, serviceDate: "2026-07-14", source });

    const changed = await assessAndRankDay({
      assessor,
      db,
      serviceDate: "2026-07-14",
    });

    expect(assessor).toHaveBeenCalledTimes(5);
    expect(assessor.mock.calls[4]?.[0].offerings).toHaveLength(1);
    expect(changed.createdAssessmentCount).toBe(1);
    expect(changed.recommendations.map(({ restaurantId }) => restaurantId)).toEqual(["d", "b", "a"]);
  });

  it("rolls back a recommendation set when its entries cannot be saved", async () => {
    const items = [sourceItem("a", "A-ravintola", "Kasviscurry")];
    const source: LunchSource = {
      fetchLunchDay: async (serviceDate) => ({
        items,
        pages: [{ body: JSON.stringify({ items }), status: 200, url: "fixture" }],
        request: { latitude: 62.7907, longitude: 22.8396, maxDistance: 50_000, serviceDate },
      }),
    };
    db = openDatabase(":memory:");
    await ingestLunchDay({ db, serviceDate: "2026-07-14", source });
    db.exec(`
      CREATE TRIGGER reject_recommendation_entries
      BEFORE INSERT ON recommendation_entries
      BEGIN
        SELECT RAISE(ABORT, 'entry failure');
      END;
    `);

    await expect(
      assessAndRankDay({
        assessor: async ({ offerings }) =>
          offerings.map((offering) => ({
            rationaleFi: "Kiinnostava päivän lounas.",
            revisionId: offering.revisionId,
            scores: { appeal: 8, distinctiveness: 8, value: 8, variety: 8 },
            structuredMenu: { courses: [] },
          })),
        db,
        serviceDate: "2026-07-14",
      }),
    ).rejects.toThrow("entry failure");

    const count = db.prepare("SELECT COUNT(*) AS count FROM recommendation_sets").get() as {
      count: number;
    };
    expect(count.count).toBe(0);
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
});
