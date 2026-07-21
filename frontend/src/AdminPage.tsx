import { type FormEvent, useEffect, useState } from "react";

import { formatShortDate, formatUpdatedAt, todayInHelsinki } from "./dates";
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
  const response = await fetch(url, init);
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onLogin(password);
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="admin-main admin-login-main">
      <section className="admin-login-card">
        <h1>Kirjaudu ylläpitoon</h1>
        <p>Tarkista keräyksen tila ja lisää puuttuvia ruokalistasivuja.</p>
        <form className="admin-form" onSubmit={submit}>
          <label htmlFor="admin-password">Salasana</label>
          <input
            autoComplete="current-password"
            id="admin-password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
          {error && <p className="form-message form-message-error" role="alert">{error}</p>}
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

const assessmentScoreLabels: Array<[
  keyof AdminOverview["recentAssessments"][number]["scores"],
  string,
]> = [
  ["appeal", "Houkuttelevuus"],
  ["distinctiveness", "Erityisyys"],
  ["variety", "Vaihtelu"],
  ["value", "Hinta–laatu"],
];

function formatScore(value: number): string {
  return value.toLocaleString("fi-FI", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  });
}

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
  return outcome ? labels[outcome] ?? outcome : "Ei vielä haettu";
}

function ExternalLinkHint() {
  return <span className="visually-hidden"> (avautuu uuteen välilehteen)</span>;
}

