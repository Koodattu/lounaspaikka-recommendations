const endpoint = "https://lounaspaikka.ilkkapohjalainen.fi/resources/lunch/pois";
const pageSize = 100;

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

export function createLounaspaikkaClient(options: ClientOptions = {}): LunchSource {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;

  return {
    async fetchLunchDay(serviceDate) {
      const pages: SourcePage[] = [];
      const items: unknown[] = [];
      let page = 0;
      const request = {
        latitude: 62.7907,
        longitude: 22.8396,
        maxDistance: 50_000,
        serviceDate,
      };

      try {
        while (true) {
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

          const response = await fetchImpl(url, {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(timeoutMs),
          });
          const body = await response.text();
          pages.push({ body, status: response.status, url: url.toString() });
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

          items.push(...parsed.items);
          if (parsed.items.length < pageSize) break;
          page += 1;
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
