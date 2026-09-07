// backend/src/synthesis/synthesizeResponse.ts — Laptop C.
// Real response-synthesis agent for "Varuna" (SIH26176 - ORCA).
//
// Contract (must match what graph.ts imports at Hour 14):
//   synthesizeResponse(state: Pick<QueryState, "region"|"intents"|"marineData"|"weatherRisk">)
//     => Promise<FinalResponse { text, mapMarkers, evidence }>
// This function does NOT append to executionTrace — the graph node does that.

import type { QueryState } from "../types.ts";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { translateFromEnglish } from "../services/translation.ts";

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b";

export type SynthesisInput = Pick<
  QueryState,
  "region" | "intents" | "language" | "marineData" | "weatherRisk" | "geofenceAlerts" | "routeOptimization"
> & {
  /** How the region was resolved: keyword|geocoder = user-named, llm|fallback may be the untouched default pin. */
  regionSource?: string;
};

type FinalResponse = NonNullable<QueryState["finalResponse"]>;
type MapMarker = FinalResponse["mapMarkers"][number];

function verdictAdvice(
  verdict: "safe" | "caution" | "unsafe" | undefined,
): string {
  if (verdict === "safe")
    return "Conditions look favourable — safe to plan your trip, but keep checking IMD updates.";
  if (verdict === "unsafe")
    return "It is advisable to stay ashore and wait for conditions to improve.";
  return "Venture out only with caution and monitor IMD updates closely.";
}

export function productivityNote(sst?: number, chl?: number): string | null {
  if (sst === undefined || chl === undefined) return null;
  const sstFav = sst >= 27 && sst <= 29.5;
  const chlFav = chl >= 0.5;
  if (sstFav && chlFav)
    return `Productivity favourable: SST ${sst}°C with chlorophyll ${chl} mg/m³ supports plankton growth — good PFZ potential.`;
  const reasons: string[] = [];
  if (!sstFav) reasons.push(sst > 29.5 ? `SST ${sst}°C is warm, pushing thermal fronts offshore` : `SST ${sst}°C is cool for this sector`);
  if (!chlFav) reasons.push(`chlorophyll ${chl} mg/m³ is low, indicating weak plankton bloom`);
  return `Productivity subdued: ${reasons.join("; ")} — fish may be deeper or dispersed, prefer the nearest PFZ marker.`;
}

const ALERT_GUIDANCE: Record<string, string> = {
  "high-wave": "High waves — secure gear, avoid open-sea crossings, return if swell builds.",
  "cyclone-watch": "Possible cyclonic circulation — track IMD/RSMC bulletins hourly, keep harbour contact.",
  "imd-warning": "IMD warning active — follow the official bulletin window strictly.",
  "lightning": "Lightning risk — avoid metal masts, head to shore at first thunder.",
  "data-unavailable": "Conditions unverifiable — treat as unsafe until fresh data arrives.",
};

function alertGuidance(alerts: string[]): string | null {
  if (alerts.length === 0) return null;
  const parts = alerts.map((a) => {
    const key = Object.keys(ALERT_GUIDANCE).find((k) => a.toLowerCase().includes(k));
    return key ? `${a}: ${ALERT_GUIDANCE[key]}` : a;
  });
  return `Alert guidance — ${parts.join(" ")}`;
}

function avoidanceNote(input: SynthesisInput): string | null {
  const avoid: string[] = [];
  if (input.weatherRisk && (input.weatherRisk.verdict === "unsafe" || input.weatherRisk.alerts.length > 0)) {
    avoid.push(`avoid open-sea legs while ${input.weatherRisk.verdict} (${input.weatherRisk.alerts.join(", ") || `waves ${input.weatherRisk.waveHeightM} m`})`);
  }
  const danger = (input.geofenceAlerts ?? []).filter((g) => g.alertLevel === "danger");
  for (const g of danger) avoid.push(`keep clear of ${g.zoneName}`);
  const warn = (input.geofenceAlerts ?? []).filter((g) => g.alertLevel === "warning");
  for (const g of warn) avoid.push(`exercise caution near ${g.zoneName}`);
  if (avoid.length === 0) return null;
  return `Zones to avoid: ${avoid.join("; ")}.`;
}

