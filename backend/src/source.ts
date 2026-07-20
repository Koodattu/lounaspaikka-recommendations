import { readBoundedResponseBody } from "./bounded-response.js";

const endpoint = "https://lounaspaikka.ilkkapohjalainen.fi/resources/lunch/pois";
const endpointOrigin = new URL(endpoint).origin;
const pageSize = 100;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export interface SourcePage {
  body: string;
  status: number;
  url: string;
}

export interface SourceFetchResult {
  items: unknown[];
  pages: SourcePage[];
  request: {
    latitude: number;
    longitude: number;
    maxDistance: number;
    serviceDate: string;
  };
}

export interface LunchSource {
  fetchLunchDay(serviceDate: string): Promise<SourceFetchResult>;
}

export class SourceFetchError extends Error {
  constructor(
    message: string,
    readonly outcome: "http_error" | "invalid_response" | "network_error",
    readonly request: SourceFetchResult["request"],
    readonly pages: SourcePage[],
    readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "SourceFetchError";
  }
}

interface ClientOptions {
  fetchImpl?: typeof fetch;
  maxBytesPerPage?: number;
  maxItems?: number;
  maxPages?: number;
  maxRedirects?: number;
  maxTotalBytes?: number;
  timeoutMs?: number;
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

export function createLounaspaikkaClient(options: ClientOptions = {}): LunchSource {
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
    async fetchLunchDay(serviceDate) {
      const pages: SourcePage[] = [];
      const items: unknown[] = [];
      let totalBytes = 0;
      const request = {
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
              throw new SourceFetchError(
                "Lounaspaikka redirect is missing a location",
                "http_error",
                request,
                pages,
                response.status,
              );
            }
            if (redirectCount === maxRedirects) {
              throw new SourceFetchError(
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
              throw new SourceFetchError(
                error instanceof Error ? error.message : "Lounaspaikka redirect is invalid",
                "invalid_response",
                request,
                pages,
                response.status,
              );
            }
          }
          if (!response) {
            throw new SourceFetchError(
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
            () => new SourceFetchError(
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
            throw new SourceFetchError(
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
            throw new SourceFetchError(
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
            throw new SourceFetchError(
              "Lounaspaikka response is missing items",
              "invalid_response",
              request,
              pages,
              response.status,
            );
          }

          if (items.length + parsed.items.length > maxItems) {
            throw new SourceFetchError(
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
            throw new SourceFetchError(
              "Lounaspaikka returned too many pages",
              "invalid_response",
              request,
              pages,
              response.status,
            );
          }
        }
      } catch (error) {
        if (error instanceof SourceFetchError) throw error;
        throw new SourceFetchError(
          error instanceof Error ? error.message : "Lounaspaikka request failed",
          "network_error",
          request,
          pages,
        );
      }

      return {
        items,
        pages,
        request,
      };
    },
  };
}