function AdminDashboard({
  data,
  error,
  onLogout,
  onRefresh,
  onSessionExpired,
}: {
  data: AdminOverview;
  error: string | null;
  onLogout: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onSessionExpired: () => void;
}) {
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
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
  const [selectedAssessmentDate, setSelectedAssessmentDate] = useState(defaultAssessmentDate);
  const visibleAssessments = data.recentAssessments.filter(
    (assessment) => assessment.serviceDate === selectedAssessmentDate,
  );
  const busy = adding || loggingOut || refreshing || savingAssessmentId !== null;

  useEffect(() => {
    if (!assessmentDates.includes(selectedAssessmentDate)) {
      setSelectedAssessmentDate(defaultAssessmentDate);
    }
  }, [data.recentAssessments, defaultAssessmentDate, selectedAssessmentDate]);

  async function addSource(event: FormEvent) {
    event.preventDefault();
    setAdding(true);
    setSourceError(null);
    setSourceMessage(null);
    try {
      await adminRequest("/api/admin/sources", {
        body: JSON.stringify({ url }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      setUrl("");
      setSourceMessage("Lähde lisättiin ja ruokalista haettiin.");
      await onRefresh();
    } catch (error) {
      if (error instanceof AdminRequestError && error.status === 401) {
        onSessionExpired();
        return;
      }
      setSourceError(error instanceof Error ? error.message : "Lähteen lisäys epäonnistui.");
    } finally {
      setAdding(false);
    }
  }

  async function saveAssessmentFeedback(
    assessmentId: number,
    direction: "higher" | "lower" | null,
    restaurantName: string,
  ) {
    setSavingAssessmentId(assessmentId);
    setFeedbackError(null);
    setFeedbackMessage(null);
    try {
      await adminRequest(`/api/admin/assessments/${assessmentId}/feedback`, {
        body: JSON.stringify({ direction }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      });
      await onRefresh();
      setFeedbackMessage(
        direction
          ? `Palaute tallennettiin: ${restaurantName}.`
          : `Palaute poistettiin: ${restaurantName}.`,
      );
    } catch (error) {
      if (error instanceof AdminRequestError && error.status === 401) {
        onSessionExpired();
        return;
      }
      setFeedbackError(error instanceof Error ? error.message : "Palautetta ei saatu tallennettua.");
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
    <main className="admin-main">
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

      <section
        aria-busy={data.refresh.running || refreshing}
        aria-label="Palvelun tila"
        aria-live="polite"
        className="admin-status-strip"
      >
        <div>
          <span className={`status-dot ${data.refresh.running ? "status-dot-running" : "status-dot-ok"}`} />
          <strong>{data.refresh.running ? "Keräys käynnissä" : "Palvelu valmiina"}</strong>
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
          <h2 id="calibration-title">Arvioiden kalibrointi</h2>
          <div className="admin-calibration-toolbar">
            <label htmlFor="assessment-date">Lounaspäivä</label>
            <select
              disabled={assessmentDates.length === 0}
              id="assessment-date"
              onChange={(event) => {
                setSelectedAssessmentDate(event.target.value);
                setFeedbackMessage(null);
              }}
              value={selectedAssessmentDate}
            >
              {assessmentDates.map((serviceDate) => (
                <option key={serviceDate} value={serviceDate}>{formatShortDate(serviceDate)}</option>
              ))}
            </select>
            <span>
              {visibleAssessments.length === 1
                ? "1 arvio"
                : `${visibleAssessments.length} arviota`}
            </span>
          </div>
        </div>
        <p className="admin-calibration-intro">
          Valitse päivä ja merkitse, ovatko kokonaispisteet mielestäsi liian korkeat vai
          liian matalat. Palaute tallentuu arviointiohjeen seuraavaa kalibrointia varten
          eikä muuta julkaistua top 3:a heti. Poista valinta painamalla samaa palautetta
          uudelleen.
        </p>
        <details className="admin-score-help">
          <summary>Mitä osa-alueet tarkoittavat?</summary>
          <dl>
            <div><dt>Houkuttelevuus</dt><dd>Kuinka kiinnostavalta päivän ruoka vaikuttaa.</dd></div>
            <div><dt>Erityisyys</dt><dd>Kuinka selvästi menu erottuu tavallisesta lounaasta.</dd></div>
            <div><dt>Vaihtelu</dt><dd>Kuinka monta aidosti erilaista ateriaa on tarjolla.</dd></div>
            <div><dt>Hinta–laatu</dt><dd>Mitä ilmoitetulla hinnalla saa.</dd></div>
          </dl>
        </details>
        {feedbackError && <p className="admin-inline-error" role="alert">{feedbackError}</p>}
        {feedbackMessage && <p className="form-message form-message-ok" role="status">{feedbackMessage}</p>}
        {visibleAssessments.length === 0 ? (
          <p className="admin-empty">Aktiivisen arviointiversion arvioita ei ole vielä.</p>
        ) : (
          <ul className="admin-assessment-list">
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
                        onClick={() => void saveAssessmentFeedback(
                          assessment.assessmentId,
                          assessment.feedbackDirection === "lower" ? null : "lower",
                          assessment.restaurantName,
                        )}
                        type="button"
                      >
                        Liian korkea
                      </button>
                      <button
                        aria-pressed={assessment.feedbackDirection === "higher"}
                        className="admin-feedback-button"
                        data-direction="higher"
                        disabled={busy}
                        onClick={() => void saveAssessmentFeedback(
                          assessment.assessmentId,
                          assessment.feedbackDirection === "higher" ? null : "higher",
                          assessment.restaurantName,
                        )}
                        type="button"
                      >
                        Liian matala
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="admin-layout">
        <section className="admin-panel" aria-labelledby="source-add-title">
          <h2 id="source-add-title">Lisää ruokalistasivu</h2>
          <p>Anna julkinen HTTPS-sivu, jonka tekstissä ruokalista näkyy ilman kirjautumista. PDF- ja selainohjelmaa vaativia sivuja ei lueta.</p>
          <form className="admin-form" onSubmit={addSource}>
            <label htmlFor="menu-source-url">Ravintolan ruokalistasivu</label>
            <input
              aria-describedby="menu-source-hint"
              autoCapitalize="none"
              autoCorrect="off"
              disabled={busy}
              id="menu-source-url"
              inputMode="url"
              maxLength={2048}
              onChange={(event) => setUrl(event.target.value)}
              pattern="https://.*"
              placeholder="https://ravintola.fi/lounas/"
              required
              spellCheck={false}
              title="Anna täydellinen HTTPS-osoite."
              type="url"
              value={url}
            />
            <small className="field-hint" id="menu-source-hint">
              Osoitteen pitää alkaa https:// ja olla enintään 2048 merkkiä.
            </small>
            {sourceMessage && <p className="form-message form-message-ok" role="status">{sourceMessage}</p>}
            {sourceError && <p className="form-message form-message-error" role="alert">{sourceError}</p>}
            <button className="button button-dark" disabled={busy} type="submit">
              {adding ? "Haetaan ja luetaan…" : "Lisää ja hae ruokalista"}
            </button>
          </form>
        </section>

        <section className="admin-panel" aria-labelledby="crawler-title">
          <h2 id="crawler-title">Viimeisin ajo</h2>
          <dl className="admin-detail-list">
            <div><dt>Tila</dt><dd>{data.refresh.running ? "Käynnissä" : "Valmis"}</dd></div>
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
          <h2 id="sources-title">Lisätyt ravintolat</h2>
          <span>{data.sources.length} lähdettä</span>
        </div>
        {data.sources.length === 0 ? (
          <p className="admin-empty">Sivulähteitä ei ole vielä lisätty.</p>
        ) : (
          <ul className="admin-source-list">
            {data.sources.map((source) => (
              <li key={source.id}>
                <div>
                  <strong>{source.restaurantName ?? "Nimeä ei vielä löytynyt"}</strong>
                  <a href={source.url} rel="noreferrer" target="_blank">
                    <span>{source.url}</span>
                    <span aria-hidden="true">↗</span>
                    <ExternalLinkHint />
                  </a>
                </div>
                <div className="admin-source-state">
                  <span>{outcomeLabel(source.lastOutcome)}</span>
                  <small>{timeOrDash(source.lastRunAt)}</small>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="admin-panel admin-wide-panel" aria-labelledby="errors-title">
        <div className="admin-section-heading">
          <h2 id="errors-title">Viimeisimmät keräysvirheet</h2>
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
                  <span>Tarkista lähdesivu ja päivitä tiedot, kun sivu on jälleen luettavissa.</span>
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
      setMessage(error instanceof Error ? error.message : "Ylläpitotietoja ei saatu ladattua.");
      setMode("error");
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

  return (
    <>
      <AdminHeader />
      {mode === "login" && <LoginPanel error={message} onLogin={login} />}
      {mode === "loading" && (
        <main className="admin-main"><div className="state-panel" role="status">Ylläpitoa ladataan…</div></main>
      )}
      {(mode === "disabled" || mode === "error") && (
        <main className="admin-main">
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
          onLogout={logout}
          onRefresh={loadOverview}
          onSessionExpired={sessionExpired}
        />
      )}
    </>
  );
}
