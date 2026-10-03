import { describe, expect, it } from "vitest";

import { lunchPrice, mainCourses, priceLabel } from "./menu-comparison";
import type { Menu } from "./types";

const menu: Menu = { lunchHours: null, priceText: null, status: "published", structuredMenu: null, text: null, title: null };

describe("lunch comparison facts", () => {
  it("uses only unambiguous legacy prices and preserves ranges, from prices and unknowns", () => {
    expect(lunchPrice({ ...menu, priceText: "13,50 €" })).toEqual({ minEur: 13.5, maxEur: 13.5 });
    for (const priceText of ["Lapset 7 €", "12 €/kg", "Kahvi 2 €", "Etukortilla 9 €", "Keitto 11 €, buffet 14 €"]) {
      expect(lunchPrice({ ...menu, priceText })).toBeNull();
    }
    const comparison = { mainCourseIndices: [], vegetarianMain: null, veganMain: null, coffeeIncluded: null, price: null };
    const withPrice = (price: { minEur: number; maxEur: number | null } | null): Menu => ({
      ...menu, structuredMenu: { courses: [], comparison: { ...comparison, price } },
    });
    expect(priceLabel(withPrice({ minEur: 11, maxEur: 14.5 }))).toBe("11,00–14,50 €");
    expect(priceLabel(withPrice({ minEur: 12, maxEur: null }))).toBe("alk. 12,00 €");
    expect(priceLabel(withPrice(null))).toBe("Hinta ei ilmoitettu");
    expect(lunchPrice({ ...withPrice(null), priceText: "13,50 €" })).toBeNull();
  });

  it("keeps sides out of legacy highlights while retaining the source dishes", () => {
    const structuredMenu: NonNullable<Menu["structuredMenu"]> = { courses: [
      { category: "side", nameFi: "Riisiä", dietaryMarkers: ["V"], explicitAllergens: [] },
      { category: "main", nameFi: "Teriyaki-naudanlihaa", dietaryMarkers: [], explicitAllergens: [] },
      { category: "salad", nameFi: "Salaattipöytä", dietaryMarkers: ["VE"], explicitAllergens: [] },
      { category: "drink", nameFi: "Kahvi", dietaryMarkers: [], explicitAllergens: [] },
    ] };
    expect(mainCourses({ ...menu, structuredMenu }).map((course) => course.nameFi)).toEqual(["Teriyaki-naudanlihaa"]);
    expect(structuredMenu.courses).toHaveLength(4);
  });
});
