import type {
  CapturedLounaspaikkaOffering,
  LounaspaikkaCatchmentAdapter,
} from "../src/lounaspaikka-catchment.js";

export function capturedOffering(
  id: string,
  name: string,
  menuText: string | null,
  overrides: Partial<CapturedLounaspaikkaOffering> = {},
): CapturedLounaspaikkaOffering {
  return {
    address: null,
    availability: menuText ? "published" : "not_published",
    city: "Seinäjoki",
    descriptionText: null,
    id,
    latitude: 62.79,
    longitude: 22.84,
    lunchHours: menuText ? "10.30–14" : null,
    menuText,
    menuTitle: menuText ? "Päivän lounas" : null,
    name,
    openingHours: [],
    phone: null,
    photoUrl: null,
    priceText: null,
    sourceSnapshot: { fixture: true },
    websiteUrl: null,
    ...overrides,
  };
}

export function catchmentAdapterForOfferings(
  offerings: CapturedLounaspaikkaOffering[] | (() => CapturedLounaspaikkaOffering[]),
): LounaspaikkaCatchmentAdapter {
  return {
    async observe(serviceDate) {
      const currentOfferings = typeof offerings === "function" ? offerings() : offerings;
      return {
        offerings: currentOfferings,
        pages: [{ body: "fixture", status: 200, url: "https://fixture.test" }],
        request: {
          latitude: 62.7907,
          longitude: 22.8396,
          maxDistance: 50_000,
          serviceDate,
        },
      };
    },
  };
}