function tideLine(reasoning: string): string | null {
  const m = reasoning.match(/Next high tide .*?IST.*?low .*?IST.*?(?:—|–)/i)
    ?? reasoning.match(/high tide.*?IST.*?low.*?IST.*/i);
  return m ? `Tide: ${m[0].trim()}` : null;
}

interface HistorySnap { sector: string; date: string; sstCelsius: number; chlorophyll: number; }
let historyCache: HistorySnap[] | null = null;
function loadHistory(): HistorySnap[] {
  if (historyCache) return historyCache;
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(dir, "..", "data", "productivity_history.json"), "utf-8");
    historyCache = (JSON.parse(raw) as { snapshots: HistorySnap[] }).snapshots;
  } catch {
    historyCache = [];
  }
  return historyCache;
}

/** "Why has productivity declined here?" — compare current vs earliest snapshot. */
export function productivityTrend(sectorSource: string, sst?: number, chl?: number): string | null {
  if (sst === undefined || chl === undefined) return null;
  const snaps = loadHistory().filter((s) => sectorSource.toLowerCase().includes(s.sector.toLowerCase()));
  if (snaps.length < 2) return null;
  const first = snaps[0];
  const dChl = +(chl - first.chlorophyll).toFixed(2);
  const dSst = +(sst - first.sstCelsius).toFixed(1);
  const dir = dChl < 0 ? "declined" : dChl > 0 ? "improved" : "steady";
  return `Productivity trend: chlorophyll ${dir} from ${first.chlorophyll} (${first.date}) to ${chl} now (${dChl >= 0 ? "+" : ""}${dChl}), SST ${first.sstCelsius}°C → ${sst}°C (${dSst >= 0 ? "+" : ""}${dSst}) — ${dChl < -0.2 ? "weakening bloom explains thinner catches; prefer the nearest PFZ marker" : "conditions track the seasonal norm"}.`;
}

function buildTemplateText(input: SynthesisInput): string {
  const { region, marineData: marine, weatherRisk: weather } = input;
  const sentences: string[] = [];

  if (marine && marine.pfzZones.length > 0) {
    const nearest = marine.pfzZones[0];
    let pfz =
      `The nearest Potential Fishing Zone is ${nearest.distanceKm} km away ` +
      `at (${nearest.lat}, ${nearest.lon})`;
    if (marine.sstCelsius !== undefined)
      pfz += `, with sea surface temperature ${marine.sstCelsius}°C`;
    if (marine.chlorophyll !== undefined)
      pfz += ` and chlorophyll ${marine.chlorophyll} mg/m³`;
    pfz += ".";
    sentences.push(pfz);
  }

  if (weather) {
    sentences.push(
      `Sea conditions near ${region.name} are ${weather.verdict}: ` +
        `waves ${weather.waveHeightM} m, wind ${weather.windSpeedKmh} km/h. ` +
        verdictAdvice(weather.verdict),
    );
    if (weather.alerts.length > 0)
      sentences.push(`Active alerts: ${weather.alerts.join(", ")}.`);
    else sentences.push(`No active alerts for the ${region.name} coast right now.`);
  } else {
    sentences.push(
      `No weather assessment is available for ${region.name} right now.`,
    );
  }

  if (input.geofenceAlerts && input.geofenceAlerts.length > 0) {
    sentences.push(
      `Boundary notice: ${input.geofenceAlerts.map((a) => `${a.zoneName} (${a.alertLevel}): ${a.message}`).join(" ")}`,
    );
  }

  if (input.routeOptimization) {
    sentences.push(input.routeOptimization.message);
  }

  const prod = productivityNote(marine?.sstCelsius, marine?.chlorophyll);
  if (prod && (input.intents.includes("chlorophyll_sst") || input.intents.includes("pfz_lookup") || !marine)) {
    sentences.push(prod);
  } else if (prod && input.intents.length > 0) {
    sentences.push(prod);
  }

  const avoid = avoidanceNote(input);
  if (avoid) sentences.push(avoid);

  const guide = input.weatherRisk ? alertGuidance(input.weatherRisk.alerts) : null;
  if (guide) sentences.push(guide);

  // Honest default-spot note: when the region wasn't user-named
  // (keyword/geocoder), say so instead of sounding Vizag-specific.
  if (
    (input.regionSource === "fallback" || input.regionSource === "llm") &&
    !input.intents.includes("greeting")
  ) {
    sentences.push(
      `Showing your selected spot (${region.name}) — tap Locate me or search your town for local advice.`,
    );
  }

  return `For ${region.name}: ${sentences.join(" ")}`.trim();
}

