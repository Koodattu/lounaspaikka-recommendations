import { readBoundedResponseBody } from "./bounded-response.js";
import { parseIsoDate } from "./dates.js";
import { htmlToText, normalizeLunchHours } from "./html.js";

const endpoint = "https://lounaspaikka.ilkkapohjalainen.fi/resources/lunch/pois";
const endpointOrigin = new URL(endpoint).origin;
const pageSize = 100;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

interface ClientOptions {
  fetchImpl?: typeof fetch;
  maxBytesPerPage?: number;
  maxItems?: number;
  maxPages?: number;
  maxRedirects?: number;
  maxTotalBytes?: number;
  timeoutMs?: number;
}

export interface LounaspaikkaCatchmentRequest {
  latitude: number;
  longitude: number;
  maxDistance: number;
  serviceDate: string;
}

export interface LounaspaikkaCatchmentPage {
  body: string;
  status: number;
  url: string;
}

export interface CapturedLounaspaikkaOffering {
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
  priceText: string | null;
  sourceSnapshot: unknown;
  websiteUrl: string | null;
}

export interface LounaspaikkaCatchmentObservation {
  offerings: CapturedLounaspaikkaOffering[];
  pages: LounaspaikkaCatchmentPage[];
  request: LounaspaikkaCatchmentRequest;
}

export interface LounaspaikkaCatchmentAdapter {
  observe(serviceDate: string): Promise<LounaspaikkaCatchmentObservation>;
}

export class LounaspaikkaCatchmentObservationError extends Error {
  constructor(
    message: string,
    readonly outcome: "http_error" | "invalid_response" | "network_error",
    readonly request: LounaspaikkaCatchmentRequest,
    readonly pages: LounaspaikkaCatchmentPage[],
    readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "LounaspaikkaCatchmentObservationError";
  }
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

function parseRestaurant(value: unknown, serviceDate: string): CapturedLounaspaikkaOffering {
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
    priceText: extractLunchPriceText(dailyAd, menuText),
    sourceSnapshot: { dailyAd, restaurant: item },
    websiteUrl: optionalHttpUrl(item.www),
  };
}

