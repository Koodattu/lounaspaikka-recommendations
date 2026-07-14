import { type FormEvent, useEffect, useState } from "react";

import { formatUpdatedAt } from "./dates";
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
        <span className="eyebrow">Ylläpito</span>
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

function AdminDashboard({
  data,
  error,
  onLogout,
  onRefresh,
}: {
  data: AdminOverview;
  error: string | null;
  onLogout: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [sourceMessage, setSourceMessage] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);

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
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : "Lähteen lisäys epäonnistui.");
    } finally {
      await onRefresh();
      setAdding(false);
    }
  }

  return (
    <main className="admin-main">
      <section className="admin-hero">
        <div>
          <span className="eyebrow">Ylläpito</span>
          <h1>Järjestelmän tila</h1>
          <p>Keräyksen, ruokalistojen ja suositusten nopea yleiskuva.</p>
        </div>
        <div className="admin-actions">
          <button className="button admin-secondary-button" type="button" onClick={() => void onRefresh()}>
            Päivitä tiedot
          </button>
          <button className="button admin-secondary-button" type="button" onClick={() => void onLogout()}>
            Kirjaudu ulos
          </button>
        </div>
      </section>

      <section className="admin-status-strip" aria-label="Palvelun tila">
        <div>
          <span className={`status-dot ${data.refresh.running ? "status-dot-running" : "status-dot-ok"}`} />
          <strong>{data.refresh.running ? "Keräys käynnissä" : "Palvelu valmiina"}</strong>
        </div>
        <span>OpenAI {data.openAiConfigured ? "käytössä" : "ei käytössä"}</span>
        <span>Päivitetty {formatUpdatedAt(data.generatedAt)}</span>
      </section>
      {error && <p className="admin-inline-error" role="alert">{error}</p>}

      <section className="admin-count-grid" aria-label="Tietokannan luvut">
        {countLabels.map(([key, label]) => (
          <article className="admin-count-card" key={key}>
            <strong>{data.counts[key].toLocaleString("fi-FI")}</strong>
            <span>{label}</span>
          </article>
        ))}
      </section>

      <div className="admin-layout">
        <section className="admin-panel" aria-labelledby="source-add-title">
          <span className="eyebrow">Uusi lähde</span>
          <h2 id="source-add-title">Lisää ruokalistasivu</h2>
          <p>Anna julkinen HTTPS-sivu, jonka tekstissä ruokalista näkyy ilman kirjautumista. PDF- ja selainohjelmaa vaativia sivuja ei lueta.</p>
          <form className="admin-form" onSubmit={addSource}>
            <label htmlFor="menu-source-url">Ravintolan ruokalistasivu</label>
            <input
              id="menu-source-url"
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://ravintola.fi/lounas/"
              required
              type="url"
              value={url}
            />
            {sourceMessage && <p className="form-message form-message-ok" role="status">{sourceMessage}</p>}
            {sourceError && <p className="form-message form-message-error" role="alert">{sourceError}</p>}
            <button className="button button-accent" disabled={adding} type="submit">
              {adding ? "Haetaan ja luetaan…" : "Lisää ja hae ruokalista"}
            </button>
          </form>
        </section>

        <section className="admin-panel" aria-labelledby="crawler-title">
          <span className="eyebrow">Keräys</span>
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
            <p className="admin-inline-error">{data.refresh.lastError.message}</p>
          )}
        </section>
      </div>

      <section className="admin-panel admin-wide-panel" aria-labelledby="sources-title">
        <div className="admin-section-heading">
          <div>
            <span className="eyebrow">Sivulähteet</span>
            <h2 id="sources-title">Lisätyt ravintolat</h2>
          </div>
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
                  <a href={source.url} rel="noreferrer" target="_blank">{source.url}</a>
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
          <div>
            <span className="eyebrow">Virheet</span>
            <h2 id="errors-title">Viimeisimmät keräysvirheet</h2>
          </div>
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
                  <span>
                    {error.message ?? "Virheen lisätietoa ei ole saatavilla."}
                    {error.sourceUrl ? ` · ${error.sourceUrl}` : " · Lounaspaikka"}
                  </span>
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

  async function loadOverview(signal?: AbortSignal) {
    try {
      const overview = await adminRequest<AdminOverview>("/api/admin/overview", signal ? { signal } : undefined);
      setData(overview);
      setMessage(null);
      setMode("ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof AdminRequestError && error.status === 401) {
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
      await loadOverview();
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
        <AdminDashboard data={data} error={message} onLogout={logout} onRefresh={loadOverview} />
      )}
    </>
  );
}
