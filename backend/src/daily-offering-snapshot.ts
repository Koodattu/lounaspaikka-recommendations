import type Database from "better-sqlite3";

export interface DailyOfferingSnapshotEntry {
  fetchedAt: string;
  offering: {
    availability: string;
    lunchHours: string | null;
    menuText: string | null;
    menuTitle: string | null;
    priceText: string | null;
  };
  restaurant: {
    address: string | null;
    city: string | null;
    customSourceId: number | null;
    customSourceUrl: string | null;
    id: string;
    latitude: number | null;
    longitude: number | null;
    name: string;
    phone: string | null;
    photoUrl: string | null;
    websiteUrl: string | null;
  };
  revisionId: number;
}

export interface DailyOfferingSnapshot {
  entries: DailyOfferingSnapshotEntry[];
  serviceDate: string;
}

interface SnapshotRow {
  address: string | null;
  availability: string;
  city: string | null;
  customSourceId: number | null;
  customSourceUrl: string | null;
  fetchedAt: string;
  latitude: number | null;
  longitude: number | null;
  lunchHours: string | null;
  menuText: string | null;
  menuTitle: string | null;
  name: string;
  phone: string | null;
  photoUrl: string | null;
  priceText: string | null;
  restaurantId: string;
  revisionId: number;
  serviceDate: string;
  websiteUrl: string | null;
}

const queryChunkSize = 100;

export function getDailyOfferingSnapshots(
  db: Database.Database,
  requestedServiceDates: readonly string[],
): DailyOfferingSnapshot[] {
  const serviceDates = [...new Set(requestedServiceDates)];
  const entriesByDate = new Map(
    serviceDates.map((serviceDate) => [serviceDate, [] as DailyOfferingSnapshotEntry[]]),
  );

  for (let offset = 0; offset < serviceDates.length; offset += queryChunkSize) {
    const chunk = serviceDates.slice(offset, offset + queryChunkSize);
    const requestedDates = chunk.map(() => "(?)").join(", ");
    const rows = db
      .prepare(
        `WITH requested_dates(service_date) AS (
          VALUES ${requestedDates}
        ), active_sources(custom_source_id) AS (
          SELECT NULL
          UNION ALL
          SELECT id FROM custom_sources WHERE enabled = 1
        ), latest_fetches AS (
          SELECT requested_dates.service_date, (
            SELECT fetch.id
            FROM source_fetches fetch
            WHERE fetch.service_date = requested_dates.service_date
              AND fetch.outcome = 'success'
              AND fetch.custom_source_id IS active_sources.custom_source_id
            ORDER BY fetch.id DESC
            LIMIT 1
          ) AS id
          FROM requested_dates CROSS JOIN active_sources
        )
        SELECT
          latest_fetches.service_date AS serviceDate,
          fetch.finished_at AS fetchedAt,
          revision.id AS revisionId,
          revision.availability,
          revision.menu_title AS menuTitle,
          revision.menu_text AS menuText,
          revision.lunch_hours AS lunchHours,
          revision.price_text AS priceText,
          restaurant.id AS restaurantId,
          restaurant.name,
          restaurant.address,
          restaurant.city,
          restaurant.latitude,
          restaurant.longitude,
          restaurant.website_url AS websiteUrl,
          restaurant.phone,
          restaurant.photo_url AS photoUrl,
          restaurant.custom_source_id AS customSourceId,
          custom_source.url AS customSourceUrl
        FROM latest_fetches
        JOIN source_fetches fetch ON fetch.id = latest_fetches.id
        JOIN fetch_observations observation ON observation.fetch_id = fetch.id
        JOIN offering_revisions revision ON revision.id = observation.revision_id
        JOIN restaurants restaurant ON restaurant.id = observation.restaurant_id
        LEFT JOIN custom_sources custom_source ON custom_source.id = restaurant.custom_source_id
        ORDER BY latest_fetches.service_date, restaurant.name COLLATE NOCASE, restaurant.id`,
      )
      .all(...chunk) as SnapshotRow[];

    for (const row of rows) {
      entriesByDate.get(row.serviceDate)?.push({
        fetchedAt: row.fetchedAt,
        offering: {
          availability: row.availability,
          lunchHours: row.lunchHours,
          menuText: row.menuText,
          menuTitle: row.menuTitle,
          priceText: row.priceText,
        },
        restaurant: {
          address: row.address,
          city: row.city,
          customSourceId: row.customSourceId,
          customSourceUrl: row.customSourceUrl,
          id: row.restaurantId,
          latitude: row.latitude,
          longitude: row.longitude,
          name: row.name,
          phone: row.phone,
          photoUrl: row.photoUrl,
          websiteUrl: row.websiteUrl,
        },
        revisionId: row.revisionId,
      });
    }
  }

  return serviceDates.map((serviceDate) => ({
    entries: entriesByDate.get(serviceDate) ?? [],
    serviceDate,
  }));
}

export function getDailyOfferingSnapshot(
  db: Database.Database,
  serviceDate: string,
): DailyOfferingSnapshot {
  return getDailyOfferingSnapshots(db, [serviceDate])[0]!;
}
