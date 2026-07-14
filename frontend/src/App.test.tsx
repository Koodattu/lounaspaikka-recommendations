import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

const restaurant = {
  address: "Keskuskatu 10, Seinäjoki",
  city: "Seinäjoki",
  id: "vinola",
  latitude: 62.79,
  longitude: 22.84,
  name: "Vinola",
  phone: "045 123 4567",
  photoUrl: null,
  websiteUrl: "https://example.com",
};

const menu = {
  lunchHours: "10.30–14",
  status: "published",
  text: "Paahdettua kuhaa\nSitruunaperunoita",
  title: "Lounas 14.7.",
};

const dayResponse = {
  generatedAt: "2026-07-14T03:11:00.000Z",
  lastAttemptAt: "2026-07-14T03:10:00.000Z",
  lastSuccessfulFetchAt: "2026-07-14T03:10:00.000Z",
  menus: [
    { fetchedAt: "2026-07-14T03:10:00.000Z", menu, restaurant },
    {
      fetchedAt: "2026-07-14T03:10:00.000Z",
      menu: { ...menu, text: "Kasviscurry" },
      restaurant: { ...restaurant, id: "kasvis", name: "Kasvisravintola" },
    },
  ],
  recommendations: [
    {
      menu,
      rank: 1,
      rationale: "Kuha ja raikas lisuke tekevät tästä päivän kiinnostavimman lounaan.",
      restaurant,
      score: 9.2,
    },
    {
      menu: { ...menu, text: "Kasviscurry" },
      rank: 2,
      rationale: "Monipuolinen kasvislounas erottuu edukseen.",
      restaurant: { ...restaurant, id: "kasvis", name: "Kasvisravintola" },
      score: 8.4,
    },
    {
      menu: { ...menu, text: "Lohikeitto" },
      rank: 3,
      rationale: "Hyvä hinta ja huolella kuvattu klassikko.",
      restaurant: { ...restaurant, id: "keitto", name: "Keittola" },
      score: 7.8,
    },
  ],
  serviceDate: "2026-07-14",
  source: { name: "Lounaspaikka", url: "https://lounaspaikka.ilkkapohjalainen.fi/" },
  stale: false,
  status: "ready",
};

describe("reader app", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/?date=2026-07-14");
    vi.restoreAllMocks();
  });

  it("shows the Finnish top three, all menus, and moves to the next date", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(JSON.stringify(dayResponse), { status: 200 }));

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Päivän kolme parasta" })).toBeTruthy();
    expect(screen.getAllByText("Vinola")).toHaveLength(2);
    expect(screen.getByText("9,2")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Kaikki päivän ruokalistat" })).toBeTruthy();
    expect(screen.getByText("Kuha ja raikas lisuke tekevät tästä päivän kiinnostavimman lounaan.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Seuraava päivä" }));
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/days/2026-07-15"));

    window.history.replaceState({}, "", "/?date=2026-07-14");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/days/2026-07-14"));
  });

  it("shows honest pending, stale, and network error states", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...dayResponse,
          recommendations: [],
          stale: true,
          status: "pending",
        }),
        { status: 200 },
      ),
    );

    const { unmount } = render(<App />);
    expect(await screen.findByText("Suosituksia arvioidaan vielä.")).toBeTruthy();
    expect(screen.getByText("Viimeisin päivitysyritys epäonnistui.")).toBeTruthy();
    expect(screen.getByText("Näytämme viimeksi onnistuneesti haetut tiedot.")).toBeTruthy();

    unmount();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...dayResponse,
          lastSuccessfulFetchAt: null,
          menus: [],
          recommendations: [],
          stale: true,
          status: "unavailable",
        }),
        { status: 200 },
      ),
    );
    render(<App />);
    expect(await screen.findByText("Tietoja ei ole vielä saatavilla.")).toBeTruthy();
    expect(
      screen.queryByText("Tälle päivälle ei löytynyt julkaistuja lounaslistoja."),
    ).toBeNull();
    expect(screen.queryByText("Ruokalistoja ei ole julkaistu tälle päivälle.")).toBeNull();

    unmount();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    render(<App />);
    expect(await screen.findByText("Ruokalistoja ei saatu ladattua.")).toBeTruthy();
  });

  it("shows a restaurant's complete week", async () => {
    window.history.replaceState({}, "", "/ravintolat/vinola?week=2026-07-13");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          days: Array.from({ length: 7 }, (_, index) => ({
            fetchedAt: index === 1 ? "2026-07-14T03:10:00.000Z" : null,
            lunchHours: index === 1 ? "10.30–14" : null,
            serviceDate: `2026-07-${String(13 + index).padStart(2, "0")}`,
            status: index === 1 ? "published" : index === 0 ? "not_published" : "missing",
            text: index === 1 ? "Paahdettua kuhaa" : null,
            title: index === 1 ? "Lounas 14.7." : null,
          })),
          restaurant: {
            ...restaurant,
            description: "Rento lounasravintola keskustassa.",
            openingHours: [{ periods: [{ close: "14.00", open: "10.30" }], weekday: "MO" }],
          },
          source: dayResponse.source,
          weekEnd: "2026-07-19",
          weekStart: "2026-07-13",
        }),
        { status: 200 },
      ),
    );

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Vinola" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Viikon ruokalista" })).toBeTruthy();
    expect(screen.getByText("Paahdettua kuhaa")).toBeTruthy();
    expect(screen.getByText("Ruokalistaa ei ole julkaistu.")).toBeTruthy();
    expect(screen.getAllByText("Tietoja ei ole vielä haettu tälle päivälle.")).toHaveLength(5);
    expect(screen.getByRole("link", { name: "Ravintolan verkkosivut" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Seuraava viikko" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
        "/api/restaurants/vinola/weeks/2026-07-20",
      ),
    );
    window.history.replaceState({}, "", "/ravintolat/vinola?week=2026-07-13");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() =>
      expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
        "/api/restaurants/vinola/weeks/2026-07-13",
      ),
    );
  });
});
