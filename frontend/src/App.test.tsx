import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { formatLongDate, todayInHelsinki } from "./dates";
import type { BrowserAdapter, BrowserLocation } from "./navigation";

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
      {
        category: "main",
        dietaryMarkers: ["L"],
        explicitAllergens: [],
        nameFi: "Paahdettua halloumia ja kasviksia",
      },
      {
        category: "soup",
        dietaryMarkers: ["G"],
        explicitAllergens: [],
        nameFi: "Porkkana-inkiväärikeittoa",
      },
      {
        category: "salad",
        dietaryMarkers: [],
        explicitAllergens: [],
        nameFi: "Vihersalaattia",
      },
      {
        category: "dessert",
        dietaryMarkers: ["L"],
        explicitAllergens: [],
        nameFi: "Marjarahkaa",
      },
    ],
  },
  text: "Paahdettua kuhaa (G)\nAllergeenit: kala\nSitruunaperunoita\nPaahdettua halloumia ja kasviksia (L)\nPorkkana-inkiväärikeittoa (G)\nVihersalaattia\nMarjarahkaa (L)",
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
      scores: { appeal: 9.5, distinctiveness: 9, value: 8.4, variety: 9.1 },
    },
    {
      menu: { ...menu, structuredMenu: null, text: "Kasviscurry" },
      rank: 2,
      rationale: "Monipuolinen kasvislounas erottuu edukseen.",
      restaurant: { ...restaurant, id: "kasvis", name: "Kasvisravintola" },
      score: 8.4,
      scores: { appeal: 8.5, distinctiveness: 8.2, value: 8.4, variety: 8.6 },
    },
    {
      menu: {
        ...menu,
        source: { name: "Muun ravintolan lista", url: "https://example.com/muu/menu" },
        structuredMenu: null,
        text: "Lihapullat ja perunamuusi",
      },
      rank: 3,
      rationale: "Hyvä hinta ja huolella kuvattu klassikko.",
      restaurant: { ...restaurant, id: "muu", name: "Muu lounaspaikka" },
      score: 7.8,
      scores: { appeal: 8, distinctiveness: 7.4, value: 8.2, variety: 7.2 },
    },
  ],
  serviceDate: "2026-07-14",
  source: { name: "Lounaspaikka", url: "https://lounaspaikka.ilkkapohjalainen.fi/" },
  stale: false,
  status: "ready",
};

