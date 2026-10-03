import { createServer } from "../../backend/dist/http-app.js";
import { createCustomSourceService } from "../../backend/dist/custom-sources.js";
import { createRecommendationPublication } from "../../backend/dist/recommendation-publication.js";
import { createFixture } from "./fixture.mjs";

const planning = process.argv.includes("--planning");
const db = await createFixture({ varied: planning });
const attempts = new Map();
// External boundaries are synthetic; source persistence and diagnostics are real.
const sources = createCustomSourceService({
  db, model: "synthetic-preview",
  fetchPage: async (url) => {
    const attempt = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, attempt);
    if (url.endsWith("/retry-once") && attempt === 2) throw new Error("Synthetic preview connection failure");
    return { body: "synthetic", text: url, finalUrl: url, httpStatus: 200, truncated: false };
  },
  extractor: async ({ serviceDates, pageText }) => ({ extraction: {
    pageType: pageText.endsWith("/failure") ? "unsupported" : "restaurant_page",
    restaurant: { name: pageText.endsWith("/retry-once") ? "Esimerkkiravintola Päivän pitkä pöytä ja puutarhakeittiö" : "Esimerkkiravintola", address: "Esimerkkitie 1", city: "Seinäjoki", description: null, phone: null, openingHours: [] },
    menus: serviceDates.map((serviceDate) => ({ serviceDate, status: "published", menuText: "Kasvislasagne", lunchHours: "11–14", priceText: "12 €", title: "Lounas" })),
  } }),
});
if (planning) {
  await sources.addAndCrawl("https://example.test/retry-once", ["2026-10-02", "2026-10-03"]);
  await sources.addAndCrawl("https://example.test/retry-once", ["2026-10-02", "2026-10-03", "2026-10-04"])
    .catch(() => console.info("Seeded expected synthetic source failure; its next retry succeeds."));
  await sources.addAndCrawl("https://example.test/failure", ["2026-10-03", "2026-10-04"])
    .catch(() => console.info("Seeded expected synthetic extraction failure."));
}
const publication = createRecommendationPublication({
  db, customSources: sources, assessor: null, versions: {}, adminRequestBudget: 0, refreshRequestBudget: 0,
});
const app = createServer({
  db, adminPassword: "local-preview-only-password", openAiConfigured: true,
  addCustomSource: (url) => sources.addAndCrawl(url, ["2026-10-03", "2026-10-04"]),
  setCustomSourceEnabled: (id, enabled) => publication.setCustomSourceEnabled(id, enabled, ["2026-10-03", "2026-10-04"]),
});
await app.listen({ host: "127.0.0.1", port: 3000 });
console.info("Synthetic preview API: http://127.0.0.1:3000 (in-memory database, no external integrations)");
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => { await app.close(); db.close(); });
}
