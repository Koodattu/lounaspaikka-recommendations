import { type FormEvent, useEffect, useRef, useState } from "react";

import { formatShortDate, formatUpdatedAt, todayInHelsinki } from "./dates";
import { assessmentScoreLabels, formatScore } from "./scores";
import type { AdminOverview } from "./types";

class AdminRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function adminRequest<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("Yhteyttä ei saatu muodostettua. Tarkista yhteys ja yritä uudelleen.");
  }
  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null;
  if (!response.ok) {
    throw new AdminRequestError(
      payload?.error?.message ?? "Pyyntö epäonnistui.",
      response.status,
    );
  }
  return payload as T;
}

function AdminHeader() {
  return (
    <header className="app-header admin-header">
      <a className="skip-link" href="#main-content">Siirry sisältöön</a>
      <a className="brand" href="/" aria-label="Mihin lounaalle? – etusivu">
        <span className="brand-mark" aria-hidden="true">M</span>
        <span>Mihin lounaalle?</span>
      </a>
      <span className="admin-badge">Ylläpito</span>
    </header>
  );
}

function LoginPanel({
  error,
  onLogin,
}: {
  error: string | null;
  onLogin: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const passwordInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    passwordInput.current?.focus();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onLogin(password);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="admin-main admin-login-main" id="main-content" tabIndex={-1}>
      <section className="admin-login-card">
        <h1>Kirjaudu ylläpitoon</h1>
        <p>Tarkista keräyksen tila ja lisää puuttuvia ruokalistasivuja.</p>
        <form className="admin-form" onSubmit={submit}>
          <label htmlFor="admin-password">Salasana</label>
          <input
            aria-describedby={error ? "login-error" : undefined}
            autoComplete="current-password"
            disabled={submitting}
            id="admin-password"
            ref={passwordInput}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
          {error && <p className="form-message form-message-error" id="login-error" role="alert">{error}</p>}
          <button className="button button-dark" disabled={submitting} type="submit">
            {submitting ? "Kirjaudutaan…" : "Kirjaudu"}
          </button>
        </form>
      </section>
    </main>
  );
}

const countLabels: Array<[keyof AdminOverview["counts"], string]> = [
  ["restaurants", "Ravintoloita"],
  ["customSources", "Sivulähteitä"],
  ["fetches", "Hakuyrityksiä"],
  ["offeringRevisions", "Ruokalistaversioita"],
  ["assessments", "Arvioita"],
  ["recommendationSets", "Suosituspäiviä"],
];

function timeOrDash(value: string | null): string {
  return value ? formatUpdatedAt(value) : "–";
}

function outcomeLabel(outcome: string | null): string {
  const labels: Record<string, string> = {
    extraction_error: "Poiminta epäonnistui",
    http_error: "Verkkosivu vastasi virheellä",
    invalid_response: "Sivua ei voitu lukea",
    network_error: "Verkkoyhteys epäonnistui",
    partial_error: "Osittainen virhe",
    running: "Käynnissä",
    success: "Onnistui",
    unchanged: "Ei muutoksia",
  };
  return outcome ? labels[outcome] ?? "Tuntematon tila" : "Ei vielä haettu";
}

function ExternalLinkHint() {
  return <span className="visually-hidden"> (avautuu uuteen välilehteen)</span>;
}