describe("reader app", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  beforeEach(() => {
    window.history.replaceState({}, "", "/?date=2026-07-14");
    vi.restoreAllMocks();
  });

  it("marks only the affected daily menu with its failed update and source recovery link", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      ...dayResponse, stale: true,
      menus: dayResponse.menus.map((entry, index) => ({
        ...entry, stale: index === 2, lastAttemptAt: "2026-07-14T06:00:00.000Z",
      })),
    })));
    render(<App />);
    await screen.findByRole("searchbox");
    const affected = screen.getByRole("heading", { name: "Muu lounaspaikka" }).closest("article")!;
    expect(within(affected).getByText(/Päivitys epäonnistui/)).toBeTruthy();
    expect(within(affected).getByText(/14.7. klo 09.00/)).toBeTruthy();
    expect(within(affected).getByRole("link", { name: /Tarkista lähdesivu/ }).getAttribute("href"))
      .toBe("https://example.com/muu/menu");
    expect(within(affected).getByText("Lihapullat ja perunamuusi")).toBeTruthy();
    const healthy = screen.getByRole("heading", { name: "Vinola" }).closest("article")!;
    expect(within(healthy).queryByText(/Päivitys epäonnistui/)).toBeNull();
  });

  it.each([true, false])("explains a failed restaurant-week update with prior menu=%s", async (hasPriorMenu) => {
    window.history.replaceState({}, "", "/ravintolat/vinola?date=2026-07-14");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      restaurant: { ...restaurant, description: null, openingHours: [] },
      source: dayResponse.source, weekStart: "2026-07-13", weekEnd: "2026-07-19",
      days: Array.from({ length: 7 }, (_, i) => ({
        serviceDate: `2026-07-${13 + i}`, status: "missing", text: null, structuredMenu: null,
        fetchedAt: null, stale: false, lastAttemptAt: null,
        ...(i === 1 ? {
          ...(hasPriorMenu ? { ...menu, fetchedAt: "2026-07-14T03:10:00.000Z" } : {}),
          stale: true, lastAttemptAt: "2026-07-14T06:00:00.000Z",
        } : {}),
      })),
    })));
    render(<App />);
    await screen.findByRole("heading", { name: "Vinola" });
    const warning = screen.getByRole("complementary", { name: "Ruokalistan päivitys" });
    expect(within(warning).getByText("Päivitys epäonnistui.")).toBeTruthy();
    expect(within(warning).getByRole("link", { name: /Tarkista lähdesivu/ }).getAttribute("href"))
      .toBe(dayResponse.source.url);
    if (hasPriorMenu) {
      expect(within(warning).getByText(/Näytämme aiemmat tiedot: 14.7. klo 06.10/)).toBeTruthy();
      expect(screen.getByText("Paahdettua kuhaa")).toBeTruthy();
    } else {
      expect(within(warning).getByText(/ei ole aiemmin haettuja tietoja/)).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Viikon tietoja puuttuu." })).toBeTruthy();
      expect(screen.getAllByRole("status").map((element) => element.textContent).join(" "))
        .toContain("Viikon tietoja puuttuu päivitysvirheen vuoksi.");
      expect(screen.queryByText("Tietoja ei ole vielä haettu tälle päivälle.")).toBeNull();
    }
  });

  it("switches between loaded week days without fetching and keeps selection, history and shared links aligned", async () => {
    window.history.replaceState({}, "", "/ravintolat/vinola?date=2026-07-14&q=kuhaa");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({
      restaurant: { ...restaurant, description: null, openingHours: [] },
      source: dayResponse.source, weekStart: "2026-07-13", weekEnd: "2026-07-19",
      days: Array.from({ length: 7 }, (_, i) => ({
        ...menu, serviceDate: `2026-07-${13 + i}`, fetchedAt: "2026-07-14T03:10:00.000Z",
        ...(i === 6 ? { status: "not_published", text: null, structuredMenu: null } : {}),
      })),
    })));
    const copy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
    const view = render(<App />);
    await screen.findByRole("heading", { name: "Vinola" });
    const dates = screen.getByRole("navigation", { name: "Viikon päivät" });
    expect(within(dates).getAllByRole("button")).toHaveLength(7);
    const sunday = within(dates).getByRole("button", { name: "Sunnuntai 19. heinäkuuta" });
    fireEvent.click(sunday);
    expect(sunday.getAttribute("aria-pressed")).toBe("true");
    const selected = screen.getByRole("heading", { name: "Sunnuntai 19. heinäkuuta" }).closest("article")!;
    expect(within(selected).getByText("Ruokalistaa ei ole julkaistu.")).toBeTruthy();
    expect(window.location.search).toBe("?week=2026-07-13&date=2026-07-19&q=kuhaa");
    expect(screen.getByRole("link", { name: "Sunnuntai 19. heinäkuuta · suosituksiin" }).getAttribute("href"))
      .toBe("/?date=2026-07-19&q=kuhaa");
    fireEvent.click(screen.getByRole("button", { name: "Kopioi linkki" }));
    await screen.findByText("Linkki kopioitu.");
    expect(copy).toHaveBeenCalledWith(`${window.location.origin}/ravintolat/vinola?week=2026-07-13&date=2026-07-19&q=kuhaa`);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    window.history.replaceState({}, "", "/ravintolat/vinola?date=2026-07-14&q=kuhaa");
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(within(dates).getByRole("button", { name: "Tiistai 14. heinäkuuta" }).getAttribute("aria-pressed"))
      .toBe("true");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    view.unmount();
    render(<App />);
    await screen.findByRole("heading", { name: "Tiistai 14. heinäkuuta" });
    expect(screen.getByRole("button", { name: "Tiistai 14. heinäkuuta" }).getAttribute("aria-pressed"))
      .toBe("true");
  });

  it("jumps directly to a chosen date with one request and preserves the menu search", async () => {
    window.history.replaceState({}, "", "/?date=2026-07-14&q=curry");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      new Response(JSON.stringify({ ...dayResponse, serviceDate: String(input).split("/").at(-1) })),
    );
    render(<App />);
    await screen.findByRole("searchbox");
    fireEvent.click(screen.getByText("Valitse päivä"));
    fireEvent.change(screen.getByLabelText("Lounaspäivä"), { target: { value: "2026-08-04" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Näytä lounaat" }));
    await screen.findByRole("searchbox");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.lastCall?.[0]).toBe("/api/days/2026-08-04");
    expect(window.location.search).toBe("?date=2026-08-04&q=curry");
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("curry");
    expect(screen.getByText("Valitse päivä").closest("details")?.open).toBe(false);
    expect(document.activeElement).toBe(screen.getByText("Valitse päivä"));
  });

  it("opens the selected restaurant date and week while retaining search and rejecting an empty date", async () => {
    window.history.replaceState({}, "", "/ravintolat/vinola?date=2026-07-14&q=kuhaa");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const weekStart = String(input).split("/").at(-1);
      return new Response(JSON.stringify({
        restaurant: { ...restaurant, description: null, openingHours: [] },
        source: dayResponse.source, weekStart,
        days: [{ ...menu, serviceDate: weekStart === "2026-08-03" ? "2026-08-04" : "2026-07-14" }],
      }));
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Vinola" });
    fireEvent.click(screen.getByText("Valitse päivä"));
    const date = screen.getByLabelText("Lounaspäivä");
    fireEvent.change(date, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Näytä lounaat" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Valitse päivä").closest("details")?.open).toBe(true);
    fireEvent.change(date, { target: { value: "2026-08-04" } });
    fireEvent.click(screen.getByRole("button", { name: "Näytä lounaat" }));
    await screen.findByRole("heading", { name: "Tiistai 4. elokuuta" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.lastCall?.[0]).toBe("/api/restaurants/vinola/weeks/2026-08-03");
    expect(window.location.search).toBe("?week=2026-08-03&date=2026-08-04&q=kuhaa");
    expect(screen.getByRole("link", { name: "Tiistai 4. elokuuta · suosituksiin" }).getAttribute("href"))
      .toBe("/?date=2026-08-04&q=kuhaa");
  });

  it("copies the selected day and search and clears copy confirmation when the view changes", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(dayResponse)));
    render(<App />);
    fireEvent.change(await screen.findByRole("searchbox"), { target: { value: "Seinäjoki kuhaa" } });
    fireEvent.click(screen.getByRole("button", { name: "Kopioi linkki" }));
    expect(await screen.findByText("Linkki kopioitu.")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?date=2026-07-14&q=Sein%C3%A4joki+kuhaa`);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "curry" } });
    expect(screen.queryByText("Linkki kopioitu.")).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["denied", "unavailable"])("offers a selected restaurant link for manual copy when the clipboard is %s", async (mode) => {
    window.history.replaceState({}, "", "/ravintolat/vinola?date=2026-07-14&q=kuhaa");
    vi.stubGlobal("navigator", mode === "denied"
      ? { clipboard: { writeText: vi.fn().mockRejectedValue(new DOMException("Denied", "NotAllowedError")) } }
      : {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      restaurant: { ...restaurant, description: null, openingHours: [] },
      source: dayResponse.source, weekStart: "2026-07-13", days: [],
    })));
    render(<App />);
    await screen.findByRole("heading", { name: "Viikolle ei löytynyt ruokalistaa." });
    fireEvent.click(screen.getByRole("button", { name: "Kopioi linkki" }));
    const link = await screen.findByRole("textbox", { name: "Jaettava linkki" }) as HTMLInputElement;
    expect(link.value).toBe(`${window.location.origin}/ravintolat/vinola?week=2026-07-13&date=2026-07-14&q=kuhaa`);
    expect(document.activeElement).toBe(link);
    expect(link.selectionStart).toBe(0);
    expect(link.selectionEnd).toBe(link.value.length);
    expect(screen.queryByText("Linkki kopioitu.")).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("pins the home link to its date and ignores a late copy result after navigation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-14T09:00:00Z"));
    window.history.replaceState({}, "", "/");
    let finishCopy!: () => void;
    const writeText = vi.fn(() => new Promise<void>((resolve) => { finishCopy = resolve; }));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      new Response(JSON.stringify({ ...dayResponse, serviceDate: String(input).split("/").at(-1) })),
    );
    render(<App />);
    await screen.findByRole("searchbox");
    fireEvent.click(screen.getByRole("button", { name: "Kopioi linkki" }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?date=2026-07-14`);
    expect((screen.getByRole("button", { name: "Kopioi linkki" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Seuraava päivä" }));
    await act(async () => finishCopy());
    expect(screen.queryByText("Linkki kopioitu.")).toBeNull();
    expect((screen.getByRole("button", { name: "Kopioi linkki" }) as HTMLButtonElement).disabled).toBe(false);
    expect(window.location.search).toBe("?date=2026-07-15");
  });

  it("recovers from a malformed restaurant link without crashing or requesting data", () => {
    window.history.replaceState({}, "", "/ravintolat/%E0%A4%A?date=2026-07-14");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<App />);
    expect(screen.getByRole("heading", { name: "Ravintolaa ei löytynyt." })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Palaa päivän lounaisiin" }).getAttribute("href"))
      .toBe("/?date=2026-07-14");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains a missing restaurant and returns to the selected day instead of retrying a 404", async () => {
    window.history.replaceState({}, "", "/ravintolat/missing?date=2026-07-14");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 404 }));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Ravintolaa ei löytynyt." })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Palaa päivän lounaisiin" }).getAttribute("href"))
      .toBe("/?date=2026-07-14");
    expect(screen.queryByRole("button", { name: "Yritä uudelleen" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Viikon valinta" })).toBeNull();
  });

  it.each(["day", "week"])("includes the town in the %s view and its directions link", async (view) => {
    const localRestaurant = { ...restaurant, address: "Keskuskatu 10", city: "Ilmajoki" };
    const response = view === "day" ? {
      ...dayResponse, recommendations: [],
      menus: [{ ...dayResponse.menus[0], restaurant: localRestaurant }],
    } : {
      restaurant: { ...localRestaurant, description: null, openingHours: [] },
      source: dayResponse.source, weekStart: "2026-07-13", weekEnd: "2026-07-19",
      days: [{ ...menu, serviceDate: "2026-07-14", fetchedAt: dayResponse.lastSuccessfulFetchAt }],
    };
    if (view === "week") window.history.replaceState({}, "", "/ravintolat/vinola?date=2026-07-14");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(response)));
    render(<App />);
    expect(await screen.findByText("Keskuskatu 10, Ilmajoki")).toBeTruthy();
    const route = screen.getByRole("link", { name: /(?:Reitti|Avaa reitti).*avautuu/ });
    expect(new URL(route.getAttribute("href")!).searchParams.get("destination"))
      .toBe("Keskuskatu 10, Ilmajoki");
  });

  it("finds menus by restaurant, town, and dish and recovers from no matches without fetching again", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      ...dayResponse,
      menus: dayResponse.menus.map((entry, index) => index === 1
        ? { ...entry, restaurant: { ...entry.restaurant, city: "Ilmajoki", address: "Puistotie 2" } }
        : entry),
    })));
    render(<App />);
    const search = await screen.findByRole("searchbox", { name: "Hae ravintolaa, paikkakuntaa tai ruokaa" });
    const results = screen.getByRole("region", { name: "Kaikki ruokalistat" });
    for (const term of [" KASVISravintola ", "Ilmajoki", "kasviscurry", "ILMAJOKI curry"]) {
      fireEvent.change(search, { target: { value: term } });
      expect(within(results).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent))
        .toEqual(["Kasvisravintola"]);
      expect(within(results).getByText("Kasviscurry")).toBeTruthy();
      expect(within(results).getByRole("img", { name: "Sija 2" })).toBeTruthy();
    }
    fireEvent.change(search, { target: { value: "ei-olemassa" } });
    expect(within(results).queryByRole("heading", { level: 3 })).toBeNull();
    expect(within(results).getByText("Haulla ei löytynyt ruokalistoja.")).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Ruokavaliotietojen turvallisuus" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tyhjennä haku" }));
    expect(document.activeElement).toBe(search);
    expect(within(results).getAllByRole("heading", { level: 3 })).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the menu search when changing the date and retrying a failed request", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(dayResponse)))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...dayResponse, serviceDate: "2026-07-15" })));
    render(<App />);
    fireEvent.change(await screen.findByRole("searchbox"), { target: { value: "curry" } });
    fireEvent.click(screen.getByRole("button", { name: "Seuraava päivä" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yritä uudelleen" }));
    expect((await screen.findByRole("searchbox") as HTMLInputElement).value).toBe("curry");
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent))
      .toEqual(["Kasvisravintola"]);
    expect(screen.getByRole("link", { name: "Viikon ruokalista" }).getAttribute("href"))
      .toBe("/ravintolat/kasvis?week=2026-07-13&date=2026-07-15&q=curry");
  });

  it("keeps menu search in reloadable URLs and restaurant return links without fetching on input", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(dayResponse)));
    const { unmount } = render(<App />);
    fireEvent.change(await screen.findByRole("searchbox"), { target: { value: "Seinäjoki kuhaa" } });
    expect(new URLSearchParams(window.location.search).get("q")).toBe("Seinäjoki kuhaa");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const weekHref = screen.getByRole("link", { name: "Viikon ruokalista" }).getAttribute("href")!;
    expect(new URL(weekHref, window.location.origin).searchParams.get("q")).toBe("Seinäjoki kuhaa");

    unmount();
    window.history.replaceState({}, "", weekHref);
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(JSON.stringify({
      days: [{ ...menu, fetchedAt: "2026-07-14T03:00:00Z", serviceDate: "2026-07-14" }],
      restaurant: { ...restaurant, description: null, openingHours: [] },
      source: dayResponse.source, weekStart: "2026-07-13", weekEnd: "2026-07-19",
    })));
    const weekView = render(<App />);
    await screen.findByRole("heading", { name: "Vinola" });
    const returnHref = screen.getByRole("link", { name: "Tiistai 14. heinäkuuta · suosituksiin" }).getAttribute("href")!;
    expect(new URL(returnHref, window.location.origin).searchParams.get("q")).toBe("Seinäjoki kuhaa");
    weekView.unmount();

    window.history.replaceState({}, "", returnHref);
    vi.mocked(globalThis.fetch).mockImplementation(async () => new Response(JSON.stringify(dayResponse)));
    render(<App />);
    expect((await screen.findByRole("searchbox") as HTMLInputElement).value).toBe("Seinäjoki kuhaa");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Tyhjennä haku" }));
    expect(new URLSearchParams(window.location.search).has("q")).toBe(false);
    expect(screen.getAllByRole("article")).toHaveLength(3);

    await act(async () => {
      window.history.replaceState({}, "", "/?date=2026-07-14&q=curry");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("curry");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it.each(["pending", "ready", "unavailable"])("provides a recovery path for an empty %s day", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      ...dayResponse, menus: [], recommendations: [], status,
    })));
    render(<App />);
    expect(await screen.findByText(/yllä olevilla nuolilla/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Seuraava päivä" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Siirry sisältöön" }).getAttribute("href"))
      .toBe("#main-content");
    expect(screen.getByRole("main").id).toBe("main-content");
  });

  it("recovers the selected day after a network failure", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(JSON.stringify(dayResponse)));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Yritä uudelleen" }));
    expect(await screen.findByRole("heading", { name: "Vinola", level: 3 })).toBeTruthy();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/days/2026-07-14", "/api/days/2026-07-14",
    ]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("uses an injected browser adapter for local navigation", async () => {
    let location: BrowserLocation = { pathname: "/", search: "?date=2026-07-14" };
    const push = vi.fn((path: string) => {
      const url = new URL(path, "https://example.test");
      location = { pathname: url.pathname, search: url.search };
    });
    const browser: BrowserAdapter = {
      location: () => location,
      push,
      replace: vi.fn(),
      reload: vi.fn(),
      subscribePopState: () => () => undefined,
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(dayResponse), { status: 200 }),
    );

    render(<App browser={browser} />);
    await screen.findByRole("heading", { name: "Päivän lounaat" });
    fireEvent.click(screen.getByRole("button", { name: "Seuraava päivä" }));

    expect(push).toHaveBeenCalledWith("/?date=2026-07-15");
    expect(browser.location()).toEqual({ pathname: "/", search: "?date=2026-07-15" });
  });

  it("shows every daily menu once with complete dishes and transparent assessments", async () => {
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
    await waitFor(() =>
      expect(document.title).toBe("Tiistai 14. heinäkuuta | Mihin lounaalle?"),
    );
    expect(
      await screen.findByText("Tiistai 14. heinäkuuta ladattu. 3 ravintolaa ja 3 suositusta."),
    ).toBeTruthy();
    expect(screen.getAllByText("Vinola")).toHaveLength(1);
    expect(screen.getAllByText(/13,70 €/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Arvio 9,2 / 10")).toBeTruthy();
    expect(screen.getByLabelText("Sija 3")).toBeTruthy();
    const allMenusHeading = screen.getByRole("heading", { name: "Kaikki ruokalistat" });
    const allMenus = allMenusHeading.closest("section");
    expect(allMenus).not.toBeNull();
    expect(within(allMenus!).getByText("Muu lounaspaikka")).toBeTruthy();
    expect(within(allMenus!).getByText("Lihapullat ja perunamuusi")).toBeTruthy();
    expect(within(allMenus!).getByText("Vinola")).toBeTruthy();
    expect(within(allMenus!).getByText("Kasvisravintola")).toBeTruthy();
    expect(
      within(allMenus!).getByRole("link", {
        name: /Muun ravintolan lista.*avautuu uuteen välilehteen/,
      }),
    ).toBeTruthy();
    expect(screen.getByText("Kuha ja raikas lisuke tekevät tästä päivän kiinnostavimman lounaan.")).toBeTruthy();
    expect(screen.getAllByText("Paahdettua kuhaa").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sitruunaperunoita").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Paahdettua halloumia ja kasviksia").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Porkkana-inkiväärikeittoa").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Vihersalaattia").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Marjarahkaa").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ilmoitetut allergeenit: kala").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Alkuperäinen ruokalistateksti").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Näytä \d+ muuta kohtaa/)).toBeNull();
    expect(screen.getAllByText("Kasviscurry").length).toBeGreaterThan(0);
    const companion = screen.getByRole("heading", { name: "Kasvisravintola", level: 3 })
      .closest("article");
    expect(companion).not.toBeNull();
    expect(within(companion!).getByText("Kasviscurry")).toBeTruthy();
    expect(within(companion!).getByText("Monipuolinen kasvislounas erottuu edukseen.")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /Reitti.*avautuu uuteen välilehteen/ }).length)
      .toBeGreaterThan(0);
    const dataNotice = screen.getByText(/Ruokavaliomerkinnät on poimittu automaattisesti/);
    const primaryRestaurant = screen.getByRole("heading", { name: "Vinola", level: 3 });
    const primaryCard = primaryRestaurant.closest("article");
    expect(primaryCard).not.toBeNull();
    const primaryDietaryMarkers = within(primaryCard!).getAllByLabelText(
      /Ravintolan ilmoittamat ruokavaliomerkinnät/,
    );
    expect(primaryDietaryMarkers.length).toBeGreaterThan(0);
    expect(primaryRestaurant.compareDocumentPosition(dataNotice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(allMenusHeading.compareDocumentPosition(dataNotice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/allergeeniton/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Seuraava päivä" }));
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/days/2026-07-15"));
    expect(
      await screen.findByText("Keskiviikko 15. heinäkuuta ladattu. 3 ravintolaa ja 3 suositusta."),
    ).toBeTruthy();
    await waitFor(() =>
      expect(document.title).toBe("Keskiviikko 15. heinäkuuta | Mihin lounaalle?"),
    );

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
    await waitFor(() =>
      expect(document.title).toBe(`${formatLongDate(todayInHelsinki())} | Mihin lounaalle?`),
    );
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
    expect(
      await screen.findByText("Menuarviot eivät ole vielä saatavilla. Ruokalistat ovat jo selattavissa."),
    ).toBeTruthy();
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
    await waitFor(() =>
      expect(document.title).toBe("Vinola – Tiistai 14. heinäkuuta | Mihin lounaalle?"),
    );
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
    await waitFor(() =>
      expect(document.title).toBe("Vinola – Tiistai 21. heinäkuuta | Mihin lounaalle?"),
    );
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

  it.each(["missing", "not_published", "no-days"])("keeps an empty %s restaurant week useful and announced", async (status) => {
    window.history.replaceState({}, "", "/ravintolat/vinola?week=2026-07-13&date=2026-07-14");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const weekStart = String(input).split("/").at(-1)!;
      const startDay = weekStart === "2026-07-20" ? 20 : 13;
      return new Response(
        JSON.stringify({
          days: status === "no-days" ? [] : Array.from({ length: 7 }, (_, index) => ({
            fetchedAt: status === "missing" ? null : "2026-07-14T03:10:00.000Z",
            lunchHours: null,
            serviceDate: `2026-07-${startDay + index}`,
            status,
            structuredMenu: null,
            text: null,
            title: null,
          })),
          restaurant: {
            ...restaurant,
            description: "Rento lounasravintola keskustassa.",
            openingHours: [],
          },
          source: dayResponse.source,
          weekEnd: `2026-07-${startDay + 6}`,
          weekStart,
        }),
        { status: 200 },
      );
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Viikolle ei löytynyt ruokalistaa." }))
      .toBeTruthy();
    expect(screen.getByText("Vinola: viikolle 13.7.–19.7. ei löytynyt ruokalistaa."))
      .toBeTruthy();
    expect(screen.getByRole("link", { name: "Palaa suosituksiin" }).getAttribute("href"))
      .toBe("/?date=2026-07-14");
    expect(screen.queryByRole("heading", { name: "Muut päivät" })).toBeNull();
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

  it("keeps the newly selected week in the return link while loading and after failure", async () => {
    window.history.replaceState({}, "", "/ravintolat/vinola?date=2026-07-14");
    let rejectWeek!: (error: Error) => void;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        days: [{ ...menu, serviceDate: "2026-07-14", fetchedAt: "2026-07-14T03:00:00Z" }],
        restaurant: { ...restaurant, description: null, openingHours: [] },
        source: dayResponse.source,
        weekStart: "2026-07-13",
        weekEnd: "2026-07-19",
      })))
      .mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { rejectWeek = reject; }));
    render(<App />);
    await screen.findByRole("heading", { name: "Tiistai 14. heinäkuuta" });

    fireEvent.click(screen.getByRole("button", { name: "Seuraava viikko" }));
    expect(screen.getByText("Ravintolan ruokalistaa ladataan…")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tiistai 21. heinäkuuta · suosituksiin" }).getAttribute("href"))
      .toBe("/?date=2026-07-21");
    expect(screen.queryByRole("heading", { name: "Tiistai 14. heinäkuuta" })).toBeNull();

    await act(async () => rejectWeek(new Error("offline")));
    expect(await screen.findByRole("button", { name: "Yritä uudelleen" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tiistai 21. heinäkuuta · suosituksiin" }).getAttribute("href"))
      .toBe("/?date=2026-07-21");
    expect(document.title).toBe("Vinola – Tiistai 21. heinäkuuta | Mihin lounaalle?");
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
    await waitFor(() =>
      expect(document.title).toBe("Vinola – Keskiviikko 15. heinäkuuta | Mihin lounaalle?"),
    );
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

    const primaryHeading = await screen.findByRole("heading", { name: "Vinola", level: 3 });
    const primaryCard = primaryHeading.closest("article");
    expect(primaryCard).not.toBeNull();
    const primary = within(primaryCard!);
    expect(primaryCard!.textContent).toContain(longFirstLine);
    expect(primaryCard!.textContent).toContain("Toinen ruoka");
    expect(primaryCard!.textContent).toContain("Kolmas ruoka");
    expect(primary.queryByText("Koko lista avautuu viikon ruokalistasta.")).toBeNull();

    expect(
      primary.getByRole("link", {
        name: /Vinolan oma lista.*avautuu uuteen välilehteen/,
      }).getAttribute("href"),
    )
      .toBe(customSource.url);
    expect(primaryCard!.textContent).toContain("15.7.");
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
    expect(screen.getByRole("status").textContent).toContain("Vinola");
    fireEvent.change(screen.getByLabelText("Lounaspäivä"), {
      target: { value: "2026-07-13" },
    });
    expect(screen.queryByText("Palaute tallennettiin: Vinola.")).toBeNull();
    expect(screen.getByText("Tortillavaihtoehdot saivat korkean arvion.")).toBeTruthy();
    expect(screen.queryByText("Kuha tekee listasta kiinnostavan.")).toBeNull();
    const sourceInput = screen.getByLabelText("Ravintolan ruokalistasivu");
    expect(sourceInput.getAttribute("pattern")).toBe("https://.*");
    expect(sourceInput.getAttribute("maxlength")).toBe("2048");
    expect(sourceInput.getAttribute("aria-describedby")).toBe("menu-source-hint");
    fireEvent.change(sourceInput, {
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

  it.each(["feedback", "source"] as const)(
    "returns an operator to login when the session expires during a %s mutation",
    async (mutation) => {
    window.history.replaceState({}, "", "/admin");
    let authenticated = false;
    const mutationUrl = mutation === "feedback"
      ? "/api/admin/assessments/42/feedback"
      : "/api/admin/sources";
    const overview = {
      counts: {
        assessments: 1,
        customSources: 0,
        fetches: 1,
        offeringRevisions: 1,
        recommendationSets: 1,
        restaurants: 1,
      },
      errors: [],
      generatedAt: "2026-07-14T05:00:00.000Z",
      latestFetch: {
        attemptedAt: "2026-07-14T04:05:00.000Z",
        lastSuccessfulAt: "2026-07-14T04:05:00.000Z",
        outcome: "success",
      },
      openAiConfigured: true,
      recentAssessments: [{
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
      }],
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
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/admin/login") {
        authenticated = true;
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      if (url === "/api/admin/overview") {
        return authenticated
          ? new Response(JSON.stringify(overview), { status: 200 })
          : new Response(
            JSON.stringify({ error: { message: "Kirjaudu sisään jatkaaksesi." } }),
            { status: 401 },
          );
      }
      if (url === mutationUrl) {
        authenticated = false;
        return new Response(
          JSON.stringify({ error: { message: "Kirjaudu sisään jatkaaksesi." } }),
          { status: 401 },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Kirjaudu ylläpitoon" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Salasana"), {
      target: { value: "a-long-test-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Kirjaudu" }));

    expect(await screen.findByRole("heading", { name: "Järjestelmän tila" })).toBeTruthy();
    if (mutation === "feedback") {
      fireEvent.click(screen.getByRole("button", { name: "Liian korkea" }));
    } else {
      fireEvent.change(screen.getByLabelText("Ravintolan ruokalistasivu"), {
        target: { value: "https://example.com/lounas" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Lisää ja hae ruokalista" }));
    }

    expect(await screen.findByRole("heading", { name: "Kirjaudu ylläpitoon" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "Istunto vanheni. Kirjaudu uudelleen jatkaaksesi.",
    );
  });

  it("explains when login succeeds but the session cannot be established", async () => {
    window.history.replaceState({}, "", "/admin");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/admin/login") {
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      }
      if (url === "/api/admin/overview") {
        return new Response(
          JSON.stringify({ error: { message: "Kirjaudu sisään jatkaaksesi." } }),
          { status: 401 },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Kirjaudu ylläpitoon" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Salasana"), {
      target: { value: "a-long-test-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Kirjaudu" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Kirjautuminen ei valmistunut. Yritä uudelleen.",
    );
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
