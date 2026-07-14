import type Database from "better-sqlite3";
import { z } from "zod";

import { parseIsoDate } from "./dates.js";
import {
  persistFailedFetch,
  persistSuccessfulFetch,
  sha256,
  type StoredOffering,
} from "./offering-store.js";
import { normalizeMenuPageUrl, PageFetchError } from "./page-fetcher.js";

const nullableText = z.string().trim().max(4_000).nullable();
const weekdaySchema = z.enum(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);

export const pageExtractionSchema = z.object({
  menus: z.array(
    z.object({
      lunchHours: z.string().trim().max(80).nullable(),
      menuText: z.string().trim().max(4_000).nullable(),
      priceText: z.string().trim().max(160).nullable(),
      serviceDate: z.string(),
      status: z.enum(["not_found", "published"]),
      title: z.string().trim().max(160).nullable(),
    }),
  ),
  pageType: z.enum(["restaurant_page", "unsupported"]),
  restaurant: z.object({
    address: z.string().trim().max(300).nullable(),
    city: z.string().trim().max(120).nullable(),
    description: nullableText,
    name: z.string().trim().max(160).nullable(),
    openingHours: z.array(
      z.object({
        close: z.string().trim().max(20),
        open: z.string().trim().max(20),
        weekday: weekdaySchema,
      }),
    ),
    phone: z.string().trim().max(80).nullable(),
  }),
});

export type PageExtraction = z.infer<typeof pageExtractionSchema>;

export interface MenuExtractorResult {
  extraction: unknown;
  inputTokens?: number | null;
  outputTokens?: number | null;
  providerResponseId?: string | null;
}

export type MenuExtractor = (request: {
  pageText: string;
  serviceDates: string[];
  url: string;
}) => Promise<MenuExtractorResult>;

export interface FetchedMenuPage {
  body: string;
  finalUrl: string;
  httpStatus: number;
  text: string;
  truncated: boolean;
}

export type MenuPageFetcher = (url: string) => Promise<FetchedMenuPage>;

interface CustomSourceServiceOptions {
  db: Database.Database;
  extractor: MenuExtractor;
  fetchPage: MenuPageFetcher;
  model: string;
  now?: () => Date;
  promptVersion?: string;
}

interface CustomSourceRow {
  id: number;
  url: string;
}

interface CrawlResult {
  createdRevisionCount: number;
  restaurantId: string;
  reusedExtraction: boolean;
  sourceId: number;
}

class CustomSourceError extends Error {
  constructor(
    message: string,
    readonly outcome: "extraction_error" | "http_error" | "invalid_response" | "network_error",
    readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "CustomSourceError";
  }
}

export function normalizeCustomSourceUrl(value: string): string {
  return normalizeMenuPageUrl(value);
}

function validateServiceDates(serviceDates: string[]): void {
  if (
    serviceDates.length === 0 ||
    new Set(serviceDates).size !== serviceDates.length ||
    serviceDates.some((date) => !parseIsoDate(date))
  ) {
    throw new Error("Custom source service dates are invalid");
  }
}

function validateExtraction(value: unknown, serviceDates: string[]): PageExtraction {
  const extraction = pageExtractionSchema.parse(value);
  if (extraction.pageType !== "restaurant_page" || !extraction.restaurant.name) {
    throw new CustomSourceError(
      "The page does not contain an identifiable restaurant",
      "extraction_error",
    );
  }
  const actualDates = extraction.menus.map((menu) => menu.serviceDate);
  if (
    actualDates.length !== serviceDates.length ||
    new Set(actualDates).size !== actualDates.length ||
    serviceDates.some((date) => !actualDates.includes(date)) ||
    extraction.menus.some(
      (menu) =>
        !parseIsoDate(menu.serviceDate) ||
        (menu.status === "published" && !menu.menuText) ||
        (menu.status === "not_found" && menu.menuText !== null),
    )
  ) {
    throw new CustomSourceError(
      "The extracted menu dates do not match the requested dates",
      "extraction_error",
    );
  }
  return extraction;
}