function buildMapMarkers(input: SynthesisInput): MapMarker[] {
  const markers: MapMarker[] = [];
  const { region, marineData: marine, weatherRisk: weather } = input;

  if (marine) {
    for (const zone of marine.pfzZones) {
      markers.push({
        lat: zone.lat,
        lon: zone.lon,
        label: `PFZ (${zone.distanceKm} km)`,
        type: "pfz",
      });
    }
  }

  if (weather && weather.verdict !== "safe") {
    markers.push({
      lat: region.lat,
      lon: region.lon,
      label: `Weather: ${weather.verdict}`,
      type: "hazard",
    });
  }

  if (input.geofenceAlerts) {
    for (const alert of input.geofenceAlerts) {
      markers.push({
        lat: region.lat,
        lon: region.lon,
        label: `Geofence: ${alert.zoneName}`,
        type: "hazard",
      });
    }
  }

  if (input.routeOptimization) {
    for (let i = 0; i < input.routeOptimization.waypoints.length; i++) {
      const wp = input.routeOptimization.waypoints[i];
      markers.push({
        lat: wp.lat,
        lon: wp.lon,
        label: `Waypoint ${i + 1}`,
        type: "route",
      });
    }
  }

  return markers;
}

function buildEvidence(input: SynthesisInput): string[] {
  const evidence: string[] = [];
  const { marineData: marine, weatherRisk: weather } = input;

  if (marine) {
    evidence.push(
      `INCOIS PFZ data (${marine.source}): ${marine.pfzZones.length} zone(s) found`,
    );
    const parts: string[] = [];
    if (marine.sstCelsius !== undefined)
      parts.push(`SST ${marine.sstCelsius}°C`);
    if (marine.chlorophyll !== undefined)
      parts.push(`chlorophyll ${marine.chlorophyll} mg/m³`);
    if (parts.length > 0) evidence.push(parts.join(", "));
    const prod = productivityNote(marine.sstCelsius, marine.chlorophyll);
    if (prod) evidence.push(prod);
    const trend = productivityTrend(marine.source, marine.sstCelsius, marine.chlorophyll);
    if (trend) evidence.push(trend);
  }
  if (weather) {
    evidence.push(
      `IMD weather: waves ${weather.waveHeightM} m, wind ${weather.windSpeedKmh} km/h`,
    );
    if (weather.alerts.length > 0) {
      evidence.push(`Active alerts: ${weather.alerts.join(", ")}`);
      const guide = alertGuidance(weather.alerts);
      if (guide) evidence.push(guide);
    } else evidence.push("No active alerts");
    evidence.push(`Risk reasoning: ${weather.reasoning}`);
    const tide = tideLine(weather.reasoning);
    if (tide) evidence.push(tide);
  }

  if (input.geofenceAlerts && input.geofenceAlerts.length > 0) {
    evidence.push(`Geofence Alerts: ${input.geofenceAlerts.map(a => `[${a.alertLevel}] ${a.zoneName}: ${a.message}`).join("; ")}`);
  } else {
    evidence.push("Geofence: no boundary violations for this location");
  }

  if (input.routeOptimization) {
    evidence.push(`Route Optimization: ${input.routeOptimization.message} (distance ${input.routeOptimization.distanceKm} km, ~${input.routeOptimization.estTimeHours} h)`);
  }

  const avoid = avoidanceNote(input);
  if (avoid) evidence.push(avoid);

  return evidence;
}

