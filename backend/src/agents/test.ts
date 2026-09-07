// backend/src/agents/test.ts — Laptop B standalone verification.
// Calls getMarineData + getWeatherRisk directly (no Ollama, no graph) and
// asserts the outputs match backend/src/types.ts exactly.
// Run: npx tsx src/agents/test.ts   (from backend/)
import { getMarineData, haversineKm } from "./marineData.ts";
import { buildReasoning, computeVerdict, detectEscalation, getWeatherRisk } from "./weatherRisk.ts";
import { daysBetween, expiryNote, STALE_AFTER_DAYS, stalenessNote } from "./cacheUtils.ts";
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
  assert(w.reasoning.includes("IMD") || w.reasoning.includes("Visakhapatnam") || w.reasoning.includes("provenance"), "reasoning cites the bulletin source + provenance");

  // Live-with-fallback: wave/wind may come from Open-Meteo when network is
  // available, else from the IMD cache. Assert internal consistency instead
  // of exact cache numbers.
  assert(w.verdict === computeVerdict(w.waveHeightM, w.alerts), `verdict consistent with wave/alerts (${w.verdict})`);
  assert(w.reasoning.includes("Data provenance:"), "reasoning carries data provenance");
  if (!w.reasoning.includes("Open-Meteo live")) {
    // Pure cache path (offline): values must match the pre-fetched bulletin.
    assert(w.windSpeedKmh === 32, `offline wind matches IMD bulletin midpoint (got ${w.windSpeedKmh})`);
    assert(w.waveHeightM === 1.5, `offline wave height matches derived value (got ${w.waveHeightM})`);
    assert(w.verdict === "caution", `offline verdict is caution for 1.5 m, no alerts (got ${w.verdict})`);
  }

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

  console.log("\n=== escalation detection (H3) ===");
  assert(
    detectEscalation("SLIGHT TO MODERATE BECOMING ROUGH IN THUNDERSHOWERS") === true,
    "bulletin escalation phrase detected",
  );
  assert(detectEscalation("SLIGHT TO MODERATE") === false, "calm sea state has no escalation");
  assert(detectEscalation("CALM") === false, "calm has no escalation");
  const re = buildReasoning(1.5, 32, {
    issuer: "CWC Visakhapatnam (IMD)",
    type: "t",
    validFrom: "x",
    validTo: "y",
    issuedAt: "2026-09-02T13:24:00+05:30",
    wind: "MAINLY SOUTHWESTERLY 15-20 KNOTS",
    weather: "SCATTERED RAIN OR THUNDERSHOWERS",
    seaCondition: "SLIGHT TO MODERATE BECOMING ROUGH IN THUNDERSHOWERS",
    portSignal: "NIL AT ALL PORTS",
    warning: "NIL",
  }, "caution", 3.0);
  assert(re.includes("rough") && re.includes("3"), "escalation sentence cites rough max (~3 m)");
  const reNoMax = buildReasoning(1.5, 32, {
    issuer: "CWC Visakhapatnam (IMD)",
    type: "t",
    validFrom: "x",
    validTo: "y",
    issuedAt: "2026-09-02T13:24:00+05:30",
    wind: "WIND",
    weather: "W",
    seaCondition: "ROUGH",
    portSignal: "NIL",
    warning: "NIL",
  }, "caution");
  assert(reNoMax.includes("2.5+"), "escalation without stored max falls back to 2.5+");

  // Live cache carries the real escalation bulletin + max, so the served
  // reasoning must contain the escalation sentence (date-independent).
  assert(
    w.reasoning.includes("return to shore if weather builds"),
    "live reasoning surfaces the thundershower escalation",
  );
  // B-2: live cache carries a tide prediction — reasoning must ground it.
  assert(
    w.reasoning.includes("high tide") && w.reasoning.includes("IST"),
    "live reasoning surfaces the tide prediction",
  );
}

function testCacheUtils(): void {
  console.log("\n=== cacheUtils staleness/expiry (H1, deterministic) ===");
  const now = Date.parse("2026-09-10T00:00:00.000Z");
  assert(STALE_AFTER_DAYS === 3, `stale threshold is 3 days (got ${STALE_AFTER_DAYS})`);
  assert(daysBetween(Date.parse("2026-09-07T00:00:00Z"), now) === 3, "daysBetween counts whole days");
  assert(
    stalenessNote("2026-09-08T00:00:00.000Z", now) === null,
    "2-day-old cache is fresh (no note)",
  );
  const old = stalenessNote("2026-09-07T00:00:00.000Z", now);
  assert(
    old !== null && old.includes("3 days old") && old.includes("refresh advised"),
    `3-day-old cache flagged (${old})`,
  );
  assert(stalenessNote("not-a-date", now) === null, "unparseable timestamp stays silent");
  assert(
    expiryNote("2026-09-07", Date.parse("2026-09-07T12:00:00.000Z")) === null,
    "advisory still valid on its valid-upto day",
  );
  const expired = expiryNote("2026-09-07", now);
  assert(
    expired !== null && expired.includes("expired"),
    `passed valid-upto flagged (${expired})`,
  );
  assert(expiryNote("not-a-date", now) === null, "unparseable valid-upto stays silent");
}

function testTide(): void {
  console.log("\n=== tide grounding (B-2) ===");
  const calm = {
    issuer: "CWC Visakhapatnam (IMD)",
    type: "t",
    validFrom: "x",
    validTo: "y",
    issuedAt: "2026-09-07T13:24:00+05:30",
    wind: "WIND",
    weather: "W",
    seaCondition: "SLIGHT",
    portSignal: "NIL",
    warning: "NIL",
  };
  const tide = {
    nextHighTide: "2026-09-07T18:42:00+05:30",
    highTideHeightM: 1.6,
    nextLowTide: "2026-09-08T01:05:00+05:30",
    lowTideHeightM: 0.4,
  };
  const withTide = buildReasoning(1.0, 20, calm, "safe", undefined, tide);
  assert(
    withTide.includes("18:42") && withTide.includes("1.6") && withTide.includes("slack water"),
    "tide prediction surfaces clock time + heights in reasoning",
  );
  assert(withTide.includes("Conditions look favourable"), "tide line does not alter safe advice");
  const noTide = buildReasoning(1.0, 20, calm, "safe");
  assert(!noTide.includes("high tide"), "reasoning without tide data has no tide line");
  // Verdict logic untouched by tide presence.
  assert(computeVerdict(1.0, []) === "safe", "tide-range waves stay safe");
}

async function main(): Promise<void> {
  await testMarine();
  await testWeather();
  testCacheUtils();
  testTide();
  console.log(`\n${failures === 0 ? "ALL LAPTOP-B TESTS PASSED" : `${failures} TEST(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test run crashed:", err);
  process.exit(1);
});
