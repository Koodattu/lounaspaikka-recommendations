import { createServer } from "../../backend/dist/http-app.js";
import { createCustomSourceService } from "../../backend/dist/custom-sources.js";
import { createFixture } from "./fixture.mjs";

const db = await createFixture();
// External boundaries are synthetic; source persistence and diagnostics are real.
const sources = createCustomSourceService({
  db, model: "synthetic-preview",
  fetchPage: async (url) => ({ body: "synthetic", text: url, finalUrl: url, httpStatus: 200, truncated: false }),
  extractor: async ({ serviceDates, pageText }) => ({ extraction: {
    pageType: pageText.endsWith("/failure") ? "unsupported" : "restaurant_page",
    restaurant: { name: "Esimerkkiravintola", address: "Esimerkkitie 1", city: "Seinäjoki", description: null, phone: null, openingHours: [] },
    menus: serviceDates.map((serviceDate) => ({ serviceDate, status: "published", menuText: "Kasvislasagne", lunchHours: "11–14", priceText: "12 €", title: "Lounas" })),
  } }),
});
const app = createServer({
  db, adminPassword: "local-preview-only-password", openAiConfigured: true,
  addCustomSource: (url) => sources.addAndCrawl(url, ["2026-10-03", "2026-10-04"]),
});
await app.listen({ host: "127.0.0.1", port: 3000 });
console.info("Synthetic preview API: http://127.0.0.1:3000 (in-memory database, no external integrations)");
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => { await app.close(); db.close(); });
}