// Intent-aware framing: the lead instruction and fact order change with the
// query's primary intent, while the KEY FACTS numbers stay EXACT throughout.
function framingFor(intents: string[]): { lead: string; hazardFirst: boolean } {
  if (intents.includes("alert_check")) {
    return {
      lead:
        "Lead with the HAZARD verdict FIRST: one opening sentence on safety " +
        "(verdict, alerts, waves/wind) and what the fisherman must do. " +
        "Then give PFZ guidance using exactly this pattern: " +
        "'head about X km out to the nearest PFZ' (X = the fact number). ",
      hazardFirst: true,
    };
  }
  if (intents.includes("tide_lookup")) {
    return {
      lead:
        "Frame the advice around HARBOUR TIMING: when to depart and when to " +
        "return given the stated wave/wind conditions, then give PFZ guidance. " +
        "Cite the tide clock times verbatim when present. ",
      hazardFirst: false,
    };
  }
  if (intents.includes("chlorophyll_sst")) {
    return {
      lead:
        "Lead with PRODUCTIVITY: explain SST + chlorophyll and what it means for fish availability, " +
        "then give PFZ guidance and safety. ",
      hazardFirst: false,
    };
  }
  if (intents.includes("route_advice")) {
    return {
      lead:
        "Lead with the SAFE ROUTE: distance, time, and how it skirts hazards, " +
        "then confirm PFZ target and safety verdict. ",
      hazardFirst: false,
    };
  }
  return {
    lead:
      "Frame the PFZ distance as guidance on WHERE TO GO (e.g. 'head about X km out to ...'), " +
      "never as avoidance (never say 'stay away/clear/at least X km from the zone'). ",
    hazardFirst: false,
  };
}

async function generateWithOllama(
  input: SynthesisInput,
  fallback: string,
): Promise<{ text: string; via: "llm" | "template" }> {
  const context = {
    region: input.region,
    intents: input.intents,
    marineData: input.marineData ?? null,
    weatherRisk: input.weatherRisk ?? null,
  };
  const marine = input.marineData;
  const weather = input.weatherRisk;
  const framing = framingFor(input.intents);
  const marineFacts: string[] = [];
  const weatherFacts: string[] = [];
  
  if (marine && marine.pfzZones.length > 0) {
    const n = marine.pfzZones[0];
    marineFacts.push(`Nearest PFZ distance (km): ${n.distanceKm}`);
    marineFacts.push(`Nearest PFZ coordinates: (${n.lat}, ${n.lon})`);
    if (marine.sstCelsius !== undefined)
      marineFacts.push(`Sea surface temperature: EXACTLY ${marine.sstCelsius}°C — cite verbatim`);
    if (marine.chlorophyll !== undefined)
      marineFacts.push(`Chlorophyll: EXACTLY ${marine.chlorophyll} mg/m³ — cite verbatim`);
    const prod = productivityNote(marine.sstCelsius, marine.chlorophyll);
    if (prod) marineFacts.push(`Productivity assessment: ${prod}`);
  } else {
    marineFacts.push("PFZ data: not requested or not available for this query (do not invent a distance)");
  }
  if (weather) {
    weatherFacts.push(`Safety verdict: ${weather.verdict}`);
    weatherFacts.push(`Wave height (m): ${weather.waveHeightM}`);
    weatherFacts.push(`Wind speed (km/h): ${weather.windSpeedKmh}`);
    weatherFacts.push(
      weather.alerts.length > 0
        ? `Active alerts: ${weather.alerts.join(", ")}`
        : "Active alerts: none",
    );
    if (weather.reasoning.includes("high tide")) {
      const tideMatch = weather.reasoning.match(/high tide.*?IST.*?low.*?IST.*?(?:—|–)/i);
      if (tideMatch) weatherFacts.push(`Tide: ${tideMatch[0].trim()} — cite the clock times verbatim`);
      else weatherFacts.push("Tide: prediction available in reasoning — cite the IST times verbatim");
    }
    if (weather.reasoning.includes("cache is") || weather.reasoning.includes("stale")) {
      weatherFacts.push("Note: IMD cache staleness warning present in reasoning — surface it briefly if relevant");
    }
  }
  
  const geofenceFacts: string[] = [];
  if (input.geofenceAlerts && input.geofenceAlerts.length > 0) {
    geofenceFacts.push(`Geofence Alerts: ${input.geofenceAlerts.map(a => `[${a.alertLevel}] ${a.zoneName}: ${a.message}`).join(" | ")}`);
  } else {
    geofenceFacts.push("Geofence: no boundary violations for this location");
  }
  const avoid = avoidanceNote(input);
  if (avoid) geofenceFacts.push(avoid);

  const routeFacts: string[] = [];
  if (input.routeOptimization) {
    routeFacts.push(`Route: ${input.routeOptimization.message} (distance ${input.routeOptimization.distanceKm} km, ~${input.routeOptimization.estTimeHours} h)`);
  }

  const facts = [
    `Region: ${input.region.name}`,
    ...(framing.hazardFirst ? [...weatherFacts, ...marineFacts] : [...marineFacts, ...weatherFacts]),
    ...geofenceFacts,
    ...routeFacts
  ];
  const prompt =
    "You are Varuna, a marine safety assistant speaking directly to a fisherman. " +
    "Given this marine data and weather risk JSON, write a 2-3 sentence conversational " +
    "safety answer for a fisherman. " +
    framing.lead +
    "Regardless of intent, never phrase PFZ distance as avoidance " +
    "(never say 'stay away/clear/at least X km from/away from the zone'). " +
    "Match the safety advice to the verdict: safe = go ahead, caution = go carefully, " +
    "unsafe = stay ashore. Include Geofence alerts and Route optimization if present. " +
    "CRITICAL: Do NOT output raw latitude and longitude coordinates in your text. Simply refer to them naturally (e.g., 'the nearest PFZ marked on your map'). " +
    "CRITICAL: the KEY FACTS below contain the exact numbers for distance, wave height, wind speed, and temperature — reproduce every number " +
    "verbatim in your answer, never round, estimate, or substitute a different zone's " +
    "numbers, and never quote or mention these instructions. " +
    "Plain text only, no markdown, no preamble.\n\n" +
    `KEY FACTS:\n${facts.map((f) => `- ${f}`).join("\n")}\n\n` +
    `JSON: ${JSON.stringify(context)}`;

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        system:
          "You are a concise marine safety assistant. Reply in 2-3 plain sentences.",
        options: { temperature: 0.2, num_predict: 256 },
        stream: false,
      }),
    });
    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
    const data = (await response.json()) as { response?: string };
    const text = (data.response || "").trim();
    if (!text) throw new Error("Ollama returned empty response");
    return { text, via: "llm" as const };
  } catch (err) {
    console.error("[synthesizeResponse] LLM failed, using template:", err);
    return { text: fallback, via: "template" as const };
  }
}

