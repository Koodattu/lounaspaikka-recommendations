import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";

import { openDatabase } from "../src/database.js";
import { ingestLunchDay } from "../src/ingestion.js";
import { getDayMenus, getFetchState, getOfferingHistory } from "../src/queries.js";
import { createLounaspaikkaClient } from "../src/source.js";

const dailyAd = {
  header: "Lounas 14.7.",
  body: "Mustajuurikeitto (L, G)<br>Lounaspöytä 13,70 €",
  imgurl: null,
  wwwurl: null,
  shopid: "1342653",
  poiId: "1342653",
  id: "1089360",
  type: "Lunch",
  timestamp: "1783884724000",
  contentType: 32,
  lunchOh: "10.30-14",
};

const restaurant = {
  id: "1342653",
  name: "Vinola",
  address: "Keskuskatu 10, Seinäjoki",
  city: "Seinäjoki",
  desc: "Lounas tarjoillaan maanantaista perjantaihin.<br>",
  photo: "https://kuvat.tassa.fi/vinola.jpg",
  tel: "0451451711",
  www: "http://www.vinola.fi",
  marker: {
    latitude: "62.79163257",
    longitude: "22.83905458",
  },
  openingHours: [
    {
      mon: [{ open: "11.00", close: "14.00" }],
    },
  ],
  ads: [
    { ad: dailyAd },
    {
      ad: {
        ...dailyAd,
        id: "1089366",
        contentType: 0,
        header: "Lounas viikolle 13.7. - 19.7.",
        body: "<div>Maanantai 13.7.</div>",
        lunchOh: null,
      },
    },
  ],
};

describe("lunch ingestion", () => {
  let db: Database.Database | undefined;

  afterEach(() => db?.close());

  it("keeps immutable revisions while identical fetches only add freshness observations", async () => {
    let body = { items: [restaurant] };
    let now = "2026-07-14T03:10:00.000Z";
    const source = createLounaspaikkaClient({
      fetchImpl: async () =>
        new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
    });
    db = openDatabase(":memory:");

    const first = await ingestLunchDay({
      db,
      now: () => new Date(now),
      serviceDate: "2026-07-14",
      source,
    });
    now = "2026-07-14T04:10:00.000Z";
    const second = await ingestLunchDay({
      db,
      now: () => new Date(now),
      serviceDate: "2026-07-14",
      source,
    });

    expect(first).toMatchObject({
      createdRevisionCount: 1,
      itemCount: 1,
      outcome: "success",
    });
    expect(second).toMatchObject({
      createdRevisionCount: 0,
      itemCount: 1,
      outcome: "success",
    });
    expect(getOfferingHistory(db, "1342653", "2026-07-14")).toHaveLength(1);
    expect(getDayMenus(db, "2026-07-14")).toEqual([
      expect.objectContaining({
        fetchedAt: "2026-07-14T04:10:00.000Z",
        menu: expect.objectContaining({
          lunchHours: "10.30–14",
          text: "Mustajuurikeitto (L, G)\nLounaspöytä 13,70 €",
        }),
        restaurant: expect.objectContaining({
          id: "1342653",
          latitude: 62.79163257,
          name: "Vinola",
        }),
      }),
    ]);

    body = {
      items: [
        {
          ...restaurant,
          ads: [
            {
              ad: {
                ...dailyAd,
                body: "Paahdettua lohta (L, G)<br>14,20 €",
              },
            },
          ],
        },
      ],
    };
    now = "2026-07-14T05:10:00.000Z";

    const changed = await ingestLunchDay({
      db,
      now: () => new Date(now),
      serviceDate: "2026-07-14",
      source,
    });

    expect(changed.createdRevisionCount).toBe(1);
    expect(getOfferingHistory(db, "1342653", "2026-07-14")).toEqual([
      expect.objectContaining({ menuText: "Mustajuurikeitto (L, G)\nLounaspöytä 13,70 €" }),
      expect.objectContaining({ menuText: "Paahdettua lohta (L, G)\n14,20 €" }),
    ]);
    expect(getDayMenus(db, "2026-07-14")[0]?.menu.text).toBe(
      "Paahdettua lohta (L, G)\n14,20 €",
    );
  });

  it("records a failed retry without replacing the latest successful menus", async () => {
    let status = 200;
    let now = "2026-07-14T03:10:00.000Z";
    const source = createLounaspaikkaClient({
      fetchImpl: async () =>
        new Response(status === 200 ? JSON.stringify({ items: [restaurant] }) : "unavailable", {
          status,
        }),
    });
    db = openDatabase(":memory:");

    await ingestLunchDay({
      db,
      now: () => new Date(now),
      serviceDate: "2026-07-14",
      source,
    });
    status = 503;
    now = "2026-07-14T04:10:00.000Z";

    await expect(
      ingestLunchDay({
        db,
        now: () => new Date(now),
        serviceDate: "2026-07-14",
        source,
      }),
    ).rejects.toThrow("HTTP 503");

    expect(getFetchState(db, "2026-07-14")).toEqual({
      lastAttemptAt: "2026-07-14T04:10:00.000Z",
      lastOutcome: "http_error",
      lastSuccessfulFetchAt: "2026-07-14T03:10:00.000Z",
    });
    expect(getDayMenus(db, "2026-07-14")[0]?.menu.text).toContain("Mustajuurikeitto");
  });

  it("treats missing coordinates as missing and rejects unsafe upstream URLs", async () => {
    const source = createLounaspaikkaClient({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            items: [
              {
                ...restaurant,
                ads: [{ ad: { ...dailyAd, lunchOh: null } }],
                auxData: {
                  lunch: {
                    oh: {
                      openingTimes: [
                        { closing: "14.00", opening: "10.30", weekday: "TU" },
                      ],
                    },
                  },
                },
                marker: { latitude: null, longitude: "" },
                photo: "data:image/svg+xml,<svg onload=alert(1) />",
                www: "javascript:alert(1)",
              },
            ],
          }),
          { status: 200 },
        ),
    });
    db = openDatabase(":memory:");

    await ingestLunchDay({
      db,
      serviceDate: "2026-07-14",
      source,
    });

    expect(getDayMenus(db, "2026-07-14")[0]?.restaurant).toMatchObject({
      latitude: null,
      longitude: null,
      photoUrl: null,
      websiteUrl: null,
    });
    expect(getDayMenus(db, "2026-07-14")[0]?.menu.lunchHours).toBe("10.30–14.00");
  });
});