function reuseExtraction(value: unknown, serviceDates: string[]): PageExtraction | null {
  try {
    const extraction = pageExtractionSchema.parse(value);
    const requestedMenus = extraction.menus.filter((menu) => serviceDates.includes(menu.serviceDate));
    return validateExtraction({ ...extraction, menus: requestedMenus }, serviceDates);
  } catch {
    return null;
  }
}

const weekdayKeys = {
  FR: "fri",
  MO: "mon",
  SA: "sat",
  SU: "sun",
  TH: "thu",
  TU: "tue",
  WE: "wed",
} as const;

function openingHoursForStorage(extraction: PageExtraction): unknown[] {
  const period: Record<string, Array<{ close: string; open: string }>> = {};
  for (const hours of extraction.restaurant.openingHours) {
    const key = weekdayKeys[hours.weekday];
    (period[key] ??= []).push({ close: hours.close, open: hours.open });
  }
  return Object.keys(period).length > 0 ? [period] : [];
}

function storedOffering(
  source: CustomSourceRow,
  extraction: PageExtraction,
  menu: PageExtraction["menus"][number],
  runId: number,
): StoredOffering {
  const published = menu.status === "published";
  return {
    address: extraction.restaurant.address,
    availability: published ? "published" : "not_published",
    city: extraction.restaurant.city,
    customSourceId: source.id,
    descriptionText: extraction.restaurant.description,
    id: `custom:${source.id}`,
    latitude: null,
    longitude: null,
    lunchHours: published ? menu.lunchHours : null,
    menuText: published ? menu.menuText : null,
    menuTitle: published ? menu.title : null,
    name: extraction.restaurant.name!,
    openingHours: openingHoursForStorage(extraction),
    phone: extraction.restaurant.phone,
    photoUrl: null,
    priceText: published ? menu.priceText : null,
    snapshot: {
      customRunId: runId,
      customSourceUrl: source.url,
      menu,
      restaurant: extraction.restaurant,
    },
    websiteUrl: source.url,
  };
}

function ensureSource(db: Database.Database, url: string, createdAt: string): CustomSourceRow {
  db.prepare(
    `INSERT OR IGNORE INTO custom_sources (url, enabled, created_at)
     VALUES (?, 1, ?)`,
  ).run(url, createdAt);
  const source = db.prepare("SELECT id, url FROM custom_sources WHERE url = ?").get(url) as
    | CustomSourceRow
    | undefined;
  if (!source) throw new Error("Custom source was not persisted");
  return source;
}

