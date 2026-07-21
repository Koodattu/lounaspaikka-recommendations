import { afterEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";

import { openDatabase } from "../src/database.js";
import {
  createLounaspaikkaCatchmentAdapter,
  LounaspaikkaCatchmentObservationError,
  type LounaspaikkaCatchmentAdapter,
} from "../src/lounaspaikka-catchment.js";
import { getDayMenus, getFetchState, getOfferingHistory } from "../src/queries.js";
import { createRestaurantCatchment } from "../src/restaurant-catchment.js";
import { capturedOffering, catchmentAdapterForOfferings } from "./catchment-fixture.js";

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
    let offering = capturedOffering(
      "1342653",
      "Vinola",
      "Mustajuurikeitto (L, G)\nLounaspöytä 13,70 €",
      {
        address: "Keskuskatu 10, Seinäjoki",
        latitude: 62.79163257,
        lunchHours: "10.30–14",
        priceText: "13,70 €",
      },
    );
    let now = "2026-07-14T03:10:00.000Z";
    const lounaspaikka = catchmentAdapterForOfferings(() => [offering]);
    db = openDatabase(":memory:");

    const catchment = createRestaurantCatchment({
      db,
      lounaspaikka,
      now: () => new Date(now),
    });
    const first = await catchment.refresh("2026-07-14");
    now = "2026-07-14T04:10:00.000Z";
    const second = await catchment.refresh("2026-07-14");

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
          priceText: "13,70 €",
          text: "Mustajuurikeitto (L, G)\nLounaspöytä 13,70 €",
        }),
        restaurant: expect.objectContaining({
          id: "1342653",
          latitude: 62.79163257,
          name: "Vinola",
        }),
      }),
    ]);

    offering = {
      ...offering,
      menuText: "Paahdettua lohta (L, G)\n14,20 €",
      priceText: "14,20 €",
    };
    now = "2026-07-14T05:10:00.000Z";

    const changed = await catchment.refresh("2026-07-14");

    expect(changed.createdRevisionCount).toBe(1);
    expect(getOfferingHistory(db, "1342653", "2026-07-14")).toEqual([
      expect.objectContaining({ menuText: "Mustajuurikeitto (L, G)\nLounaspöytä 13,70 €" }),
      expect.objectContaining({ menuText: "Paahdettua lohta (L, G)\n14,20 €" }),
    ]);
    expect(getDayMenus(db, "2026-07-14")[0]?.menu.text).toBe(
      "Paahdettua lohta (L, G)\n14,20 €",
    );
    expect(getDayMenus(db, "2026-07-14")[0]?.menu.priceText).toBe("14,20 €");
  });

  it("extracts explicit Paikka lunch prices without including unrelated offers", async () => {
    const adapter = createLounaspaikkaCatchmentAdapter({
      fetchImpl: async () => new Response(JSON.stringify({ items: [
          {
            ...restaurant,
            ads: [{
              ad: {
                ...dailyAd,
                body: "Aamupala 9,90 €<br>Lounas 13,90 €<br>Eläkeläiset 11,90 €<br>Lounaspassi 20 €",
              },
            }],
          },
          {
            ...restaurant,
            id: "structured-price",
            name: "Hintala",
            ads: [{
              ad: {
                ...dailyAd,
                body: "Keitto ja päivän annos",
                lunchMenu: [
                  { food: "Keitto", price: "11.5" },
                  { food: "Päivän annos", price: "13,50" },
                ],
              },
            }],
          },
        ] }), { status: 200 }),
    });

    const observation = await adapter.observe("2026-07-14");

    expect(observation.offerings.find((entry) => entry.id === "1342653")?.priceText)
      .toBe("13,90 €");
    expect(observation.offerings.find((entry) => entry.id === "structured-price")?.priceText)
      .toBe("11,50–13,50 €");
  });

  it("records a failed retry without replacing the latest successful menus", async () => {
    let shouldFail = false;
    let now = "2026-07-14T03:10:00.000Z";
    const offering = capturedOffering("1342653", "Vinola", "Mustajuurikeitto");
    const lounaspaikka: LounaspaikkaCatchmentAdapter = {
      async observe(serviceDate) {
        const request = {
          latitude: 62.7907,
          longitude: 22.8396,
          maxDistance: 50_000,
          serviceDate,
        };
        const pages = [{ body: "unavailable", status: 503, url: "https://fixture.test" }];
        if (shouldFail) {
          throw new LounaspaikkaCatchmentObservationError(
            "Lounaspaikka returned HTTP 503",
            "http_error",
            request,
            pages,
            503,
          );
        }
        return { offerings: [offering], pages, request };
      },
    };
    db = openDatabase(":memory:");

    const catchment = createRestaurantCatchment({
      db,
      lounaspaikka,
      now: () => new Date(now),
    });
    await catchment.refresh("2026-07-14");
    shouldFail = true;
    now = "2026-07-14T04:10:00.000Z";

    await expect(
      catchment.refresh("2026-07-14"),
    ).rejects.toThrow("HTTP 503");

    expect(getFetchState(db, "2026-07-14")).toEqual({
      lastAttemptAt: "2026-07-14T04:10:00.000Z",
      lastOutcome: "http_error",
      lastSuccessfulFetchAt: "2026-07-14T03:10:00.000Z",
    });
    expect(getDayMenus(db, "2026-07-14")[0]?.menu.text).toContain("Mustajuurikeitto");
  });

  it("creates a new assessment input revision when the restaurant name changes", async () => {
    let offering = capturedOffering("1342653", "Vinola", "Mustajuurikeitto");
    const lounaspaikka = catchmentAdapterForOfferings(() => [offering]);
    db = openDatabase(":memory:");

    const catchment = createRestaurantCatchment({ db, lounaspaikka });
    await catchment.refresh("2026-07-14");
    offering = { ...offering, name: "Vinola Keskusta" };
    const renamed = await catchment.refresh("2026-07-14");

    expect(renamed.createdRevisionCount).toBe(1);
    expect(getOfferingHistory(db, "1342653", "2026-07-14")).toHaveLength(2);
    expect(getDayMenus(db, "2026-07-14")[0]?.restaurant.name).toBe("Vinola Keskusta");
  });

  it("treats missing coordinates as missing and rejects unsafe upstream URLs", async () => {
    const adapter = createLounaspaikkaCatchmentAdapter({
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
    const observation = await adapter.observe("2026-07-14");

    expect(observation.offerings[0]).toMatchObject({
      latitude: null,
      longitude: null,
      photoUrl: null,
      websiteUrl: null,
    });
    expect(observation.offerings[0]?.lunchHours).toBe("10.30–14.00");
  });

  it("records malformed restaurant provenance as an invalid response", async () => {
    const body = JSON.stringify({ items: [{ name: "Missing id" }] });
    const lounaspaikka = createLounaspaikkaCatchmentAdapter({
      fetchImpl: async () => new Response(body, { status: 200 }),
    });
    db = openDatabase(":memory:");

    await expect(
      createRestaurantCatchment({ db, lounaspaikka }).refresh("2026-07-14"),
    ).rejects.toThrow("missing an id or name");

    const failedFetch = db.prepare(
      `SELECT outcome, http_status AS httpStatus, request_json AS requestJson,
        response_pages_json AS responsePagesJson, response_hash AS responseHash
       FROM source_fetches`,
    ).get() as {
      httpStatus: number;
      outcome: string;
      requestJson: string;
      responseHash: string;
      responsePagesJson: string;
    };
    expect(failedFetch).toMatchObject({
      httpStatus: 200,
      outcome: "invalid_response",
      requestJson: JSON.stringify({
        latitude: 62.7907,
        longitude: 22.8396,
        maxDistance: 50_000,
        serviceDate: "2026-07-14",
      }),
      responseHash: expect.any(String),
    });
    expect(JSON.parse(failedFetch.responsePagesJson)).toEqual([
      expect.objectContaining({ body, status: 200 }),
    ]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM offering_revisions").get()).toEqual({
      count: 0,
    });
  });
});
