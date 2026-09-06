import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  beforeEach(() => vi.restoreAllMocks());

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
