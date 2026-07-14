import cron, { type ScheduledTask } from "node-cron";

import { addDays } from "./dates.js";

interface RefreshCoordinatorOptions {
  afterDates?: (serviceDates: string[]) => Promise<void>;
  now?: () => Date;
  onError?: (serviceDate: string, error: unknown) => void;
  runDate: (serviceDate: string) => Promise<void>;
}

export interface RefreshStatus {
  currentTarget: string | null;
  lastError: { at: string; message: string; target: string } | null;
  lastFinishedAt: string | null;
  running: boolean;
  startedAt: string | null;
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
  getStatus: () => RefreshStatus;
  run: () => Promise<void>;
  stop: () => void;
  waitForIdle: () => Promise<void>;
} {
  const now = options.now ?? (() => new Date());
  let currentRun: Promise<void> | null = null;
  let stopped = false;
  const status: RefreshStatus = {
    currentTarget: null,
    lastError: null,
    lastFinishedAt: null,
    running: false,
    startedAt: null,
  };

  function recordError(target: string, error: unknown): void {
    status.lastError = {
      at: now().toISOString(),
      message: error instanceof Error ? error.message : "Unknown refresh error",
      target,
    };
    options.onError?.(target, error);
  }

  return {
    getStatus() {
      return {
        ...status,
        lastError: status.lastError ? { ...status.lastError } : null,
      };
    },
    run() {
      if (stopped) return Promise.resolve();
      if (currentRun) return currentRun;
      const work = (async () => {
        const serviceDates = datesToRefresh(now());
        status.running = true;
        status.startedAt = now().toISOString();
        status.lastError = null;
        for (const serviceDate of serviceDates) {
          if (stopped) break;
          status.currentTarget = serviceDate;
          try {
            await options.runDate(serviceDate);
          } catch (error) {
            recordError(serviceDate, error);
          }
        }
        if (!stopped && options.afterDates) {
          status.currentTarget = "finalization";
          try {
            await options.afterDates(serviceDates);
          } catch (error) {
            recordError("finalization", error);
          }
        }
      })();
      currentRun = work.finally(() => {
        status.currentTarget = null;
        status.lastFinishedAt = now().toISOString();
        status.running = false;
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
