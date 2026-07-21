import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { formatLongDate, todayInHelsinki } from "./dates";

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
  priceText: "13,70 €",
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
    {
      fetchedAt: "2026-07-14T03:10:00.000Z",
      menu: {
        ...menu,
        source: { name: "Muun ravintolan lista", url: "https://example.com/muu/menu" },
        structuredMenu: null,
        text: "Lihapullat ja perunamuusi",
      },
      restaurant: { ...restaurant, id: "muu", name: "Muu lounaspaikka" },
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

  it("shows the top three once, then the remaining menus, and moves to the next date", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const serviceDate = String(input).split("/").at(-1) ?? dayResponse.serviceDate;
        return new Response(JSON.stringify({ ...dayResponse, serviceDate }), { status: 200 });
      });

    render(<App />);

    expect(document.querySelector("main")?.getAttribute("aria-busy")).toBe("true");
    expect(await screen.findByRole("heading", { name: "Päivän lounaat" })).toBeTruthy();
    expect(document.querySelector("main")?.getAttribute("aria-busy")).toBe("false");
    expect(document.title).toBe("Tiistai 14. heinäkuuta | Mihin lounaalle?");
    expect(
      await screen.findByText("Tiistai 14. heinäkuuta ladattu. 3 ravintolaa ja 3 suositusta."),
    ).toBeTruthy();
    expect(screen.getAllByText("Vinola")).toHaveLength(1);
    expect(screen.getAllByText("13,70 €").length).toBeGreaterThan(0);
    expect(screen.queryByText("9,2")).toBeNull();
    const otherMenusHeading = screen.getByRole("heading", { name: "Muut päivän lounaat" });
    const otherMenus = otherMenusHeading.closest("section");
    expect(otherMenus).not.toBeNull();
    expect(within(otherMenus!).getByText("Muu lounaspaikka")).toBeTruthy();
    expect(within(otherMenus!).getByText("Lihapullat ja perunamuusi")).toBeTruthy();
    expect(within(otherMenus!).queryByText("Vinola")).toBeNull();
    expect(within(otherMenus!).queryByText("Kasvisravintola")).toBeNull();
    expect(
      within(otherMenus!).getByRole("link", {
        name: /Muun ravintolan lista.*avautuu uuteen välilehteen/,
      }),
    ).toBeTruthy();
    expect(screen.queryByText("Kuha ja raikas lisuke tekevät tästä päivän kiinnostavimman lounaan.")).toBeNull();
    expect(screen.getAllByText("Paahdettua kuhaa").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sitruunaperunoita").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ilmoitetut allergeenit: kala").length).toBeGreaterThan(0);
    expect(screen.queryByText("Alkuperäinen ruokalistateksti")).toBeNull();
    expect(screen.getAllByText("Kasviscurry").length).toBeGreaterThan(0);
    const companion = document.querySelector("a.recommendation-name-link[href^='/ravintolat/kasvis']")
      ?.closest("article");
    expect(companion).not.toBeNull();
    expect(within(companion!).getByText("Kasviscurry")).toBeTruthy();
    expect(within(companion!).queryByText("Monipuolinen kasvislounas erottuu edukseen.")).toBeNull();
    expect(screen.getByRole("link", { name: /Avaa reitti.*avautuu uuteen välilehteen/ })).toBeTruthy();
    const dataNotice = screen.getByText(/Ruokavaliomerkinnät on poimittu automaattisesti/);
    const primaryRestaurant = screen.getByRole("heading", { name: "Vinola", level: 2 });
    const primaryCard = primaryRestaurant.closest("article");
    expect(primaryCard).not.toBeNull();
    const inlineSafetyNote = within(primaryCard!).getByText(
      /Varmista ruokavaliomerkinnät ravintolasta/,
    );
    const primaryDietaryMarkers = within(primaryCard!).getByLabelText(
      /Ravintolan ilmoittamat ruokavaliomerkinnät/,
    );
    expect(
      inlineSafetyNote.compareDocumentPosition(primaryDietaryMarkers)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(primaryRestaurant.compareDocumentPosition(dataNotice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(otherMenusHeading.compareDocumentPosition(dataNotice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/allergeeniton/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Seuraava päivä" }));
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/days/2026-07-15"));
    expect(
      await screen.findByText("Keskiviikko 15. heinäkuuta ladattu. 3 ravintolaa ja 3 suositusta."),
    ).toBeTruthy();
    expect(document.title).toBe("Keskiviikko 15. heinäkuuta | Mihin lounaalle?");

    window.history.replaceState({}, "", "/?date=2026-07-14");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/days/2026-07-14"));
    expect(
      await screen.findByText("Tiistai 14. heinäkuuta ladattu. 3 ravintolaa ja 3 suositusta."),
    ).toBeTruthy();

    const todayButton = screen.getByRole("button", { name: "Siirry tähän päivään" });
    todayButton.focus();
    fireEvent.click(todayButton);
    await waitFor(() =>
      expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(`/api/days/${todayInHelsinki()}`),
    );
    expect(screen.queryByRole("button", { name: "Tänään valittu" })).toBeNull();
    expect(document.querySelector(".date-navigation .today-current")?.getAttribute("aria-current"))
      .toBe("date");
    expect(document.title).toBe(`${formatLongDate(todayInHelsinki())} | Mihin lounaalle?`);
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
    expect(await screen.findByRole("heading", { name: "Päivän lounaat" })).toBeTruthy();
    expect(await screen.findByText("Suosituksia arvioidaan vielä.")).toBeTruthy();
    expect(screen.getByText("Ruokalistojen päivitys viivästyi.")).toBeTruthy();
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
    expect(await screen.findByRole("heading", { name: "Tälle päivälle ei löytynyt lounaslistoja." })).toBeTruthy();
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
    window.history.replaceState({}, "", "/ravintolat/vinola?week=2026-07-13&date=2026-07-14");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const weekStart = String(input).split("/").at(-1) ?? "2026-07-13";
      const startDay = weekStart === "2026-07-20" ? 20 : 13;
      const publishedDay = startDay + 1;
      return new Response(
        JSON.stringify({
          days: Array.from({ length: 7 }, (_, index) => ({
            fetchedAt: index === 1 ? `2026-07-${publishedDay}T03:10:00.000Z` : null,
            lunchHours: index === 1 ? "10.30–14" : null,
            priceText: index === 1 ? "13,70 €" : null,
            serviceDate: `2026-07-${String(startDay + index).padStart(2, "0")}`,
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
            title: index === 1 ? `Lounas ${publishedDay}.7.` : null,
          })),
          restaurant: {
            ...restaurant,
            description: "Rento lounasravintola keskustassa.",
            openingHours: [{ periods: [{ close: "14.00", open: "10.30" }], weekday: "MO" }],
          },
          source: dayResponse.source,
          weekEnd: `2026-07-${startDay + 6}`,
          weekStart,
        }),
        { status: 200 },
      );
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Vinola" })).toBeTruthy();
    expect(document.title).toBe("Vinola – Tiistai 14. heinäkuuta | Mihin lounaalle?");
    expect(await screen.findByText("Vinola: Tiistai 14. heinäkuuta ladattu.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Viikon ruokalista" })).toBeTruthy();
    const selectedDayHeading = screen.getByRole("heading", { name: "Tiistai 14. heinäkuuta" });
    expect(selectedDayHeading).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tiistai 14. heinäkuuta · suosituksiin" }).getAttribute("href"))
      .toBe("/?date=2026-07-14");
    expect(screen.getAllByText("Paahdettua kuhaa").length).toBeGreaterThan(0);
    expect(screen.getByText("13,70 €")).toBeTruthy();
    expect(screen.getByText("L")).toBeTruthy();
    expect(screen.getByLabelText(/L, laktoositon; G, gluteeniton/)).toBeTruthy();
    const selectedDay = selectedDayHeading.closest("article");
    expect(selectedDay).not.toBeNull();
    expect(
      within(selectedDay!).getByText(/Varmista ruokavaliomerkinnät ravintolasta/),
    ).toBeTruthy();
    expect(screen.getByText(/Ruokavaliomerkinnät on poimittu automaattisesti/)).toBeTruthy();
    expect(screen.getByText("Ruokalistaa ei ole julkaistu.")).toBeTruthy();
    expect(screen.getAllByText("Tietoja ei ole vielä haettu tälle päivälle.")).toHaveLength(5);
    expect(
      screen.getByRole("link", { name: /Ravintolan verkkosivut.*avautuu uuteen välilehteen/ }),
    ).toBeTruthy();
    const routeLink = screen.getByRole("link", {
      name: /Avaa reitti.*avautuu uuteen välilehteen/,
    });
    expect(routeLink).toBeTruthy();
    expect(
      routeLink.compareDocumentPosition(selectedDayHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Seuraava viikko" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
        "/api/restaurants/vinola/weeks/2026-07-20",
      ),
    );
    expect(await screen.findByText("Vinola: Tiistai 21. heinäkuuta ladattu.")).toBeTruthy();
    expect(document.title).toBe("Vinola – Tiistai 21. heinäkuuta | Mihin lounaalle?");
    window.history.replaceState({}, "", "/ravintolat/vinola?week=2026-07-13&date=2026-07-14");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() =>
      expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
        "/api/restaurants/vinola/weeks/2026-07-13",
      ),
    );
    expect(await screen.findByText("Vinola: Tiistai 14. heinäkuuta ladattu.")).toBeTruthy();

    window.history.replaceState(
      {},
      "",
      "/ravintolat/vinola?week=2026-07-13&date=2026-07-21",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() =>
      expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
        "/api/restaurants/vinola/weeks/2026-07-20",
      ),
    );
  });

  it("keeps an empty restaurant week useful and announced", async () => {
    window.history.replaceState({}, "", "/ravintolat/vinola?week=2026-07-13&date=2026-07-14");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(
        JSON.stringify({
          days: [],
          restaurant: {
            ...restaurant,
            description: "Rento lounasravintola keskustassa.",
            openingHours: [],
          },
          source: dayResponse.source,
          weekEnd: "2026-07-19",
          weekStart: "2026-07-13",
        }),
        { status: 200 },
      ),
    );

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Viikolle ei löytynyt ruokalistaa." }))
      .toBeTruthy();
    expect(screen.getByText("Vinola: viikolle 13.7.–19.7. ei löytynyt ruokalistaa."))
      .toBeTruthy();
    expect(screen.getByRole("link", { name: "Palaa suosituksiin" }).getAttribute("href"))
      .toBe("/?date=2026-07-14");
    expect(
      screen.getByRole("link", { name: /Lounaspaikka.*avautuu uuteen välilehteen/ }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Seuraava viikko" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
        "/api/restaurants/vinola/weeks/2026-07-20",
      ),
    );
    expect(await screen.findByText("Vinola: viikolle 20.7.–26.7. ei löytynyt ruokalistaa."))
      .toBeTruthy();
  });

  it("keeps route context aligned when a selected restaurant day is missing", async () => {
    window.history.replaceState({}, "", "/ravintolat/vinola?week=2026-07-13&date=2026-07-14");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          days: [{
            fetchedAt: "2026-07-15T03:10:00.000Z",
            lunchHours: "10.30–14",
            serviceDate: "2026-07-15",
            status: "published",
            structuredMenu: null,
            text: "Kasviscurry",
            title: "Lounas 15.7.",
          }],
          restaurant: {
            ...restaurant,
            description: "Rento lounasravintola keskustassa.",
            openingHours: [],
          },
          source: dayResponse.source,
          weekEnd: "2026-07-19",
          weekStart: "2026-07-13",
        }),
        { status: 200 },
      ),
    );

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Keskiviikko 15. heinäkuuta" }))
      .toBeTruthy();
    expect(document.title).toBe("Vinola – Keskiviikko 15. heinäkuuta | Mihin lounaalle?");
    expect(
      screen.getByRole("link", { name: "Keskiviikko 15. heinäkuuta · suosituksiin" })
        .getAttribute("href"),
    ).toBe("/?date=2026-07-15");
    expect(screen.getByText("Vinola: Keskiviikko 15. heinäkuuta ladattu.")).toBeTruthy();
  });

  it("keeps the leading recommendation's source, freshness, and raw preview honest", async () => {
    const customSource = { name: "Vinolan oma lista", url: "https://example.com/vinola/menu" };
    const longFirstLine = "Paikallista kesäkeittoa päivän kasviksista, rapeaa leipää, yrttiöljyä ja paahdettuja siemeniä";
    const rawMenu = {
      ...menu,
      source: customSource,
      structuredMenu: null,
      text: `${longFirstLine}\nToinen ruoka\nKolmas ruoka`,
    };
    const response = {
      ...dayResponse,
      menus: [{
        fetchedAt: "2026-07-15T03:10:00.000Z",
        menu: rawMenu,
        restaurant,
      }],
      recommendations: [{
        ...dayResponse.recommendations[0],
        menu: rawMenu,
      }],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(response), { status: 200 }),
    );

    render(<App />);

    const primaryHeading = await screen.findByRole("heading", { name: "Vinola", level: 2 });
    const primaryCard = primaryHeading.closest("article");
    expect(primaryCard).not.toBeNull();
    const primary = within(primaryCard!);
    expect(primaryCard!.textContent).toContain(longFirstLine);
    expect(primaryCard!.textContent).toContain("Toinen ruoka");
    expect(primaryCard!.textContent).toContain("Kolmas ruoka");
    expect(primary.queryByText("Koko lista avautuu viikon ruokalistasta.")).toBeNull();

    const trust = screen.getByLabelText("Suositusten perusteet ja päivitys");
    expect(
      within(trust).getByRole("link", {
        name: /Vinolan oma lista.*avautuu uuteen välilehteen/,
      }).getAttribute("href"),
    )
      .toBe(customSource.url);
    expect(trust.textContent).toContain("15.7.");
    expect(screen.queryByRole("heading", { name: "Muut päivän lounaat" })).toBeNull();
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
