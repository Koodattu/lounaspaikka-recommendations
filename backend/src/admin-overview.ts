import type Database from "better-sqlite3";

import { getDailyOfferingSnapshots } from "./daily-offering-snapshot.js";
import {
  defaultRecommendationVersions,
  type RecommendationVersions,
} from "./recommendations.js";
import type { RefreshStatus } from "./refresh.js";

interface AdminOverviewOptions {
  now?: () => Date;
  openAiConfigured: boolean;
  recommendationVersions?: Partial<RecommendationVersions>;
  refresh: RefreshStatus;
}

function count(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function operationalErrorMessage(outcome: string | null, httpStatus: number | null): string {
  switch (outcome) {
    case "extraction_error":
      return "Ruokalistaa ei voitu poimia sivulta.";
    case "http_error":
      return httpStatus
        ? `Lähde vastasi HTTP-virheellä ${httpStatus}.`
        : "Lähde vastasi HTTP-virheellä.";
    case "invalid_response":
      return "Lähteen sisältöä ei voitu lukea turvallisesti.";
    case "network_error":
      return "Verkkoyhteys lähteeseen epäonnistui.";
    default:
      return "Keräys epäonnistui.";
  }
}

interface RecentAssessmentRow {
  assessedAt: string;
  assessmentId: number;
  feedbackDirection: "higher" | "lower" | null;
  menuText: string | null;
  rationale: string;
  restaurantId: string;
  restaurantName: string;
  score: number;
  scoresJson: string;
  serviceDate: string;
}

function getRecentAssessments(
  db: Database.Database,
  versions: RecommendationVersions,
): RecentAssessmentRow[] {
  const assessmentDates = db
    .prepare(
      `SELECT DISTINCT revision.service_date AS serviceDate
       FROM assessments assessment
       JOIN offering_revisions revision ON revision.id = assessment.revision_id
       WHERE assessment.profile_version = ?
         AND assessment.rubric_version = ?
         AND assessment.prompt_version = ?
         AND assessment.schema_version = ?
         AND assessment.model = ?
       ORDER BY revision.service_date DESC`,
    )
    .all(
      versions.profileVersion,
      versions.rubricVersion,
      versions.promptVersion,
      versions.schemaVersion,
      versions.model,
    ) as Array<{ serviceDate: string }>;
  const snapshots = getDailyOfferingSnapshots(
    db,
    assessmentDates.map(({ serviceDate }) => serviceDate),
  );
  const recent: RecentAssessmentRow[] = [];
  let activeDateCount = 0;

  for (const snapshot of snapshots) {
    const revisionIds = snapshot.entries
      .filter(
        (entry) =>
          entry.offering.availability === "published" && entry.offering.menuText !== null,
      )
      .map((entry) => entry.revisionId);
    if (revisionIds.length === 0) continue;
    const placeholders = revisionIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT
          assessment.id AS assessmentId,
          assessment.assessed_at AS assessedAt,
          assessment.rationale_fi AS rationale,
          assessment.scores_json AS scoresJson,
          assessment.total_score AS score,
          feedback.direction AS feedbackDirection,
          restaurant.id AS restaurantId,
          restaurant.name AS restaurantName,
          revision.menu_text AS menuText,
          revision.service_date AS serviceDate
         FROM assessments assessment
         JOIN offering_revisions revision ON revision.id = assessment.revision_id
         JOIN restaurants restaurant ON restaurant.id = revision.restaurant_id
         LEFT JOIN assessment_feedback feedback ON feedback.assessment_id = assessment.id
         WHERE assessment.revision_id IN (${placeholders})
           AND assessment.profile_version = ?
           AND assessment.rubric_version = ?
           AND assessment.prompt_version = ?
           AND assessment.schema_version = ?
           AND assessment.model = ?
         ORDER BY assessment.total_score DESC,
           restaurant.name COLLATE NOCASE, assessment.id DESC`,
      )
      .all(
        ...revisionIds,
        versions.profileVersion,
        versions.rubricVersion,
        versions.promptVersion,
        versions.schemaVersion,
        versions.model,
      ) as RecentAssessmentRow[];
    if (rows.length === 0) continue;
    recent.push(...rows);
    activeDateCount += 1;
    if (activeDateCount === 8) break;
  }

  return recent;
}

export function getAdminOverview(db: Database.Database, options: AdminOverviewOptions) {
  const versions = {
    ...defaultRecommendationVersions,
    ...options.recommendationVersions,
  };
  const sources = db
    .prepare(
      `SELECT
        source.id,
        source.url,
        source.enabled,
        source.created_at AS createdAt,
        restaurant.name AS restaurantName,
        run.finished_at AS lastRunAt,
        run.outcome AS lastOutcome,
        run.error_message AS lastError
       FROM custom_sources source
       LEFT JOIN restaurants restaurant ON restaurant.custom_source_id = source.id
       LEFT JOIN custom_source_runs run ON run.id = (
         SELECT latest.id FROM custom_source_runs latest
         WHERE latest.custom_source_id = source.id
         ORDER BY latest.id DESC LIMIT 1
       )
       ORDER BY source.id`,
    )
    .all() as Array<{
      createdAt: string;
      enabled: number;
      id: number;
      lastError: string | null;
      lastOutcome: string | null;
      lastRunAt: string | null;
      restaurantName: string | null;
      url: string;
    }>;
  const recentAssessments = getRecentAssessments(db, versions);
  const errors = db
    .prepare(
      `SELECT
        MAX(fetch.id) AS id,
        MAX(fetch.finished_at) AS occurredAt,
        MIN(fetch.service_date) AS serviceDate,
        MAX(fetch.outcome) AS outcome,
        MAX(fetch.http_status) AS httpStatus,
        MAX(custom.url) AS sourceUrl,
        COUNT(*) AS affectedDateCount
       FROM source_fetches fetch
       LEFT JOIN custom_sources custom ON custom.id = fetch.custom_source_id
       WHERE fetch.outcome <> 'success'
       GROUP BY CASE
         WHEN fetch.custom_run_id IS NULL THEN 'fetch:' || fetch.id
         ELSE 'custom:' || fetch.custom_run_id
       END
       ORDER BY MAX(fetch.id) DESC
       LIMIT 20`,
    )
    .all() as Array<{
      affectedDateCount: number;
      httpStatus: number | null;
      id: number;
      occurredAt: string;
      outcome: string;
      serviceDate: string;
      sourceUrl: string | null;
    }>;
  const latestFetch = db
    .prepare(
      `SELECT finished_at AS attemptedAt, outcome
       FROM source_fetches ORDER BY id DESC LIMIT 1`,
    )
    .get() as { attemptedAt: string; outcome: string } | undefined;
  const latestSuccess = db
    .prepare(
      `SELECT finished_at AS finishedAt
       FROM source_fetches WHERE outcome = 'success' ORDER BY id DESC LIMIT 1`,
    )
    .get() as { finishedAt: string } | undefined;

  return {
    counts: {
      assessments: count(db, "assessments"),
      customSources: count(db, "custom_sources"),
      fetches: count(db, "source_fetches"),
      offeringRevisions: count(db, "offering_revisions"),
      recommendationSets: count(db, "recommendation_sets"),
      restaurants: count(db, "restaurants"),
    },
    errors: errors.map(({ httpStatus, ...error }) => ({
      ...error,
      message: operationalErrorMessage(error.outcome, httpStatus),
    })),
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    latestFetch: {
      attemptedAt: latestFetch?.attemptedAt ?? null,
      lastSuccessfulAt: latestSuccess?.finishedAt ?? null,
      outcome: latestFetch?.outcome ?? null,
    },
    openAiConfigured: options.openAiConfigured,
    refresh: {
      ...options.refresh,
      lastError: options.refresh.lastError
        ? { ...options.refresh.lastError, message: "Keräyksen vaihe epäonnistui." }
        : null,
    },
    recentAssessments: recentAssessments.map(({ scoresJson, ...assessment }) => ({
      ...assessment,
      scores: JSON.parse(scoresJson) as {
        appeal: number;
        distinctiveness: number;
        value: number;
        variety: number;
      },
    })),
    sources: sources.map((source) => ({
      ...source,
      enabled: source.enabled === 1,
      lastError: source.lastError
        ? operationalErrorMessage(source.lastOutcome, null)
        : null,
    })),
    uptimeSeconds: Math.floor(process.uptime()),
  };
}
