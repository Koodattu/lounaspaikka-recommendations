import { describe, expect, it, vi } from "vitest";

import { createRefreshCoordinator, datesToRefresh } from "../src/refresh.js";

describe("scheduled refresh", () => {
  it("refreshes through Sunday and includes the next week when run on Sunday", () => {
    expect(datesToRefresh(new Date("2026-07-13T01:15:00.000Z"))).toEqual([
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
      "2026-07-19",
    ]);
    expect(datesToRefresh(new Date("2026-07-12T01:15:00.000Z"))).toEqual([
      "2026-07-12",
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
      "2026-07-19",
    ]);
  });

  it("coalesces overlapping runs and continues after one date fails", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstDate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const runDate = vi
      .fn<(serviceDate: string) => Promise<void>>()
      .mockImplementationOnce(() => firstDate)
      .mockRejectedValueOnce(new Error("source unavailable"))
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const coordinator = createRefreshCoordinator({
      now: () => new Date("2026-07-17T01:15:00.000Z"),
      onError,
      runDate,
    });

    const firstRun = coordinator.run();
    const overlappingRun = coordinator.run();
    expect(overlappingRun).toBe(firstRun);
    expect(runDate).toHaveBeenCalledTimes(1);

    releaseFirst?.();
    await firstRun;

    expect(runDate.mock.calls.map(([serviceDate]) => serviceDate)).toEqual([
      "2026-07-17",
      "2026-07-18",
      "2026-07-19",
    ]);
    expect(onError).toHaveBeenCalledWith("2026-07-18", expect.any(Error));
  });
});
