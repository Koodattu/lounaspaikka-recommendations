import { isIsoDate, startOfWeek, todayInHelsinki } from "./dates";

export interface BrowserLocation {
  pathname: string;
  search: string;
}

export interface BrowserAdapter {
  location(): BrowserLocation;
  push(path: string): void;
  reload(): void;
  subscribePopState(listener: () => void): () => void;
}

export const browserAdapter: BrowserAdapter = {
  location: () => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }),
  push: (path) => window.history.pushState({}, "", path),
  reload: () => window.location.reload(),
  subscribePopState: (listener) => {
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  },
};

export type AppRoute =
  | { kind: "admin" }
  | { kind: "day" }
  | { kind: "restaurant"; restaurantId: string };

export function appRoute(pathname: string): AppRoute {
  if (pathname === "/admin" || pathname === "/admin/") return { kind: "admin" };
  const restaurantMatch = pathname.match(/^\/ravintolat\/([^/]+)\/?$/);
  if (restaurantMatch?.[1]) {
    return {
      kind: "restaurant",
      restaurantId: decodeURIComponent(restaurantMatch[1]),
    };
  }
  return { kind: "day" };
}

export function dayRouteDate(
  search: string,
  today = todayInHelsinki(),
): string {
  const date = new URLSearchParams(search).get("date");
  return isIsoDate(date) ? date : today;
}

export function restaurantRouteState(
  search: string,
  today = todayInHelsinki(),
): { selectedDate: string; week: string } {
  const params = new URLSearchParams(search);
  const dateParam = params.get("date");
  const weekParam = params.get("week");

  if (isIsoDate(dateParam)) {
    return { selectedDate: dateParam, week: startOfWeek(dateParam) };
  }

  const week = isIsoDate(weekParam) ? startOfWeek(weekParam) : startOfWeek(today);
  const selectedDate = startOfWeek(today) === week ? today : week;
  return { selectedDate, week };
}

export function dayHref(date: string): string {
  return `/?date=${date}`;
}

export function restaurantHref(restaurantId: string, date: string): string {
  return restaurantWeekHref(restaurantId, startOfWeek(date), date);
}

export function restaurantWeekHref(
  restaurantId: string,
  week: string,
  date: string,
): string {
  return `/ravintolat/${encodeURIComponent(restaurantId)}?week=${week}&date=${date}`;
}
