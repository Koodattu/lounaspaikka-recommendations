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
  structuredMenu: {
    courses: [
      {
        category: "main",
        dietaryMarkers: ["G"],
        explicitAllergens: ["kala"],
        nameFi: "Paahdettua kuhaa",
      },
      {
        category: "side",
        dietaryMarkers: [],
        explicitAllergens: [],
        nameFi: "Sitruunaperunoita",
      },
    ],
  },
  text: "Paahdettua kuhaa (G)\nAllergeenit: kala\nSitruunaperunoita",
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
      menu: { ...menu, structuredMenu: null, text: "Kasviscurry" },
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
      menu: { ...menu, structuredMenu: null, text: "Kasviscurry" },
      rank: 2,
      rationale: "Monipuolinen kasvislounas erottuu edukseen.",
      restaurant: { ...restaurant, id: "kasvis", name: "Kasvisravintola" },
      score: 8.4,
    },
    {
      menu: { ...menu, structuredMenu: null, text: "Lohikeitto" },
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
    expect(screen.getAllByText("Paahdettua kuhaa").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sitruunaperunoita").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ilmoitetut allergeenit: kala").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Alkuperäinen ruokalistateksti").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Kasviscurry").length).toBeGreaterThan(0);
    const dataNotice = screen.getByText(/Ruokavalio- ja allergeenitiedot on poimittu/);
    const firstAllergen = screen.getAllByText("Ilmoitetut allergeenit: kala")[0]!;
    expect(dataNotice.compareDocumentPosition(firstAllergen) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/allergeeniton/i)).toBeNull();

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
            structuredMenu: index === 1 ? {
              courses: [{
                category: "main",
                dietaryMarkers: ["L", "G"],
                explicitAllergens: [],
                nameFi: "Paahdettua kuhaa",
              }],
            } : null,
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
    expect(screen.getAllByText("Paahdettua kuhaa").length).toBeGreaterThan(0);
    expect(screen.getByText("L")).toBeTruthy();
    expect(screen.getByText(/Ruokavalio- ja allergeenitiedot on poimittu/)).toBeTruthy();
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

  it("keeps the unlinked admin route behind a password and adds a page source", async () => {
    window.history.replaceState({}, "", "/admin");
    let authenticated = false;
    let feedbackDirection: "higher" | "lower" | null = null;
    const overview = {
      counts: {
        assessments: 12,
        customSources: 0,
        fetches: 20,
        offeringRevisions: 18,
        recommendationSets: 3,
        restaurants: 8,
      },
      errors: [],
      generatedAt: "2026-07-14T05:00:00.000Z",
      latestFetch: {
        attemptedAt: "2026-07-14T04:05:00.000Z",
        lastSuccessfulAt: "2026-07-14T04:05:00.000Z",
        outcome: "success",
      },
      openAiConfigured: true,
      recentAssessments: [
        {
          assessedAt: "2026-07-14T04:11:00.000Z",
          assessmentId: 42,
          feedbackDirection: null,
          menuText: "Paahdettua kuhaa ja perunoita",
          rationale: "Kuha tekee listasta kiinnostavan.",
          restaurantId: "vinola",
          restaurantName: "Vinola",
          score: 8.2,
          scores: { appeal: 8, distinctiveness: 9, value: 7, variety: 8 },
          serviceDate: "2026-07-14",
        },
        {
          assessedAt: "2026-07-13T04:11:00.000Z",
          assessmentId: 43,
          feedbackDirection: null,
          menuText: "Tortillabuffet",
          rationale: "Tortillavaihtoehdot saivat korkean arvion.",
          restaurantId: "pancho",
          restaurantName: "Pancho Villa",
          score: 8.4,
          scores: { appeal: 8, distinctiveness: 8, value: 8, variety: 10 },
          serviceDate: "2026-07-13",
        },
      ],
      refresh: {
        currentTarget: null,
        lastError: null,
        lastFinishedAt: "2026-07-14T04:05:00.000Z",
        running: false,
        startedAt: "2026-07-14T04:00:00.000Z",
      },
      sources: [],
      uptimeSeconds: 3600,
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/admin/login") {
        authenticated = true;
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      if (url === "/api/admin/sources") {
        return new Response(JSON.stringify({ sourceId: 1 }), { status: 201 });
      }
      if (url === "/api/admin/assessments/42/feedback") {
        const body = JSON.parse(String(init?.body)) as {
          direction: "higher" | "lower" | null;
        };
        feedbackDirection = body.direction;
        return new Response(JSON.stringify({ assessmentId: 42, direction: feedbackDirection }), {
          status: 200,
        });
      }
      if (url === "/api/admin/overview" && !authenticated) {
        return new Response(
          JSON.stringify({ error: { message: "Kirjaudu sisään jatkaaksesi." } }),
          { status: 401 },
        );
      }
      expect(init?.method).toBeUndefined();
      return new Response(JSON.stringify({
        ...overview,
        recentAssessments: overview.recentAssessments.map((assessment) => ({
          ...assessment,
          feedbackDirection: assessment.assessmentId === 42
            ? feedbackDirection
            : assessment.feedbackDirection,
        })),
      }), { status: 200 });
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Kirjaudu ylläpitoon" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Ylläpito" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Salasana"), {
      target: { value: "a-long-test-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Kirjaudu" }));

    expect(await screen.findByRole("heading", { name: "Järjestelmän tila" })).toBeTruthy();
    expect(screen.getByText("8")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Arvioiden kalibrointi" })).toBeTruthy();
    expect(screen.getByText("Kuha tekee listasta kiinnostavan.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Liian korkea" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/assessments/42/feedback",
        expect.objectContaining({
          body: JSON.stringify({ direction: "lower" }),
          method: "PUT",
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Liian korkea" }).getAttribute("aria-pressed"))
        .toBe("true"),
    );
    fireEvent.change(screen.getByLabelText("Lounaspäivä"), {
      target: { value: "2026-07-13" },
    });
    expect(screen.getByText("Tortillavaihtoehdot saivat korkean arvion.")).toBeTruthy();
    expect(screen.queryByText("Kuha tekee listasta kiinnostavan.")).toBeNull();
    fireEvent.change(screen.getByLabelText("Ravintolan ruokalistasivu"), {
      target: { value: "https://backyard.fi/ideapark/" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lisää ja hae ruokalista" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/sources",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await screen.findByText("Lähde lisättiin ja ruokalista haettiin.")).toBeTruthy();
  });

  it("keeps the dashboard visible when logout fails", async () => {
    window.history.replaceState({}, "", "/admin");
    const overview = {
      counts: {
        assessments: 0,
        customSources: 0,
        fetches: 0,
        offeringRevisions: 0,
        recommendationSets: 0,
        restaurants: 0,
      },
      errors: [],
      generatedAt: "2026-07-14T05:00:00.000Z",
      latestFetch: { attemptedAt: null, lastSuccessfulAt: null, outcome: null },
      openAiConfigured: false,
      recentAssessments: [],
      refresh: {
        currentTarget: null,
        lastError: null,
        lastFinishedAt: null,
        running: false,
        startedAt: null,
      },
      sources: [],
      uptimeSeconds: 10,
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input) === "/api/admin/logout"
        ? new Response(
            JSON.stringify({ error: { message: "Uloskirjautuminen epäonnistui." } }),
            { status: 500 },
          )
        : new Response(JSON.stringify(overview), { status: 200 }),
    );

    render(<App />);
    expect(await screen.findByRole("heading", { name: "Järjestelmän tila" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Kirjaudu ulos" }));

    expect(await screen.findByText("Uloskirjautuminen epäonnistui.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Järjestelmän tila" })).toBeTruthy();
  });
});
