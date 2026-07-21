import type Database from "better-sqlite3";

import {
  LounaspaikkaCatchmentObservationError,
  type CapturedLounaspaikkaOffering,
  type LounaspaikkaCatchmentAdapter,
  type LounaspaikkaCatchmentObservation,
} from "./lounaspaikka-catchment.js";
import {
  persistFailedFetch,
  persistSuccessfulFetch,
  sha256,
  type PersistResult,
} from "./offering-store.js";

export interface RestaurantCatchment {
  refresh(serviceDate: string): Promise<PersistResult>;
}

interface RestaurantCatchmentOptions {
  db: Database.Database;
  lounaspaikka: LounaspaikkaCatchmentAdapter;
  now?: () => Date;
}

function storedOffering(offering: CapturedLounaspaikkaOffering) {
  const { sourceSnapshot, ...facts } = offering;
  return {
    ...facts,
    customSourceId: null,
    snapshot: sourceSnapshot,
  };
}

export function createRestaurantCatchment(
  options: RestaurantCatchmentOptions,
): RestaurantCatchment {
  const now = options.now ?? (() => new Date());

  return {
    async refresh(serviceDate) {
      const startedAt = now().toISOString();
      let observation: LounaspaikkaCatchmentObservation | undefined;

      try {
        observation = await options.lounaspaikka.observe(serviceDate);
        return persistSuccessfulFetch({
          db: options.db,
          finishedAt: now().toISOString(),
          httpStatus: observation.pages.at(-1)?.status ?? null,
          offerings: observation.offerings.map(storedOffering),
          request: observation.request,
          responseHash: sha256(observation.pages.map((page) => page.body)),
          responsePages: observation.pages,
          serviceDate,
          startedAt,
        });
      } catch (error) {
        const observationError = error instanceof LounaspaikkaCatchmentObservationError
          ? error
          : null;
        const pages = observationError?.pages ?? observation?.pages ?? null;

        persistFailedFetch({
          db: options.db,
          errorMessage: error instanceof Error ? error.message : "Unknown catchment error",
          finishedAt: now().toISOString(),
          httpStatus: observationError?.httpStatus ?? null,
          outcome: observationError?.outcome ?? (observation ? "invalid_response" : "network_error"),
          request: observationError?.request ?? observation?.request ?? { serviceDate },
          responseHash: pages ? sha256(pages.map((page) => page.body)) : null,
          responsePages: pages,
          serviceDate,
          startedAt,
        });
        throw error;
      }
    },
  };
}
