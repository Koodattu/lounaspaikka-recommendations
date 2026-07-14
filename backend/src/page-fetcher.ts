import { lookup as dnsLookup } from "node:dns/promises";
import { Agent, request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import { htmlToText } from "./html.js";

const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const challengeMarkers = [
  "please wait while your request is being verified",
  "just a moment",
  "checking your browser",
  "verify you are human",
  "enable javascript and cookies",
  "cf-chl-",
  "challenge-platform",
];

type LookupResult = { address: string; family: number };

interface MenuPageFetcherOptions {
  fetchImpl?: typeof fetch;
  lookupImpl?: (hostname: string) => Promise<LookupResult[]>;
  maxBytes?: number;
  maxCharacters?: number;
  maxRedirects?: number;
  timeoutMs?: number;
}

export interface FetchedPage {
  body: string;
  finalUrl: string;
  httpStatus: number;
  text: string;
  truncated: boolean;
}

export class PageFetchError extends Error {
  constructor(
    message: string,
    readonly outcome: "http_error" | "invalid_response" | "network_error",
    readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "PageFetchError";
  }
}

export function normalizeMenuPageUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PageFetchError("Menu page URL is invalid", "invalid_response");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new PageFetchError(
      "Menu page must be an HTTPS URL without credentials",
      "invalid_response",
    );
  }
  if (url.port && url.port !== "443") {
    throw new PageFetchError("Menu page must use the standard HTTPS port", "invalid_response");
  }
  url.hash = "";
  return url.toString();
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b, c] = parts as [number, number, number, number];
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isPublicIp(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0]!;
  const family = isIP(normalized);
  if (family === 4) return isPublicIpv4(normalized);
  if (family !== 6) return false;

  const mappedIpv4 = normalized.match(
    /^(?:(?:0:){5}|::)ffff:(\d+\.\d+\.\d+\.\d+)$/,
  )?.[1];
  if (mappedIpv4) return isPublicIpv4(mappedIpv4);
  const mappedHex = normalized.match(
    /^(?:(?:0:){5}|::)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/,
  );
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1]!, 16);
    const low = Number.parseInt(mappedHex[2]!, 16);
    return isPublicIpv4(
      `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`,
    );
  }

  return !(
    normalized.startsWith("::") ||
    /^0:0:0:0:0:0:/.test(normalized) ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89a-f]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

async function readBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new PageFetchError("Menu page response is too large", "invalid_response", response.status);
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new PageFetchError("Menu page response is too large", "invalid_response", response.status);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function responseHeaders(headers: Record<string, string | string[] | undefined>): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) result.append(name, entry);
    } else if (value !== undefined) {
      result.set(name, value);
    }
  }
  return result;
}

