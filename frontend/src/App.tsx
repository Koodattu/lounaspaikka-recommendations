import { Component, lazy, Suspense, type ReactNode, useEffect, useState } from "react";

import { fetchJson } from "./api";
import {
  addDays,
  formatLongDate,
  formatShortDate,
  formatUpdatedAt,
  startOfWeek,
  todayInHelsinki,
} from "./dates";
import {
  appRoute,
  browserAdapter,
  dayHref,
  dayRouteDate,
  restaurantHref,
  restaurantRouteState,
  restaurantWeekHref,
  type BrowserAdapter,
} from "./navigation";
import type {
  DayResponse,
  Menu,
  Restaurant,
  RestaurantWeekResponse,
  StructuredMenu,
} from "./types";

type RestaurantDay = RestaurantWeekResponse["days"][number];

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

function mapHref(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
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

function RestaurantLink({
  className = "",
  label = "Ravintolan sivu",
  restaurant,
  date,
}: {
  className?: string;
  label?: string;
  restaurant: Restaurant;
  date: string;
}) {
  return (
    <a className={`text-link ${className}`.trim()} href={restaurantHref(restaurant.id, date)}>
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
                aria-label={`Ravintolan ilmoittamat ruokavaliomerkinnät: ${dietaryMarkerLabel(course.dietaryMarkers)}`}
              >
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
  );
}

function MenuContent({
  courseLimit,
  menu,
  showRawText = true,
}: {
  courseLimit?: number;
  menu: Pick<Menu, "structuredMenu" | "text">;
  showRawText?: boolean;
}) {
  const courses = menu.structuredMenu?.courses ?? [];
  if (courses.length === 0) {
    if (!menu.text) return <p className="muted">Ei julkaistua ruokalistaa.</p>;
    return <p className="menu-text">{menu.text}</p>;
  }

  const visibleCourses = courseLimit ? courses.slice(0, courseLimit) : courses;
  const remainingCourses = courseLimit ? courses.slice(courseLimit) : [];

  return (
    <div className="structured-menu">
      <CourseList courses={visibleCourses} />
      {remainingCourses.length > 0 && (
        <details className="menu-more">
          <summary>
            Näytä {remainingCourses.length} {remainingCourses.length === 1 ? "muu kohta" : "muuta kohtaa"}
          </summary>
          <CourseList courses={remainingCourses} />
        </details>
      )}
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

function RecommendationList({ data }: { data: DayResponse }) {
  const primary = data.recommendations.find((recommendation) => recommendation.rank === 1)
    ?? data.recommendations[0];
  const companions = data.recommendations
    .filter((recommendation) => recommendation !== primary)
    .sort((first, second) => first.rank - second.rank);

  if (data.status === "pending" && !primary) {
    return <div className="inline-state" role="status">Suosituksia arvioidaan vielä.</div>;
  }
  if (data.status === "unavailable" && !primary) {
    return null;
  }
  if (!primary) return null;

  const recommendationSource = primary.menu.source ?? data.source;
  const recommendationUpdatedAt = data.menus.find(
    (entry) => entry.restaurant.id === primary.restaurant.id,
  )?.fetchedAt ?? data.lastSuccessfulFetchAt;

  return (
    <section className="recommendation-section" aria-labelledby="recommendations-title">
      <h2 className="visually-hidden" id="recommendations-title">Päivän suositukset</h2>
      <div className="recommendation-layout">
        <article className="recommendation-card rank-1">
          <span className="rank-label">Päivän ykkösvalinta</span>
          <h2>{primary.restaurant.name}</h2>
          <ul className="decision-facts" aria-label="Valinnan käytännön tiedot">
            {primary.restaurant.address && <li>{primary.restaurant.address}</li>}
            {primary.menu.lunchHours && <li>{primary.menu.lunchHours}</li>}
            {primary.menu.priceText && <li>{primary.menu.priceText}</li>}
          </ul>
          <p className="recommendation-rationale">{primary.rationale}</p>
          <div className="recommendation-actions">
            <RestaurantLink
              className="recommendation-primary-link"
              restaurant={primary.restaurant}
              date={data.serviceDate}
            />
            {primary.restaurant.address && (
              <a
                className="text-link recommendation-route-link"
                href={mapHref(primary.restaurant.address)}
                target="_blank"
                rel="noreferrer"
              >
                <span>Avaa reitti</span>
                <span aria-hidden="true">↗</span>
                <NewTabHint />
              </a>
            )}
          </div>
          <div className="menu-preview">
            <span className="menu-preview-label">Päivän menu</span>
            {hasDietaryMarkers(primary.menu) && <DietarySafetyNote />}
            <MenuContent courseLimit={4} menu={primary.menu} showRawText={false} />
          </div>
        </article>

        {companions.length > 0 && (
          <ol className="recommendation-companions" start={2} role="list">
            {companions.map((recommendation) => (
              <li key={recommendation.restaurant.id} value={recommendation.rank}>
                <article className="recommendation-row">
                  <span className="visually-hidden">Sija {recommendation.rank}. </span>
                  <span className="rank-number" aria-hidden="true">{recommendation.rank}</span>
                  <span className="recommendation-row-main">
                    <a
                      className="recommendation-name-link"
                      href={restaurantHref(recommendation.restaurant.id, data.serviceDate)}
                    >
                      <strong>{recommendation.restaurant.name}</strong>
                      <span aria-hidden="true">→</span>
                    </a>
                    {recommendation.restaurant.address && <small>{recommendation.restaurant.address}</small>}
                  </span>
                  <span className="recommendation-row-facts">
                    {[recommendation.menu.lunchHours, recommendation.menu.priceText].filter(Boolean).join(" · ")}
                  </span>
                  <p className="recommendation-rationale">{recommendation.rationale}</p>
                  <MenuContent courseLimit={2} menu={recommendation.menu} showRawText={false} />
                </article>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="recommendation-trust" aria-label="Suositusten perusteet ja päivitys">
        <span>Arvio: kiinnostavuus, vaihtelu ja hinta</span>
        {recommendationUpdatedAt && <span>Päivitetty {formatUpdatedAt(recommendationUpdatedAt)}</span>}
        <span>
          Ykkösvalinnan lähde:{" "}
          <a href={recommendationSource.url} target="_blank" rel="noreferrer">
            {recommendationSource.name}
            <NewTabHint />
          </a>
        </span>
      </div>
    </section>
  );
}

function OtherMenus({ data }: { data: DayResponse }) {
  const recommendedRestaurantIds = new Set(
    data.recommendations.map((recommendation) => recommendation.restaurant.id),
  );
  const otherMenus = data.menus.filter(
    (entry) => !recommendedRestaurantIds.has(entry.restaurant.id),
  );

  if (otherMenus.length === 0) return null;

  return (
    <section className="section all-menus" aria-labelledby="all-menus-title">
      <header className="section-heading compact-heading">
        <h2 id="all-menus-title">Muut päivän lounaat</h2>
        <span className="result-count">
          {otherMenus.length} {otherMenus.length === 1 ? "ravintola" : "ravintolaa"}
        </span>
      </header>
      <ul className="menu-list">
        {otherMenus.map((entry) => (
          <li key={entry.restaurant.id}>
            <article className="menu-row">
              <header className="menu-row-heading">
                <div className="menu-row-restaurant">
                  <h3>
                    <a href={restaurantHref(entry.restaurant.id, data.serviceDate)}>
                      {entry.restaurant.name}
                    </a>
                  </h3>
                  {entry.restaurant.address && <small>{entry.restaurant.address}</small>}
                </div>
                <div className="menu-row-meta">
                  {(entry.menu.lunchHours || entry.menu.priceText) && (
                    <span className="menu-row-facts">
                      {[entry.menu.lunchHours, entry.menu.priceText].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  {entry.menu.source && entry.menu.source.url !== data.source.url && (
                    <a
                      className="menu-row-source"
                      href={entry.menu.source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {entry.menu.source.name}
                      <NewTabHint />
                    </a>
                  )}
                </div>
              </header>
              <div className="menu-row-body">
                <MenuContent menu={entry.menu} showRawText={false} />
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DayPage({ browser }: { browser: BrowserAdapter }) {
  const [date, setDate] = useState(() => dayRouteDate(browser.location().search));
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
    };
    return browser.subscribePopState(syncDate);
  }, [browser]);

  function changeDate(nextDate: string) {
    browser.push(dayHref(nextDate));
    setDate(nextDate);
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
      <main className="reader-main" aria-busy={!error && data === null}>
        <p className="visually-hidden" role="status" aria-atomic="true">
          {loadedDayAnnouncement}
        </p>
        <section className="day-wayfinding" aria-labelledby="day-title">
          <DateNavigation date={date} onChange={changeDate} />
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
                <RecommendationList data={data} />
                {data.status === "unavailable" && data.menus.length === 0 && (
                  <div className="inline-state empty-day-state">
                    Valitse toinen päivä yllä olevilla nuolilla.
                  </div>
                )}
                {data.menus.length > 0 && <OtherMenus data={data} />}
                {data.menus.some((entry) => entry.menu.structuredMenu?.courses.length) && (
                  <MenuDataNotice />
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

function DayMenu({ day }: { day: RestaurantDay }) {
  return day.text || day.structuredMenu?.courses.length
    ? <MenuContent menu={day} />
    : <EmptyDayMessage day={day} />;
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
  const [data, setData] = useState<RestaurantWeekResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
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
          setError(true);
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
    };
    return browser.subscribePopState(syncWeek);
  }, [browser]);

  function changeWeek(amount: number) {
    const nextWeek = addDays(week, amount);
    const nextDate = addDays(selectedDate, amount);
    browser.push(restaurantWeekHref(restaurantId, nextWeek, nextDate));
    setWeek(nextWeek);
    setSelectedDate(nextDate);
  }

  function goToToday() {
    const today = todayInHelsinki();
    const todayWeek = startOfWeek(today);
    browser.push(restaurantWeekHref(restaurantId, todayWeek, today));
    setWeek(todayWeek);
    setSelectedDate(today);
  }

  const activeDay = data
    ? data.days.find((day) => day.serviceDate === selectedDate)
      ?? data.days.find((day) => day.status === "published")
      ?? data.days[0]
    : undefined;
  const otherDays = data && activeDay
    ? data.days.filter((day) => day.serviceDate !== activeDay.serviceDate)
    : [];
  const displayedDate = activeDay?.serviceDate ?? selectedDate;
  const returnDate = displayedDate;
  const today = todayInHelsinki();

  useEffect(() => {
    const restaurantName = data?.restaurant.name ?? "Ravintolan ruokalista";
    document.title = `${restaurantName} – ${formatLongDate(displayedDate)} | Mihin lounaalle?`;
  }, [data?.restaurant.name, displayedDate]);

  const loadedWeekAnnouncement = !loading && !error && data
    ? activeDay
      ? `${data.restaurant.name}: ${formatLongDate(activeDay.serviceDate)} ladattu.`
      : `${data.restaurant.name}: viikolle ${formatShortDate(week)}–${formatShortDate(addDays(week, 6))} ei löytynyt ruokalistaa.`
    : "";

  return (
    <>
      <AppHeader />
      <main className="reader-main restaurant-page" aria-busy={loading}>
        <p className="visually-hidden" role="status" aria-atomic="true">
          {loadedWeekAnnouncement}
        </p>
        <a className="back-link" href={`/?date=${returnDate}`}>
          <span aria-hidden="true">←</span>
          <span>{formatLongDate(returnDate)} · suosituksiin</span>
        </a>
        {data && (
            <section className="restaurant-hero">
              <div>
                <h1>{data.restaurant.name}</h1>
                <div className="restaurant-meta">
                  {data.restaurant.address && <span>{data.restaurant.address}</span>}
                  {data.restaurant.phone && <a href={`tel:${data.restaurant.phone}`}>{data.restaurant.phone}</a>}
                  {data.restaurant.address && (
                    <a
                      href={mapHref(data.restaurant.address)}
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
              onClick={goToToday}
            >
              Tänään
            </button>
          )}
          <button type="button" aria-label="Seuraava viikko" onClick={() => changeWeek(7)}>→</button>
        </nav>

        {error && <ErrorState onRetry={() => setRetry((value) => value + 1)} />}
        {loading && <LoadingState label="Ravintolan ruokalistaa ladataan…" />}
        {!loading && !error && data && !activeDay && (
          <>
            <section className="state-panel empty-week-state" aria-labelledby="empty-week-title">
              <h2 id="empty-week-title">Viikolle ei löytynyt ruokalistaa.</h2>
              <p>Vaihda viikkoa tai palaa valitun päivän suosituksiin.</p>
              <a className="button button-dark" href={`/?date=${returnDate}`}>
                Palaa suosituksiin
              </a>
            </section>
            <SourceFooter source={data.source} updatedAt={null} />
          </>
        )}
        {!loading && !error && data && activeDay && (
          <>

            <section className="restaurant-content" aria-labelledby="week-menu-title">
              <h2 className="visually-hidden" id="week-menu-title">Viikon ruokalista</h2>
              <div className="week-main">
                <article className="selected-day">
                  <header className="selected-day-heading">
                    <h2>{formatLongDate(activeDay.serviceDate)}</h2>
                    <div className="menu-facts">
                      {activeDay.lunchHours && <span className="hours">{activeDay.lunchHours}</span>}
                      {activeDay.priceText && <span className="hours">{activeDay.priceText}</span>}
                    </div>
                  </header>
                  {hasDietaryMarkers(activeDay) && <DietarySafetyNote />}
                  <DayMenu day={activeDay} />
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
                        <div className="day-row-body"><DayMenu day={day} /></div>
                      </article>
                    ))}
                  </div>
                </section>

                {data.days.some((day) => day.structuredMenu?.courses.length) && (
                  <MenuDataNotice />
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
                  {activeDay.fetchedAt && <p>Päivitetty {formatUpdatedAt(activeDay.fetchedAt)}</p>}
                </section>
              </aside>
            </section>
          </>
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
  if (route.kind === "restaurant") {
    return <RestaurantPage browser={browser} restaurantId={route.restaurantId} />;
  }
  return <DayPage browser={browser} />;
}
