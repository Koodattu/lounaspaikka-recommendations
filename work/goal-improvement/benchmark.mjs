// Run after `npm run build -w backend`. No network or persistent database.
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createFixture } from "./fixture.mjs";
import { getRestaurantWeek } from "../../backend/dist/queries.js";
import { getAdminOverview } from "../../backend/dist/admin-overview.js";

const workload = { restaurants: 80, days: 63, firstDate: "2026-08-03" };
const db = await createFixture(workload);
const operations = {
  restaurantWeek: () => getRestaurantWeek(db, "demo-1", "2026-09-28"),
  adminOverview: () => {
    const { uptimeSeconds, ...result } = getAdminOverview(db, {
      now: () => new Date("2026-10-03T09:00:00Z"), openAiConfigured: false,
      refresh: { currentTarget: null, lastError: null, lastFinishedAt: null, running: false, startedAt: null },
    });
    return result;
  },
};
const measurements = {};
for (const [name, run] of Object.entries(operations)) {
  const firstStart = performance.now();
  const result = run();
  const firstReadMs = performance.now() - firstStart;
  for (let i = 0; i < 5; i++) run();
  const samples = Array.from({ length: 25 }, () => {
    const start = performance.now(); run(); return performance.now() - start;
  }).sort((a, b) => a - b);
  measurements[name] = {
    firstReadMs: +firstReadMs.toFixed(3),
    medianMs: +samples[12].toFixed(3), p95Ms: +samples[23].toFixed(3),
    resultHash: createHash("sha256").update(JSON.stringify(result)).digest("hex"),
  };
}
console.log(JSON.stringify({ node: process.version, workload, warmup: 5, samples: 25, measurements }, null, 2));
db.close();
