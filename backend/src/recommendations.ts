import { createHash } from "node:crypto";

import type Database from "better-sqlite3";
import { z } from "zod";

const scoreSchema = z.number().min(0).max(10);
export const structuredMenuSchema = z.object({
  courses: z.array(
    z.object({
      category: z.enum([
        "unknown",
        "starter",
        "soup",
        "main",
        "side",
        "salad",
        "dessert",
        "bread",
        "drink",
        "other",
      ]),
      dietaryMarkers: z.array(z.string().trim().min(1).max(24)).max(6),
      explicitAllergens: z.array(z.string().trim().min(1).max(40)).max(16),
      nameFi: z.string().trim().min(2).max(300),
    }),
  ).max(32),
});
export type StructuredMenu = z.infer<typeof structuredMenuSchema>;

export const assessmentSchema = z.object({
  rationaleFi: z.string().trim().min(5).max(180),
  revisionId: z.number().int().positive(),
  scores: z.object({
    appeal: scoreSchema,
    distinctiveness: scoreSchema,
    value: scoreSchema,
    variety: scoreSchema,
  }),
  structuredMenu: structuredMenuSchema,
});

export interface AssessmentOffering {
  lunchHours: string | null;
  menuText: string;
  priceText: string | null;
  restaurantId: string;
  restaurantName: string;
  revisionId: number;
}

export interface AssessmentRequest {
  offerings: AssessmentOffering[];
  serviceDate: string;
}

export type Assessor = (request: AssessmentRequest) => Promise<unknown>;

interface AssessorEnvelope {
  assessments: unknown;
  inputTokens?: number | null;
  outputTokens?: number | null;
  providerResponseId?: string | null;
}

export interface RecommendationVersions {
  model: string;
  profileVersion: string;
  promptVersion: string;
  rankingVersion: string;
  rubricVersion: string;
  schemaVersion: string;
}

interface AssessAndRankDayOptions {
  assessor: Assessor;
  db: Database.Database;
  now?: () => Date;
  serviceDate: string;
  versions?: Partial<RecommendationVersions>;
}

export interface RankedRecommendation {
  rank: number;
  rationaleFi: string;
  restaurantId: string;
  score: number;
}

export interface RecommendationResult {
  createdAssessmentCount: number;
  recommendationSetId: number;
  recommendations: RankedRecommendation[];
  reusedRecommendationSet: boolean;
}

export const defaultRecommendationVersions: RecommendationVersions = {
  model: "gpt-5.4-nano",
  profileVersion: "shared-v1",
  promptVersion: "v5",
  rankingVersion: "weighted-v1",
  rubricVersion: "v2",
  schemaVersion: "v4",
};

interface CandidateRow {
  lunch_hours: string | null;
  menu_text: string;
  price_text: string | null;
  restaurant_id: string;
  restaurant_name: string;
  revision_id: number;
}