function AdminDashboard({
  data,
  error,
  onFeedbackSaved,
  onLogout,
  onRefresh,
  onSessionExpired,
  onSourceEnabled,
  onSourceFetched,
  onSourceUrlChange,
  sourceUrl,
}: {
  data: AdminOverview;
  error: string | null;
  onFeedbackSaved: (assessmentId: number, direction: "higher" | "lower" | null) => void;
  onLogout: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onSessionExpired: () => void;
  onSourceEnabled: (sourceId: number, enabled: boolean) => void;
  onSourceFetched: (sourceId: number) => void;
  onSourceUrlChange: (url: string) => void;
  sourceUrl: string;
}) {
  const [sourceAction, setSourceAction] = useState<number | "new" | null>(null);
  const [changingSourceId, setChangingSourceId] = useState<number | null>(null);
  const actionControl = useRef<HTMLButtonElement | null>(null);
  const [sourceResult, setSourceResult] = useState<{ sourceId: number; error: boolean; message: string } | null>(null);
  const adding = sourceAction === "new";
  const [feedbackResult, setFeedbackResult] = useState<{ assessmentId: number; error: boolean; message: string } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savingAssessmentId, setSavingAssessmentId] = useState<number | null>(null);
  const [sourceMessage, setSourceMessage] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const assessmentDates = Array.from(
    new Set(data.recentAssessments.map((assessment) => assessment.serviceDate)),
  ).sort((a, b) => b.localeCompare(a));
  const today = todayInHelsinki();
  const defaultAssessmentDate = assessmentDates.includes(today)
    ? today
    : assessmentDates[0] ?? "";
  const [requestedAssessmentDate, setRequestedAssessmentDate] = useState(
    () => new URLSearchParams(window.location.search).get("date") ?? "",
  );
  const [assessmentQuery, setAssessmentQuery] = useState(
    () => new URLSearchParams(window.location.search).get("q") ?? "",
  );
  const assessmentSearch = useRef<HTMLInputElement>(null);
  const selectedAssessmentDate = assessmentDates.includes(requestedAssessmentDate)
    ? requestedAssessmentDate : defaultAssessmentDate;
  const dayAssessments = data.recentAssessments.filter(
    (assessment) => assessment.serviceDate === selectedAssessmentDate,
  );
  const searchTerms = assessmentQuery.trim().toLocaleLowerCase("fi-FI").split(/\s+/).filter(Boolean);
  const visibleAssessments = dayAssessments.filter((assessment) => {
    const text = `${assessment.restaurantName} ${assessment.menuText ?? ""}`.toLocaleLowerCase("fi-FI");
    return searchTerms.every((term) => text.includes(term));
  });
  const busy = sourceAction !== null || changingSourceId !== null || loggingOut || refreshing || savingAssessmentId !== null;
  const needsAttention = Boolean(
    data.refresh.lastError
    || data.sources.some((source) => source.enabled && source.lastError)
    || (data.latestFetch.outcome && data.latestFetch.outcome !== "success"),
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedAssessmentDate) url.searchParams.set("date", selectedAssessmentDate);
    else url.searchParams.delete("date");
    if (assessmentQuery) url.searchParams.set("q", assessmentQuery);
    else url.searchParams.delete("q");
    window.history.replaceState(window.history.state, "", url);
  }, [selectedAssessmentDate, requestedAssessmentDate, assessmentQuery]);

  useEffect(() => {
    const syncReview = () => {
      const params = new URLSearchParams(window.location.search);
      setRequestedAssessmentDate(params.get("date") ?? "");
      setAssessmentQuery(params.get("q") ?? "");
      setFeedbackResult(null);
    };
    window.addEventListener("popstate", syncReview);
    return () => window.removeEventListener("popstate", syncReview);
  }, []);

  useEffect(() => {
    if (sourceAction !== null || changingSourceId !== null || savingAssessmentId !== null || !actionControl.current) return;
    // Browsers can blur a focused button while it is disabled during a save.
    // Restore it only if the user has not moved focus elsewhere meanwhile.
    if (document.activeElement === document.body) actionControl.current.focus();
    actionControl.current = null;
  }, [sourceAction, changingSourceId, savingAssessmentId]);

  async function addSource(event: FormEvent) {
    event.preventDefault();
    await fetchSource(sourceUrl);
  }

  async function fetchSource(url: string, sourceId?: number, control?: HTMLButtonElement) {
    actionControl.current = control ?? null;
    setSourceAction(sourceId ?? "new");
    if (sourceId === undefined) {
      setSourceError(null);
      setSourceMessage(null);
    } else {
      setSourceResult(null);
    }
    try {
      await adminRequest("/api/admin/sources", {
        body: JSON.stringify({ url }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (sourceId === undefined) {
        onSourceUrlChange("");
        setSourceMessage("Lähde lisättiin ja ruokalista haettiin.");
      } else {
        onSourceFetched(sourceId);
        setSourceResult({ sourceId, error: false, message: "Ruokalista haettiin uudelleen." });
      }
      await onRefresh();
    } catch (error) {
      if (error instanceof AdminRequestError && error.status === 401) {
        onSessionExpired();
        return;
      }
      const message = error instanceof Error ? error.message : "Ruokalistan haku epäonnistui.";
      if (sourceId === undefined) setSourceError(message);
      else setSourceResult({ sourceId, error: true, message });
      if (error instanceof AdminRequestError && error.status === 422) {
        await onRefresh();
      }
    } finally {
      setSourceAction(null);
    }
  }

  async function setSourceEnabled(source: AdminOverview["sources"][number], control: HTMLButtonElement) {
    actionControl.current = control;
    setChangingSourceId(source.id);
    setSourceResult(null);
    try {
      const result = await adminRequest<{ sourceId: number; enabled: boolean }>(`/api/admin/sources/${source.id}`, {
        body: JSON.stringify({ enabled: !source.enabled }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      onSourceEnabled(result.sourceId, result.enabled);
      setSourceResult({
        sourceId: source.id,
        error: false,
        message: result.enabled
          ? "Lähde otettiin käyttöön. Voit hakea ruokalistan nyt tai odottaa seuraavaa keräystä."
          : "Lähde poistettiin käytöstä. Sen ruokalistoja ei näytetä lounaslistalla eikä sivua haeta automaattisesti.",
      });
      await onRefresh();
    } catch (error) {
      if (error instanceof AdminRequestError && error.status === 401) {
        onSessionExpired();
        return;
      }
      setSourceResult({
        sourceId: source.id, error: true,
        message: error instanceof Error ? error.message : "Lähteen tilaa ei saatu tallennettua.",
      });
    } finally {
      setChangingSourceId(null);
    }
  }

  async function saveAssessmentFeedback(
    assessmentId: number,
    direction: "higher" | "lower" | null,
    restaurantName: string,
    control: HTMLButtonElement,
  ) {
    actionControl.current = control;
    setSavingAssessmentId(assessmentId);
    setFeedbackResult(null);
    try {
      await adminRequest(`/api/admin/assessments/${assessmentId}/feedback`, {
        body: JSON.stringify({ direction }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      });
      onFeedbackSaved(assessmentId, direction);
      setFeedbackResult({
        assessmentId,
        error: false,
        message: direction
          ? `Palaute tallennettiin: ${restaurantName}.`
          : `Palaute poistettiin: ${restaurantName}.`,
      });
      await onRefresh();
    } catch (error) {
      if (error instanceof AdminRequestError && error.status === 401) {
        onSessionExpired();
        return;
      }
      setFeedbackResult({
        assessmentId,
        error: true,
        message: error instanceof Error ? error.message : "Palautetta ei saatu tallennettua.",
      });
    } finally {
      setSavingAssessmentId(null);
    }
  }

  async function refreshOverview() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  async function logout() {
    setLoggingOut(true);
    try {
      await onLogout();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <main className="admin-main" id="main-content" tabIndex={-1}>
      <section className="admin-hero">
        <div>
          <h1>Järjestelmän tila</h1>
          <p>Näe poikkeamat, tarkista arviot ja pidä ruokalähteet kunnossa.</p>
        </div>
        <div className="admin-actions">
          <button
            className="button admin-secondary-button"
            disabled={busy}
            type="button"
            onClick={() => void refreshOverview()}
          >
            {refreshing ? "Päivitetään…" : "Päivitä tiedot"}
          </button>
          <button
            className="button admin-secondary-button"
            disabled={busy}
            type="button"
            onClick={() => void logout()}
          >
            {loggingOut ? "Kirjaudutaan ulos…" : "Kirjaudu ulos"}
          </button>
        </div>
      </section>

      <nav className="admin-section-nav" aria-label="Ylläpidon osiot">
        <a href="#calibration-title">Arviot</a>
        <a href="#source-add-title">Lisää lähde</a>
        <a href="#sources-title">Lisätyt ravintolat</a>
        <a href="#errors-title">Keräysvirheet</a>
      </nav>

      <section
        aria-busy={data.refresh.running || refreshing}
        aria-label="Palvelun tila"
        aria-live="polite"
        className="admin-status-strip"
      >
        <div>
          <span aria-hidden="true" className={`status-dot ${data.refresh.running ? "status-dot-running" : needsAttention ? "status-dot-error" : "status-dot-ok"}`} />
          <strong>{data.refresh.running ? "Keräys käynnissä" : needsAttention ? "Keräys vaatii huomiota" : "Palvelu valmiina"}</strong>
        </div>
        <span>Arviointi {data.openAiConfigured ? "käytössä" : "ei käytössä"}</span>
        <span>Päivitetty {formatUpdatedAt(data.generatedAt)}</span>
      </section>
      {error && <p className="admin-inline-error" role="alert">{error}</p>}
      {data.refresh.lastError && (
        <p className="admin-inline-error admin-priority-error" role="alert">
          <strong>Viimeisin keräys epäonnistui.</strong>{" "}
          Tarkista keräysvirheet alempaa ja päivitä tiedot korjauksen jälkeen.
        </p>
      )}

      <details className="admin-metrics">
        <summary>Yhteenvetoluvut</summary>
        <section className="admin-count-grid" aria-label="Tietokannan luvut">
          {countLabels.map(([key, label]) => (
            <article className="admin-count-card" key={key}>
              <strong>{data.counts[key].toLocaleString("fi-FI")}</strong>
              <span>{label}</span>
            </article>
          ))}
        </section>
      </details>

      <section className="admin-panel admin-wide-panel" aria-labelledby="calibration-title">
        <div className="admin-section-heading admin-calibration-heading">
          <h2 id="calibration-title" tabIndex={-1}>Arvioiden kalibrointi</h2>
          <div className="admin-calibration-toolbar">
            <label htmlFor="assessment-date">Lounaspäivä</label>
            <select
              disabled={assessmentDates.length === 0 || savingAssessmentId !== null}
              id="assessment-date"
              onChange={(event) => {
                setRequestedAssessmentDate(event.target.value);
                setFeedbackResult(null);
              }}
              value={selectedAssessmentDate}
            >
              {assessmentDates.length === 0 && <option value="">Ei arvioita</option>}
              {assessmentDates.map((serviceDate) => (
                <option key={serviceDate} value={serviceDate}>{formatShortDate(serviceDate)}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="admin-calibration-intro">
          Palaute tallentuu seuraavaa kalibrointia varten eikä muuta julkaistua top 3:a.
          Poista palaute painamalla samaa valintaa uudelleen.
        </p>
        <details className="admin-score-help">
          <summary>Mitä osa-alueet tarkoittavat?</summary>
          <dl>
            <div><dt>Houkuttelevuus</dt><dd>Kuinka kiinnostavalta päivän ruoka vaikuttaa.</dd></div>
            <div><dt>Omaleimaisuus</dt><dd>Kuinka selvästi menu erottuu tavallisesta lounaasta.</dd></div>
            <div><dt>Vaihtelu</dt><dd>Kuinka monta aidosti erilaista ateriaa on tarjolla.</dd></div>
            <div><dt>Hinta–laatu</dt><dd>Mitä ilmoitetulla hinnalla saa.</dd></div>
          </dl>
        </details>
        <div className="menu-search" role="search" aria-label="Arvioiden haku">
          <label htmlFor="assessment-search">Hae arviota</label>
          <div className="menu-search-controls">
            <input
              aria-controls="assessment-results"
              autoComplete="off"
              disabled={savingAssessmentId !== null}
              id="assessment-search"
              onChange={(event) => setAssessmentQuery(event.target.value)}
              placeholder="Ravintola tai ruoka"
              ref={assessmentSearch}
              type="search"
              value={assessmentQuery}
            />
            {assessmentQuery && (
              <button className="button" disabled={savingAssessmentId !== null} type="button" onClick={() => {
                setAssessmentQuery("");
                assessmentSearch.current?.focus();
              }}>
                Tyhjennä arviohaku
              </button>
            )}
          </div>
          <span className="muted" aria-live="polite" aria-atomic="true">
            {searchTerms.length > 0
              ? `${visibleAssessments.length} / ${dayAssessments.length} arviota`
              : visibleAssessments.length === 1 ? "1 arvio" : `${visibleAssessments.length} arviota`}
          </span>
        </div>
        {visibleAssessments.length === 0 ? (
          <p className="admin-empty" id="assessment-results">{dayAssessments.length > 0
            ? "Haulla ei löytynyt arvioita. Kokeile toista hakusanaa tai tyhjennä haku."
            : "Aktiivisen arviointiversion arvioita ei ole vielä."}</p>
        ) : (
          <ul className="admin-assessment-list" id="assessment-results">
            {visibleAssessments.map((assessment) => {
              const saving = savingAssessmentId === assessment.assessmentId;
              return (
                <li aria-busy={saving} key={assessment.assessmentId}>
                  <div className="admin-assessment-summary">
                    <div className="admin-assessment-heading">
                      <div>
                        <strong>{assessment.restaurantName}</strong>
                        <span>
                          {formatShortDate(assessment.serviceDate)} · arvioitu {formatUpdatedAt(assessment.assessedAt)}
                        </span>
                      </div>
                      <strong className="admin-assessment-total" aria-label={`Kokonaispisteet ${formatScore(assessment.score)} / 10`}>
                        {formatScore(assessment.score)}<small>/10</small>
                      </strong>
                    </div>
                    <dl className="admin-score-breakdown">
                      {assessmentScoreLabels.map(([key, label]) => (
                        <div key={key}>
                          <dt>{label}</dt>
                          <dd>{formatScore(assessment.scores[key])}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="admin-assessment-rationale">{assessment.rationale}</p>
                    {assessment.menuText && (
                      <details className="admin-assessment-menu">
                        <summary>Näytä arvioitu ruokalista</summary>
                        <p>{assessment.menuText}</p>
                      </details>
                    )}
                  </div>
                  <div className="admin-feedback-control">
                    <span>{saving ? "Tallennetaan…" : "Oma arvio"}</span>
                    <div role="group" aria-label={`Oma arvio: ${assessment.restaurantName}, ${formatShortDate(assessment.serviceDate)}`}>
                      <button
                        aria-pressed={assessment.feedbackDirection === "lower"}
                        className="admin-feedback-button"
                        data-direction="lower"
                        disabled={busy}
                        onClick={(event) => void saveAssessmentFeedback(
                          assessment.assessmentId,
                          assessment.feedbackDirection === "lower" ? null : "lower",
                          assessment.restaurantName,
                          event.currentTarget,
                        )}
                        type="button"
                      >
                        {assessment.feedbackDirection === "lower" && <span aria-hidden="true">✓ </span>}
                        Liian korkea
                      </button>
                      <button
                        aria-pressed={assessment.feedbackDirection === "higher"}
                        className="admin-feedback-button"
                        data-direction="higher"
                        disabled={busy}
                        onClick={(event) => void saveAssessmentFeedback(
                          assessment.assessmentId,
                          assessment.feedbackDirection === "higher" ? null : "higher",
                          assessment.restaurantName,
                          event.currentTarget,
                        )}
                        type="button"
                      >
                        {assessment.feedbackDirection === "higher" && <span aria-hidden="true">✓ </span>}
                        Liian matala
                      </button>
                    </div>
                    {feedbackResult?.assessmentId === assessment.assessmentId && (
                      <p
                        className={`form-message ${feedbackResult.error ? "form-message-error" : "form-message-ok"}`}
                        role={feedbackResult.error ? "alert" : "status"}
                      >
                        {feedbackResult.message}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="admin-layout">
        <section className="admin-panel" aria-labelledby="source-add-title">
          <h2 id="source-add-title" tabIndex={-1}>Lisää ruokalistasivu</h2>
          <p>Anna ravintolan julkinen ruokalistasivu. Ruokalistan pitää näkyä sivun tekstissä ilman kirjautumista. PDF-tiedostoja tai vasta sivun avaamisen jälkeen latautuvia ruokalistoja ei voida lukea.</p>
          <form className="admin-form" onSubmit={addSource}>
            <label htmlFor="menu-source-url">Ravintolan ruokalistasivu</label>
            <input
              aria-describedby={sourceError ? "menu-source-hint menu-source-error" : "menu-source-hint"}
              autoCapitalize="none"
              autoCorrect="off"
              disabled={busy}
              id="menu-source-url"
              inputMode="url"
              maxLength={2048}
              onChange={(event) => onSourceUrlChange(event.target.value)}
              pattern="https://.*"
              placeholder="https://ravintola.fi/lounas/"
              required
              spellCheck={false}
              title="Anna täydellinen HTTPS-osoite."
              type="url"
              value={sourceUrl}
            />
            <small className="field-hint" id="menu-source-hint">
              Osoitteen pitää alkaa https:// ja olla enintään 2048 merkkiä.
            </small>
            {sourceMessage && <p className="form-message form-message-ok" role="status">{sourceMessage}</p>}
            {sourceError && <p className="form-message form-message-error" id="menu-source-error" role="alert">{sourceError}</p>}
            <button className="button button-dark" disabled={busy} type="submit">
              {adding ? "Haetaan ja luetaan…" : "Lisää ja hae ruokalista"}
            </button>
          </form>
        </section>

        <section className="admin-panel" aria-labelledby="crawler-title">
          <h2 id="crawler-title">Viimeisin ajo</h2>
          <p>Hakutiedot koskevat käytössä olevia lähteitä.</p>
          <dl className="admin-detail-list">
            <div><dt>Tila</dt><dd>{data.refresh.running ? "Käynnissä" : data.refresh.lastError ? "Epäonnistui" : data.refresh.lastFinishedAt ? "Valmis" : "Ei vielä ajettu"}</dd></div>
            <div><dt>Kohde</dt><dd>{data.refresh.currentTarget === "finalization" ? "Viimeistely" : data.refresh.currentTarget ?? "–"}</dd></div>
            <div><dt>Valmistui</dt><dd>{timeOrDash(data.refresh.lastFinishedAt)}</dd></div>
            <div><dt>Viimeisin haku</dt><dd>{timeOrDash(data.latestFetch.attemptedAt)}</dd></div>
            <div><dt>Hakutulos</dt><dd>{outcomeLabel(data.latestFetch.outcome)}</dd></div>
            <div><dt>Käynnissäoloaika</dt><dd>{Math.floor(data.uptimeSeconds / 60).toLocaleString("fi-FI")} min</dd></div>
          </dl>
          {data.refresh.lastError && (
            <details className="admin-error-details">
              <summary>Virheen tekniset tiedot</summary>
              <p>{data.refresh.lastError.message}</p>
            </details>
          )}
        </section>
      </div>

      <section className="admin-panel admin-wide-panel" aria-labelledby="sources-title">
        <div className="admin-section-heading">
          <h2 id="sources-title" tabIndex={-1}>Lisätyt ravintolat</h2>
          <span>{data.sources.length} {data.sources.length === 1 ? "lähde" : "lähdettä"}</span>
        </div>
        <p>Poista lähde käytöstä, kun sitä ei pidä hakea tai näyttää lounaslistalla. Aiemmat tiedot säilyvät, ja voit ottaa lähteen takaisin käyttöön.</p>
        {data.sources.length === 0 ? (
          <p className="admin-empty">Sivulähteitä ei ole vielä lisätty.</p>
        ) : (
          <ul className="admin-source-list">
            {data.sources.map((source) => (
              <li key={source.id} aria-busy={sourceAction === source.id || changingSourceId === source.id}>
                <div>
                  <strong>{source.restaurantName ?? "Nimeä ei vielä löytynyt"}</strong>
                  <a href={source.url} rel="noreferrer" target="_blank">
                    <span>{source.url}</span>
                    <span aria-hidden="true">↗</span>
                    <ExternalLinkHint />
                  </a>
                </div>
                <div className="admin-source-state">
                  {!source.enabled && <strong>Ei käytössä</strong>}
                  <span>{outcomeLabel(source.lastOutcome)}</span>
                  <small>{timeOrDash(source.lastRunAt)}</small>
                  {source.enabled && (
                    <button
                      className="button admin-secondary-button"
                      type="button"
                      aria-label={`Hae uudelleen: ${source.restaurantName ?? source.url}`}
                      disabled={busy}
                      onClick={(event) => void fetchSource(source.url, source.id, event.currentTarget)}
                    >
                      {sourceAction === source.id ? "Haetaan…" : "Hae uudelleen"}
                    </button>
                  )}
                  <button
                    className="button admin-secondary-button"
                    type="button"
                    aria-label={`${source.enabled ? "Poista käytöstä" : "Ota käyttöön"}: ${source.restaurantName ?? source.url}`}
                    disabled={busy}
                    onClick={(event) => void setSourceEnabled(source, event.currentTarget)}
                  >
                    {changingSourceId === source.id ? "Tallennetaan…" : source.enabled ? "Poista käytöstä" : "Ota käyttöön"}
                  </button>
                </div>
                {sourceResult?.sourceId === source.id && (
                  <p
                    className={`admin-source-result form-message ${sourceResult.error ? "form-message-error" : "form-message-ok"}`}
                    role={sourceResult.error ? "alert" : "status"}
                  >
                    {sourceResult.message}
                  </p>
                )}
                {source.lastError && (
                  <details className="admin-error-details admin-source-error">
                    <summary>Viimeisimmän virheen tiedot</summary>
                    <p>{source.lastError}</p>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="admin-panel admin-wide-panel" aria-labelledby="errors-title">
        <div className="admin-section-heading">
          <h2 id="errors-title" tabIndex={-1}>Viimeisimmät keräysvirheet</h2>
          <span>Enintään 20</span>
        </div>
        {data.errors.length === 0 ? (
          <p className="admin-empty">Tallennettuja keräysvirheitä ei ole.</p>
        ) : (
          <ul className="admin-error-list">
            {data.errors.map((error) => (
              <li key={error.id}>
                <div>
                  <strong>{outcomeLabel(error.outcome)}</strong>
                  <span>{error.sourceUrl
                    ? "Tarkista lähdesivu ja sen tila Lisätyt ravintolat -osiosta."
                    : "Hakua yritetään uudelleen seuraavassa ajastetussa keräyksessä."}</span>
                  <details className="admin-error-details admin-error-row-details">
                    <summary>Tekniset tiedot</summary>
                    <p>{error.message ?? "Virheen lisätietoa ei ole saatavilla."}</p>
                    {error.sourceUrl && (
                      <a href={error.sourceUrl} rel="noreferrer" target="_blank">
                        Avaa lähdesivu <span aria-hidden="true">↗</span>
                        <ExternalLinkHint />
                      </a>
                    )}
                  </details>
                </div>
                <div>
                  <span>{error.affectedDateCount > 1 ? `${error.affectedDateCount} päivää` : error.serviceDate}</span>
                  <small>{formatUpdatedAt(error.occurredAt)}</small>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export function AdminPage() {
  const [mode, setMode] = useState<"disabled" | "error" | "loading" | "login" | "ready">("loading");
  const [data, setData] = useState<AdminOverview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");

  async function loadOverview(signal?: AbortSignal, unauthorizedMessage?: string) {
    try {
      const overview = await adminRequest<AdminOverview>("/api/admin/overview", signal ? { signal } : undefined);
      setData(overview);
      setMessage(null);
      setMode("ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof AdminRequestError && error.status === 401) {
        setMessage(
          unauthorizedMessage
            ?? (data ? "Istunto vanheni. Kirjaudu uudelleen jatkaaksesi." : null),
        );
        setData(null);
        setMode("login");
        return;
      }
      if (error instanceof AdminRequestError && error.status === 503) {
        setMessage(error.message);
        setMode("disabled");
        return;
      }
      setMessage(data
        ? "Tietoja ei saatu päivitettyä. Näytetään aiemmin ladatut tiedot. Tarkista yhteys ja yritä uudelleen."
        : error instanceof Error ? error.message : "Ylläpitotietoja ei saatu ladattua.");
      setMode(data ? "ready" : "error");
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadOverview(controller.signal);
    return () => controller.abort();
  }, []);

  async function login(password: string) {
    try {
      await adminRequest("/api/admin/login", {
        body: JSON.stringify({ password }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      setMessage(null);
      await loadOverview(undefined, "Kirjautuminen ei valmistunut. Yritä uudelleen.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Kirjautuminen epäonnistui.");
    }
  }

  async function logout() {
    try {
      await adminRequest("/api/admin/logout", { method: "POST" });
      setData(null);
      setMessage(null);
      setSourceUrl("");
      setMode("login");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Uloskirjautuminen epäonnistui.");
    }
  }

  function sessionExpired() {
    setData(null);
    setMessage("Istunto vanheni. Kirjaudu uudelleen jatkaaksesi.");
    setMode("login");
  }

  function feedbackSaved(assessmentId: number, direction: "higher" | "lower" | null) {
    setData((current) => current ? {
      ...current,
      recentAssessments: current.recentAssessments.map((assessment) =>
        assessment.assessmentId === assessmentId
          ? { ...assessment, feedbackDirection: direction }
          : assessment,
      ),
    } : current);
  }

  function sourceFetched(sourceId: number) {
    setData((current) => current ? {
      ...current,
      sources: current.sources.map((source) => source.id === sourceId
        // The POST confirms success but provides no timestamp. The overview supplies it.
        ? { ...source, lastOutcome: "success", lastError: null, lastRunAt: null }
        : source),
    } : current);
  }

  function sourceEnabled(sourceId: number, enabled: boolean) {
    setData((current) => current ? {
      ...current,
      sources: current.sources.map((source) => source.id === sourceId ? { ...source, enabled } : source),
    } : current);
  }

  return (
    <>
      <AdminHeader />
      {mode === "login" && <LoginPanel error={message} onLogin={login} />}
      {mode === "loading" && (
        <main className="admin-main" id="main-content" tabIndex={-1}><div className="state-panel" role="status">Ylläpitoa ladataan…</div></main>
      )}
      {(mode === "disabled" || mode === "error") && (
        <main className="admin-main" id="main-content" tabIndex={-1}>
          <div className="state-panel state-panel-error" role="alert">
            <h1>{mode === "disabled" ? "Ylläpito ei ole käytössä" : "Ylläpitoa ei saatu ladattua"}</h1>
            <p>{message}</p>
            {mode === "error" && (
              <button className="button button-dark" type="button" onClick={() => void loadOverview()}>
                Yritä uudelleen
              </button>
            )}
          </div>
        </main>
      )}
      {mode === "ready" && data && (
        <AdminDashboard
          data={data}
          error={message}
          onFeedbackSaved={feedbackSaved}
          onLogout={logout}
          onRefresh={loadOverview}
          onSessionExpired={sessionExpired}
          onSourceEnabled={sourceEnabled}
          onSourceFetched={sourceFetched}
          onSourceUrlChange={setSourceUrl}
          sourceUrl={sourceUrl}
        />
      )}
    </>
  );
}
