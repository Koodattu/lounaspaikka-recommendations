import { createHash } from "node:crypto";

import type Database from "better-sqlite3";

export interface StoredOffering {
  address: string | null;
  availability: "not_published" | "published";
  city: string | null;
  customSourceId: number | null;
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
  priceText: string | null;
  snapshot: unknown;
  websiteUrl: string | null;
}

interface PersistSuccessfulFetchOptions {
  customRunId?: number | null;
  customSourceId?: number | null;
  db: Database.Database;
  finishedAt: string;
  httpStatus?: number | null;
  offerings: StoredOffering[];
  request: unknown;
  responseHash: string | null;
  responsePages?: unknown | null;
  serviceDate: string;
  startedAt: string;
}

interface PersistFailedFetchOptions {
  customRunId?: number | null;
  customSourceId?: number | null;
  db: Database.Database;
  errorMessage: string;
  finishedAt: string;
  httpStatus?: number | null;
  outcome: string;
  request: unknown;
  responseHash?: string | null;
  responsePages?: unknown | null;
  serviceDate: string;
  startedAt: string;
}

export interface PersistResult {
  createdRevisionCount: number;
  itemCount: number;
  outcome: "success";
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function persistFailedFetch(options: PersistFailedFetchOptions): void {
  options.db
    .prepare(
      `INSERT INTO source_fetches (
        service_date, started_at, finished_at, outcome, http_status, error_message,
        request_json, response_pages_json, response_hash, item_count,
        custom_source_id, custom_run_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      options.serviceDate,
      options.startedAt,
      options.finishedAt,
      options.outcome,
      options.httpStatus ?? null,
      options.errorMessage,
      JSON.stringify(options.request),
      options.responsePages === undefined || options.responsePages === null
        ? null
        : JSON.stringify(options.responsePages),
      options.responseHash ?? null,
      options.customSourceId ?? null,
      options.customRunId ?? null,
    );
}

export function persistSuccessfulFetch(options: PersistSuccessfulFetchOptions): PersistResult {
  return options.db.transaction(() => {
    const fetchInsert = options.db
      .prepare(
        `INSERT INTO source_fetches (
          service_date, started_at, finished_at, outcome, http_status,
          request_json, response_pages_json, response_hash, item_count,
          custom_source_id, custom_run_id
        ) VALUES (?, ?, ?, 'success', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        options.serviceDate,
        options.startedAt,
        options.finishedAt,
        options.httpStatus ?? null,
        JSON.stringify(options.request),
        options.responsePages === undefined || options.responsePages === null
          ? null
          : JSON.stringify(options.responsePages),
        options.responseHash,
        options.offerings.length,
        options.customSourceId ?? null,
        options.customRunId ?? null,
      );
    const fetchId = Number(fetchInsert.lastInsertRowid);
    let createdRevisionCount = 0;

    const upsertRestaurant = options.db.prepare(`
      INSERT INTO restaurants (
        id, name, address, city, latitude, longitude, website_url, phone,
        photo_url, description_text, opening_hours_json, first_seen_at, last_seen_at,
        custom_source_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        last_seen_at = excluded.last_seen_at,
        custom_source_id = excluded.custom_source_id
    `);
    const insertRevision = options.db.prepare(`
      INSERT OR IGNORE INTO offering_revisions (
        restaurant_id, service_date, content_hash, availability, menu_title,
        menu_text, lunch_hours, price_text, source_snapshot_json,
        first_seen_fetch_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const findRevision = options.db.prepare(`
      SELECT id FROM offering_revisions
      WHERE restaurant_id = ? AND service_date = ? AND content_hash = ?
    `);
    const insertObservation = options.db.prepare(`
      INSERT INTO fetch_observations (fetch_id, restaurant_id, revision_id)
      VALUES (?, ?, ?)
    `);

    for (const offering of options.offerings) {
      upsertRestaurant.run(
        offering.id,
        offering.name,
        offering.address,
        offering.city,
        offering.latitude,
        offering.longitude,
        offering.websiteUrl,
        offering.phone,
        offering.photoUrl,
        offering.descriptionText,
        JSON.stringify(offering.openingHours),
        options.finishedAt,
        options.finishedAt,
        offering.customSourceId,
      );
      const contentHash = sha256({
        availability: offering.availability,
        lunchHours: offering.lunchHours,
        menuText: offering.menuText,
        menuTitle: offering.menuTitle,
        priceText: offering.priceText,
        restaurantName: offering.name,
      });
      const insertion = insertRevision.run(
        offering.id,
        options.serviceDate,
        contentHash,
        offering.availability,
        offering.menuTitle,
        offering.menuText,
        offering.lunchHours,
        offering.priceText,
        JSON.stringify(offering.snapshot),
        fetchId,
        options.finishedAt,
      );
      createdRevisionCount += insertion.changes;
      const revision = findRevision.get(
        offering.id,
        options.serviceDate,
        contentHash,
      ) as { id: number } | undefined;
      if (!revision) throw new Error("Offering revision was not persisted");
      insertObservation.run(fetchId, offering.id, revision.id);
    }

    return {
      createdRevisionCount,
      itemCount: options.offerings.length,
      outcome: "success" as const,
    };
  })();
}
