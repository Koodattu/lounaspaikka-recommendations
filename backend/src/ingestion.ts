import type Database from "better-sqlite3";

import { parseIsoDate } from "./dates.js";
import { htmlToText, normalizeLunchHours } from "./html.js";
import {
  persistFailedFetch,
  persistSuccessfulFetch,
  sha256,
  type PersistResult,
  type StoredOffering,
} from "./offering-store.js";
import { SourceFetchError, type LunchSource, type SourceFetchResult } from "./source.js";

interface IngestLunchDayOptions {
  db: Database.Database;
  now?: () => Date;
  serviceDate: string;
  source: LunchSource;
}

export type IngestResult = PersistResult;

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

interface EuroPrice {
  amount: number;
  text: string;
}

function euroPrice(value: unknown): EuroPrice | null {
  const candidate = optionalString(value);
  const match = candidate?.match(/^(\d{1,3})(?:[.,](\d{1,2}))?\s*(?:€|eur)?$/i);
  if (!match) return null;

  const decimals = match[2]?.padEnd(2, "0") ?? "";
  return {
    amount: Number(`${match[1]}.${decimals || "0"}`),
    text: `${match[1]}${decimals ? `,${decimals}` : ""} €`,
  };
}

function extractLunchPriceText(
  dailyAd: Record<string, unknown> | null,
  menuText: string | null,
): string | null {
  const prices: EuroPrice[] = [];
  const addPrice = (value: unknown) => {
    const price = euroPrice(value);
    if (price && !prices.some((candidate) => candidate.amount === price.amount)) {
      prices.push(price);
    }
  };

  if (Array.isArray(dailyAd?.lunchMenu)) {
    for (const value of dailyAd.lunchMenu) addPrice(record(value)?.price);
  }

  if (menuText) {
    const lunchPricePattern = /(?:koko\s+)?(?:lounas(?:buffet|pöytä|tarjous|ateria)?|keitto-?lounas|salaatti-?lounas|noutopöytä|päivän\s+(?:burger|parila|salaatti)|viikon\s+kasvis)(?!\p{L})[^€\n]{0,48}?(\d{1,3}(?:[.,]\d{1,2})?)\s*€/giu;
    for (const match of menuText.matchAll(lunchPricePattern)) addPrice(match[1]);

    if (prices.length === 0) {
      const allEuroPrices = [...menuText.matchAll(/(\d{1,3}(?:[.,]\d{1,2})?)\s*€/gu)];
      if (allEuroPrices.length === 1) addPrice(allEuroPrices[0]?.[1]);
    }
  }

  prices.sort((first, second) => first.amount - second.amount);
  if (prices.length === 0) return null;
  if (prices.length === 1) return prices[0]!.text;
  return `${prices[0]!.text.replace(/ €$/, "")}–${prices.at(-1)!.text}`;
}

function parseRestaurant(value: unknown, serviceDate: string): StoredOffering {
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
    customSourceId: null,
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
    priceText: extractLunchPriceText(dailyAd, menuText),
    snapshot: { dailyAd, restaurant: item },
    websiteUrl: optionalHttpUrl(item.www),
  };
}

function recordFailure(
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

  persistFailedFetch({
    db,
    errorMessage: error instanceof Error ? error.message : "Unknown source error",
    finishedAt,
    httpStatus: sourceError?.httpStatus ?? null,
    outcome,
    request,
    responseHash: pages ? sha256(pages.map((page) => page.body)) : null,
    responsePages: pages,
    serviceDate,
    startedAt,
  });
}

export async function ingestLunchDay(options: IngestLunchDayOptions): Promise<IngestResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  let sourceResult: SourceFetchResult | undefined;
  try {
    sourceResult = await options.source.fetchLunchDay(options.serviceDate);
    const offerings = sourceResult.items.map((item) =>
      parseRestaurant(item, options.serviceDate),
    );
    const finishedAt = now().toISOString();
    return persistSuccessfulFetch({
      db: options.db,
      finishedAt,
      httpStatus: sourceResult.pages.at(-1)?.status ?? null,
      offerings,
      request: sourceResult.request,
      responseHash: sha256(sourceResult.pages.map((page) => page.body)),
      responsePages: sourceResult.pages,
      serviceDate: options.serviceDate,
      startedAt,
    });
  } catch (error) {
    recordFailure(
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
