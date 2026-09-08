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
import { currentHourIST, timeframeLabel, timeframeHour, type Timeframe } from "../orchestrator/intentParser.ts";

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
    `(wave height ${waveHeightM} m) with wind ` +
    `(~${windSpeedKmh} km/h) alongside ${bulletin.issuer} bulletin issued ${bulletin.issuedAt}.`;
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

async function fetchLiveWeather(lat: number, lon: number, timeframe?: Timeframe | null): Promise<{ windSpeedKmh: number; waveHeightM: number; weatherCode?: number; forecastNote?: string } | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    if (timeframe) {
      // Forecast mode: request hourly data for the next 3 days.
      const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m,weather_code&timezone=Asia%2FKolkata&forecast_days=3`;
      const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height&timezone=Asia%2FKolkata&forecast_days=3`;
      const [wxRes, marineRes] = await Promise.all([
        fetch(wxUrl, { signal: ctl.signal }),
        fetch(marineUrl, { signal: ctl.signal }),
      ]);
      if (!wxRes.ok || !marineRes.ok) throw new Error("Forecast API error");
      const wxBody = await wxRes.json() as any;
      const marineBody = await marineRes.json() as any;
      const wxTimes: string[] = wxBody.hourly?.time ?? [];
      const wxWind: number[] = wxBody.hourly?.wind_speed_10m ?? [];
      const wxCode: number[] = wxBody.hourly?.weather_code ?? [];
      const mTimes: string[] = marineBody.hourly?.time ?? [];
      const mWave: number[] = marineBody.hourly?.wave_height ?? [];
      // Target hour in IST.
      const nowIST = currentHourIST();
      const targetHour = timeframeHour(timeframe, nowIST);
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + timeframe.offsetDays);
      const targetPrefix = targetDate.toISOString().slice(0, 10);
      const targetTime = `${targetPrefix}T${String(targetHour).padStart(2, "0")}:00`;
      // Find matching index.
      const wxIdx = wxTimes.findIndex((t) => t === targetTime);
      const mIdx = mTimes.findIndex((t) => t === targetTime);
      if (wxIdx === -1 && mIdx === -1) return null;
      const windSpeedKmh = wxIdx >= 0 ? wxWind[wxIdx] : undefined;
      const weatherCode = wxIdx >= 0 ? wxCode[wxIdx] : undefined;
      const waveHeightM = mIdx >= 0 ? mWave[mIdx] : undefined;
      if (typeof windSpeedKmh !== "number" || typeof waveHeightM !== "number") return null;
      return { windSpeedKmh, waveHeightM, weatherCode, forecastNote: timeframeLabel(timeframe) };
    }
    // Current mode.
    const wxRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=wind_speed_10m,weather_code`, { signal: ctl.signal });
    const marineRes = await fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=wave_height`, { signal: ctl.signal });
    if (!wxRes.ok || !marineRes.ok) throw new Error("API error");
    const wxBody = await wxRes.json() as any;
    const marineBody = await marineRes.json() as any;
    const windSpeedKmh = wxBody.current?.wind_speed_10m;
    const waveHeightM = marineBody.current?.wave_height;
    const weatherCode = wxBody.current?.weather_code;
    if (typeof windSpeedKmh !== "number" || typeof waveHeightM !== "number") throw new Error("Invalid response");
    return { windSpeedKmh, waveHeightM, weatherCode: typeof weatherCode === "number" ? weatherCode : undefined };
  } catch (err) {
    console.error("[weatherRiskAgent] live weather fetch failed:", err);
    return null;
  } finally {
    clearTimeout(t);
  }
}

// WMO weather codes signalling thunderstorm / lightning activity.
function isThunderstorm(code?: number): boolean {
  return code === 95 || code === 96 || code === 99;
}

function bulletinSignalsCyclone(warning: string): boolean {
  return /cyclon|depression|deep depression|storm/i.test(warning);
}

