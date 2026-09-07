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
});

type Cache = z.infer<typeof CacheSchema>;
type Bulletin = z.infer<typeof BulletinSchema>;

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
): string {
  const alertPart =
    bulletin.warning === "NIL"
      ? "No active warnings (port signal NIL, high-wave alert Nil)."
      : `Active warning: ${bulletin.warning}.`;
  const seaPart =
    `Sea ${bulletin.seaCondition.toLowerCase()} ` +
    `(representative wave height ${waveHeightM} m) with ${bulletin.wind.toLowerCase()} ` +
    `(~${windSpeedKmh} km/h) per ${bulletin.issuer} bulletin issued ${bulletin.issuedAt}.`;
  const advice =
    verdict === "unsafe"
      ? "It is advisable to stay ashore."
      : verdict === "caution"
        ? "Venture out only with caution and monitor IMD updates."
        : "Conditions look favourable for venturing out.";
  return `${seaPart} ${alertPart} ${advice}`;
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
    return {
      waveHeightM: cache.waveHeightM,
      windSpeedKmh: cache.windSpeedKmh,
      alerts: cache.alerts,
      verdict,
      reasoning: buildReasoning(
        cache.waveHeightM,
        cache.windSpeedKmh,
        cache.bulletin,
        verdict,
      ),
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
