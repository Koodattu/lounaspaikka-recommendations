export interface Restaurant {
  address: string | null;
  city: string | null;
  id: string;
  latitude: number | null;
  longitude: number | null;
  name: string;
  phone: string | null;
  photoUrl: string | null;
  websiteUrl: string | null;
}

export interface Menu {
  lunchHours: string | null;
  status: string;
  text: string | null;
  title: string | null;
}

export interface SourceAttribution {
  name: string;
  url: string;
}

export interface DayResponse {
  generatedAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessfulFetchAt: string | null;
  menus: Array<{ fetchedAt: string; menu: Menu; restaurant: Restaurant }>;
  recommendations: Array<{
    menu: Menu;
    rank: number;
    rationale: string;
    restaurant: Restaurant;
    score: number;
  }>;
  serviceDate: string;
  source: SourceAttribution;
  stale: boolean;
  status: "pending" | "ready" | "unavailable";
}

export interface RestaurantWeekResponse {
  days: Array<{
    fetchedAt: string | null;
    lunchHours: string | null;
    serviceDate: string;
    status: string;
    text: string | null;
    title: string | null;
  }>;
  restaurant: Restaurant & {
    description: string | null;
    openingHours: Array<{
      periods: Array<{ close: string; open: string }>;
      weekday: string;
    }>;
  };
  source: SourceAttribution;
  weekEnd: string;
  weekStart: string;
}
