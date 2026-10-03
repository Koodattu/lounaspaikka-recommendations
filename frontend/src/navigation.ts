import { isIsoDate, startOfWeek, todayInHelsinki } from "./dates";

export interface BrowserLocation {
  pathname: string;
  search: string;
  hash?: string;
}

export interface BrowserAdapter {
  location(): BrowserLocation;
  push(path: string): void;
  replace(path: string): void;
  reload(): void;
  subscribePopState(listener: () => void): () => void;
}

export const browserAdapter: BrowserAdapter = {
  location: () => ({
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
  }),
  push: (path) => window.history.pushState({}, "", path),
  replace: (path) => window.history.replaceState({}, "", path),
  reload: () => window.location.reload(),
  subscribePopState: (listener) => {
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  },
};

export type AppRoute =
  | { kind: "admin" }
  | { kind: "day" }
  | { kind: "restaurant-not-found" }
  | { kind: "restaurant"; restaurantId: string };

export function appRoute(pathname: string): AppRoute {
  if (pathname === "/admin" || pathname === "/admin/") return { kind: "admin" };
  const restaurantMatch = pathname.match(/^\/ravintolat\/([^/]+)\/?$/);
  if (restaurantMatch?.[1]) {
    try {
      return {
        kind: "restaurant",
        restaurantId: decodeURIComponent(restaurantMatch[1]),
      };
    } catch {
      return { kind: "restaurant-not-found" };
    }
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

export function menuSearchQuery(search: string): string {
  return new URLSearchParams(search).get("q") ?? "";
}

export function menuTargetId(restaurantId: string): string {
  return `menu-${encodeURIComponent(restaurantId)}`;
}

export function dayHref(date: string, query = "", restaurantId?: string): string {
  const params = new URLSearchParams({ date });
  if (query) params.set("q", query);
  const target = restaurantId ? `#${encodeURIComponent(menuTargetId(restaurantId))}` : "";
  return `/?${params}${target}`;
}

export function restaurantHref(restaurantId: string, date: string, query = ""): string {
  return restaurantWeekHref(restaurantId, startOfWeek(date), date, query);
}

export function restaurantWeekHref(
  restaurantId: string,
  week: string,
  date: string,
  query = "",
): string {
  const params = new URLSearchParams({ week, date });
  if (query) params.set("q", query);
  return `/ravintolat/${encodeURIComponent(restaurantId)}?${params}`;
}