export async function getWeatherRisk(region: Region, timeframe?: Timeframe): Promise<WeatherRisk> {
  console.log(`[weatherRiskAgent] Fetching weather risk for ${region.name} (${region.lat}, ${region.lon})${timeframe ? ` (${timeframeLabel(timeframe)})` : ""}`);
  try {
    let cache: Cache | null = null;
    try {
      cache = loadCache();
    } catch (e) {
      console.log("[weatherRiskAgent] No local cache available, proceeding with pure live API.");
    }

    // Never mutate the parsed cache object in place — clone fields we need.
    const bulletin: Bulletin | null = cache ? { ...cache.bulletin } : null;
    const tide: Tide | undefined = cache?.tide ? { ...cache.tide } : undefined;
    const cacheFetchedAt: string | null = cache?.fetchedAt ?? null;
    const waveHeightMaxM = cache?.waveHeightMaxM;

    let waveHeightM = cache?.waveHeightM ?? 1.0;
    let windSpeedKmh = cache?.windSpeedKmh ?? 10.0;
    let alerts: string[] = [...(cache?.alerts ?? [])];
    let provenance = "IMD cache";

    // Live-with-fallback: try Open-Meteo, fall back to cache on failure.
    const liveWeather = await fetchLiveWeather(region.lat, region.lon, timeframe);
    let liveWeatherCode: number | undefined;
    let forecastNote: string | undefined;
    if (liveWeather) {
      waveHeightM = liveWeather.waveHeightM;
      windSpeedKmh = liveWeather.windSpeedKmh;
      liveWeatherCode = liveWeather.weatherCode;
      forecastNote = liveWeather.forecastNote;
      provenance = cache ? "IMD cache + Open-Meteo live" : "Open-Meteo live";
      console.log(`[weatherRiskAgent] using live weather for ${region.name}: wave ${waveHeightM}m, wind ${windSpeedKmh}km/h, code ${liveWeatherCode ?? "n/a"}`);
    } else if (cache) {
      provenance = "IMD cache (live fetch failed — cache fallback)";
      console.log(`[weatherRiskAgent] live fetch failed, using cache for ${region.name}`);
    } else {
      provenance = "Open-Meteo live attempt failed, defaults";
    }

    // Real alert derivations — no mocks:
    // - high-wave from effective wave height
    // - lightning from live WMO thunderstorm codes (95/96/99)
    // - cyclone-watch from IMD bulletin warning text (cyclone/depression/storm)
    if (waveHeightM > 2.5 && !alerts.includes("high-wave")) {
      alerts.push("high-wave");
    }
    if (bulletin && bulletin.warning !== "NIL" && !alerts.includes("imd-warning")) {
      alerts.push("imd-warning");
    }
    if (liveWeatherCode !== undefined && isThunderstorm(liveWeatherCode) && !alerts.includes("lightning")) {
      alerts.push("lightning");
    }
    if (bulletin && bulletinSignalsCyclone(bulletin.warning) && !alerts.includes("cyclone-watch")) {
      alerts.push("cyclone-watch");
    }

    const verdict = computeVerdict(waveHeightM, alerts);
    const forecastBit = forecastNote ? ` (${forecastNote} forecast)` : "";

    let reasoning = "";
    if (bulletin) {
      reasoning = buildReasoning(
        waveHeightM,
        windSpeedKmh,
        bulletin,
        verdict,
        waveHeightMaxM,
        tide,
      );
      reasoning += ` Data provenance: ${provenance}${forecastBit}.`;
    } else {
      reasoning = `Live API weather${forecastBit}: Sea is ${verdict} (wave height ${waveHeightM} m) with wind (~${windSpeedKmh} km/h). ` +
        (alerts.length > 0 ? `Active alerts: ${alerts.join(", ")}.` : "No active warnings.") +
        ` Data provenance: ${provenance}.`;
    }

    // Staleness is measured against the CACHE fetchedAt, never "now".
    if (cacheFetchedAt) {
      const stale = stalenessNote(cacheFetchedAt);
      if (stale) {
        reasoning += ` Note: IMD data is stale (${stale}) — verify with the latest IMD bulletin before venturing out.`;
      }
    }
    return {
      waveHeightM,
      windSpeedKmh,
      alerts,
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
