import type Database from "better-sqlite3";

import type { CrawlResult, CustomSourceService } from "./custom-sources.js";
import { OpenAiRequestBudget } from "./openai-request-budget.js";
import {
  assessAndRankDay,
  type AssessmentAdapter,
  type RecommendationResult,
  type RecommendationVersions,
} from "./recommendations.js";

export type PublicationDateOutcome =
  | { result: RecommendationResult; serviceDate: string; status: "succeeded" }
  | { error: unknown; serviceDate: string; status: "failed" }
  | { serviceDate: string; status: "disabled" };

export interface RecommendationPublicationOutcome {
  dates: PublicationDateOutcome[];
}

interface RecommendationPublicationOptions {
  adminRequestBudget: number;
  assessor: AssessmentAdapter | null;
  customSources: CustomSourceService | null;
  db: Database.Database;
  refreshRequestBudget: number;
  versions: Partial<RecommendationVersions>;
}

export interface RecommendationPublication {
  addCustomSource(
    url: string,
    serviceDates: string[],
  ): Promise<{
    outcome: RecommendationPublicationOutcome;
    source: CrawlResult;
  }>;
  runScheduled(serviceDates: string[]): Promise<RecommendationPublicationOutcome>;
}

export function createRecommendationPublication(
  options: RecommendationPublicationOptions,
): RecommendationPublication {
  async function assessDates(
    serviceDates: string[],
    budget: OpenAiRequestBudget,
  ): Promise<RecommendationPublicationOutcome> {
    if (!options.assessor) {
      return {
        dates: serviceDates.map((serviceDate) => ({ serviceDate, status: "disabled" })),
      };
    }

    const dates: PublicationDateOutcome[] = [];
    for (const serviceDate of serviceDates) {
      try {
        const result = await assessAndRankDay({
          assessor: options.assessor,
          budget,
          db: options.db,
          serviceDate,
          versions: options.versions,
        });
        dates.push({ result, serviceDate, status: "succeeded" });
      } catch (error) {
        dates.push({ error, serviceDate, status: "failed" });
      }
    }
    return { dates };
  }

  return {
    async addCustomSource(url, serviceDates) {
      if (!options.customSources) {
        throw new Error("Custom source publication is not configured");
      }
      const budget = new OpenAiRequestBudget(options.adminRequestBudget);
      const source = await options.customSources.addAndCrawl(url, serviceDates, budget);
      return {
        outcome: await assessDates(serviceDates, budget),
        source,
      };
    },
    async runScheduled(serviceDates) {
      const budget = new OpenAiRequestBudget(options.refreshRequestBudget);
      await options.customSources?.crawlAll(serviceDates, budget);
      return assessDates(serviceDates, budget);
    },
  };
}
