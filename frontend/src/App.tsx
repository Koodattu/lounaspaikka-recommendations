import { useEffect, useState } from "react";

import { AdminPage } from "./AdminPage";
import { fetchJson } from "./api";
import {
  addDays,
  formatLongDate,
  formatShortDate,
  formatUpdatedAt,
  isIsoDate,
  startOfWeek,
  todayInHelsinki,
} from "./dates";
import type { DayResponse, Menu, Restaurant, RestaurantWeekResponse } from "./types";

function AppHeader() {
  return (
    <header className="app-header">
      <a className="brand" href="/" aria-label="Mihin lounaalle? – etusivu">
        <span className="brand-mark" aria-hidden="true">M</span>
        <span>Mihin lounaalle?</span>
      </a>
      <span className="catchment">Seinäjoki · 50 km</span>
    </header>
  );
}

function DateNavigation({
  date,
  onChange,
}: {
  date: string;
  onChange: (date: string) => void;
}) {
  return (
    <div className="date-navigation" aria-label="Päivän valinta">
      <button type="button" aria-label="Edellinen päivä" onClick={() => onChange(addDays(date, -1))}>
        <span aria-hidden="true">←</span>
      </button>
      <div>
        <span className="date-label">Valittu päivä</span>
        <strong>{formatLongDate(date)}</strong>
      </div>
      <button type="button" aria-label="Seuraava päivä" onClick={() => onChange(addDays(date, 1))}>
        <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}

function LoadingState({ label = "Ruokalistoja ladataan…" }: { label?: string }) {
  return (
    <div className="state-panel" role="status">
      <span className="loading-dot" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="state-panel state-panel-error" role="alert">
      <h2>Ruokalistoja ei saatu ladattua.</h2>
      <p>Yritä hetken kuluttua uudelleen.</p>
      <button className="button button-dark" type="button" onClick={onRetry}>Yritä uudelleen</button>
    </div>
  );
}

function RestaurantLink({ restaurant, date }: { restaurant: Restaurant; date: string }) {
  const href = `/ravintolat/${encodeURIComponent(restaurant.id)}?week=${startOfWeek(date)}`;
  return <a className="text-link" href={href}>Katso viikon ruokalista <span aria-hidden="true">→</span></a>;
}

function MenuContent({
  compact = false,
  menu,
}: {
  compact?: boolean;
  menu: Pick<Menu, "structuredMenu" | "text">;
}) {
  const courses = menu.structuredMenu?.courses ?? [];
  if (courses.length === 0) {
    if (!menu.text) return <p className="muted">Ei julkaistua ruokalistaa.</p>;
    return <p className="menu-text">{menu.text}</p>;
  }
  const visibleCourses = compact ? courses.slice(0, 6) : courses;

  return (
    <div className="structured-menu">
      <ul className="course-list">
        {visibleCourses.map((course, index) => (
          <li key={`${course.nameFi}-${index}`}>
            <div className="course-line">
              <span className="course-name">{course.nameFi}</span>
              {course.dietaryMarkers.length > 0 && (
                <span className="dietary-markers" aria-label="Ruokavaliomerkinnät">
                  {[...new Set(course.dietaryMarkers)].map((marker, markerIndex) => (
                    <span key={`${marker}-${markerIndex}`}>{marker}</span>
                  ))}
                </span>
              )}
            </div>
            {course.explicitAllergens.length > 0 && (
              <small>Ilmoitetut allergeenit: {course.explicitAllergens.join(", ")}</small>
            )}
          </li>
        ))}
      </ul>
      {visibleCourses.length < courses.length && (
        <p className="more-courses">Lisäksi {courses.length - visibleCourses.length} muuta.</p>
      )}
      {!compact && menu.text && (
        <details className="raw-menu">
          <summary>Alkuperäinen ruokalistateksti</summary>
          <p className="menu-text">{menu.text}</p>
        </details>
      )}
    </div>
  );
}

function MenuDataNotice() {
  return (
    <p className="menu-data-notice">
      Ruokavalio- ja allergeenitiedot on poimittu ruokalistoista automaattisesti, ja
      ne voivat olla virheellisiä tai puutteellisia. Jos sinulla on ruoka-allergia,
      varmista annoksen sopivuus aina ravintolasta.
    </p>
  );
}

function RecommendationList({ data }: { data: DayResponse }) {
  return (
    <section className="section" aria-labelledby="recommendations-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Suositukset</span>
          <h2 id="recommendations-title">Päivän kolme parasta</h2>
        </div>
        <p>Yhteinen arvio ruokalistan kiinnostavuudesta, vaihtelusta ja hinnasta.</p>
      </div>

      {data.status === "pending" && (
        <div className="inline-state" role="status">Suosituksia arvioidaan vielä.</div>
      )}
      {data.status === "unavailable" && (
        <div className="inline-state">Tälle päivälle ei löytynyt julkaistuja lounaslistoja.</div>
      )}
      {data.recommendations.length > 0 && (
        <ol className="recommendation-grid">
          {data.recommendations.map((recommendation) => (
            <li
              className={`recommendation-card rank-${recommendation.rank}`}
              key={recommendation.restaurant.id}
            >
              <div className="card-topline">
                <span className="rank-badge">#{recommendation.rank}</span>
                <span
                  className="score"
                  aria-label={`Pisteet ${recommendation.score.toLocaleString("fi-FI")} / 10`}
                >
                  {recommendation.score.toLocaleString("fi-FI", { maximumFractionDigits: 1 })}
                  <small>/10</small>
                </span>
              </div>
              <h3>{recommendation.restaurant.name}</h3>
              <p className="rationale">{recommendation.rationale}</p>
              <div className="menu-preview">
                <MenuContent compact menu={recommendation.menu} />
                <div className="menu-facts">
                  {recommendation.menu.lunchHours && (
                    <span className="hours">Lounas {recommendation.menu.lunchHours}</span>
                  )}
                  {recommendation.menu.priceText && (
                    <span className="hours">{recommendation.menu.priceText}</span>
                  )}
                </div>
                {recommendation.menu.source && (
                  <p className="menu-source">
                    Lähde: <a href={recommendation.menu.source.url} target="_blank" rel="noreferrer">{recommendation.menu.source.name}</a>
                  </p>
                )}
              </div>
              <RestaurantLink restaurant={recommendation.restaurant} date={data.serviceDate} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AllMenus({ data }: { data: DayResponse }) {
  return (
    <section className="section" aria-labelledby="all-menus-title">
      <div className="section-heading compact-heading">
        <div>
          <span className="eyebrow">Koko tarjonta</span>
          <h2 id="all-menus-title">Kaikki päivän ruokalistat</h2>
        </div>
        <span className="result-count">{data.menus.length} ravintolaa</span>
      </div>
      {data.menus.length === 0 ? (
        <div className="inline-state">Ruokalistoja ei ole julkaistu tälle päivälle.</div>
      ) : (
        <ul className="menu-grid">
          {data.menus.map((entry) => (
            <li className="menu-card" key={entry.restaurant.id}>
              <div className="menu-card-heading">
                <div>
                  <h3>{entry.restaurant.name}</h3>
                  {entry.restaurant.address && <p>{entry.restaurant.address}</p>}
                </div>
                <div className="menu-facts">
                  {entry.menu.lunchHours && <span className="hours">{entry.menu.lunchHours}</span>}
                  {entry.menu.priceText && <span className="hours">{entry.menu.priceText}</span>}
                </div>
              </div>
              <MenuContent menu={entry.menu} />
              {entry.menu.source && (
                <p className="menu-source">
                  Lähde: <a href={entry.menu.source.url} target="_blank" rel="noreferrer">{entry.menu.source.name}</a>
                </p>
              )}
              <RestaurantLink restaurant={entry.restaurant} date={data.serviceDate} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DayPage() {
  const [date, setDate] = useState(() => {
    const initialDate = new URLSearchParams(window.location.search).get("date");
    return isIsoDate(initialDate) ? initialDate : todayInHelsinki();
  });
  const [data, setData] = useState<DayResponse | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(false);
    fetchJson<DayResponse>(`/api/days/${date}`, controller.signal)
      .then(setData)
      .catch((requestError: unknown) => {
        if (!(requestError instanceof DOMException && requestError.name === "AbortError")) setError(true);
      });
    return () => controller.abort();
  }, [date, retry]);

  useEffect(() => {
    const syncDate = () => {
      const nextDate = new URLSearchParams(window.location.search).get("date");
      setDate(isIsoDate(nextDate) ? nextDate : todayInHelsinki());
    };
    window.addEventListener("popstate", syncDate);
    return () => window.removeEventListener("popstate", syncDate);
  }, []);

  function changeDate(nextDate: string) {
    window.history.pushState({}, "", `/?date=${nextDate}`);
    setDate(nextDate);
  }

  return (
    <>
      <AppHeader />
      <main>
        <section className="day-hero">
          <div className="hero-copy">
            <span className="eyebrow">Lounaat Seinäjoen seudulta</span>
            <h1>Poimi päivän paras lounas.</h1>
            <p>Kaikki 50 kilometrin säteellä julkaistut lounaat, yksi selkeä top 3.</p>
          </div>
          <DateNavigation date={date} onChange={changeDate} />
        </section>

        {error && <ErrorState onRetry={() => setRetry((value) => value + 1)} />}
        {!error && !data && <LoadingState />}
        {data && (
          <>
            {data.stale && (
              <div className="stale-notice" role="status">
                <strong>Viimeisin päivitysyritys epäonnistui.</strong>
                <span>
                  {data.lastSuccessfulFetchAt
                    ? "Näytämme viimeksi onnistuneesti haetut tiedot."
                    : "Tietoja ei ole vielä saatavilla."}
                </span>
              </div>
            )}
            {!(data.stale && data.lastSuccessfulFetchAt === null) && (
              <>
                {data.menus.some((entry) => entry.menu.structuredMenu?.courses.length) && (
                  <MenuDataNotice />
                )}
                <RecommendationList data={data} />
                <AllMenus data={data} />
              </>
            )}
            <SourceFooter
              source={data.source}
              updatedAt={data.lastSuccessfulFetchAt}
            />
          </>
        )}
      </main>
    </>
  );
}

function SourceFooter({
  source,
  updatedAt,
}: {
  source: { name: string; url: string };
  updatedAt: string | null;
}) {
  return (
    <footer className="source-footer">
      <span>
        Ruokalistat: <a href={source.url} target="_blank" rel="noreferrer">{source.name}</a>
      </span>
      {updatedAt && <span>Päivitetty {formatUpdatedAt(updatedAt)}</span>}
    </footer>
  );
}

const weekdayNames: Record<string, string> = {
  FR: "Pe",
  MO: "Ma",
  SA: "La",
  SU: "Su",
  TH: "To",
  TU: "Ti",
  WE: "Ke",
};

function RestaurantPage({ restaurantId }: { restaurantId: string }) {
  const [week, setWeek] = useState(() => {
    const initialWeek = new URLSearchParams(window.location.search).get("week");
    return isIsoDate(initialWeek)
      ? startOfWeek(initialWeek)
      : startOfWeek(todayInHelsinki());
  });
  const [data, setData] = useState<RestaurantWeekResponse | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(false);
    fetchJson<RestaurantWeekResponse>(
      `/api/restaurants/${encodeURIComponent(restaurantId)}/weeks/${week}`,
      controller.signal,
    )
      .then(setData)
      .catch((requestError: unknown) => {
        if (!(requestError instanceof DOMException && requestError.name === "AbortError")) setError(true);
      });
    return () => controller.abort();
  }, [restaurantId, retry, week]);

  useEffect(() => {
    const syncWeek = () => {
      const nextWeek = new URLSearchParams(window.location.search).get("week");
      setWeek(
        isIsoDate(nextWeek) ? startOfWeek(nextWeek) : startOfWeek(todayInHelsinki()),
      );
    };
    window.addEventListener("popstate", syncWeek);
    return () => window.removeEventListener("popstate", syncWeek);
  }, []);

  function changeWeek(nextWeek: string) {
    window.history.pushState(
      {},
      "",
      `/ravintolat/${encodeURIComponent(restaurantId)}?week=${nextWeek}`,
    );
    setWeek(nextWeek);
  }

  return (
    <>
      <AppHeader />
      <main>
        <a className="back-link" href={`/?date=${todayInHelsinki()}`}>
          <span aria-hidden="true">←</span> Päivän suosituksiin
        </a>
        {error && <ErrorState onRetry={() => setRetry((value) => value + 1)} />}
        {!error && !data && <LoadingState label="Ravintolan ruokalistaa ladataan…" />}
        {data && (
          <>
            <section className="restaurant-hero">
              <div>
                <span className="eyebrow">Ravintola</span>
                <h1>{data.restaurant.name}</h1>
                {data.restaurant.description && <p>{data.restaurant.description}</p>}
                <div className="restaurant-meta">
                  {data.restaurant.address && <span>{data.restaurant.address}</span>}
                  {data.restaurant.phone && <a href={`tel:${data.restaurant.phone}`}>{data.restaurant.phone}</a>}
                </div>
              </div>
              {data.restaurant.websiteUrl && (
                <a
                  className="button button-accent"
                  href={data.restaurant.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Ravintolan verkkosivut <span aria-hidden="true">↗</span>
                </a>
              )}
            </section>

            <div className="week-toolbar">
              <button type="button" aria-label="Edellinen viikko" onClick={() => changeWeek(addDays(week, -7))}>←</button>
              <div>
                <span className="date-label">Viikko</span>
                <strong>{formatShortDate(data.weekStart)}–{formatShortDate(data.weekEnd)}</strong>
              </div>
              <button type="button" aria-label="Seuraava viikko" onClick={() => changeWeek(addDays(week, 7))}>→</button>
            </div>

            <section className="restaurant-content" aria-labelledby="week-menu-title">
              <div className="week-main">
                <div className="section-heading compact-heading">
                  <div>
                    <span className="eyebrow">Maanantai–sunnuntai</span>
                    <h2 id="week-menu-title">Viikon ruokalista</h2>
                  </div>
                </div>
                {data.days.some((day) => day.structuredMenu?.courses.length) && (
                  <MenuDataNotice />
                )}
                <div className="week-grid">
                  {data.days.map((day) => (
                    <article className={`day-card ${day.status !== "published" ? "day-card-empty" : ""}`} key={day.serviceDate}>
                      <div className="day-card-heading">
                        <h3>{formatLongDate(day.serviceDate)}</h3>
                        <div className="menu-facts">
                          {day.lunchHours && <span className="hours">{day.lunchHours}</span>}
                          {day.priceText && <span className="hours">{day.priceText}</span>}
                        </div>
                      </div>
                      {day.text ? (
                        <MenuContent menu={day} />
                      ) : (
                        <p className="muted">
                          {day.status === "missing"
                            ? "Tietoja ei ole vielä haettu tälle päivälle."
                            : "Ruokalistaa ei ole julkaistu."}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              </div>

              {data.restaurant.openingHours.length > 0 && (
                <aside className="opening-hours">
                  <span className="eyebrow">Aukioloajat</span>
                  <h2>Ravintola avoinna</h2>
                  <dl>
                    {data.restaurant.openingHours.map((day) => (
                      <div key={day.weekday}>
                        <dt>{weekdayNames[day.weekday] ?? day.weekday}</dt>
                        <dd>{day.periods.map((period) => `${period.open}–${period.close}`).join(", ")}</dd>
                      </div>
                    ))}
                  </dl>
                </aside>
              )}
            </section>
            <SourceFooter source={data.source} updatedAt={data.days.find((day) => day.fetchedAt)?.fetchedAt ?? null} />
          </>
        )}
      </main>
    </>
  );
}

export function App() {
  if (window.location.pathname === "/admin" || window.location.pathname === "/admin/") {
    return <AdminPage />;
  }
  const restaurantMatch = window.location.pathname.match(/^\/ravintolat\/([^/]+)\/?$/);
  if (restaurantMatch?.[1]) return <RestaurantPage restaurantId={decodeURIComponent(restaurantMatch[1])} />;
  return <DayPage />;
}
