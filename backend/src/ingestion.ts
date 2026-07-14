import { createHash } from "node:crypto";

import type Database from "better-sqlite3";

import { parseIsoDate } from "./dates.js";
import { htmlToText, normalizeLunchHours } from "./html.js";
import { SourceFetchError, type LunchSource, type SourceFetchResult } from "./source.js";

interface IngestLunchDayOptions {
  db: Database.Database;
  now?: () => Date;
  serviceDate: string;
  source: LunchSource;
}

export interface IngestResult {
  createdRevisionCount: number;
  itemCount: number;
  outcome: "success";
}

function persistFailure(
  db: Database.Database,
  error: unknown,
  sourceResult: SourceFetchResult | undefined,
  serviceDate: string,
  startedAt: string,
  finishedAt: string,
): void {
  const sourceError = error instanceof SourceFetchError ? error : null;
  const outcome = sourceError?.outcome ?? (sourceResult ? "invalid_response" : "network_error");
  const pages = sourceError?.pages ?? sourceResult?.pages ?? null;
  const request = sourceError?.request ?? sourceResult?.request ?? { serviceDate };

  db.prepare(
    `INSERT INTO source_fetches (
      service_date, started_at, finished_at, outcome, http_status, error_message,
      request_json, response_pages_json, response_hash, item_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    serviceDate,
    startedAt,
    finishedAt,
    outcome,
    sourceError?.httpStatus ?? null,
    error instanceof Error ? error.message : "Unknown source error",
    JSON.stringify(request),
    pages ? JSON.stringify(pages) : null,
    pages ? hash(pages.map((page) => page.body)) : null,
    sourceResult?.items.length ?? null,
  );
}

interface ParsedRestaurant {
  address: string | null;
  availability: "not_published" | "published";
  city: string | null;
  descriptionText: string | null;
  id: string;
  latitude: number | null;
  longitude: number | null;
  lunchHours: string | null;
  menuText: string | null;
  menuTitle: string | null;
  name: string;
  openingHours: unknown;
  phone: string | null;
  photoUrl: string | null;
  snapshot: unknown;
  websiteUrl: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function optionalHttpUrl(value: unknown): string | null {
  const candidate = optionalString(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? candidate : null;
  } catch {
    return null;
  }
}

const weekdayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function fallbackLunchHours(item: Record<string, unknown>, serviceDate: string): string | null {
  const date = parseIsoDate(serviceDate);
  if (!date) return null;
  const auxData = record(item.auxData);
  const lunch = record(auxData?.lunch);
  const hours = record(lunch?.oh);
  const openingTimes = hours?.openingTimes;
  if (!Array.isArray(openingTimes)) return null;

  const weekday = weekdayCodes[date.getUTCDay()];
  const periods = openingTimes.flatMap((value) => {
    const period = record(value);
    if (!period || period.weekday !== weekday) return [];
    const opening = optionalString(period.opening);
    const closing = optionalString(period.closing);
    return opening && closing ? [`${opening}–${closing}`] : [];
  });
  return periods.length > 0 ? periods.join(", ") : null;
}

function parseRestaurant(value: unknown, serviceDate: string): ParsedRestaurant {
  const item = record(value);
  const id = optionalString(item?.id);
  const name = optionalString(item?.name);
  if (!item || !id || !name) throw new Error("Restaurant is missing an id or name");

  const dailyAds = Array.isArray(item.ads)
    ? item.ads
        .map((wrapper) => record(record(wrapper)?.ad))
        .filter((ad): ad is Record<string, unknown> => ad?.contentType === 32)
    : [];
  if (dailyAds.length > 1) throw new Error(`Restaurant ${id} has multiple daily menus`);
  const dailyAd = dailyAds[0] ?? null;
  const menuText = dailyAd ? htmlToText(optionalString(dailyAd.body) ?? "") || null : null;
  const marker = record(item.marker);

  return {
    address: optionalString(item.address),
    availability: menuText ? "published" : "not_published",
    city: optionalString(item.city),
    descriptionText: optionalString(item.desc) ? htmlToText(String(item.desc)) : null,
    id,
    latitude: optionalNumber(marker?.latitude),
    longitude: optionalNumber(marker?.longitude),
    lunchHours:
      normalizeLunchHours(optionalString(dailyAd?.lunchOh)) ??
      fallbackLunchHours(item, serviceDate),
    menuText,
    menuTitle: optionalString(dailyAd?.header),
    name,
    openingHours: item.openingHours ?? [],
    phone: optionalString(item.tel),
    photoUrl: optionalHttpUrl(item.photo),
    snapshot: { dailyAd, restaurant: item },
    websiteUrl: optionalHttpUrl(item.www),
  };
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function persistSuccess(
  db: Database.Database,
  sourceResult: SourceFetchResult,
  restaurants: ParsedRestaurant[],
  serviceDate: string,
  startedAt: string,
  finishedAt: string,
): IngestResult {
  return db.transaction(() => {
    const fetchInsert = db
      .prepare(
        `INSERT INTO source_fetches (
          service_date, started_at, finished_at, outcome, request_json,
          response_pages_json, response_hash, item_count
        ) VALUES (?, ?, ?, 'success', ?, ?, ?, ?)`,
      )
      .run(
        serviceDate,
        startedAt,
        finishedAt,
        JSON.stringify(sourceResult.request),
        JSON.stringify(sourceResult.pages),
        hash(sourceResult.pages.map((page) => page.body)),
        restaurants.length,
      );
    const fetchId = Number(fetchInsert.lastInsertRowid);
    let createdRevisionCount = 0;

    const upsertRestaurant = db.prepare(`
      INSERT INTO restaurants (
        id, name, address, city, latitude, longitude, website_url, phone,
        photo_url, description_text, opening_hours_json, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        address = excluded.address,
        city = excluded.city,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        website_url = excluded.website_url,
        phone = excluded.phone,
        photo_url = excluded.photo_url,
        description_text = excluded.description_text,
        opening_hours_json = excluded.opening_hours_json,
        last_seen_at = excluded.last_seen_at
    `);
    const insertRevision = db.prepare(`
      INSERT OR IGNORE INTO offering_revisions (
        restaurant_id, service_date, content_hash, availability, menu_title,
        menu_text, lunch_hours, source_snapshot_json, first_seen_fetch_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const findRevision = db.prepare(`
      SELECT id FROM offering_revisions
      WHERE restaurant_id = ? AND service_date = ? AND content_hash = ?
    `);
    const insertObservation = db.prepare(`
      INSERT INTO fetch_observations (fetch_id, restaurant_id, revision_id)
      VALUES (?, ?, ?)
    `);

    for (const restaurant of restaurants) {
      upsertRestaurant.run(
        restaurant.id,
        restaurant.name,
        restaurant.address,
        restaurant.city,
        restaurant.latitude,
        restaurant.longitude,
        restaurant.websiteUrl,
        restaurant.phone,
        restaurant.photoUrl,
        restaurant.descriptionText,
        JSON.stringify(restaurant.openingHours),
        finishedAt,
        finishedAt,
      );
      const contentHash = hash({
        availability: restaurant.availability,
        lunchHours: restaurant.lunchHours,
        menuText: restaurant.menuText,
        menuTitle: restaurant.menuTitle,
      });
      const insertion = insertRevision.run(
        restaurant.id,
        serviceDate,
        contentHash,
        restaurant.availability,
        restaurant.menuTitle,
        restaurant.menuText,
        restaurant.lunchHours,
        JSON.stringify(restaurant.snapshot),
        fetchId,
        finishedAt,
      );
      createdRevisionCount += insertion.changes;
      const revision = findRevision.get(restaurant.id, serviceDate, contentHash) as
        | { id: number }
        | undefined;
      if (!revision) throw new Error("Offering revision was not persisted");
      insertObservation.run(fetchId, restaurant.id, revision.id);
    }

    return {
      createdRevisionCount,
      itemCount: restaurants.length,
      outcome: "success" as const,
    };
  })();
}

export async function ingestLunchDay(options: IngestLunchDayOptions): Promise<IngestResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  let sourceResult: SourceFetchResult | undefined;
  try {
    sourceResult = await options.source.fetchLunchDay(options.serviceDate);
    const restaurants = sourceResult.items.map((item) => parseRestaurant(item, options.serviceDate));
    const finishedAt = now().toISOString();
    return persistSuccess(
      options.db,
      sourceResult,
      restaurants,
      options.serviceDate,
      startedAt,
      finishedAt,
    );
  } catch (error) {
    persistFailure(
      options.db,
      error,
      sourceResult,
      options.serviceDate,
      startedAt,
      now().toISOString(),
    );
    throw error;
  }
}
