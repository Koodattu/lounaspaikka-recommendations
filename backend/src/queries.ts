import type Database from "better-sqlite3";

import { addDays } from "./dates.js";
import {
  defaultRecommendationVersions,
  recommendationInputHash,
  type RecommendationVersions,
} from "./recommendations.js";

export interface DayMenu {
  fetchedAt: string;
  menu: {
    lunchHours: string | null;
    status: string;
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
  website_url: string | null;
}

export function getDayMenus(db: Database.Database, serviceDate: string): DayMenu[] {
  const rows = db
    .prepare(
      `WITH latest_fetch AS (
        SELECT id, finished_at
        FROM source_fetches
        WHERE service_date = ? AND outcome = 'success'
        ORDER BY id DESC
        LIMIT 1
      )
      SELECT
        r.id, r.name, r.address, r.city, r.latitude, r.longitude,
        r.website_url, r.phone, r.photo_url,
        o.availability, o.menu_title, o.menu_text, o.lunch_hours,
        latest_fetch.finished_at AS fetched_at
      FROM latest_fetch
      JOIN fetch_observations observation ON observation.fetch_id = latest_fetch.id
      JOIN offering_revisions o ON o.id = observation.revision_id
      JOIN restaurants r ON r.id = observation.restaurant_id
      ORDER BY r.name COLLATE NOCASE, r.id`,
    )
    .all(serviceDate) as DayMenuRow[];

  return rows.map((row) => ({
    fetchedAt: row.fetched_at,
    menu: {
      lunchHours: row.lunch_hours,
      status: row.availability,
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
      `SELECT
        (SELECT finished_at FROM source_fetches WHERE service_date = ? ORDER BY id DESC LIMIT 1)
          AS lastAttemptAt,
        (SELECT outcome FROM source_fetches WHERE service_date = ? ORDER BY id DESC LIMIT 1)
          AS lastOutcome,
        (SELECT finished_at FROM source_fetches
          WHERE service_date = ? AND outcome = 'success' ORDER BY id DESC LIMIT 1)
          AS lastSuccessfulFetchAt`,
    )
    .get(serviceDate, serviceDate, serviceDate) as {
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
      `WITH latest_fetch AS (
        SELECT id FROM source_fetches
        WHERE service_date = ? AND outcome = 'success'
        ORDER BY id DESC LIMIT 1
      )
      SELECT revision.id
      FROM latest_fetch
      JOIN fetch_observations observation ON observation.fetch_id = latest_fetch.id
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
        restaurant.phone, restaurant.photo_url,
        revision.availability, revision.menu_title, revision.menu_text, revision.lunch_hours
      FROM recommendation_entries entry
      JOIN assessments assessment ON assessment.id = entry.assessment_id
      JOIN offering_revisions revision ON revision.id = assessment.revision_id
      JOIN restaurants restaurant ON restaurant.id = revision.restaurant_id
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
        status: row.availability,
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
): {
  days: Array<{
    fetchedAt: string | null;
    lunchHours: string | null;
    serviceDate: string;
    status: string;
    text: string | null;
    title: string | null;
  }>;
  restaurant: DayMenu["restaurant"] & {
    description: string | null;
    openingHours: ReturnType<typeof normalizedOpeningHours>;
  };
  weekEnd: string;
  weekStart: string;
} | null {
  const restaurant = db
    .prepare(
      `SELECT id, name, address, city, latitude, longitude, website_url, phone,
        photo_url, description_text, opening_hours_json
       FROM restaurants WHERE id = ?`,
    )
    .get(restaurantId) as RestaurantRow | undefined;
  if (!restaurant) return null;

  const days = Array.from({ length: 7 }, (_, index) => {
    const serviceDate = addDays(weekStart, index);
    const observed = getDayMenus(db, serviceDate).find((menu) => menu.restaurant.id === restaurantId);
    return {
      fetchedAt: observed?.fetchedAt ?? null,
      lunchHours: observed?.menu.lunchHours ?? null,
      serviceDate,
      status: observed?.menu.status ?? "missing",
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
    weekEnd: addDays(weekStart, 6),
    weekStart,
  };
}
