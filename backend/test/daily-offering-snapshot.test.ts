import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";

import { getDailyOfferingSnapshot } from "../src/daily-offering-snapshot.js";
import { openDatabase } from "../src/database.js";
import { getRestaurantWeek } from "../src/queries.js";
import {
  persistFailedFetch,
  persistSuccessfulFetch,
  type StoredOffering,
} from "../src/offering-store.js";

function offering(
  id: string,
  name: string,
  menuText: string,
  customSourceId: number | null = null,
): StoredOffering {
  return {
    address: null,
    availability: "published",
    city: "Seinäjoki",
    customSourceId,
    descriptionText: null,
    id,
    latitude: null,
    longitude: null,
    lunchHours: "10.30–14",
    menuText,
    menuTitle: "Lounas",
    name,
    openingHours: [],
    phone: null,
    photoUrl: null,
    priceText: null,
    snapshot: { menuText },
    websiteUrl: null,
  };
}

describe("Daily offering snapshot", () => {
  let db: Database.Database | undefined;

  afterEach(() => db?.close());

  it("uses each enabled source's latest success and ignores later failed attempts", () => {
    db = openDatabase(":memory:");
    const serviceDate = "2026-07-14";
    persistSuccessfulFetch({
      db,
      finishedAt: "2026-07-14T03:00:00.000Z",
      offerings: [offering("main", "Pääravintola", "Kasviscurry")],
      request: { serviceDate },
      responseHash: "main-one",
      serviceDate,
      startedAt: "2026-07-14T02:59:00.000Z",
    });
    persistFailedFetch({
      db,
      errorMessage: "temporary failure",
      finishedAt: "2026-07-14T04:00:00.000Z",
      outcome: "network_error",
      request: { serviceDate },
      serviceDate,
      startedAt: "2026-07-14T03:59:00.000Z",
    });

    const source = db.prepare(
      "INSERT INTO custom_sources (url, enabled, created_at) VALUES (?, 1, ?)",
    ).run("https://example.com/menu", "2026-07-14T02:00:00.000Z");
    const customSourceId = Number(source.lastInsertRowid);
    persistSuccessfulFetch({
      customSourceId,
      db,
      finishedAt: "2026-07-14T03:30:00.000Z",
      offerings: [offering("custom:1", "Oma ravintola", "Lohikeitto", customSourceId)],
      request: { serviceDate },
      responseHash: "custom-one",
      serviceDate,
      startedAt: "2026-07-14T03:29:00.000Z",
    });

    const current = getDailyOfferingSnapshot(db, serviceDate);
    expect(current.entries.map((entry) => entry.restaurant.id)).toEqual(["custom:1", "main"]);
    expect(current.entries.find((entry) => entry.restaurant.id === "main")).toMatchObject({
      fetchedAt: "2026-07-14T03:00:00.000Z",
      offering: { menuText: "Kasviscurry" },
    });
    const week = getRestaurantWeek(db, "main", "2026-07-13");
    expect(week?.days).toHaveLength(7);
    expect(week?.days[0]).toMatchObject({ serviceDate: "2026-07-13", status: "missing" });
    expect(week?.days[1]).toMatchObject({
      fetchedAt: "2026-07-14T03:00:00.000Z",
      serviceDate,
      status: "published",
      text: "Kasviscurry",
    });
    expect(getRestaurantWeek(db, "custom:1", "2026-07-13")?.days[1]).toMatchObject({
      source: { name: "Oma ravintola", url: "https://example.com/menu" },
      text: "Lohikeitto",
    });

    db.prepare("UPDATE custom_sources SET enabled = 0 WHERE id = ?").run(customSourceId);
    expect(
      getDailyOfferingSnapshot(db, serviceDate).entries.map((entry) => entry.restaurant.id),
    ).toEqual(["main"]);
    expect(getRestaurantWeek(db, "custom:1", "2026-07-13")?.days[1]).toMatchObject({
      status: "missing",
      stale: false,
      lastAttemptAt: null,
      text: null,
    });

    persistSuccessfulFetch({
      db,
      finishedAt: "2026-07-14T05:00:00.000Z",
      offerings: [offering("main", "Pääravintola", "Paahdettua kuhaa")],
      request: { serviceDate },
      responseHash: "main-two",
      serviceDate,
      startedAt: "2026-07-14T04:59:00.000Z",
    });
    expect(getDailyOfferingSnapshot(db, serviceDate).entries[0]).toMatchObject({
      fetchedAt: "2026-07-14T05:00:00.000Z",
      offering: { menuText: "Paahdettua kuhaa" },
    });
    expect(getRestaurantWeek(db, "main", "2026-07-13")?.days[1]?.text).toBe("Paahdettua kuhaa");

    persistSuccessfulFetch({
      db,
      finishedAt: "2026-07-14T06:00:00.000Z",
      offerings: [],
      request: { serviceDate },
      responseHash: "main-empty",
      serviceDate,
      startedAt: "2026-07-14T05:59:00.000Z",
    });
    expect(getRestaurantWeek(db, "main", "2026-07-13")?.days[1]).toMatchObject({
      fetchedAt: null,
      status: "missing",
      text: null,
    });
  });
});