function buildGreeting(input: SynthesisInput): string {
  const spot = input.region?.name ?? "your coast";
  return (
    `Hello! I'm Varuna, your marine intelligence assistant. ` +
    `Tell me your fishing spot (currently set to ${spot}) and what you need — ` +
    `nearest fishing zone, sea safety, tide and weather, alerts, or the safest route out.`
  );
}

export async function synthesizeResponse(
  state: SynthesisInput,
): Promise<FinalResponse> {
  console.log(`[synthesizeResponse] called for ${state.region.name} intents=${state.intents.join(",")}`);

  // Conversational greeting: warm ask+suggest, no data dump, no LLM needed.
  // state.language is the UI selector choice (selector always wins).
  if (state.intents.length === 1 && state.intents[0] === "greeting") {
    const text = await translateFromEnglish(buildGreeting(state), state.language);
    return {
      text,
      mapMarkers: [],
      evidence: ["Conversational greeting — no marine data fetched (ask+suggest)"],
    };
  }

  const mapMarkers = buildMapMarkers(state);
  const evidenceBase = buildEvidence(state);
  const fallback = buildTemplateText(state);
  const { text, via } = await generateWithOllama(state, fallback);
  
  // Use specialized translation service instead of LLM
  const translatedText = await translateFromEnglish(text, state.language);
  
  const evidence = [...evidenceBase, `synthesis: ${via} (${OLLAMA_MODEL}) — ${via === "llm" ? "verbatim-grounded" : "template fallback"}`];
  return { text: translatedText, mapMarkers, evidence };
}