function requestValidatedAddress(
  url: string,
  addresses: LookupResult[],
  headers: Record<string, string>,
  signal: AbortSignal,
  maxBytes: number,
): Promise<Response> {
  const selected = addresses.find(({ family }) => family === 4) ?? addresses[0]!;
  return new Promise((resolve, reject) => {
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const request = httpsRequest(
      url,
      {
        agent,
        family: selected.family,
        headers: { ...headers, "accept-encoding": "identity" },
        lookup: (_hostname, _options, callback) => {
          callback(null, selected.address, selected.family as 4 | 6);
        },
        signal,
      },
      (incoming) => {
        const contentEncoding = incoming.headers["content-encoding"];
        if (contentEncoding && contentEncoding !== "identity") {
          incoming.destroy();
          agent.destroy();
          reject(
            new PageFetchError(
              "Menu page returned unsupported content encoding",
              "invalid_response",
              incoming.statusCode ?? null,
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        incoming.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > maxBytes) {
            incoming.destroy(
              new PageFetchError(
                "Menu page response is too large",
                "invalid_response",
                incoming.statusCode ?? null,
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        incoming.once("end", () => {
          agent.destroy();
          const status = incoming.statusCode ?? 500;
          resolve(
            new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), {
              headers: responseHeaders(incoming.headers),
              status,
            }),
          );
        });
        incoming.once("error", (error) => {
          agent.destroy();
          reject(error);
        });
      },
    );
    request.once("error", (error) => {
      agent.destroy();
      reject(error);
    });
    request.end();
  });
}

export function createMenuPageFetcher(options: MenuPageFetcherOptions = {}) {
  const fetchImpl = options.fetchImpl;
  const lookupImpl =
    options.lookupImpl ??
    (async (hostname: string) =>
      dnsLookup(hostname, { all: true, verbatim: true }) as Promise<LookupResult[]>);
  const maxBytes = options.maxBytes ?? 1_048_576;
  const maxCharacters = options.maxCharacters ?? 30_000;
  const maxRedirects = options.maxRedirects ?? 3;
  const timeoutMs = options.timeoutMs ?? 15_000;

  return async function fetchMenuPage(value: string): Promise<FetchedPage> {
    let currentUrl = normalizeMenuPageUrl(value);

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const parsedUrl = new URL(currentUrl);
      const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, "");
      const addresses = await lookupImpl(hostname).catch(() => {
        throw new PageFetchError("Menu page host could not be resolved", "network_error");
      });
      if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIp(address))) {
        throw new PageFetchError("Menu page must resolve only to a public host", "invalid_response");
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      const headers = {
        accept: "text/html, application/xhtml+xml, text/plain",
        "accept-language": "fi-FI,fi;q=0.9,en;q=0.5",
        "user-agent":
          "Mozilla/5.0 (compatible; MihinLounaalle-LunchMenuFetcher/1.0; lunch menu collection)",
      };
      try {
        response = fetchImpl
          ? await fetchImpl(currentUrl, {
              headers,
              redirect: "manual",
              signal: controller.signal,
            })
          : await requestValidatedAddress(
              currentUrl,
              addresses,
              headers,
              controller.signal,
              maxBytes,
            );
      } catch (error) {
        clearTimeout(timeout);
        if (error instanceof PageFetchError) throw error;
        const message = error instanceof Error && error.name === "AbortError"
          ? "Menu page request timed out"
          : "Menu page request failed";
        throw new PageFetchError(message, "network_error");
      }

      try {
        if (redirectStatuses.has(response.status)) {
          const location = response.headers.get("location");
          if (!location) {
            throw new PageFetchError("Menu page redirect is missing a location", "http_error", response.status);
          }
          if (redirectCount === maxRedirects) {
            throw new PageFetchError("Menu page has too many redirects", "http_error", response.status);
          }
          await response.body?.cancel();
          currentUrl = normalizeMenuPageUrl(new URL(location, currentUrl).toString());
          continue;
        }

        if (!response.ok) {
          throw new PageFetchError(
            `Menu page returned HTTP ${response.status}`,
            "http_error",
            response.status,
          );
        }
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (
          !contentType.startsWith("text/html") &&
          !contentType.startsWith("application/xhtml+xml") &&
          !contentType.startsWith("text/plain")
        ) {
          throw new PageFetchError(
            "Menu page response is not text or HTML",
            "invalid_response",
            response.status,
          );
        }

        const bytes = await readBody(response, maxBytes);
        const body = new TextDecoder().decode(bytes);
        const lowerBody = body.toLowerCase();
        if (challengeMarkers.some((marker) => lowerBody.includes(marker))) {
          throw new PageFetchError(
            "Menu page returned a verification page",
            "invalid_response",
            response.status,
          );
        }
        const normalizedText = contentType.startsWith("text/plain") ? body.trim() : htmlToText(body);
        if (!normalizedText) {
          throw new PageFetchError("Menu page does not contain readable text", "invalid_response", response.status);
        }
        const truncated = normalizedText.length > maxCharacters;
        return {
          body,
          finalUrl: currentUrl,
          httpStatus: response.status,
          text: truncated ? normalizedText.slice(0, maxCharacters) : normalizedText,
          truncated,
        };
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          throw new PageFetchError("Menu page request timed out", "network_error");
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new PageFetchError("Menu page has too many redirects", "http_error");
  };
}
