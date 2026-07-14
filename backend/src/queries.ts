import type Database from "better-sqlite3";

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

interface DayMenuRow {
  address: string | null;
  availability: string;
  city: string | null;
  custom_source_id: number | null;
  custom_source_url: string | null;
  fetched_at: string;
  id: string;
  latitude: number | null;
  longitude: number | null;
  lunch_hours: string | null;
  menu_text: string | null;
  menu_title: string | null;
  name: string;
  phone: string | null;
  photo_url: string | null;
  price_text: string | null;
  structured_menu_json: string | null;
  website_url: string | null;
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

export function getDayMenus(
  db: Database.Database,
  serviceDate: string,
  versionOverrides: Partial<RecommendationVersions> = {},
): DayMenu[] {
  const versions = { ...defaultRecommendationVersions, ...versionOverrides };
  const rows = db
    .prepare(
      `WITH active_sources(custom_source_id) AS (
        SELECT NULL
        UNION ALL
        SELECT id FROM custom_sources WHERE enabled = 1
      ), latest_fetches AS (
        SELECT (
          SELECT fetch.id
          FROM source_fetches fetch
          WHERE fetch.service_date = ? AND fetch.outcome = 'success'
            AND fetch.custom_source_id IS active_sources.custom_source_id
          ORDER BY fetch.id DESC
          LIMIT 1
        ) AS id
        FROM active_sources
      )
      SELECT
        r.id, r.name, r.address, r.city, r.latitude, r.longitude,
        r.website_url, r.phone, r.photo_url, r.custom_source_id,
        custom_source.url AS custom_source_url,
        o.availability, o.menu_title, o.menu_text, o.lunch_hours, o.price_text,
        assessment.structured_menu_json,
        fetch.finished_at AS fetched_at
      FROM latest_fetches
      JOIN source_fetches fetch ON fetch.id = latest_fetches.id
      JOIN fetch_observations observation ON observation.fetch_id = fetch.id
      JOIN offering_revisions o ON o.id = observation.revision_id
      JOIN restaurants r ON r.id = observation.restaurant_id
      LEFT JOIN custom_sources custom_source ON custom_source.id = r.custom_source_id
      LEFT JOIN assessments assessment ON assessment.revision_id = o.id
        AND assessment.profile_version = ? AND assessment.rubric_version = ?
        AND assessment.prompt_version = ? AND assessment.schema_version = ?
        AND assessment.model = ?
      ORDER BY r.name COLLATE NOCASE, r.id`,
    )
    .all(
      serviceDate,
      versions.profileVersion,
      versions.rubricVersion,
      versions.promptVersion,
      versions.schemaVersion,
      versions.model,
    ) as DayMenuRow[];

  return rows.map((row) => ({
    fetchedAt: row.fetched_at,
    menu: {
      lunchHours: row.lunch_hours,
      priceText: row.price_text,
      source: row.custom_source_id
        ? { name: row.name, url: row.custom_source_url! }
        : { name: "Lounaspaikka", url: "https://lounaspaikka.ilkkapohjalainen.fi/" },
      status: row.availability,
      structuredMenu: parseStructuredMenu(row.structured_menu_json),
      text: row.menu_text,
      title: row.menu_title,
    },
    restaurant: {
      address: row.address,
      city: row.city,
      id: row.id,
      latitude: row.latitude,
      longitude: row.longitude,
      name: row.name,
      phone: row.phone,
      photoUrl: row.photo_url,
      websiteUrl: row.website_url,
    },
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
  const currentRevisions = db
    .prepare(
      `WITH active_sources(custom_source_id) AS (
        SELECT NULL
        UNION ALL
        SELECT id FROM custom_sources WHERE enabled = 1
      ), latest_fetches AS (
        SELECT (
          SELECT fetch.id FROM source_fetches fetch
          WHERE fetch.service_date = ? AND fetch.outcome = 'success'
            AND fetch.custom_source_id IS active_sources.custom_source_id
          ORDER BY fetch.id DESC LIMIT 1
        ) AS id
        FROM active_sources
      )
      SELECT revision.id
      FROM latest_fetches
      JOIN fetch_observations observation ON observation.fetch_id = latest_fetches.id
      JOIN offering_revisions revision ON revision.id = observation.revision_id
      WHERE revision.availability = 'published' AND revision.menu_text IS NOT NULL
      ORDER BY revision.id`,
    )
    .all(serviceDate) as Array<{ id: number }>;
  if (currentRevisions.length === 0) return { generatedAt: null, recommendations: [] };

  const placeholders = currentRevisions.map(() => "?").join(", ");
  const assessments = db
    .prepare(
      `SELECT id AS assessment_id, total_score
       FROM assessments
       WHERE revision_id IN (${placeholders})
         AND profile_version = ? AND rubric_version = ? AND prompt_version = ?
         AND schema_version = ? AND model = ?`,
    )
    .all(
      ...currentRevisions.map((revision) => revision.id),
      versions.profileVersion,
      versions.rubricVersion,
      versions.promptVersion,
      versions.schemaVersion,
      versions.model,
    ) as Array<{ assessment_id: number; total_score: number }>;
  if (assessments.length !== currentRevisions.length) {
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
        restaurant.id, restaurant.name, restaurant.address, restaurant.city,
        restaurant.latitude, restaurant.longitude, restaurant.website_url,
        restaurant.phone, restaurant.photo_url, restaurant.custom_source_id,
        custom_source.url AS custom_source_url,
        revision.availability, revision.menu_title, revision.menu_text,
        revision.lunch_hours, revision.price_text, assessment.structured_menu_json
      FROM recommendation_entries entry
      JOIN assessments assessment ON assessment.id = entry.assessment_id
      JOIN offering_revisions revision ON revision.id = assessment.revision_id
      JOIN restaurants restaurant ON restaurant.id = revision.restaurant_id
      LEFT JOIN custom_sources custom_source ON custom_source.id = restaurant.custom_source_id
      WHERE entry.set_id = ?
      ORDER BY entry.rank`,
    )
    .all(set.id) as Array<
    Omit<DayMenuRow, "fetched_at"> & { rank: number; rationale: string; score: number }
  >;

  return {
    generatedAt: set.created_at,
    recommendations: rows.map((row) => ({
      menu: {
        lunchHours: row.lunch_hours,
        priceText: row.price_text,
        source: row.custom_source_id
          ? { name: row.name, url: row.custom_source_url! }
          : { name: "Lounaspaikka", url: "https://lounaspaikka.ilkkapohjalainen.fi/" },
        status: row.availability,
        structuredMenu: parseStructuredMenu(row.structured_menu_json),
        text: row.menu_text,
        title: row.menu_title,
      },
      rank: row.rank,
      rationale: row.rationale,
      restaurant: {
        address: row.address,
        city: row.city,
        id: row.id,
        latitude: row.latitude,
        longitude: row.longitude,
        name: row.name,
        phone: row.phone,
        photoUrl: row.photo_url,
        websiteUrl: row.website_url,
      },
      score: row.score,
    })),
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
