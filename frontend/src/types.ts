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
  priceText?: string | null;
  source?: SourceAttribution;
  status: string;
  structuredMenu: StructuredMenu | null;
  text: string | null;
  title: string | null;
}

export interface StructuredMenu {
  courses: Array<{
    category: "unknown" | "starter" | "soup" | "main" | "side" | "salad" | "dessert" | "bread" | "drink" | "other";
    dietaryMarkers: string[];
    explicitAllergens: string[];
    nameFi: string;
  }>;
}

export interface AdminOverview {
  counts: {
    assessments: number;
    customSources: number;
    fetches: number;
    offeringRevisions: number;
    recommendationSets: number;
    restaurants: number;
  };
  errors: Array<{
    affectedDateCount: number;
    id: number;
    message: string | null;
    occurredAt: string;
    outcome: string;
    serviceDate: string;
    sourceUrl: string | null;
  }>;
  generatedAt: string;
  latestFetch: {
    attemptedAt: string | null;
    lastSuccessfulAt: string | null;
    outcome: string | null;
  };
  openAiConfigured: boolean;
  refresh: {
    currentTarget: string | null;
    lastError: { at: string; message: string; target: string } | null;
    lastFinishedAt: string | null;
    running: boolean;
    startedAt: string | null;
  };
  sources: Array<{
    createdAt: string;
    enabled: boolean;
    id: number;
    lastError: string | null;
    lastOutcome: string | null;
    lastRunAt: string | null;
    restaurantName: string | null;
    url: string;
  }>;
  uptimeSeconds: number;
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
    priceText?: string | null;
    serviceDate: string;
    source?: SourceAttribution | null;
    status: string;
    structuredMenu: StructuredMenu | null;
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
