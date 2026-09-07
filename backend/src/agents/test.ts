// backend/src/agents/test.ts — Laptop B standalone verification.
// Calls getMarineData + getWeatherRisk directly (no Ollama, no graph) and
// asserts the outputs match backend/src/types.ts exactly.
// Run: npx tsx src/agents/test.ts   (from backend/)
import { getMarineData, haversineKm } from "./marineData.ts";
import { buildReasoning, computeVerdict, getWeatherRisk } from "./weatherRisk.ts";
import type { QueryState } from "../types.ts";

type MarineData = NonNullable<QueryState["marineData"]>;
type WeatherRisk = NonNullable<QueryState["weatherRisk"]>;

let failures = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}`);
  }
}

const VIZAG: QueryState["region"] = { name: "Visakhapatnam", lat: 17.6868, lon: 83.2185 };

async function testMarine(): Promise<void> {
  console.log("\n=== getMarineData (Visakhapatnam) ===");
  const m: MarineData = await getMarineData(VIZAG);
  console.log(JSON.stringify(m, null, 2));

  assert(Array.isArray(m.pfzZones) && m.pfzZones.length >= 3, `pfzZones has >=3 zones (got ${m.pfzZones.length})`);
  assert(
    m.pfzZones.every(
      (z) => typeof z.lat === "number" && typeof z.lon === "number" && typeof z.distanceKm === "number" && z.distanceKm > 0,
    ),
    "every zone has numeric lat/lon/distanceKm > 0",
  );
  const sorted = m.pfzZones.every((z, i, a) => i === 0 || a[i - 1].distanceKm <= z.distanceKm);
  assert(sorted, "pfzZones sorted nearest-first");
  // Spot-check: distances must equal haversine from the query region exactly.
  const recomputed = m.pfzZones.every(
    (z) => Math.abs(z.distanceKm - Math.round(haversineKm(VIZAG.lat, VIZAG.lon, z.lat, z.lon) * 10) / 10) < 1e-9,
  );
  assert(recomputed, "distanceKm values match haversine from query region");
  assert(typeof m.sstCelsius === "number" && m.sstCelsius > 20 && m.sstCelsius < 35, `sstCelsius plausible (${m.sstCelsius})`);
  assert(typeof m.chlorophyll === "number" && m.chlorophyll > 0, `chlorophyll present (${m.chlorophyll})`);
  assert(typeof m.source === "string" && m.source.includes("INCOIS"), `source cites INCOIS (${m.source})`);
  assert(typeof m.fetchedAt === "string" && !Number.isNaN(Date.parse(m.fetchedAt)), `fetchedAt is valid ISO (${m.fetchedAt})`);

  // Region-awareness: a far-away query region must produce larger distances.
  console.log("\n=== getMarineData (region-awareness: Chennai) ===");
  const chennai = await getMarineData({ name: "Chennai", lat: 13.0827, lon: 80.2707 });
  assert(
    chennai.pfzZones[0].distanceKm > m.pfzZones[0].distanceKm,
    `distances grow for far region (Chennai nearest ${chennai.pfzZones[0].distanceKm} km vs Vizag ${m.pfzZones[0].distanceKm} km)`,
  );
}

async function testWeather(): Promise<void> {
  console.log("\n=== getWeatherRisk (Visakhapatnam) ===");
  const w: WeatherRisk = await getWeatherRisk(VIZAG);
  console.log(JSON.stringify(w, null, 2));

  assert(typeof w.waveHeightM === "number" && w.waveHeightM >= 0, `waveHeightM numeric (${w.waveHeightM})`);
  assert(typeof w.windSpeedKmh === "number" && w.windSpeedKmh >= 0, `windSpeedKmh numeric (${w.windSpeedKmh})`);
  assert(Array.isArray(w.alerts), "alerts is an array");
  assert(w.verdict === "safe" || w.verdict === "caution" || w.verdict === "unsafe", `verdict valid (${w.verdict})`);
  assert(typeof w.reasoning === "string" && w.reasoning.length > 20, "reasoning is a non-trivial sentence");
  assert(w.reasoning.includes("IMD") || w.reasoning.includes("Visakhapatnam"), "reasoning cites the bulletin source");

  // Cache values are the real IMD bulletin: 15-20 kt -> ~32 km/h, sea slight-to-moderate -> 1.5 m -> caution.
  assert(w.windSpeedKmh === 32, `wind matches IMD bulletin midpoint (got ${w.windSpeedKmh})`);
  assert(w.waveHeightM === 1.5, `wave height matches derived value (got ${w.waveHeightM})`);
  assert(w.verdict === "caution", `verdict is caution for 1.5 m, no alerts (got ${w.verdict})`);
  assert(w.alerts.length === 0, "no active alerts (IMD Warning NIL)");

  console.log("\n=== computeVerdict decision boundaries ===");
  assert(computeVerdict(1.0, []) === "safe", "1.0 m, no alerts -> safe");
  assert(computeVerdict(1.4, []) === "safe", "1.4 m, no alerts -> safe");
  assert(computeVerdict(1.5, []) === "caution", "1.5 m boundary -> caution");
  assert(computeVerdict(2.5, []) === "caution", "2.5 m boundary -> caution");
  assert(computeVerdict(2.6, []) === "unsafe", "2.6 m -> unsafe");
  assert(computeVerdict(0.5, ["cyclone-watch"]) === "unsafe", "any alert -> unsafe");
  assert(computeVerdict(5.0, ["high-wave"]) === "unsafe", "high wave + alert -> unsafe");

  console.log("\n=== buildReasoning sanity ===");
  const r = buildReasoning(1.5, 32, {
    issuer: "CWC Visakhapatnam (IMD)",
    type: "t",
    validFrom: "x",
    validTo: "y",
    issuedAt: "2026-09-02T13:24:00+05:30",
    wind: "MAINLY SOUTHWESTERLY 15-20 KNOTS",
    weather: "SCATTERED RAIN",
    seaCondition: "SLIGHT TO MODERATE",
    portSignal: "NIL AT ALL PORTS",
    warning: "NIL",
  }, "caution");
  assert(r.length > 50 && r.includes("1.5"), "reasoning embeds wave height and bulletin facts");
}

async function main(): Promise<void> {
  await testMarine();
  await testWeather();
  console.log(`\n${failures === 0 ? "ALL LAPTOP-B TESTS PASSED" : `${failures} TEST(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test run crashed:", err);
  process.exit(1);
});
