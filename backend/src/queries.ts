import type Database from "better-sqlite3";

import {
  getDailyOfferingSnapshot,
  type DailyOfferingSnapshotEntry,
} from "./daily-offering-snapshot.js";
import { addDays } from "./dates.js";
import {
  defaultRecommendationVersions,
  recommendationInputHash,
  structuredMenuSchema,
  type RecommendationVersions,
  type StructuredMenu,
} from "./recommendations.js";

export interface DayMenu {
  fetchedAt: string;
  menu: {
    lunchHours: string | null;
    priceText: string | null;
    source: { name: string; url: string };
    status: string;
    structuredMenu: StructuredMenu | null;
    text: string | null;
    title: string | null;
  };
  restaurant: {
    address: string | null;
    city: string | null;
    id: string;
    latitude: number | null;
    longitude: number | null;
    name: string;
    phone: string | null;
    photoUrl: string | null;
    websiteUrl: string | null;
  };
}

function parseStructuredMenu(value: string | null): StructuredMenu | null {
  if (!value) return null;
  try {
    const parsed = structuredMenuSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function sourceFor(entry: DailyOfferingSnapshotEntry): DayMenu["menu"]["source"] {
  return entry.restaurant.customSourceId
    ? { name: entry.restaurant.name, url: entry.restaurant.customSourceUrl! }
    : { name: "Lounaspaikka", url: "https://lounaspaikka.ilkkapohjalainen.fi/" };
}

function restaurantFor(entry: DailyOfferingSnapshotEntry): DayMenu["restaurant"] {
  return {
    address: entry.restaurant.address,
    city: entry.restaurant.city,
    id: entry.restaurant.id,
    latitude: entry.restaurant.latitude,
    longitude: entry.restaurant.longitude,
    name: entry.restaurant.name,
    phone: entry.restaurant.phone,
    photoUrl: entry.restaurant.photoUrl,
    websiteUrl: entry.restaurant.websiteUrl,
  };
}

function menuFor(
  entry: DailyOfferingSnapshotEntry,
  structuredMenu: StructuredMenu | null,
): DayMenu["menu"] {
  return {
    lunchHours: entry.offering.lunchHours,
    priceText: entry.offering.priceText,
    source: sourceFor(entry),
    status: entry.offering.availability,
    structuredMenu,
    text: entry.offering.menuText,
    title: entry.offering.menuTitle,
  };
}

function structuredMenusFor(
  db: Database.Database,
  revisionIds: number[],
  versions: RecommendationVersions,
): Map<number, StructuredMenu | null> {
  if (revisionIds.length === 0) return new Map();
  const placeholders = revisionIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT revision_id AS revisionId, structured_menu_json AS structuredMenuJson
       FROM assessments
       WHERE revision_id IN (${placeholders})
         AND profile_version = ? AND rubric_version = ? AND prompt_version = ?
         AND schema_version = ? AND model = ?`,
    )
    .all(
      ...revisionIds,
      versions.profileVersion,
      versions.rubricVersion,
      versions.promptVersion,
      versions.schemaVersion,
      versions.model,
    ) as Array<{ revisionId: number; structuredMenuJson: string | null }>;
  return new Map(
    rows.map((row) => [row.revisionId, parseStructuredMenu(row.structuredMenuJson)]),
  );
}

export function getDayMenus(
  db: Database.Database,
  serviceDate: string,
  versionOverrides: Partial<RecommendationVersions> = {},
): DayMenu[] {
  const versions = { ...defaultRecommendationVersions, ...versionOverrides };
  const snapshot = getDailyOfferingSnapshot(db, serviceDate);
  const structuredMenus = structuredMenusFor(
    db,
    snapshot.entries.map((entry) => entry.revisionId),
    versions,
  );

  return snapshot.entries.map((entry) => ({
    fetchedAt: entry.fetchedAt,
    menu: menuFor(entry, structuredMenus.get(entry.revisionId) ?? null),
    restaurant: restaurantFor(entry),
  }));
}

export function getOfferingHistory(
  db: Database.Database,
  restaurantId: string,
  serviceDate: string,
): Array<{ id: number; menuText: string | null }> {
  return db
    .prepare(
      `SELECT id, menu_text AS menuText
       FROM offering_revisions
       WHERE restaurant_id = ? AND service_date = ?
       ORDER BY id`,
    )
    .all(restaurantId, serviceDate) as Array<{ id: number; menuText: string | null }>;
}

export function getFetchState(
  db: Database.Database,
  serviceDate: string,
): {
  lastAttemptAt: string | null;
  lastOutcome: string | null;
  lastSuccessfulFetchAt: string | null;
} {
  const row = db
    .prepare(
      `WITH active_sources(custom_source_id) AS (
        SELECT NULL
        UNION ALL
        SELECT id FROM custom_sources WHERE enabled = 1
      ), latest_attempts AS (
        SELECT (
          SELECT fetch.id FROM source_fetches fetch
          WHERE fetch.service_date = ?
            AND fetch.custom_source_id IS active_sources.custom_source_id
          ORDER BY fetch.id DESC LIMIT 1
        ) AS id
        FROM active_sources
      ), attempts AS (
        SELECT fetch.* FROM latest_attempts
        JOIN source_fetches fetch ON fetch.id = latest_attempts.id
      )
      SELECT
        MAX(finished_at) AS lastAttemptAt,
        CASE
          WHEN COUNT(*) = 0 THEN NULL
          WHEN COUNT(*) = 1 THEN MAX(outcome)
          WHEN SUM(CASE WHEN outcome <> 'success' THEN 1 ELSE 0 END) > 0 THEN 'partial_error'
          ELSE 'success'
        END AS lastOutcome,
        (SELECT MAX(finished_at) FROM source_fetches
          WHERE service_date = ? AND outcome = 'success'
            AND (custom_source_id IS NULL OR custom_source_id IN (
              SELECT id FROM custom_sources WHERE enabled = 1
            ))) AS lastSuccessfulFetchAt
      FROM attempts`,
    )
    .get(serviceDate, serviceDate) as {
    lastAttemptAt: string | null;
    lastOutcome: string | null;
    lastSuccessfulFetchAt: string | null;
  };
  return row;
}

export interface DailyRecommendation {
  menu: DayMenu["menu"];
  rank: number;
  rationale: string;
  restaurant: DayMenu["restaurant"];
  score: number;
}

export function getDailyRecommendations(
  db: Database.Database,
  serviceDate: string,
  versionOverrides: Partial<RecommendationVersions> = {},
): { generatedAt: string | null; recommendations: DailyRecommendation[] } {
  const versions = { ...defaultRecommendationVersions, ...versionOverrides };
  const snapshot = getDailyOfferingSnapshot(db, serviceDate);
  const currentEntries = snapshot.entries.filter(
    (entry) => entry.offering.availability === "published" && entry.offering.menuText !== null,
  );
  if (currentEntries.length === 0) return { generatedAt: null, recommendations: [] };

  const placeholders = currentEntries.map(() => "?").join(", ");
  const assessments = db
    .prepare(
      `SELECT id AS assessment_id, total_score
       FROM assessments
       WHERE revision_id IN (${placeholders})
         AND profile_version = ? AND rubric_version = ? AND prompt_version = ?
         AND schema_version = ? AND model = ?`,
    )
    .all(
      ...currentEntries.map((entry) => entry.revisionId),
      versions.profileVersion,
      versions.rubricVersion,
      versions.promptVersion,
      versions.schemaVersion,
      versions.model,
    ) as Array<{ assessment_id: number; total_score: number }>;
  if (assessments.length !== currentEntries.length) {
    return { generatedAt: null, recommendations: [] };
  }

  const set = db
    .prepare(
      `SELECT id, created_at
       FROM recommendation_sets
       WHERE service_date = ? AND profile_version = ? AND ranking_version = ? AND input_hash = ?
       LIMIT 1`,
    )
    .get(
      serviceDate,
      versions.profileVersion,
      versions.rankingVersion,
      recommendationInputHash(assessments),
    ) as { created_at: string; id: number } | undefined;
  if (!set) return { generatedAt: null, recommendations: [] };

  const rows = db
    .prepare(
      `SELECT
        entry.rank,
        assessment.total_score AS score,
        assessment.rationale_fi AS rationale,
        assessment.revision_id AS revisionId,
        assessment.structured_menu_json AS structuredMenuJson
      FROM recommendation_entries entry
      JOIN assessments assessment ON assessment.id = entry.assessment_id
      WHERE entry.set_id = ?
      ORDER BY entry.rank`,
    )
    .all(set.id) as Array<{
      rank: number;
      rationale: string;
      revisionId: number;
      score: number;
      structuredMenuJson: string | null;
    }>;
  const entriesByRevision = new Map(
    currentEntries.map((entry) => [entry.revisionId, entry]),
  );

  return {
    generatedAt: set.created_at,
    recommendations: rows.map((row) => {
      const entry = entriesByRevision.get(row.revisionId);
      if (!entry) throw new Error("Recommendation entry is outside the daily offering snapshot");
      return {
        menu: menuFor(entry, parseStructuredMenu(row.structuredMenuJson)),
        rank: row.rank,
        rationale: row.rationale,
        restaurant: restaurantFor(entry),
        score: row.score,
      };
    }),
  };
}

interface RestaurantRow {
  address: string | null;
  city: string | null;
  custom_source_id: number | null;
  custom_source_url: string | null;
  description_text: string | null;
  id: string;
  latitude: number | null;
  longitude: number | null;
  name: string;
  opening_hours_json: string;
  phone: string | null;
  photo_url: string | null;
  website_url: string | null;
}

const weekdays = [
  ["mon", "MO"],
  ["tue", "TU"],
  ["wed", "WE"],
  ["thu", "TH"],
  ["fri", "FR"],
  ["sat", "SA"],
  ["sun", "SU"],
] as const;

function normalizedOpeningHours(value: string): Array<{
  periods: Array<{ close: string; open: string }>;
  weekday: string;
}> {
  let source: unknown;
  try {
    source = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(source)) return [];

  return weekdays.flatMap(([key, weekday]) => {
    const periods = source.flatMap((period) => {
      if (typeof period !== "object" || period === null) return [];
      const entries = (period as Record<string, unknown>)[key];
      if (!Array.isArray(entries)) return [];
      return entries.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) return [];
        const { open, close } = entry as Record<string, unknown>;
        return typeof open === "string" && typeof close === "string" ? [{ close, open }] : [];
      });
    });
    return periods.length > 0 ? [{ periods, weekday }] : [];
  });
}

export function getRestaurantWeek(
  db: Database.Database,
  restaurantId: string,
  weekStart: string,
  versionOverrides: Partial<RecommendationVersions> = {},
): {
  days: Array<{
    fetchedAt: string | null;
    lunchHours: string | null;
    priceText: string | null;
    serviceDate: string;
    source: DayMenu["menu"]["source"] | null;
    status: string;
    structuredMenu: StructuredMenu | null;
    text: string | null;
    title: string | null;
  }>;
  restaurant: DayMenu["restaurant"] & {
    description: string | null;
    openingHours: ReturnType<typeof normalizedOpeningHours>;
  };
  source: DayMenu["menu"]["source"];
  weekEnd: string;
  weekStart: string;
} | null {
  const restaurant = db
    .prepare(
      `SELECT restaurant.id, restaurant.name, restaurant.address, restaurant.city,
        restaurant.latitude, restaurant.longitude, restaurant.website_url,
        restaurant.phone, restaurant.photo_url, restaurant.description_text,
        restaurant.opening_hours_json, restaurant.custom_source_id,
        custom_source.url AS custom_source_url
       FROM restaurants restaurant
       LEFT JOIN custom_sources custom_source ON custom_source.id = restaurant.custom_source_id
       WHERE restaurant.id = ?`,
    )
    .get(restaurantId) as RestaurantRow | undefined;
  if (!restaurant) return null;

  const days = Array.from({ length: 7 }, (_, index) => {
    const serviceDate = addDays(weekStart, index);
    const observed = getDayMenus(db, serviceDate, versionOverrides).find(
      (menu) => menu.restaurant.id === restaurantId,
    );
    return {
      fetchedAt: observed?.fetchedAt ?? null,
      lunchHours: observed?.menu.lunchHours ?? null,
      priceText: observed?.menu.priceText ?? null,
      serviceDate,
      source: observed?.menu.source ?? null,
      status: observed?.menu.status ?? "missing",
      structuredMenu: observed?.menu.structuredMenu ?? null,
      text: observed?.menu.text ?? null,
      title: observed?.menu.title ?? null,
    };
  });

  return {
    days,
    restaurant: {
      address: restaurant.address,
      city: restaurant.city,
      description: restaurant.description_text,
      id: restaurant.id,
      latitude: restaurant.latitude,
      longitude: restaurant.longitude,
      name: restaurant.name,
      openingHours: normalizedOpeningHours(restaurant.opening_hours_json),
      phone: restaurant.phone,
      photoUrl: restaurant.photo_url,
      websiteUrl: restaurant.website_url,
    },
    source: restaurant.custom_source_id
      ? { name: restaurant.name, url: restaurant.custom_source_url! }
      : { name: "Lounaspaikka", url: "https://lounaspaikka.ilkkapohjalainen.fi/" },
    weekEnd: addDays(weekStart, 6),
    weekStart,
  };
}
