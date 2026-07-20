import { describe, expect, it, vi } from "vitest";

import { createLounaspaikkaClient, SourceFetchError } from "../src/source.js";

function jsonResponse(items: unknown[], init: ResponseInit = {}): Response {
  return new Response(JSON.stringify({ items }), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

describe("Lounaspaikka client limits", () => {
  it("follows only bounded same-origin redirects manually", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          headers: { location: "/resources/lunch/pois-v2" },
          status: 302,
        }),
      )
      .mockResolvedValueOnce(jsonResponse([]));
    const client = createLounaspaikkaClient({ fetchImpl });

    const result = await client.fetchLunchDay("2026-07-20");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
    expect(result.pages[0]?.url).toContain("/resources/lunch/pois-v2");
  });

  it("rejects redirects outside the fixed HTTPS origin", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        headers: { location: "https://127.0.0.1/private" },
        status: 302,
      }),
    );
    const client = createLounaspaikkaClient({ fetchImpl });

    await expect(client.fetchLunchDay("2026-07-20")).rejects.toMatchObject({
      outcome: "invalid_response",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects missing redirect locations and redirect-limit exhaustion", async () => {
    const missingLocation = createLounaspaikkaClient({
      fetchImpl: async () => new Response(null, { status: 302 }),
    });
    await expect(missingLocation.fetchLunchDay("2026-07-20")).rejects.toMatchObject({
      outcome: "http_error",
    });

    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        headers: { location: "/resources/lunch/pois" },
        status: 302,
      }),
    );
    const noRedirects = createLounaspaikkaClient({ fetchImpl, maxRedirects: 0 });
    await expect(noRedirects.fetchLunchDay("2026-07-20")).rejects.toThrow(
      "too many redirects",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("enforces per-page and total response byte limits", async () => {
    const oversizedPage = createLounaspaikkaClient({
      fetchImpl: async () =>
        jsonResponse([], { headers: { "content-length": "101" } }),
      maxBytesPerPage: 100,
    });
    await expect(oversizedPage.fetchLunchDay("2026-07-20")).rejects.toThrow(
      "response is too large",
    );

    const cancel = vi.fn();
    const streamedPage = createLounaspaikkaClient({
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            cancel,
            start(controller) {
              controller.enqueue(new Uint8Array(60));
              controller.enqueue(new Uint8Array(60));
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      maxBytesPerPage: 100,
    });
    await expect(streamedPage.fetchLunchDay("2026-07-20")).rejects.toThrow(
      "response is too large",
    );
    expect(cancel).toHaveBeenCalled();

    const fullPage = Array.from({ length: 100 }, (_, id) => ({ id }));
    const firstBodySize = JSON.stringify({ items: fullPage }).length;
    const totalCancel = vi.fn();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(fullPage))
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            cancel: totalCancel,
            start(controller) {
              controller.enqueue(new Uint8Array(6));
              controller.enqueue(new Uint8Array(6));
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    const totalBytes = createLounaspaikkaClient({
      fetchImpl,
      maxTotalBytes: firstBodySize + 10,
    });

    await expect(totalBytes.fetchLunchDay("2026-07-20")).rejects.toThrow(
      "total size limit",
    );
    expect(totalCancel).toHaveBeenCalled();

    const boundaryBody = JSON.stringify({ items: [] });
    const boundary = createLounaspaikkaClient({
      fetchImpl: async () => jsonResponse([]),
      maxBytesPerPage: boundaryBody.length,
      maxTotalBytes: boundaryBody.length,
    });
    await expect(boundary.fetchLunchDay("2026-07-20")).resolves.toMatchObject({
      items: [],
    });
  });

  it("enforces page and item limits before requesting more data", async () => {
    const fullPage = Array.from({ length: 100 }, (_, id) => ({ id }));
    const pageFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(fullPage));
    const pageLimited = createLounaspaikkaClient({
      fetchImpl: pageFetch,
      maxPages: 1,
    });

    await expect(pageLimited.fetchLunchDay("2026-07-20")).rejects.toThrow(
      "too many pages",
    );
    expect(pageFetch).toHaveBeenCalledTimes(1);

    const itemLimited = createLounaspaikkaClient({
      fetchImpl: async () => jsonResponse([{ id: 1 }, { id: 2 }]),
      maxItems: 1,
    });
    const error = await itemLimited.fetchLunchDay("2026-07-20").catch((value) => value);
    expect(error).toBeInstanceOf(SourceFetchError);
    expect(error).toMatchObject({ outcome: "invalid_response" });
  });
});
