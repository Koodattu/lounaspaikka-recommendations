import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminPage } from "./AdminPage";
import type { AdminOverview } from "./types";

const overview: AdminOverview = {
  counts: { assessments: 0, customSources: 0, fetches: 0, offeringRevisions: 0, recommendationSets: 0, restaurants: 0 },
  errors: [],
  generatedAt: "2026-07-14T05:00:00Z",
  latestFetch: { attemptedAt: null, lastSuccessfulAt: null, outcome: null },
  openAiConfigured: false,
  recentAssessments: [],
  refresh: { currentTarget: null, lastError: null, lastFinishedAt: null, running: false, startedAt: null },
  sources: [],
  uptimeSeconds: 60,
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}

describe("admin recovery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/admin");
  });

  it("disables and enables a source with confirmed local state, no duplicate save, and an intact draft", async () => {
    const source = {
      createdAt: overview.generatedAt, enabled: true, id: 1,
      lastError: null, lastOutcome: "success", lastRunAt: overview.generatedAt,
      restaurantName: "Lounastupa", url: "https://example.com/existing",
    };
    let finish!: (response: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ ...overview, sources: [source] }))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(json({ sourceId: 1, enabled: true }))
      .mockResolvedValueOnce(json({ ...overview, sources: [source] }));
    render(<AdminPage />);
    const draft = await screen.findByLabelText("Ravintolan ruokalistasivu") as HTMLInputElement;
    fireEvent.change(draft, { target: { value: "https://example.com/new-draft" } });
    const disable = screen.getByRole("button", { name: "Poista käytöstä: Lounastupa" }) as HTMLButtonElement;
    const row = disable.closest("li")!;
    fireEvent.click(disable);
    expect(disable.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Hae uudelleen: Lounastupa" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(disable);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/admin/sources/1");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ enabled: false });
    await act(async () => finish(json({ sourceId: 1, enabled: false })));
    expect(within(row).getByText("Ei käytössä")).toBeTruthy();
    expect(within(row).queryByRole("button", { name: /^Hae uudelleen:/ })).toBeNull();
    expect((await within(row).findByRole("status")).textContent).toContain("Lähde poistettiin käytöstä");
    expect(await screen.findByText(/Näytetään aiemmin ladatut tiedot/)).toBeTruthy();
    expect(draft.value).toBe("https://example.com/new-draft");
    fireEvent.click(screen.getByRole("button", { name: "Ota käyttöön: Lounastupa" }));
    expect(await screen.findByRole("button", { name: "Poista käytöstä: Lounastupa" })).toBeTruthy();
    expect(within(row).queryByText("Ei käytössä")).toBeNull();
    expect(within(row).getByRole("status").textContent).toContain("Lähde otettiin käyttöön");
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({ enabled: true });
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/admin/sources")).toBe(false);
  });

  it.each([500, 401])("preserves source state and draft after a failed state change (%s), without replaying it", async (status) => {
    const data = { ...overview, sources: [{
      createdAt: overview.generatedAt, enabled: true, id: 1,
      lastError: null, lastOutcome: "success", lastRunAt: overview.generatedAt,
      restaurantName: "Lounastupa", url: "https://example.com/existing",
    }] };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(data))
      .mockResolvedValueOnce(json({ error: { message: "Tilaa ei saatu tallennettua." } }, status))
      .mockResolvedValueOnce(json({ status: "ok" }))
      .mockResolvedValueOnce(json(data));
    render(<AdminPage />);
    fireEvent.change(await screen.findByLabelText("Ravintolan ruokalistasivu"), { target: { value: "https://example.com/draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Poista käytöstä: Lounastupa" }));
    if (status === 401) {
      fireEvent.change(await screen.findByLabelText("Salasana"), { target: { value: "test-only-password" } });
      fireEvent.click(screen.getByRole("button", { name: /^Kirjaudu$/ }));
    } else {
      expect((await screen.findByRole("alert")).closest("li")).toBeTruthy();
    }
    const disable = await screen.findByRole("button", { name: "Poista käytöstä: Lounastupa" });
    await waitFor(() => expect((disable as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByLabelText("Ravintolan ruokalistasivu") as HTMLInputElement).value).toBe("https://example.com/draft");
    expect(screen.queryByText("Ei käytössä")).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
  });

  it("finds assessments by restaurant and dish while preserving date and search across refresh and reload", async () => {
    const assessment = {
      assessedAt: overview.generatedAt, assessmentId: 1, feedbackDirection: null,
      menuText: "Kasviskeitto", rationale: "Monipuolinen lounas.", restaurantId: "vinola",
      restaurantName: "Vinola", score: 7, scores: { appeal: 7, distinctiveness: 7, value: 7, variety: 7 },
      serviceDate: "2026-07-14",
    };
    const data = { ...overview, recentAssessments: [
      assessment,
      { ...assessment, assessmentId: 2, restaurantName: "Aava", menuText: "Kalakeitto" },
      { ...assessment, assessmentId: 3, serviceDate: "2026-07-15" },
    ] };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => json(data));
    const view = render(<AdminPage />);
    fireEvent.change(await screen.findByLabelText("Lounaspäivä"), { target: { value: "2026-07-14" } });
    const search = screen.getByRole("searchbox", { name: "Hae arviota" });
    fireEvent.change(search, { target: { value: "  VINOLA kasvis  " } });
    expect(screen.getByText("1 / 2 arviota")).toBeTruthy();
    expect(screen.getAllByRole("group", { name: /^Oma arvio:/ })).toHaveLength(1);
    expect(screen.getByRole("group", { name: "Oma arvio: Vinola, 14.7." })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Päivitä tiedot" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Päivitä tiedot" }) as HTMLButtonElement).disabled).toBe(false));
    expect((search as HTMLInputElement).value).toBe("  VINOLA kasvis  ");
    view.unmount();
    render(<AdminPage />);
    expect((await screen.findByLabelText("Lounaspäivä") as HTMLSelectElement).value).toBe("2026-07-14");
    const restored = screen.getByRole("searchbox", { name: "Hae arviota" }) as HTMLInputElement;
    expect(restored.value).toBe("  VINOLA kasvis  ");
    fireEvent.change(restored, { target: { value: "ei löydy" } });
    expect(screen.getByText("Haulla ei löytynyt arvioita. Kokeile toista hakusanaa tai tyhjennä haku.")).toBeTruthy();
    expect(screen.queryByRole("group", { name: /^Oma arvio:/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tyhjennä arviohaku" }));
    expect(document.activeElement).toBe(restored);
    expect(screen.getAllByRole("group", { name: /^Oma arvio:/ })).toHaveLength(2);
    expect(new URLSearchParams(window.location.search).has("q")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => {
      window.history.replaceState({}, "", "/admin?date=2026-07-15&q=kasvis#calibration-title");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect((screen.getByLabelText("Lounaspäivä") as HTMLSelectElement).value).toBe("2026-07-15");
    expect(restored.value).toBe("kasvis");
    expect(screen.getByRole("group", { name: "Oma arvio: Vinola, 15.7." })).toBeTruthy();
    expect(window.location.hash).toBe("#calibration-title");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => {
      window.history.replaceState({}, "", "/admin?date=invalid&q=kasvis");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(new URLSearchParams(window.location.search).get("date")).toBe("2026-07-15");
  });

  it("keeps review context after an expired save without duplicate submission or automatic replay", async () => {
    window.history.replaceState({}, "", "/admin?date=2026-07-14&q=vinola");
    const assessment = {
      assessedAt: overview.generatedAt, assessmentId: 1, feedbackDirection: null,
      menuText: "Kasviskeitto", rationale: "Monipuolinen lounas.", restaurantId: "vinola",
      restaurantName: "Vinola", score: 7, scores: { appeal: 7, distinctiveness: 7, value: 7, variety: 7 },
      serviceDate: "2026-07-14",
    };
    const data = { ...overview, recentAssessments: [assessment, { ...assessment, assessmentId: 2, serviceDate: "2026-07-15" }] };
    let finish!: (response: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(data))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(json({ status: "ok" }))
      .mockResolvedValueOnce(json(data));
    render(<AdminPage />);
    const lower = await screen.findByRole("button", { name: "Liian korkea" });
    fireEvent.click(lower);
    expect((lower as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("searchbox", { name: "Hae arviota" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Lounaspäivä") as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(lower);
    await act(async () => finish(json({}, 401)));
    fireEvent.change(await screen.findByLabelText("Salasana"), { target: { value: "test-only-password" } });
    fireEvent.click(screen.getByRole("button", { name: /^Kirjaudu$/ }));
    expect((await screen.findByLabelText("Lounaspäivä") as HTMLSelectElement).value).toBe("2026-07-14");
    expect((screen.getByRole("searchbox", { name: "Hae arviota" }) as HTMLInputElement).value).toBe("vinola");
    expect(screen.getByRole("button", { name: "Liian korkea" }).getAttribute("aria-pressed")).toBe("false");
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "PUT")).toHaveLength(1);
  });

  it("shows a failed feedback save beside its assessment and allows retry without changing the saved selection", async () => {
    const assessment = {
      assessedAt: overview.generatedAt, assessmentId: 1, feedbackDirection: null,
      menuText: "Kasviskeitto", rationale: "Monipuolinen lounas.", restaurantId: "vinola",
      restaurantName: "Vinola", score: 7, scores: { appeal: 7, distinctiveness: 7, value: 7, variety: 7 },
      serviceDate: "2026-07-14",
    };
    const data = { ...overview, recentAssessments: [assessment, { ...assessment, assessmentId: 2, restaurantName: "Aava" }] };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(data))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(json({ status: "ok" }))
      .mockResolvedValueOnce(json({ ...data, recentAssessments: [assessment, { ...data.recentAssessments[1], feedbackDirection: "lower" }] }));
    render(<AdminPage />);
    const feedback = await screen.findByRole("group", { name: "Oma arvio: Aava, 14.7." });
    const row = feedback.closest("li")!;
    const lower = within(feedback).getByRole("button", { name: "Liian korkea" });
    fireEvent.click(lower);
    expect((await within(row).findByRole("alert")).textContent).toContain("Tarkista yhteys");
    expect(lower.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(lower);
    expect((await within(row).findByRole("status")).textContent).toBe("Palaute tallennettiin: Aava.");
    expect(lower.getAttribute("aria-pressed")).toBe("true");
    expect(within(row).queryByRole("alert")).toBeNull();
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "PUT")).toHaveLength(2);
  });

  it("retries a source in place without duplicate requests or losing an unrelated draft", async () => {
    const failedSource = {
      createdAt: overview.generatedAt, enabled: true, id: 1,
      lastError: "Synthetic failure", lastOutcome: "network_error",
      lastRunAt: overview.generatedAt, restaurantName: "Lounastupa", url: "https://example.com/existing",
    };
    let finish!: (response: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ ...overview, sources: [failedSource, { ...failedSource, id: 2, enabled: false, restaurantName: "Poistettu käytöstä" }] }))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<AdminPage />);
    const draft = await screen.findByLabelText("Ravintolan ruokalistasivu") as HTMLInputElement;
    fireEvent.change(draft, { target: { value: "https://example.com/new-draft" } });
    const retry = screen.getByRole("button", { name: "Hae uudelleen: Lounastupa" }) as HTMLButtonElement;
    fireEvent.click(retry);
    expect(retry.disabled).toBe(true);
    fireEvent.click(retry);
    expect(screen.queryByRole("button", { name: "Hae uudelleen: Poistettu käytöstä" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/admin/sources")).toHaveLength(1);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ url: "https://example.com/existing" });
    await act(async () => finish(json({ status: "ok" })));
    expect(await screen.findByText("Ruokalista haettiin uudelleen.")).toBeTruthy();
    expect(draft.value).toBe("https://example.com/new-draft");
    expect(retry.disabled).toBe(false);
    const sourceRow = retry.closest("li")!;
    expect(within(sourceRow).queryByText("Verkkoyhteys epäonnistui")).toBeNull();
    expect(within(sourceRow).getByText("Onnistui")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Näytetään aiemmin ladatut tiedot");
  });

  it.each([422, 401])("preserves the source draft when a retry returns %s", async (status) => {
    const failedOverview = { ...overview, sources: [{
      createdAt: overview.generatedAt, enabled: true, id: 1,
      lastError: "Synthetic extraction failure", lastOutcome: "extraction_error",
      lastRunAt: overview.generatedAt, restaurantName: "Lounastupa", url: "https://example.com/existing",
    }] };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(failedOverview))
      .mockResolvedValueOnce(json({ error: { message: "Lähteen käsittely epäonnistui." } }, status));
    if (status === 401) fetchMock.mockResolvedValueOnce(json({ status: "ok" }));
    fetchMock.mockResolvedValueOnce(json(failedOverview));
    render(<AdminPage />);
    fireEvent.change(await screen.findByLabelText("Ravintolan ruokalistasivu"), {
      target: { value: "https://example.com/new-draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Hae uudelleen: Lounastupa" }));
    if (status === 401) {
      fireEvent.change(await screen.findByLabelText("Salasana"), { target: { value: "test-only-password" } });
      expect(screen.getByRole("alert").textContent).toContain("Istunto vanheni");
      fireEvent.click(screen.getByRole("button", { name: /^Kirjaudu$/ }));
    } else {
      expect((await screen.findByRole("alert")).textContent).toContain("Lähteen käsittely epäonnistui");
    }
    const retry = await screen.findByRole("button", { name: "Hae uudelleen: Lounastupa" }) as HTMLButtonElement;
    await waitFor(() => expect(retry.disabled).toBe(false));
    expect((screen.getByLabelText("Ravintolan ruokalistasivu") as HTMLInputElement).value)
      .toBe("https://example.com/new-draft");
    expect(screen.getByText("Poiminta epäonnistui")).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/admin/sources")).toHaveLength(1);
  });

  it("keeps a source draft through session expiry and sign-in, then clears it on explicit logout", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(overview))
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ status: "ok" }))
      .mockResolvedValueOnce(json(overview))
      .mockResolvedValueOnce(json({ status: "ok" }))
      .mockResolvedValueOnce(json({ status: "ok" }))
      .mockResolvedValueOnce(json(overview));
    render(<AdminPage />);
    fireEvent.change(await screen.findByLabelText("Ravintolan ruokalistasivu"), {
      target: { value: "https://example.com/draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lisää ja hae ruokalista" }));
    fireEvent.change(await screen.findByLabelText("Salasana"), { target: { value: "test-password" } });
    expect(screen.getByRole("alert").textContent).toContain("Istunto vanheni");
    fireEvent.click(screen.getByRole("button", { name: "Kirjaudu" }));
    const restored = await screen.findByLabelText("Ravintolan ruokalistasivu") as HTMLInputElement;
    expect(restored.value).toBe("https://example.com/draft");
    fireEvent.click(screen.getByRole("button", { name: "Kirjaudu ulos" }));
    fireEvent.change(await screen.findByLabelText("Salasana"), { target: { value: "test-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Kirjaudu" }));
    expect((await screen.findByLabelText("Ravintolan ruokalistasivu") as HTMLInputElement).value).toBe("");
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/admin/sources")).toHaveLength(1);
  });

  it("preserves the dashboard and source draft after a failed refresh, then recovers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(overview))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(json(overview));
    render(<AdminPage />);
    const source = await screen.findByLabelText("Ravintolan ruokalistasivu");
    fireEvent.change(source, { target: { value: "https://example.com/lounas" } });
    fireEvent.click(screen.getByRole("button", { name: "Päivitä tiedot" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Tarkista yhteys");
    expect(screen.getByRole("heading", { name: "Järjestelmän tila" })).toBeTruthy();
    expect((source as HTMLInputElement).value).toBe("https://example.com/lounas");
    fireEvent.click(screen.getByRole("button", { name: "Päivitä tiedot" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("refreshes persisted source diagnostics after processing fails and keeps the URL editable", async () => {
    const failedOverview: AdminOverview = {
      ...overview,
      sources: [{
        createdAt: overview.generatedAt, enabled: true, id: 1,
        lastError: "Ruokalistaa ei voitu poimia sivulta.", lastOutcome: "extraction_error",
        lastRunAt: overview.generatedAt, restaurantName: null, url: "https://example.com/draft",
      }],
    };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(overview))
      .mockResolvedValueOnce(json({ error: { message: "Lähteen käsittely epäonnistui. Tarkista virhe yhteenvedosta." } }, 422))
      .mockResolvedValueOnce(json(failedOverview));
    render(<AdminPage />);
    const source = await screen.findByLabelText("Ravintolan ruokalistasivu") as HTMLInputElement;
    fireEvent.change(source, { target: { value: "https://example.com/draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Lisää ja hae ruokalista" }));
    expect(await screen.findByText("Poiminta epäonnistui")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Lähteen käsittely epäonnistui");
    expect(source.value).toBe("https://example.com/draft");
    expect(source.disabled).toBe(false);
    expect(screen.getByText("Keräys vaatii huomiota")).toBeTruthy();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/admin/overview", "/api/admin/sources", "/api/admin/overview",
    ]);
  });

  it("keeps a failed login editable and describes its error in Finnish", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({}, 401))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<AdminPage />);
    const password = await screen.findByLabelText("Salasana");
    expect(document.activeElement).toBe(password);
    fireEvent.change(password, { target: { value: "test-only-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Kirjaudu" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Tarkista yhteys");
    expect((password as HTMLInputElement).value).toBe("test-only-password");
    expect((password as HTMLInputElement).disabled).toBe(false);
    expect(password.getAttribute("aria-describedby")).toBe("login-error");
  });

  it.each(["source", "feedback"])("distinguishes a saved %s from a failed overview refresh", async (operation) => {
    const data: AdminOverview = {
      ...overview,
      recentAssessments: [{
        assessedAt: overview.generatedAt, assessmentId: 1, feedbackDirection: null,
        menuText: "Kasviskeitto", rationale: "Monipuolinen lounas.", restaurantId: "vinola",
        restaurantName: "Vinola", score: 7, scores: { appeal: 7, distinctiveness: 7, value: 7, variety: 7 },
        serviceDate: "2026-07-14",
      }],
    };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(data))
      .mockResolvedValueOnce(json({ status: "ok" }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<AdminPage />);
    await screen.findByRole("heading", { name: "Järjestelmän tila" });
    if (operation === "source") {
      fireEvent.change(screen.getByLabelText("Ravintolan ruokalistasivu"), {
        target: { value: "https://example.com/lounas" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Lisää ja hae ruokalista" }));
    } else {
      fireEvent.click(screen.getByRole("button", { name: "Liian korkea" }));
    }
    expect((await screen.findByRole("alert")).textContent).toContain("Näytetään aiemmin ladatut tiedot");
    expect(screen.getByRole("status").textContent).toContain(
      operation === "source" ? "Lähde lisättiin" : "Palaute tallennettiin",
    );
    expect(screen.getByRole("heading", { name: "Järjestelmän tila" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    if (operation === "feedback") {
      const lower = screen.getByRole("button", { name: "Liian korkea" });
      expect(lower.getAttribute("aria-pressed")).toBe("true");
      fetchMock.mockResolvedValueOnce(json({ assessmentId: 1, direction: null }))
        .mockRejectedValueOnce(new TypeError("Failed to fetch"));
      fireEvent.click(lower);
      expect(await screen.findByText("Palaute poistettiin: Vinola.")).toBeTruthy();
      expect(lower.getAttribute("aria-pressed")).toBe("false");
      expect(JSON.parse(fetchMock.mock.calls[3]?.[1]?.body as string)).toEqual({ direction: null });
    }
  });

  it("explains empty calibration and disabled source states without raw status codes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({
      ...overview,
      sources: [{
        createdAt: "2026-07-14T05:00:00Z", enabled: false, id: 1,
        lastError: "Lähdesivua ei voitu lukea.", lastOutcome: "unrecognized_outcome",
        lastRunAt: null, restaurantName: "Vinola", url: "https://example.com/lounas",
      }],
    }));
    render(<AdminPage />);
    const dates = await screen.findByLabelText("Lounaspäivä");
    expect((dates as HTMLSelectElement).disabled).toBe(true);
    expect(dates.textContent).toBe("Ei arvioita");
    expect(screen.getByText("Ei käytössä")).toBeTruthy();
    expect(screen.getByText("Tuntematon tila")).toBeTruthy();
    fireEvent.click(screen.getByText("Viimeisimmän virheen tiedot"));
    expect(screen.getByText("Lähdesivua ei voitu lukea.")).toBeTruthy();
    expect(screen.queryByText("unrecognized_outcome")).toBeNull();
  });

  it("reports a failed collection instead of a healthy ready state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({
      ...overview,
      refresh: { ...overview.refresh, lastError: { at: overview.generatedAt, message: "Fetch failed", target: "source" } },
    }));
    render(<AdminPage />);
    expect(await screen.findByText("Keräys vaatii huomiota")).toBeTruthy();
    expect(screen.queryByText("Palvelu valmiina")).toBeNull();
    expect(screen.getByText("Epäonnistui")).toBeTruthy();
  });
});
