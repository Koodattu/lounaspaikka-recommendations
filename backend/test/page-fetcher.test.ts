import { describe, expect, it, vi } from "vitest";

import { createMenuPageFetcher } from "../src/page-fetcher.js";

describe("custom menu page fetcher", () => {
  it("fetches public HTTPS HTML with a descriptive user agent and safe plain text", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(
        "<html><script>ignore()</script><h2>Lounasbuffet</h2><p>Ti 14.7.<br>Lihapullat</p></html>",
        { headers: { "content-type": "text/html; charset=utf-8" }, status: 200 },
      ),
    );
    const fetchPage = createMenuPageFetcher({
      fetchImpl,
      lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
    });

    const page = await fetchPage("https://example.com/menu");

    expect(page).toMatchObject({
      finalUrl: "https://example.com/menu",
      httpStatus: 200,
      text: "Lounasbuffet\nTi 14.7.\nLihapullat",
      truncated: false,
    });
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
    expect(
      (fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>)["user-agent"],
    ).toContain("LunchMenuFetcher");
  });

  it("rejects private targets, oversized responses, and verification pages", async () => {
    const privateFetcher = createMenuPageFetcher({
      fetchImpl: vi.fn(),
      lookupImpl: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    await expect(privateFetcher("https://localhost/menu")).rejects.toThrow("public host");

    const mappedPrivateFetcher = createMenuPageFetcher({
      fetchImpl: vi.fn(),
      lookupImpl: async () => [{ address: "::ffff:7f00:1", family: 6 }],
    });
    await expect(mappedPrivateFetcher("https://localhost/menu")).rejects.toThrow("public host");

    const compatiblePrivateFetcher = createMenuPageFetcher({
      fetchImpl: vi.fn(),
      lookupImpl: async () => [{ address: "::7f00:1", family: 6 }],
    });
    await expect(compatiblePrivateFetcher("https://localhost/menu")).rejects.toThrow("public host");

    const oversizedFetcher = createMenuPageFetcher({
      fetchImpl: async () =>
        new Response("menu", {
          headers: { "content-length": "2000000", "content-type": "text/html" },
        }),
      lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    await expect(oversizedFetcher("https://example.com/menu")).rejects.toThrow("too large");

    const challengeFetcher = createMenuPageFetcher({
      fetchImpl: async () =>
        new Response("Please wait while your request is being verified...", {
          headers: { "content-type": "text/html" },
        }),
      lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    await expect(challengeFetcher("https://example.com/menu")).rejects.toThrow(
      "verification page",
    );
  });

  it("validates every redirect target before requesting it", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, { headers: { location: "https://127.0.0.1/menu" }, status: 302 }),
    );
    const lookupImpl = vi
      .fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const fetchPage = createMenuPageFetcher({ fetchImpl, lookupImpl });

    await expect(fetchPage("https://example.com/menu")).rejects.toThrow("public host");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
