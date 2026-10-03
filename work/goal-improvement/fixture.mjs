// Synthetic data only. Uses the real ingestion, assessment and SQLite interfaces.
import { openDatabase } from "../../backend/dist/database.js";
import { createRestaurantCatchment } from "../../backend/dist/restaurant-catchment.js";
import { assessAndRankDay } from "../../backend/dist/recommendations.js";
import { addDays } from "../../backend/dist/dates.js";

const names = ["Lounastupa Aava", "Ravintola Pihlaja", "Keittiö Joki", "Kahvila Kanerva"];
const dishes = ["Paahdettua kuhaa ja sitruunaperunoita", "Kasviscurry ja basmatiriisi", "Lihapullat ja perunamuusi", "Lohikeitto ja ruisleipä"];

export async function createFixture({ restaurants = 32, days = 7, firstDate = "2026-09-28", varied = false } = {}) {
  const db = openDatabase(":memory:");
  const catchment = createRestaurantCatchment({
    db,
    now: () => new Date("2026-10-03T03:15:00Z"),
    lounaspaikka: {
      async observe(serviceDate) {
        const dayOffset = varied ? Math.round((Date.parse(serviceDate) - Date.parse(firstDate)) / 86_400_000) : 0;
        return {
          request: { serviceDate },
          pages: [{ body: "synthetic preview fixture", status: 200, url: "https://example.test/menu" }],
          offerings: Array.from({ length: restaurants }, (_, i) => ({
            id: `demo-${i + 1}`, name: i < 4 ? names[i] : `Lounaskeittiö ${i + 1}`,
            address: `Esimerkkikatu ${i + 1}`, city: i % 3 === 0 ? "Ilmajoki" : "Seinäjoki",
            availability: i % 11 === 10 || (varied && i === 0 && dayOffset === 6) ? "not_published" : "published",
            descriptionText: "Synteettinen paikallisen lounasravintolan esimerkki.",
            latitude: null, longitude: null, lunchHours: "10.30–14.00",
            menuText: i % 11 === 10 || (varied && i === 0 && dayOffset === 6)
              ? null
              : `${dishes[(i + dayOffset) % 4]}\nVihersalaatti\nMarjarahka${varied && i === 1 ? "\nTalon leipää, kasvislevitettä ja paahdettuja siemeniä\nKahvi, tee ja päivän pieni makea sisältyvät lounaaseen" : ""}`,
            menuTitle: "Päivän lounas", priceText: "13,50 €",
            openingHours: [{ mon: [{ open: "10.30", close: "15.00" }] }],
            phone: null, photoUrl: null, websiteUrl: "https://example.test/menu",
            sourceSnapshot: { synthetic: true },
          })),
        };
      },
    },
  });
  for (let day = 0; day < days; day++) {
    const serviceDate = addDays(firstDate, day);
    await catchment.refresh(serviceDate);
    await assessAndRankDay({
      db, serviceDate,
      now: () => new Date("2026-10-03T03:16:00Z"),
      assessor: {
        async assess(facts) {
          const score = facts.menuText.includes("kuhaa") ? 8.4 : 7.2;
          return { assessment: {
            scores: { appeal: score, distinctiveness: 7, value: 8, variety: 7.5 },
            rationaleFi: "Monipuolinen lounas ja selkeästi ilmoitettu hinta helpottavat päivän valintaa.",
            structuredMenu: { courses: facts.menuText.split("\n").map((nameFi, i) => ({
              nameFi, category: i === 0 ? "main" : i === 1 ? "salad" : "dessert",
              dietaryMarkers: i === 1 ? ["G", "VE"] : [], explicitAllergens: [],
            })) },
          } };
        },
      },
    });
  }
  return db;
}
