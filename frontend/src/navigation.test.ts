import { describe, expect, it } from "vitest";

import {
  appRoute,
  dayHref,
  dayRouteDate,
  restaurantHref,
  restaurantRouteState,
  restaurantWeekHref,
} from "./navigation";

describe("navigation", () => {
  it("parses app routes while preserving the daily fallback", () => {
    expect(appRoute("/admin/")).toEqual({ kind: "admin" });
    expect(appRoute("/ravintolat/Vinola%20Keskusta")).toEqual({
      kind: "restaurant",
      restaurantId: "Vinola Keskusta",
    });
    expect(appRoute("/tuntematon")).toEqual({ kind: "day" });
    expect(() => appRoute("/ravintolat/%E0%A4%A")).toThrow(URIError);
  });

  it("parses day and restaurant query state with the existing precedence", () => {
    expect(dayRouteDate("?date=2026-07-14", "2026-07-21")).toBe("2026-07-14");
    expect(dayRouteDate("?date=invalid", "2026-07-21")).toBe("2026-07-21");
    expect(restaurantRouteState(
      "?week=2026-07-20&date=2026-07-14",
      "2026-07-21",
    )).toEqual({ selectedDate: "2026-07-14", week: "2026-07-13" });
    expect(restaurantRouteState("?week=2026-07-15", "2026-07-21")).toEqual({
      selectedDate: "2026-07-13",
      week: "2026-07-13",
    });
  });

  it("formats the current URL shapes", () => {
    expect(dayHref("2026-07-14")).toBe("/?date=2026-07-14");
    expect(restaurantHref("Vinola Keskusta", "2026-07-14")).toBe(
      "/ravintolat/Vinola%20Keskusta?week=2026-07-13&date=2026-07-14",
    );
    expect(restaurantWeekHref("vinola", "2026-07-20", "2026-07-21")).toBe(
      "/ravintolat/vinola?week=2026-07-20&date=2026-07-21",
    );
  });
});
