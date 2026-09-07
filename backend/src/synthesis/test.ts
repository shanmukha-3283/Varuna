// backend/src/synthesis/test.ts — Laptop C standalone test.
// Run: npx tsx src/synthesis/test.ts   (from backend/)
import { synthesizeResponse } from "./synthesizeResponse.ts";
import type { QueryState } from "../types.ts";

const mockState = {
  region: { name: "Visakhapatnam", lat: 17.6868, lon: 83.2185 },
  intents: ["pfz_lookup", "safety_check"],
  marineData: {
    pfzZones: [
      { lat: 17.72, lon: 83.25, distanceKm: 4.2 },
      { lat: 17.65, lon: 83.3, distanceKm: 6.8 },
    ],
    sstCelsius: 28.4,
    chlorophyll: 1.2,
    source: "INCOIS (stub)",
    fetchedAt: new Date().toISOString(),
  },
  weatherRisk: {
    waveHeightM: 1.8,
    windSpeedKmh: 22,
    alerts: [],
    verdict: "caution" as const,
    reasoning: "Wave height of 1.8m is in the caution range (1.5-2.5m).",
  },
};

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`ASSERT FAILED: ${msg}`);
    process.exit(1);
  }
}

const result = await synthesizeResponse(mockState);

// Shape check against QueryState["finalResponse"]
const check: NonNullable<QueryState["finalResponse"]> = result;
assert(typeof check.text === "string" && check.text.length > 0, "text non-empty");
assert(Array.isArray(check.mapMarkers), "mapMarkers is array");
assert(
  check.mapMarkers.every(
    (m) => typeof m.lat === "number" && typeof m.lon === "number" &&
      typeof m.label === "string" && typeof m.type === "string",
  ),
  "every marker has lat/lon/label/type",
);
assert(Array.isArray(check.evidence), "evidence is array");
assert(
  check.mapMarkers.some((m) => m.type === "pfz"),
  "at least one pfz marker",
);
assert(
  check.mapMarkers.some((m) => m.type === "hazard"),
  "hazard marker present for caution verdict",
);

console.log("synthesis test PASSED");
console.log(JSON.stringify(result, null, 2));