function timestampForServiceDate(serviceDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    throw new Error("Invalid service date");
  }
  const timestamp = Date.parse(`${serviceDate}T09:00:00.000Z`);
  if (Number.isNaN(timestamp)) throw new Error("Invalid service date");
  return String(timestamp);
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function redirectUrl(value: string, currentUrl: string): string {
  let url: URL;
  try {
    url = new URL(value, currentUrl);
  } catch {
    throw new Error("Lounaspaikka redirect URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== endpointOrigin ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new Error("Lounaspaikka redirect target is not allowed");
  }
  url.hash = "";
  return url.toString();
}

export function createLounaspaikkaCatchmentAdapter(
  options: ClientOptions = {},
): LounaspaikkaCatchmentAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytesPerPage = positiveInteger(
    options.maxBytesPerPage ?? 2 * 1_048_576,
    "maxBytesPerPage",
  );
  const maxItems = positiveInteger(options.maxItems ?? 1_000, "maxItems");
  const maxPages = positiveInteger(options.maxPages ?? 10, "maxPages");
  const maxRedirects = nonNegativeInteger(options.maxRedirects ?? 3, "maxRedirects");
  const maxTotalBytes = positiveInteger(
    options.maxTotalBytes ?? 8 * 1_048_576,
    "maxTotalBytes",
  );
  const timeoutMs = options.timeoutMs ?? 15_000;

  return {
    async observe(serviceDate) {
      const pages: LounaspaikkaCatchmentPage[] = [];
      const items: unknown[] = [];
      let totalBytes = 0;
      const request: LounaspaikkaCatchmentRequest = {
        latitude: 62.7907,
        longitude: 22.8396,
        maxDistance: 50_000,
        serviceDate,
      };

      try {
        for (let page = 0; page < maxPages; page += 1) {
          const url = new URL(endpoint);
          url.search = new URLSearchParams({
            channel: "collections_lounaspaikka",
            l: "fi",
            lat: "62.7907",
            lon: "22.8396",
            maxdist: "50000",
            page: String(page),
            size: String(pageSize),
            ts: timestampForServiceDate(serviceDate),
            uit: "lounas-ilpo-prod",
          }).toString();

          let currentUrl = url.toString();
          let response: Response | null = null;
          for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
            response = await fetchImpl(currentUrl, {
              headers: { accept: "application/json" },
              redirect: "manual",
              signal: AbortSignal.timeout(timeoutMs),
            });
            if (!redirectStatuses.has(response.status)) break;

            const location = response.headers.get("location");
            await response.body?.cancel();
            if (!location) {
              throw new LounaspaikkaCatchmentObservationError(
                "Lounaspaikka redirect is missing a location",
                "http_error",
                request,
                pages,
                response.status,
              );
            }
            if (redirectCount === maxRedirects) {
              throw new LounaspaikkaCatchmentObservationError(
                "Lounaspaikka returned too many redirects",
                "http_error",
                request,
                pages,
                response.status,
              );
            }
            try {
              currentUrl = redirectUrl(location, currentUrl);
            } catch (error) {
              throw new LounaspaikkaCatchmentObservationError(
                error instanceof Error ? error.message : "Lounaspaikka redirect is invalid",
                "invalid_response",
                request,
                pages,
                response.status,
              );
            }
          }
          if (!response) {
            throw new LounaspaikkaCatchmentObservationError(
              "Lounaspaikka did not return a response",
              "network_error",
              request,
              pages,
            );
          }
          const remainingTotalBytes = maxTotalBytes - totalBytes;
          const responseByteLimit = Math.min(maxBytesPerPage, remainingTotalBytes);
          const totalLimitIsTighter = remainingTotalBytes < maxBytesPerPage;
          const bytes = await readBoundedResponseBody(
            response,
            responseByteLimit,
            () => new LounaspaikkaCatchmentObservationError(
              totalLimitIsTighter
                ? "Lounaspaikka responses exceed the total size limit"
                : "Lounaspaikka response is too large",
              "invalid_response",
              request,
              pages,
              response.status,
            ),
          );
          totalBytes += bytes.byteLength;
          const body = new TextDecoder().decode(bytes);
          pages.push({ body, status: response.status, url: currentUrl });
          if (!response.ok) {
            throw new LounaspaikkaCatchmentObservationError(
              `Lounaspaikka returned HTTP ${response.status}`,
              "http_error",
              request,
              pages,
              response.status,
            );
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch {
            throw new LounaspaikkaCatchmentObservationError(
              "Lounaspaikka returned invalid JSON",
              "invalid_response",
              request,
              pages,
              response.status,
            );
          }
          if (
            typeof parsed !== "object" ||
            parsed === null ||
            !("items" in parsed) ||
            !Array.isArray(parsed.items)
          ) {
            throw new LounaspaikkaCatchmentObservationError(
              "Lounaspaikka response is missing items",
              "invalid_response",
              request,
              pages,
              response.status,
            );
          }

          if (items.length + parsed.items.length > maxItems) {
            throw new LounaspaikkaCatchmentObservationError(
              "Lounaspaikka returned too many items",
              "invalid_response",
              request,
              pages,
              response.status,
            );
          }
          items.push(...parsed.items);
          if (parsed.items.length < pageSize) break;
          if (page === maxPages - 1) {
            throw new LounaspaikkaCatchmentObservationError(
              "Lounaspaikka returned too many pages",
              "invalid_response",
              request,
              pages,
              response.status,
            );
          }
        }

        let offerings: CapturedLounaspaikkaOffering[];
        try {
          offerings = items.map((item) => parseRestaurant(item, serviceDate));
        } catch (error) {
          throw new LounaspaikkaCatchmentObservationError(
            error instanceof Error ? error.message : "Lounaspaikka restaurant is invalid",
            "invalid_response",
            request,
            pages,
            pages.at(-1)?.status ?? null,
          );
        }

        return { offerings, pages, request };
      } catch (error) {
        if (error instanceof LounaspaikkaCatchmentObservationError) throw error;
        throw new LounaspaikkaCatchmentObservationError(
          error instanceof Error ? error.message : "Lounaspaikka request failed",
          "network_error",
          request,
          pages,
        );
      }
    },
  };
}