interface AssessedRow {
  assessment_id: number;
  rationale_fi: string;
  restaurant_id: string;
  revision_id: number;
  total_score: number;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function totalScore(scores: z.infer<typeof assessmentSchema>["scores"]): number {
  return Number(
    (
      scores.appeal * 0.35 +
      scores.distinctiveness * 0.25 +
      scores.variety * 0.2 +
      scores.value * 0.2
    ).toFixed(1),
  );
}

function compareRank(a: AssessedRow, b: AssessedRow): number {
  if (a.total_score !== b.total_score) return b.total_score - a.total_score;
  return a.restaurant_id < b.restaurant_id ? -1 : a.restaurant_id > b.restaurant_id ? 1 : 0;
}

function latestPublishedOfferings(
  db: Database.Database,
  serviceDate: string,
): CandidateRow[] {
  return db
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
      SELECT
        revision.id AS revision_id,
        restaurant.id AS restaurant_id,
        restaurant.name AS restaurant_name,
        revision.menu_text,
        revision.lunch_hours,
        revision.price_text
      FROM latest_fetches
      JOIN fetch_observations observation ON observation.fetch_id = latest_fetches.id
      JOIN offering_revisions revision ON revision.id = observation.revision_id
      JOIN restaurants restaurant ON restaurant.id = observation.restaurant_id
      WHERE revision.availability = 'published' AND revision.menu_text IS NOT NULL
      ORDER BY restaurant.id`,
    )
    .all(serviceDate) as CandidateRow[];
}

function findAssessments(
  db: Database.Database,
  offerings: CandidateRow[],
  versions: RecommendationVersions,
): AssessedRow[] {
  if (offerings.length === 0) return [];
  const ids = offerings.map(() => "?").join(", ");
  return db
    .prepare(
      `SELECT
        assessment.id AS assessment_id,
        revision.restaurant_id,
        assessment.revision_id,
        assessment.total_score,
        assessment.rationale_fi
      FROM assessments assessment
      JOIN offering_revisions revision ON revision.id = assessment.revision_id
      WHERE assessment.revision_id IN (${ids})
        AND assessment.profile_version = ?
        AND assessment.rubric_version = ?
        AND assessment.prompt_version = ?
        AND assessment.schema_version = ?
        AND assessment.model = ?`,
    )
    .all(
      ...offerings.map((offering) => offering.revision_id),
      versions.profileVersion,
      versions.rubricVersion,
      versions.promptVersion,
      versions.schemaVersion,
      versions.model,
    ) as AssessedRow[];
}

function loadRecommendations(db: Database.Database, setId: number): RankedRecommendation[] {
  return db
    .prepare(
      `SELECT
        entry.rank,
        revision.restaurant_id AS restaurantId,
        assessment.total_score AS score,
        assessment.rationale_fi AS rationaleFi
      FROM recommendation_entries entry
      JOIN assessments assessment ON assessment.id = entry.assessment_id
      JOIN offering_revisions revision ON revision.id = assessment.revision_id
      WHERE entry.set_id = ?
      ORDER BY entry.rank`,
    )
    .all(setId) as RankedRecommendation[];
}

export async function assessAndRankDay(
  options: AssessAndRankDayOptions,
): Promise<RecommendationResult> {
  const versions = { ...defaultRecommendationVersions, ...options.versions };
  const now = options.now ?? (() => new Date());
  const offerings = latestPublishedOfferings(options.db, options.serviceDate);
  const existing = findAssessments(options.db, offerings, versions);
  const existingRevisionIds = new Set(existing.map((row) => row.revision_id));
  const unseen = offerings.filter((offering) => !existingRevisionIds.has(offering.revision_id));
  let createdAssessmentCount = 0;

  if (unseen.length > 0) {
    const insert = options.db.prepare(`
      INSERT INTO assessments (
        revision_id, profile_version, rubric_version, prompt_version,
        schema_version, model, scores_json, total_score, rationale_fi,
        structured_menu_json, provider_response_id, input_tokens, output_tokens,
        assessed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const offering of unseen) {
      const rawOutput = await options.assessor({
        offerings: [
          {
            lunchHours: offering.lunch_hours,
            menuText: offering.menu_text,
            priceText: offering.price_text,
            restaurantId: offering.restaurant_id,
            restaurantName: offering.restaurant_name,
            revisionId: offering.revision_id,
          },
        ],
        serviceDate: options.serviceDate,
      });
      const envelope =
        typeof rawOutput === "object" && rawOutput !== null && "assessments" in rawOutput
          ? (rawOutput as AssessorEnvelope)
          : null;
      const output = z.array(assessmentSchema).length(1).parse(envelope?.assessments ?? rawOutput);
      const assessment = output[0]!;
      if (assessment.revisionId !== offering.revision_id) {
        throw new Error("Assessor output does not match requested revision");
      }
      insert.run(
        assessment.revisionId,
        versions.profileVersion,
        versions.rubricVersion,
        versions.promptVersion,
        versions.schemaVersion,
        versions.model,
        JSON.stringify(assessment.scores),
        totalScore(assessment.scores),
        assessment.rationaleFi,
        JSON.stringify(assessment.structuredMenu),
        envelope?.providerResponseId ?? null,
        envelope?.inputTokens ?? null,
        envelope?.outputTokens ?? null,
        now().toISOString(),
      );
      createdAssessmentCount += 1;
    }
  }

  const assessed = unseen.length > 0 ? findAssessments(options.db, offerings, versions) : existing;
  const ranked = assessed.sort(compareRank).slice(0, 3);
  const inputHash = recommendationInputHash(assessed);
  const createdAt = now().toISOString();
  const { set, setInsertion } = options.db.transaction(() => {
    const setInsertion = options.db
      .prepare(
        `INSERT OR IGNORE INTO recommendation_sets (
          service_date, profile_version, ranking_version, input_hash, created_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        options.serviceDate,
        versions.profileVersion,
        versions.rankingVersion,
        inputHash,
        createdAt,
      );
    const set = options.db
      .prepare(
        `SELECT id FROM recommendation_sets
         WHERE service_date = ? AND profile_version = ? AND ranking_version = ? AND input_hash = ?`,
      )
      .get(
        options.serviceDate,
        versions.profileVersion,
        versions.rankingVersion,
        inputHash,
      ) as { id: number };

    if (setInsertion.changes === 0) return { set, setInsertion };
    const insertEntry = options.db.prepare(
      `INSERT INTO recommendation_entries (set_id, rank, assessment_id) VALUES (?, ?, ?)`,
    );
    ranked.forEach((row, index) => insertEntry.run(set.id, index + 1, row.assessment_id));
    return { set, setInsertion };
  })();

  return {
    createdAssessmentCount,
    recommendationSetId: set.id,
    recommendations: loadRecommendations(options.db, set.id),
    reusedRecommendationSet: setInsertion.changes === 0,
  };
}

export function recommendationInputHash(
  assessments: Array<{ assessment_id: number; total_score: number }>,
): string {
  return sha256(
    assessments
      .map((row) => ({ assessmentId: row.assessment_id, score: row.total_score }))
      .sort((a, b) => a.assessmentId - b.assessmentId),
  );
}