export function createCustomSourceService(options: CustomSourceServiceOptions): {
  addAndCrawl: (url: string, serviceDates: string[]) => Promise<CrawlResult>;
  crawlAll: (serviceDates: string[]) => Promise<void>;
} {
  const now = options.now ?? (() => new Date());
  const promptVersion = options.promptVersion ?? "custom-menu-v1";

  async function crawlSource(
    source: CustomSourceRow,
    serviceDates: string[],
  ): Promise<CrawlResult> {
    validateServiceDates(serviceDates);
    const startedAt = now().toISOString();
    const runInsertion = options.db
      .prepare(
        `INSERT INTO custom_source_runs (
          custom_source_id, started_at, outcome, model, prompt_version
        ) VALUES (?, ?, 'running', ?, ?)`,
      )
      .run(source.id, startedAt, options.model, promptVersion);
    const runId = Number(runInsertion.lastInsertRowid);
    let fetchedPage: FetchedMenuPage | null = null;
    let contentHash: string | null = null;

    try {
      fetchedPage = await options.fetchPage(source.url);
      if (fetchedPage.truncated) {
        throw new CustomSourceError(
          "Custom source page text is too long to extract safely",
          "invalid_response",
          fetchedPage.httpStatus,
        );
      }
      contentHash = sha256(fetchedPage.text);
      const previous = options.db
        .prepare(
          `SELECT extracted_json
           FROM custom_source_runs
           WHERE custom_source_id = ? AND id <> ? AND content_hash = ?
             AND outcome IN ('success', 'unchanged') AND extracted_json IS NOT NULL
             AND model = ? AND prompt_version = ?
           ORDER BY id DESC LIMIT 1`,
        )
        .get(source.id, runId, contentHash, options.model, promptVersion) as
        | { extracted_json: string }
        | undefined;
      let cachedExtraction: PageExtraction | null = null;
      if (previous) {
        cachedExtraction = reuseExtraction(JSON.parse(previous.extracted_json), serviceDates);
      }
      const reusedExtraction = cachedExtraction !== null;
      let extractorResult: MenuExtractorResult;
      let extraction: PageExtraction;
      if (cachedExtraction) {
        extraction = cachedExtraction;
        extractorResult = { extraction };
      } else {
        extractorResult = await options.extractor({
          pageText: fetchedPage.text,
          serviceDates,
          url: source.url,
        });
        extraction = validateExtraction(extractorResult.extraction, serviceDates);
      }
      const finishedAt = now().toISOString();
      let createdRevisionCount = 0;

      options.db.transaction(() => {
        options.db
          .prepare(
            `UPDATE custom_source_runs SET
              finished_at = ?, outcome = ?, http_status = ?, source_text = ?,
              content_hash = ?, extracted_json = ?, provider_response_id = ?,
              input_tokens = ?, output_tokens = ?
             WHERE id = ?`,
          )
          .run(
            finishedAt,
            reusedExtraction ? "unchanged" : "success",
            fetchedPage!.httpStatus,
            fetchedPage!.text,
            contentHash,
            JSON.stringify(extraction),
            extractorResult.providerResponseId ?? null,
            extractorResult.inputTokens ?? null,
            extractorResult.outputTokens ?? null,
            runId,
          );

        for (const serviceDate of serviceDates) {
          const menu = extraction.menus.find((candidate) => candidate.serviceDate === serviceDate)!;
          const result = persistSuccessfulFetch({
            customRunId: runId,
            customSourceId: source.id,
            db: options.db,
            finishedAt,
            httpStatus: fetchedPage!.httpStatus,
            offerings: [storedOffering(source, extraction, menu, runId)],
            request: {
              customRunId: runId,
              customSourceId: source.id,
              serviceDate,
              url: source.url,
            },
            responseHash: contentHash,
            serviceDate,
            startedAt,
          });
          createdRevisionCount += result.createdRevisionCount;
        }
      })();

      return {
        createdRevisionCount,
        restaurantId: `custom:${source.id}`,
        reusedExtraction,
        sourceId: source.id,
      };
    } catch (error) {
      const finishedAt = now().toISOString();
      const knownError =
        error instanceof CustomSourceError || error instanceof PageFetchError ? error : null;
      const outcome = knownError?.outcome ?? (fetchedPage ? "extraction_error" : "network_error");
      const errorMessage = error instanceof Error ? error.message : "Custom source refresh failed";
      options.db.transaction(() => {
        options.db
          .prepare(
            `UPDATE custom_source_runs SET
              finished_at = ?, outcome = ?, http_status = ?, error_message = ?,
              source_text = ?, content_hash = ?
             WHERE id = ?`,
          )
          .run(
            finishedAt,
            outcome,
            knownError?.httpStatus ?? fetchedPage?.httpStatus ?? null,
            errorMessage,
            fetchedPage?.text ?? null,
            contentHash,
            runId,
          );
        for (const serviceDate of serviceDates) {
          persistFailedFetch({
            customRunId: runId,
            customSourceId: source.id,
            db: options.db,
            errorMessage,
            finishedAt,
            httpStatus: knownError?.httpStatus ?? fetchedPage?.httpStatus ?? null,
            outcome,
            request: {
              customRunId: runId,
              customSourceId: source.id,
              serviceDate,
              url: source.url,
            },
            responseHash: contentHash,
            serviceDate,
            startedAt,
          });
        }
      })();
      throw error;
    }
  }

  return {
    async addAndCrawl(url, serviceDates) {
      validateServiceDates(serviceDates);
      const source = ensureSource(options.db, normalizeCustomSourceUrl(url), now().toISOString());
      return crawlSource(source, serviceDates);
    },
    async crawlAll(serviceDates) {
      validateServiceDates(serviceDates);
      const sources = options.db
        .prepare("SELECT id, url FROM custom_sources WHERE enabled = 1 ORDER BY id")
        .all() as CustomSourceRow[];
      for (const source of sources) {
        try {
          await crawlSource(source, serviceDates);
        } catch {
          // The persisted run error is exposed in the admin overview.
        }
      }
    },
  };
}
