import type { MenuView } from "./navigation";
import type { DayResponse, Menu } from "./types";

export function lunchPrice(menu: Menu): { minEur: number; maxEur: number | null } | null {
  if (menu.status !== "published") return null;
  if (menu.structuredMenu?.comparison) return menu.structuredMenu.comparison.price;
  // Historical assessments have no comparison facts. Only a standalone EUR amount is unambiguous.
  const amount = menu.priceText?.match(/^\s*(\d+(?:[,.]\d{1,2})?)\s*(?:€|eur)\s*$/i)?.[1];
  if (!amount) return null;
  const value = Number(amount.replace(",", "."));
  return { minEur: value, maxEur: value };
}

export function priceLabel(menu: Menu): string {
  const price = lunchPrice(menu);
  if (!price) return menu.priceText
    ? menu.priceText.length <= 40 ? menu.priceText : "Katso hinnat"
    : "Hinta ei ilmoitettu";
  const format = (value: number) => value.toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price.maxEur === null) return `alk. ${format(price.minEur)} €`;
  return price.minEur === price.maxEur
    ? `${format(price.minEur)} €`
    : `${format(price.minEur)}–${format(price.maxEur)} €`;
}

export function mainCourses(menu: Menu) {
  const structured = menu.structuredMenu;
  if (!structured) return [];
  return structured.comparison
    ? structured.comparison.mainCourseIndices.map((index) => structured.courses[index]).filter((course) => course !== undefined).slice(0, 3)
    : structured.courses.filter((course) => course.category === "main" || course.category === "soup").slice(0, 3);
}

export function compareMenus(data: DayResponse, query: string, view: MenuView) {
  const legacy = new Map(data.recommendations.map((entry) => [entry.restaurant.id, entry]));
  const ranked = data.menus.map((entry) => ({
    ...entry,
    // Allows an older API response during a rolling frontend/backend deployment.
    assessment: entry.assessment === undefined ? legacy.get(entry.restaurant.id) ?? null : entry.assessment,
  })).sort((a, b) => {
    if (a.assessment && b.assessment) return b.assessment.score - a.assessment.score
      || (a.restaurant.id < b.restaurant.id ? -1 : a.restaurant.id > b.restaurant.id ? 1 : 0);
    if (a.assessment) return -1;
    if (b.assessment) return 1;
    return a.restaurant.name.localeCompare(b.restaurant.name, "fi-FI");
  }).map((entry, index) => ({ ...entry, rank: entry.assessment ? index + 1 : null }));
  const terms = query.trim().toLocaleLowerCase("fi-FI").split(/\s+/).filter(Boolean);
  const entries = ranked.filter(({ restaurant, menu }) => {
    const facts = menu.structuredMenu?.comparison;
    if (view.diet !== "all" && menu.status !== "published") return false;
    if (view.diet === "vegetarian" && facts?.vegetarianMain !== true) return false;
    if (view.diet === "vegan" && facts?.veganMain !== true) return false;
    const text = [restaurant.name, restaurant.city, restaurant.address, menu.title, menu.text,
      ...(menu.structuredMenu?.courses.map((course) => course.nameFi) ?? []),
    ].filter(Boolean).join(" ").toLocaleLowerCase("fi-FI");
    return terms.every((term) => text.includes(term));
  });
  if (view.sort === "price") entries.sort((a, b) => {
    const first = lunchPrice(a.menu)?.minEur ?? Infinity;
    const second = lunchPrice(b.menu)?.minEur ?? Infinity;
    // Stable sort preserves score order for equal or unknown prices.
    return first === second ? 0 : first - second;
  });
  return { entries, assessedCount: ranked.filter((entry) => entry.assessment).length };
}
