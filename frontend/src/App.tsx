import { Component, lazy, Suspense, type ReactNode, useEffect, useRef, useState } from "react";

import { fetchJson, HttpError } from "./api";
import {
  addDays,
  formatLongDate,
  formatShortDate,
  formatUpdatedAt,
  formatWeekday,
  startOfWeek,
  todayInHelsinki,
} from "./dates";
import {
  appRoute,
  browserAdapter,
  dayHref,
  dayRouteDate,
  menuSearchQuery,
  menuTargetId,
  restaurantHref,
  restaurantRouteState,
  restaurantWeekHref,
  type BrowserAdapter,
} from "./navigation";
import { assessmentScoreLabels, formatScore } from "./scores";
import { ReaderActions } from "./ReaderActions";
import type {
  DayResponse,
  Menu,
  Restaurant,
  RestaurantWeekResponse,
  StructuredMenu,
} from "./types";

type RestaurantDay = RestaurantWeekResponse["days"][number];
type DayRecommendation = DayResponse["recommendations"][number];

const AdminPage = lazy(() => import("./AdminPage").then((module) => ({ default: module.AdminPage })));

class AdminRouteErrorBoundary extends Component<
  { children: ReactNode; onReload: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="admin-main admin-login-main">
          <section className="admin-login-card" role="alert">
            <h1>Ylläpitoa ei saatu ladattua.</h1>
            <p>Päivitä sivu ja yritä uudelleen.</p>
            <button
              className="button button-dark"
              type="button"
              onClick={this.props.onReload}
            >
              Lataa sivu uudelleen
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

function AppHeader() {
  return (
    <header className="app-header reader-header">
      <a className="skip-link" href="#main-content">Siirry sisältöön</a>
      <a className="brand" href="/" aria-label="Mihin lounaalle? – etusivu">
        <span className="brand-mark" aria-hidden="true">M</span>
        <span className="brand-copy">
          <strong>Mihin lounaalle?</strong>
          <small>Seinäjoki · 50 km:n säde</small>
        </span>
      </a>
    </header>
  );
}

function NewTabHint() {
  return <span className="visually-hidden"> (avautuu uuteen välilehteen)</span>;
}

function restaurantAddress({ address, city }: Restaurant): string | null {
  if (!address) return city;
  if (!city || address.toLocaleLowerCase("fi-FI").endsWith(city.toLocaleLowerCase("fi-FI"))) {
    return address;
  }
  return `${address}, ${city}`;
}

function mapHref(restaurant: Restaurant): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(restaurantAddress(restaurant) ?? restaurant.name)}`;
}

function DateNavigation({
  date,
  onChange,
}: {
  date: string;
  onChange: (date: string) => void;
}) {
  const today = todayInHelsinki();
  const isToday = date === today;

  return (
    <nav className="date-navigation" aria-label="Päivän valinta">
      <button type="button" aria-label="Edellinen päivä" onClick={() => onChange(addDays(date, -1))}>
        <span aria-hidden="true">←</span>
      </button>
      <div className="date-navigation-current">
        {!isToday && <span className="date-context">Valittu päivä</span>}
        <strong>{formatLongDate(date)}</strong>
      </div>
      {isToday ? (
        <span aria-current="date" className="today-current">Tänään</span>
      ) : (
        <button
          aria-label="Siirry tähän päivään"
          className="today-button"
          type="button"
          onClick={() => onChange(today)}
        >
          Tänään
        </button>
      )}
      <button type="button" aria-label="Seuraava päivä" onClick={() => onChange(addDays(date, 1))}>
        <span aria-hidden="true">→</span>
      </button>
    </nav>
  );
}

function LoadingState({ label = "Ruokalistoja ladataan…" }: { label?: string }) {
  return (
    <div className="state-panel reader-loading" role="status" aria-live="polite">
      <p>{label}</p>
      <div className="loading-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="state-panel state-panel-error" role="alert">
      <h2>Ruokalistoja ei saatu ladattua.</h2>
      <p>Tarkista yhteys ja yritä uudelleen.</p>
      <button className="button button-dark" type="button" onClick={onRetry}>Yritä uudelleen</button>
    </div>
  );
}

function MenuUpdateNotice({
  fetchedAt,
  lastAttemptAt,
  source,
}: {
  fetchedAt: string | null;
  lastAttemptAt?: string | null;
  source: { url: string };
}) {
  return (
    <aside className="menu-update-notice" aria-label="Ruokalistan päivitys">
      <strong>Päivitys epäonnistui.</strong>
      {lastAttemptAt && <span>Hakuyritys {formatUpdatedAt(lastAttemptAt)}</span>}
      <p>{fetchedAt
        ? `Näytämme aiemmat tiedot: ${formatUpdatedAt(fetchedAt)}.`
        : "Tälle päivälle ei ole aiemmin haettuja tietoja."}</p>
      <a href={source.url} target="_blank" rel="noreferrer">Tarkista lähdesivu<NewTabHint /></a>
    </aside>
  );
}

function RestaurantLink({
  className = "",
  label = "Ravintolan sivu",
  restaurant,
  date,
  query,
}: {
  className?: string;
  label?: string;
  restaurant: Restaurant;
  date: string;
  query: string;
}) {
  return (
    <a className={`text-link ${className}`.trim()} href={restaurantHref(restaurant.id, date, query)}>
      <span>{label}</span>
      <span aria-hidden="true">→</span>
    </a>
  );
}

const dietaryMarkerNames: Record<string, string> = {
  G: "gluteeniton",
  L: "laktoositon",
  M: "maidoton",
  VE: "vegaaninen",
  VEG: "vegaaninen",
  VL: "vähälaktoosinen",
};

function dietaryMarkerLabel(markers: string[]): string {
  return [...new Set(markers)]
    .map((marker) => dietaryMarkerNames[marker.toLocaleUpperCase("fi-FI")]
      ? `${marker}, ${dietaryMarkerNames[marker.toLocaleUpperCase("fi-FI")]}`
      : marker)
    .join("; ");
}

function hasDietaryMarkers(menu: Pick<Menu, "structuredMenu">): boolean {
  return Boolean(
    menu.structuredMenu?.courses.some((course) => course.dietaryMarkers.length > 0),
  );
}

function DietarySafetyNote() {
  return (
    <p className="dietary-safety-note">
      <strong>Allergia?</strong> Varmista ruokavaliomerkinnät ravintolasta.
    </p>
  );
}

function CourseList({ courses }: { courses: StructuredMenu["courses"] }) {
  return (
    <ul className="course-list">
      {courses.map((course, index) => (
        <li key={`${course.nameFi}-${index}`}>
          <div className="course-line">
            <span className="course-name">{course.nameFi}</span>
            {course.dietaryMarkers.length > 0 && (
              <span
                className="dietary-markers"
                role="group"
                aria-label={`Ravintolan ilmoittamat ruokavaliomerkinnät: ${dietaryMarkerLabel(course.dietaryMarkers)}`}
              >
                {[...new Set(course.dietaryMarkers)].map((marker, markerIndex) => (
                  <span aria-hidden="true" key={`${marker}-${markerIndex}`}>{marker}</span>
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
  );
}

function MenuContent({
  menu,
  showRawText = true,
}: {
  menu: Pick<Menu, "structuredMenu" | "text">;
  showRawText?: boolean;
}) {
  const courses = menu.structuredMenu?.courses ?? [];
  if (courses.length === 0) {
    if (!menu.text) return <p className="muted">Ei julkaistua ruokalistaa.</p>;
    return <p className="menu-text">{menu.text}</p>;
  }

  return (
    <div className="structured-menu">
      <CourseList courses={courses} />
      {showRawText && menu.text && (
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
    <aside className="menu-data-notice" aria-label="Ruokavaliotietojen turvallisuus">
      <p className="menu-data-warning">
        <strong>Allergia?</strong> Ruokavaliomerkinnät on poimittu automaattisesti.
        Varmista annoksen sopivuus ravintolasta.
      </p>
      <details>
        <summary>Miten ruokavaliomerkinnät muodostetaan?</summary>
        <p>
          Merkinnät, kuten L, G ja VE, ovat ravintolan käyttämiä lyhenteitä.
          Automaattinen tulkinta voi olla virheellinen tai puutteellinen.
        </p>
      </details>
    </aside>
  );
}

function RecommendationAssessment({
  recommendation,
}: {
  recommendation: DayRecommendation;
}) {
  const headingId = `menu-assessment-${recommendation.restaurant.id}`;

  return (
    <aside className="menu-assessment" aria-labelledby={headingId}>
      <header className="assessment-heading">
        <span id={headingId}>Arvion perustelu</span>
      </header>
      <p className="assessment-rationale">
        <span>{recommendation.rationale}</span>
      </p>
      <dl className="assessment-breakdown" aria-label="Menuarvion osa-alueet">
        {assessmentScoreLabels.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{formatScore(recommendation.scores[key])}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

function RestaurantNotFoundPage({ date, query }: { date: string; query: string }) {
  useEffect(() => {
    document.title = "Ravintolaa ei löytynyt | Mihin lounaalle?";
  }, []);

  return (
    <>
      <AppHeader />
      <main className="reader-main" id="main-content" tabIndex={-1}>
        <section className="state-panel" aria-labelledby="missing-restaurant-title">
          <h1 id="missing-restaurant-title">Ravintolaa ei löytynyt.</h1>
          <p>Linkki voi olla virheellinen. Löydät muut ravintolat päivän lounaslistalta.</p>
          <a className="button button-dark" href={dayHref(date, query)}>Palaa päivän lounaisiin</a>
        </section>
      </main>
    </>
  );
}

function DailyMenuList({
  data,
  query,
  onQueryChange,
}: {
  data: DayResponse;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const searchInput = useRef<HTMLInputElement>(null);
  const searchTerms = query.trim().toLocaleLowerCase("fi-FI").split(/\s+/).filter(Boolean);
  const recommendationByRestaurant = new Map(
    data.recommendations.map((recommendation) => [recommendation.restaurant.id, recommendation]),
  );
  const entries = data.menus
    .filter(({ restaurant, menu }) => {
      const searchableText = [
        restaurant.name, restaurant.city, restaurant.address, menu.title, menu.text,
        ...(menu.structuredMenu?.courses.map((course) => course.nameFi) ?? []),
      ].filter(Boolean).join(" ").toLocaleLowerCase("fi-FI");
      return searchTerms.every((term) => searchableText.includes(term));
    })
    .map((entry) => ({
      entry,
      recommendation: recommendationByRestaurant.get(entry.restaurant.id),
    }))
    .sort((first, second) => {
      if (first.recommendation && second.recommendation) {
        return first.recommendation.rank - second.recommendation.rank;
      }
      if (first.recommendation) return -1;
      if (second.recommendation) return 1;
      return first.entry.restaurant.name.localeCompare(second.entry.restaurant.name, "fi-FI");
    });
  const recommendationCount = entries.filter(({ recommendation }) => recommendation).length;

  return (
    <section className="daily-menus" aria-labelledby="daily-menus-title">
      <div className="menu-search" role="search" aria-label="Ruokalistojen haku">
        <label htmlFor="menu-search">Hae ravintolaa, paikkakuntaa tai ruokaa</label>
        <div className="menu-search-controls">
          <input
            aria-controls="daily-menu-results"
            autoComplete="off"
            id="menu-search"
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Esim. Ilmajoki tai lohikeitto"
            ref={searchInput}
            type="search"
            value={query}
          />
          {query && (
            <button className="button" type="button" onClick={() => {
              onQueryChange("");
              searchInput.current?.focus();
            }}>
              Tyhjennä haku
            </button>
          )}
        </div>
      </div>
      <header className="daily-menus-heading">
        <h2 className="visually-hidden" id="daily-menus-title">Kaikki ruokalistat</h2>
        <p role="status" aria-atomic="true">
          {searchTerms.length > 0
            ? `${entries.length} / ${data.menus.length} ravintolaa`
            : `${entries.length} ${entries.length === 1 ? "ravintola" : "ravintolaa"}`}
          {recommendationCount > 0 && ` · ${recommendationCount} ${recommendationCount === 1 ? "suositus" : "suositusta"}`}
        </p>
        {data.recommendations.length > 0 && (
          <details className="assessment-method">
            <summary>Arvioinnin perusteet</summary>
            <p>
              Kokonaisarvio painottaa houkuttelevuutta 35 %, omaleimaisuutta 25 %,
              vaihtelua 20 % ja hinta–laatua 20 %. Ravintolan nimi ei vaikuta arvioon.
            </p>
          </details>
        )}
      </header>

      {data.status === "pending" && data.recommendations.length === 0 && (
        <div className="inline-state assessment-pending" role="status">
          Menuarviot eivät ole vielä saatavilla. Ruokalistat ovat jo selattavissa.
        </div>
      )}

      {entries.length === 0 && (
        <div className="inline-state empty-search-state">
          <p><strong>Haulla ei löytynyt ruokalistoja.</strong> Kokeile toista hakusanaa tai tyhjennä haku.</p>
        </div>
      )}
      <ul className="daily-menu-list" id="daily-menu-results">
        {entries.map(({ entry, recommendation }) => {
          const source = entry.menu.source ?? data.source;
          return (
            <li key={entry.restaurant.id}>
              <article
                className={`daily-menu-row${recommendation ? ` is-recommended rank-${recommendation.rank}` : ""}`}
              >
                <header className="daily-menu-restaurant">
                  <div className="daily-menu-title-line">
                    {recommendation && (
                      <span className="rank-marker" role="img" aria-label={`Sija ${recommendation.rank}`}>
                        <span aria-hidden="true">{recommendation.rank}</span>
                      </span>
                    )}
                    <h3 id={menuTargetId(entry.restaurant.id)} tabIndex={-1}>
                      <a href={restaurantHref(entry.restaurant.id, data.serviceDate, query)}>
                        {entry.restaurant.name}
                      </a>
                    </h3>
                    {recommendation && (
                      <strong
                        className="row-assessment-score"
                        aria-label={`Arvio ${formatScore(recommendation.score)} / 10`}
                      >
                        {formatScore(recommendation.score)} <small>/ 10</small>
                      </strong>
                    )}
                  </div>
                  {restaurantAddress(entry.restaurant) && (
                    <p className="restaurant-address">{restaurantAddress(entry.restaurant)}</p>
                  )}
                  {(entry.menu.lunchHours || entry.menu.priceText) && (
                    <p className="daily-menu-facts">
                      {[entry.menu.lunchHours, entry.menu.priceText].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  <div className="daily-menu-actions">
                    <RestaurantLink
                      className="menu-week-link"
                      label="Viikon ruokalista"
                      restaurant={entry.restaurant}
                      date={data.serviceDate}
                      query={query}
                    />
                    {entry.restaurant.address && (
                      <a
                        className="text-link menu-route-link"
                        href={mapHref(entry.restaurant)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span>Reitti</span>
                        <span aria-hidden="true">↗</span>
                        <NewTabHint />
                      </a>
                    )}
                  </div>
                  <p className="menu-provenance">
                    {!entry.stale && <span>Päivitetty {formatUpdatedAt(entry.fetchedAt)}</span>}
                    {source.url !== data.source.url && (
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.name}
                        <NewTabHint />
                      </a>
                    )}
                  </p>
                  {entry.stale && (
                    <MenuUpdateNotice fetchedAt={entry.fetchedAt} lastAttemptAt={entry.lastAttemptAt} source={source} />
                  )}
                </header>

                <div className="daily-menu-content">
                  <span className="menu-column-label">Ruokalista</span>
                  <MenuContent menu={entry.menu} />
                </div>

                {recommendation && (
                  <RecommendationAssessment recommendation={recommendation} />
                )}
              </article>
            </li>
          );
        })}
      </ul>
      {entries.some(({ entry }) => entry.menu.structuredMenu?.courses.length) && (
        <MenuDataNotice />
      )}
    </section>
  );
}

function DayPage({ browser }: { browser: BrowserAdapter }) {
  const [date, setDate] = useState(() => dayRouteDate(browser.location().search));
  const [query, setQuery] = useState(() => menuSearchQuery(browser.location().search));
  const [data, setData] = useState<DayResponse | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    document.title = `${formatLongDate(date)} | Mihin lounaalle?`;
  }, [date]);

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
      setDate(dayRouteDate(browser.location().search));
      setQuery(menuSearchQuery(browser.location().search));
    };
    return browser.subscribePopState(syncDate);
  }, [browser]);

  useEffect(() => {
    if (!data) return;
    let targetId: string;
    try {
      targetId = decodeURIComponent((browser.location().hash ?? "").slice(1));
    } catch {
      return;
    }
    if (data.menus.some(({ restaurant }) => menuTargetId(restaurant.id) === targetId)) {
      document.getElementById(targetId)?.focus();
    }
  }, [browser, data]);

  function changeDate(nextDate: string) {
    browser.push(dayHref(nextDate, query));
    setDate(nextDate);
  }

  function changeQuery(nextQuery: string) {
    browser.replace(dayHref(date, nextQuery));
    setQuery(nextQuery);
  }

  const isToday = date === todayInHelsinki();
  const dayTitle = data?.status === "unavailable"
    ? "Tälle päivälle ei löytynyt lounaslistoja."
    : isToday
      ? "Lounaat tänään"
      : "Päivän lounaat";
  const loadedDayAnnouncement = data
    ? `${formatLongDate(data.serviceDate)} ladattu. ${data.menus.length} ${data.menus.length === 1 ? "ravintola" : "ravintolaa"} ja ${data.recommendations.length} ${data.recommendations.length === 1 ? "suositus" : "suositusta"}.`
    : "";

  return (
    <>
      <AppHeader />
      <main className="reader-main" id="main-content" tabIndex={-1} aria-busy={!error && data === null}>
        <p className="visually-hidden" role="status" aria-atomic="true">
          {loadedDayAnnouncement}
        </p>
        <section className="day-wayfinding" aria-labelledby="day-title">
          <DateNavigation date={date} onChange={changeDate} />
          <ReaderActions date={date} href={dayHref(date, query)} onDateChange={changeDate} />
          <header className="decision-heading">
            <h1 id="day-title">{dayTitle}</h1>
          </header>
        </section>

        {error && <ErrorState onRetry={() => setRetry((value) => value + 1)} />}
        {!error && !data && <LoadingState />}
        {data && (
          <>
            {data.stale && (
              <div className="stale-notice" role="status">
                <strong>Ruokalistojen päivitys viivästyi.</strong>
                <span>
                  {data.lastSuccessfulFetchAt
                    ? "Näytämme viimeksi onnistuneesti haetut tiedot."
                    : "Tietoja ei ole vielä saatavilla."}
                </span>
              </div>
            )}
            {!(data.stale && data.lastSuccessfulFetchAt === null) && (
              <>
                {data.menus.length > 0 && <DailyMenuList data={data} query={query} onQueryChange={changeQuery} />}
                {data.menus.length === 0 && (
                  <div className="inline-state empty-day-state">
                    {data.status === "pending"
                      ? "Ruokalistoja odotetaan vielä. Voit selata muita päiviä yllä olevilla nuolilla."
                      : "Valitse toinen päivä yllä olevilla nuolilla."}
                  </div>
                )}
              </>
            )}
            <SourceFooter source={data.source} updatedAt={data.lastSuccessfulFetchAt} />
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
        Ruokalistat:{" "}
        <a href={source.url} target="_blank" rel="noreferrer">
          {source.name}
          <NewTabHint />
        </a>
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

function EmptyDayMessage({ day }: { day: RestaurantDay }) {
  return (
    <p className="muted">
      {day.status === "missing"
        ? "Tietoja ei ole vielä haettu tälle päivälle."
        : "Ruokalistaa ei ole julkaistu."}
    </p>
  );
}

function DayMenu({ day, source }: { day: RestaurantDay; source: { url: string } }) {
  return (
    <>
      {day.stale && <MenuUpdateNotice fetchedAt={day.fetchedAt} lastAttemptAt={day.lastAttemptAt} source={day.source ?? source} />}
      {day.text || day.structuredMenu?.courses.length
        ? <MenuContent menu={day} />
        : !day.stale && <EmptyDayMessage day={day} />}
    </>
  );
}

function RestaurantPage({
  browser,
  restaurantId,
}: {
  browser: BrowserAdapter;
  restaurantId: string;
}) {
  const initialState = restaurantRouteState(browser.location().search);
  const [week, setWeek] = useState(initialState.week);
  const [selectedDate, setSelectedDate] = useState(initialState.selectedDate);
  const [query, setQuery] = useState(() => menuSearchQuery(browser.location().search));
  const [data, setData] = useState<RestaurantWeekResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"not-found" | "request" | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchJson<RestaurantWeekResponse>(
      `/api/restaurants/${encodeURIComponent(restaurantId)}/weeks/${week}`,
      controller.signal,
    )
      .then((response) => {
        setData(response);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (!(requestError instanceof DOMException && requestError.name === "AbortError")) {
          setError(requestError instanceof HttpError && requestError.status === 404 ? "not-found" : "request");
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [restaurantId, retry, week]);

  useEffect(() => {
    const syncWeek = () => {
      const routeState = restaurantRouteState(browser.location().search);
      setWeek(routeState.week);
      setSelectedDate(routeState.selectedDate);
      setQuery(menuSearchQuery(browser.location().search));
    };
    return browser.subscribePopState(syncWeek);
  }, [browser]);

  function changeWeek(amount: number) {
    const nextWeek = addDays(week, amount);
    const nextDate = addDays(selectedDate, amount);
    browser.push(restaurantWeekHref(restaurantId, nextWeek, nextDate, query));
    setWeek(nextWeek);
    setSelectedDate(nextDate);
  }

  function changeDate(nextDate: string) {
    const nextWeek = startOfWeek(nextDate);
    browser.push(restaurantWeekHref(restaurantId, nextWeek, nextDate, query));
    setWeek(nextWeek);
    setSelectedDate(nextDate);
  }

  const activeDay = data?.weekStart === week
    && data.days.some((day) => day.text || day.structuredMenu?.courses.length)
    ? data.days.find((day) => day.serviceDate === selectedDate)
      ?? data.days.find((day) => day.status === "published")
      ?? data.days[0]
    : undefined;
  const otherDays = data && activeDay
    ? data.days.filter((day) => day.serviceDate !== activeDay.serviceDate)
    : [];
  const displayedDate = activeDay?.serviceDate ?? selectedDate;
  const weekHasFailedUpdates = data?.days.some((day) => day.stale) ?? false;
  const returnDate = displayedDate;
  const today = todayInHelsinki();

  useEffect(() => {
    const restaurantName = data?.restaurant.name ?? "Ravintolan ruokalista";
    document.title = `${restaurantName} – ${formatLongDate(displayedDate)} | Mihin lounaalle?`;
  }, [data?.restaurant.name, displayedDate]);

  const loadedWeekAnnouncement = !loading && !error && data
    ? activeDay
      ? `${data.restaurant.name}: ${formatLongDate(activeDay.serviceDate)} ladattu.`
      : weekHasFailedUpdates
        ? `${data.restaurant.name}: Viikon tietoja puuttuu päivitysvirheen vuoksi.`
        : `${data.restaurant.name}: viikolle ${formatShortDate(week)}–${formatShortDate(addDays(week, 6))} ei löytynyt ruokalistaa.`
    : "";

  if (error === "not-found") return <RestaurantNotFoundPage date={selectedDate} query={query} />;

  return (
    <>
      <AppHeader />
      <main className="reader-main restaurant-page" id="main-content" tabIndex={-1} aria-busy={loading}>
        <p className="visually-hidden" role="status" aria-atomic="true">
          {loadedWeekAnnouncement}
        </p>
        <a className="back-link" href={dayHref(returnDate, query, restaurantId)}>
          <span aria-hidden="true">←</span>
          <span>{formatLongDate(returnDate)} · suosituksiin</span>
        </a>
        {data && (
            <section className="restaurant-hero">
              <div>
                <h1>{data.restaurant.name}</h1>
                <div className="restaurant-meta">
                  {restaurantAddress(data.restaurant) && <span>{restaurantAddress(data.restaurant)}</span>}
                  {data.restaurant.phone && <a href={`tel:${data.restaurant.phone}`}>{data.restaurant.phone}</a>}
                  {data.restaurant.address && (
                    <a
                      href={mapHref(data.restaurant)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Avaa reitti <span aria-hidden="true">↗</span>
                      <NewTabHint />
                    </a>
                  )}
                </div>
              </div>
            </section>
        )}

        <nav className="week-toolbar" aria-label="Viikon valinta" aria-busy={loading}>
          <button type="button" aria-label="Edellinen viikko" onClick={() => changeWeek(-7)}>←</button>
          <div>
            <span className="date-context">Viikko</span>
            <strong>{formatShortDate(week)}–{formatShortDate(addDays(week, 6))}</strong>
          </div>
          {selectedDate === today ? (
            <span aria-current="date" className="today-current">Tänään</span>
          ) : (
            <button
              aria-label="Siirry tähän päivään"
              className="today-button"
              type="button"
              onClick={() => changeDate(today)}
            >
              Tänään
            </button>
          )}
          <button type="button" aria-label="Seuraava viikko" onClick={() => changeWeek(7)}>→</button>
        </nav>
        <ReaderActions
          date={selectedDate}
          href={restaurantWeekHref(restaurantId, week, selectedDate, query)}
          onDateChange={changeDate}
        />

        {error && <ErrorState onRetry={() => setRetry((value) => value + 1)} />}
        {loading && <LoadingState label="Ravintolan ruokalistaa ladataan…" />}
        {!loading && !error && data && (
          <section className="restaurant-content" aria-labelledby="week-menu-title">
            <h2 className="visually-hidden" id="week-menu-title">Viikon ruokalista</h2>
            <div className="week-main">
              {data.days.length > 0 && (
                <nav className="week-days" aria-label="Viikon päivät">
                  {data.days.map((day) => (
                    <button
                      type="button"
                      key={day.serviceDate}
                      aria-label={formatLongDate(day.serviceDate)}
                      aria-pressed={day.serviceDate === displayedDate}
                      onClick={() => changeDate(day.serviceDate)}
                    >
                      <span>{formatWeekday(day.serviceDate)}</span>
                      <strong>{formatShortDate(day.serviceDate)}</strong>
                    </button>
                  ))}
                </nav>
              )}
              {activeDay ? (
                <>
                  <article className="selected-day">
                    <header className="selected-day-heading">
                      <h2>{formatLongDate(activeDay.serviceDate)}</h2>
                      <div className="menu-facts">
                        {activeDay.lunchHours && <span className="hours">{activeDay.lunchHours}</span>}
                        {activeDay.priceText && <span className="hours">{activeDay.priceText}</span>}
                      </div>
                    </header>
                    {hasDietaryMarkers(activeDay) && <DietarySafetyNote />}
                    <DayMenu day={activeDay} source={data.source} />
                  </article>

                  <section className="other-days" aria-labelledby="other-days-title">
                    <h2 id="other-days-title">Muut päivät</h2>
                    <div className="week-list">
                      {otherDays.map((day) => (
                        <article className="day-row" key={day.serviceDate}>
                          <header className="day-row-heading">
                            <span className="day-row-title">
                              <strong>{formatLongDate(day.serviceDate)}</strong>
                            </span>
                            <span className="day-row-facts">
                              {[day.lunchHours, day.priceText].filter(Boolean).join(" · ")}
                            </span>
                          </header>
                          <div className="day-row-body"><DayMenu day={day} source={data.source} /></div>
                        </article>
                      ))}
                    </div>
                  </section>

                  {data.days.some((day) => day.structuredMenu?.courses.length) && (
                    <MenuDataNotice />
                  )}
                </>
              ) : (
                <section className="state-panel empty-week-state" aria-labelledby="empty-week-title">
                  <h2 id="empty-week-title">{weekHasFailedUpdates
                    ? "Viikon tietoja puuttuu."
                    : "Viikolle ei löytynyt ruokalistaa."}</h2>
                  {weekHasFailedUpdates && (
                    <p>Osa viikon tiedoista jäi hakematta päivitysvirheen vuoksi.</p>
                  )}
                  {data.days.filter((day) => day.serviceDate === selectedDate && day.stale).map((day) => (
                    <MenuUpdateNotice key={day.serviceDate} fetchedAt={day.fetchedAt} lastAttemptAt={day.lastAttemptAt} source={day.source ?? data.source} />
                  ))}
                  <p>Vaihda viikkoa tai palaa valitun päivän suosituksiin.</p>
                  <a className="button button-dark" href={dayHref(returnDate, query)}>
                    Palaa suosituksiin
                  </a>
                </section>
              )}
            </div>

            <aside className="restaurant-aside">
              {data.restaurant.websiteUrl && (
                <section className="restaurant-details">
                  <h2>Ravintolan tiedot</h2>
                  <div className="restaurant-actions">
                    <a
                      className="text-link"
                      href={data.restaurant.websiteUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span>Ravintolan verkkosivut</span>
                      <span aria-hidden="true">↗</span>
                      <NewTabHint />
                    </a>
                  </div>
                </section>
              )}
              {data.restaurant.openingHours.length > 0 && (
                <section className="opening-hours">
                  <h2>Aukioloajat</h2>
                  <dl>
                    {data.restaurant.openingHours.map((day) => (
                      <div key={day.weekday}>
                        <dt>{weekdayNames[day.weekday] ?? day.weekday}</dt>
                        <dd>{day.periods.map((period) => `${period.open}–${period.close}`).join(", ")}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
              <section className="restaurant-provenance">
                <h2>Lähde ja päivitys</h2>
                <p>
                  <a href={data.source.url} target="_blank" rel="noreferrer">
                    {data.source.name}
                    <NewTabHint />
                  </a>
                </p>
                {activeDay?.fetchedAt && <p>Päivitetty {formatUpdatedAt(activeDay.fetchedAt)}</p>}
              </section>
            </aside>
          </section>
        )}
      </main>
    </>
  );
}

function AdminRoute({ browser }: { browser: BrowserAdapter }) {
  useEffect(() => {
    document.title = "Ylläpito | Mihin lounaalle?";
  }, []);

  return (
    <AdminRouteErrorBoundary onReload={browser.reload}>
      <Suspense
        fallback={(
          <main className="admin-main admin-login-main">
            <section className="admin-login-card" role="status" aria-live="polite">
              Ylläpitoa ladataan…
            </section>
          </main>
        )}
      >
        <AdminPage />
      </Suspense>
    </AdminRouteErrorBoundary>
  );
}

export function App({ browser = browserAdapter }: { browser?: BrowserAdapter }) {
  const route = appRoute(browser.location().pathname);
  if (route.kind === "admin") return <AdminRoute browser={browser} />;
  if (route.kind === "restaurant-not-found") {
    return <RestaurantNotFoundPage date={dayRouteDate(browser.location().search)} query={menuSearchQuery(browser.location().search)} />;
  }
  if (route.kind === "restaurant") {
    return <RestaurantPage browser={browser} restaurantId={route.restaurantId} />;
  }
  return <DayPage browser={browser} />;
}
