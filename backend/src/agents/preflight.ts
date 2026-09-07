// backend/src/agents/preflight.ts — Laptop B demo-readiness check.
// One command answers "is Laptop B ready for the demo?":
//   1. both JSON caches exist and parse
//   2. both agent functions return shape-valid output (they validate internally)
//   3. caches are fresh (stale => WARN, not BLOCK)
// Exit 0 + "GO" when nothing blocks; exit 1 + "BLOCKED" otherwise.
// Warnings never block — a stale-but-valid cache still demos.
// Run: npx tsx src/agents/preflight.ts   (from backend/)
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expiryNote, stalenessNote } from "./cacheUtils.ts";
import { getMarineData } from "./marineData.ts";
import { getWeatherRisk } from "./weatherRisk.ts";
import type { QueryState } from "../types.ts";

const VIZAG: QueryState["region"] = { name: "Visakhapatnam", lat: 17.6868, lon: 83.2185 };

let blocks = 0;
let warnings = 0;

function ok(label: string): void {
  console.log(`  [ok]   ${label}`);
}
function warn(label: string): void {
  warnings++;
  console.log(`  [warn] ${label}`);
}
function block(label: string): void {
  blocks++;
  console.error(`  [BLOCK] ${label}`);
}

function readJson(rel: string): unknown | null {
  const dir = dirname(fileURLToPath(import.meta.url));
  const p = join(dir, rel);
  if (!existsSync(p)) {
    block(`missing file: ${rel}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as unknown;
  } catch {
    block(`unparseable JSON: ${rel}`);
    return null;
  }
}

async function main(): Promise<void> {
  console.log("Varuna Laptop-B preflight (demo readiness)");

  console.log("\n[1/3] data caches present + parseable");
  const pfz = readJson("../data/incois_pfz.json") as {
    fetchedAt?: string;
    validUpto?: string;
    zones?: unknown[];
  } | null;
  const wx = readJson("../data/imd_weather.json") as {
    fetchedAt?: string;
    waveHeightM?: number;
  } | null;
  if (pfz) ok(`incois_pfz.json parses (${pfz.zones?.length ?? 0} zones)`);
  if (wx) ok(`imd_weather.json parses (wave ${wx.waveHeightM} m)`);

  console.log("\n[2/3] agents return shape-valid output");
  try {
    const m = await getMarineData(VIZAG);
    if (Array.isArray(m.pfzZones) && m.pfzZones.length > 0 && typeof m.source === "string") {
      ok(`getMarineData: ${m.pfzZones.length} zones, nearest ${m.pfzZones[0].distanceKm} km`);
    } else {
      block("getMarineData returned an invalid shape");
    }
  } catch (err) {
    block(`getMarineData threw: ${err instanceof Error ? err.message : err}`);
  }
  try {
    const w = await getWeatherRisk(VIZAG);
    if (w.verdict === "safe" || w.verdict === "caution" || w.verdict === "unsafe") {
      ok(`getWeatherRisk: verdict=${w.verdict}, waves ${w.waveHeightM} m`);
    } else {
      block("getWeatherRisk returned an invalid verdict");
    }
  } catch (err) {
    block(`getWeatherRisk threw: ${err instanceof Error ? err.message : err}`);
  }

  console.log("\n[3/3] freshness (warnings only — stale data still demos)");
  if (pfz?.fetchedAt) {
    const s = stalenessNote(pfz.fetchedAt) ?? (pfz.validUpto ? expiryNote(pfz.validUpto) : null);
    if (s) warn(`PFZ cache: ${s}`);
    else ok("PFZ cache is fresh");
  }
  if (wx?.fetchedAt) {
    const s = stalenessNote(wx.fetchedAt);
    if (s) warn(`IMD cache: ${s}`);
    else ok("IMD cache is fresh");
  }

  if (blocks === 0) {
    const plural = warnings === 1 ? "" : "s";
    console.log("\nGO — demo ready (" + warnings + " warning" + plural + ")");
  } else {
    const plural = blocks === 1 ? "" : "s";
    console.log("\nBLOCKED — " + blocks + " blocking issue" + plural + " (fix before demo)");
  }
  process.exit(blocks === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Preflight crashed:", err);
  process.exit(1);
});
