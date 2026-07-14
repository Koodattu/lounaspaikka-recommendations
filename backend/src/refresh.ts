import cron, { type ScheduledTask } from "node-cron";

import { addDays } from "./dates.js";

interface RefreshCoordinatorOptions {
  now?: () => Date;
  onError?: (serviceDate: string, error: unknown) => void;
  runDate: (serviceDate: string) => Promise<void>;
}

function helsinkiDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Helsinki",
    year: "numeric",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function datesToRefresh(now: Date): string[] {
  const today = helsinkiDate(now);
  const weekday = new Date(`${today}T09:00:00.000Z`).getUTCDay();
  const daysThroughSunday = weekday === 0 ? 7 : 7 - weekday;
  return Array.from({ length: daysThroughSunday + 1 }, (_, index) => addDays(today, index));
}

export function createRefreshCoordinator(options: RefreshCoordinatorOptions): {
  run: () => Promise<void>;
  stop: () => void;
  waitForIdle: () => Promise<void>;
} {
  const now = options.now ?? (() => new Date());
  let currentRun: Promise<void> | null = null;
  let stopped = false;

  return {
    run() {
      if (stopped) return Promise.resolve();
      if (currentRun) return currentRun;
      const work = (async () => {
        for (const serviceDate of datesToRefresh(now())) {
          if (stopped) break;
          try {
            await options.runDate(serviceDate);
          } catch (error) {
            options.onError?.(serviceDate, error);
          }
        }
      })();
      currentRun = work.finally(() => {
        currentRun = null;
      });
      return currentRun;
    },
    stop() {
      stopped = true;
    },
    waitForIdle() {
      return currentRun ?? Promise.resolve();
    },
  };
}

export function startRefreshSchedule(run: () => Promise<void>): ScheduledTask {
  return cron.schedule(
    "15 4 * * *",
    () => {
      void run();
    },
    {
      name: "lunch-refresh",
      noOverlap: true,
      timezone: "Europe/Helsinki",
    },
  );
}
