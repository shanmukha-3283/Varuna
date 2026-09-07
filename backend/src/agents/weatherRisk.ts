// backend/src/agents/weatherRisk.ts — Laptop B (Weather & Risk Agent).
// Reads the pre-fetched IMD cache (backend/src/data/imd_weather.json) and
// applies the team-agreed verdict rules:
//   "unsafe"  — any alert active OR waveHeightM > 2.5
//   "caution" — waveHeightM in [1.5, 2.5]
//   "safe"    — otherwise
// Returns the exact QueryState["weatherRisk"] shape. Pure function: no
// network, no LLM — safe to call from the graph.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { QueryState } from "../types.ts";
import { stalenessNote } from "./cacheUtils.ts";

type Region = QueryState["region"];
type WeatherRisk = NonNullable<QueryState["weatherRisk"]>;
type Verdict = WeatherRisk["verdict"];

const BulletinSchema = z.object({
  issuer: z.string(),
  type: z.string(),
  validFrom: z.string(),
  validTo: z.string(),
  issuedAt: z.string(),
  wind: z.string(),
  weather: z.string(),
  seaCondition: z.string(),
  portSignal: z.string(),
  warning: z.string(),
});

// Tide prediction block (optional): grounds "tide, weather, and sea
// conditions" answers without touching the verdict rules or the
// QueryState["weatherRisk"] output shape (surfaced in reasoning text only).
const TideSchema = z.object({
  nextHighTide: z.string(),
  highTideHeightM: z.number().min(0),
  nextLowTide: z.string(),
  lowTideHeightM: z.number().min(0),
  derivation: z.string().optional(),
});

const CacheSchema = z.object({
  region: z.object({
    name: z.string(),
    lat: z.number(),
    lon: z.number(),
  }),
  bulletin: BulletinSchema,
  waveHeightM: z.number().min(0),
  windSpeedKmh: z.number().min(0),
  alerts: z.array(z.string()),
  fetchedAt: z.string(),
  // Optional worst-case wave height for bulletins whose sea state can
  // escalate (e.g. "slight to moderate BECOMING ROUGH in thundershowers").
  waveHeightMaxM: z.number().min(0).optional(),
  waveHeightMaxDerivation: z.string().optional(),
  // Optional tide prediction (see TideSchema above).
  tide: TideSchema.optional(),
});

// Exported so refreshCaches.ts / preflight.ts validate before write/read.
export const WeatherCacheSchema = CacheSchema;

type Cache = z.infer<typeof CacheSchema>;
type Bulletin = z.infer<typeof BulletinSchema>;
type Tide = z.infer<typeof TideSchema>;

// Sea-state phrases meaning conditions can exceed the representative
// wave height within the bulletin validity window.
const ESCALATION_RE = /rough|very rough|high seas?|heavy swell|surge/i;

// Pure + exported so agents/test.ts can cover the escalation path.
export function detectEscalation(seaCondition: string): boolean {
  return ESCALATION_RE.test(seaCondition);
}

// Pure + exported so agents/test.ts can unit-test the decision boundary.
export function computeVerdict(waveHeightM: number, alerts: string[]): Verdict {
  if (alerts.length > 0 || waveHeightM > 2.5) return "unsafe";
  if (waveHeightM >= 1.5) return "caution";
  return "safe";
}

export function buildReasoning(
  waveHeightM: number,
  windSpeedKmh: number,
  bulletin: Bulletin,
  verdict: Verdict,
  waveHeightMaxM?: number,
  tide?: Tide,
): string {
  const alertPart =
    bulletin.warning === "NIL"
      ? "No active warnings (port signal NIL, high-wave alert Nil)."
      : `Active warning: ${bulletin.warning}.`;
  const seaPart =
    `Sea ${bulletin.seaCondition.toLowerCase()} ` +
    `(representative wave height ${waveHeightM} m) with ${bulletin.wind.toLowerCase()} ` +
    `(~${windSpeedKmh} km/h) per ${bulletin.issuer} bulletin issued ${bulletin.issuedAt}.`;
  // H3: when the bulletin says the sea can escalate (e.g. "becoming rough
  // in thundershowers"), say so explicitly instead of letting the single
  // representative height under-state the hazard.
  const escalationPart = detectEscalation(bulletin.seaCondition)
    ? ` Conditions can turn rough (up to ~${waveHeightMaxM ?? "2.5+"} m) in thundershowers — return to shore if weather builds.`
    : "";
  // B-2: one grounded tide line when the cache carries a prediction.
  // Times are ISO with IST offset; surface the clock time for fishermen.
  const tidePart = tide
    ? ` Next high tide ${tide.nextHighTide.slice(11, 16)} IST (~${tide.highTideHeightM} m), next low ${tide.nextLowTide.slice(11, 16)} IST (~${tide.lowTideHeightM} m) — plan harbour departures around slack water.`
    : "";
  const advice =
    verdict === "unsafe"
      ? "It is advisable to stay ashore."
      : verdict === "caution"
        ? "Venture out only with caution and monitor IMD updates."
        : "Conditions look favourable for venturing out.";
  return `${seaPart} ${alertPart}${escalationPart}${tidePart} ${advice}`;
}

function loadCache(): Cache {
  const dir = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(dir, "..", "data", "imd_weather.json"), "utf-8");
  return CacheSchema.parse(JSON.parse(raw));
}

export async function getWeatherRisk(region: Region): Promise<WeatherRisk> {
  console.log(`[weatherRiskAgent] getWeatherRisk called for ${region.name}`);
  try {
    const cache = loadCache();
    const verdict = computeVerdict(cache.waveHeightM, cache.alerts);
    let reasoning = buildReasoning(
      cache.waveHeightM,
      cache.windSpeedKmh,
      cache.bulletin,
      verdict,
      cache.waveHeightMaxM,
      cache.tide,
    );
    // H1: never serve an old bulletin silently — say so in the reasoning.
    const stale = stalenessNote(cache.fetchedAt);
    if (stale) {
      reasoning += ` Note: IMD data is stale (${stale}) — verify with the latest IMD bulletin before venturing out.`;
    }
    return {
      waveHeightM: cache.waveHeightM,
      windSpeedKmh: cache.windSpeedKmh,
      alerts: cache.alerts,
      verdict,
      reasoning,
    };
  } catch (err) {
    console.error("[weatherRiskAgent] cache read failed, fail-safe verdict:", err);
    // Fail SAFE (not silent): if we cannot assess weather, say so as unsafe.
    return {
      waveHeightM: 0,
      windSpeedKmh: 0,
      alerts: ["data-unavailable"],
      verdict: "unsafe",
      reasoning:
        "Weather cache is unavailable, so conditions cannot be verified — treat the sea as unsafe until IMD data is restored.",
    };
  }
}
