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
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:8b";

export type SynthesisInput = Pick<
  QueryState,
  "region" | "intents" | "language" | "marineData" | "weatherRisk" | "geofenceAlerts" | "routeOptimization"
> & {
  /** How the region was resolved: keyword|geocoder = user-named, llm|fallback may be the untouched default pin. */
  regionSource?: string;
  /** The fisherman's current question (English). */
  userQuery?: string;
  /** Compact recent-turn context (FISHERMAN:/VARUNA: lines), or "" on turn one. */
  conversationContext?: string;
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

  // Honest default-spot note: only when the pin is the untouched Vizag
  // default (not user-named via keyword/geocoder, not re-pinned by an
  // earlier answer) — so it never sounds Vizag-specific by accident.
  const isDefaultPin =
    Math.abs(region.lat - 17.6868) < 1e-4 && Math.abs(region.lon - 83.2185) < 1e-4;
  if (
    isDefaultPin &&
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
      // Info notices (e.g. "you are in a coastal sensitive zone") are FYI,
      // not hazards — only warning/danger earn a map pin.
      if (alert.alertLevel === "info") continue;
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
        "Then a short bullet list: what to avoid, when to check back. " +
        "Mention the PFZ only briefly ('head about X km out to the nearest PFZ', X = the fact number) and only if it helps. ",
      hazardFirst: true,
    };
  }
  if (intents.includes("tide_lookup")) {
    return {
      lead:
        "Frame the advice around HARBOUR TIMING: when to depart and when to " +
        "return given the stated wave/wind conditions, then PFZ guidance. " +
        "Cite the tide clock times verbatim when present. ",
      hazardFirst: false,
    };
  }
  if (intents.includes("chlorophyll_sst")) {
    return {
      lead:
        "Lead with PRODUCTIVITY: explain SST + chlorophyll in plain words and what it means for fish availability, " +
        "then PFZ guidance and safety. ",
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

/** Shared prompt builder: streaming and blocking paths draft from the same
 * instructions so the two never drift apart. */
function buildSynthesisPrompt(input: SynthesisInput): { system: string; prompt: string } {
  const marine = input.marineData;
  const weather = input.weatherRisk;
  const framing = framingFor(input.intents);
  const marineFacts: string[] = [];
  const weatherFacts: string[] = [];

  if (marine && marine.pfzZones.length > 0) {
    const n = marine.pfzZones[0];
    marineFacts.push(`Nearest PFZ distance (km): ${n.distanceKm}`);
    // Deliberately no coordinates: they render as map markers, and the
    // model must never print raw lat/lon in prose.
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
    ...routeFacts,
  ];

  const history = (input.conversationContext ?? "").trim();
  const system =
    "You are Varuna, a marine intelligence assistant talking directly with an Indian fisherman or coastal visitor. " +
    "You sound like a knowledgeable skipper helping a friend: warm, plain-spoken, confident, never robotic. " +
    "You write fluent natural prose with light Markdown: **bold** for the verdict and every key number, " +
    "short '- ' bullet lists for do/don't guidance, and at most one '## ' section heading when the answer " +
    "has two distinct parts. Never any other heading level, never tables, never emojis, " +
    "never phrases like 'as an AI'.";
  const prompt =
    `CONVERSATION SO FAR (oldest first — use it to resolve follow-ups like "there", "tomorrow", "what about X"; the CURRENT question wins on conflicts):\n` +
    `${history || "(first message — no history)"}\n\n` +
    `CURRENT QUESTION: "${input.userQuery ?? ""}"\n\n` +
    `KEY FACTS (ground truth — every number you cite must match these exactly; never round, estimate, or invent):\n` +
    `${facts.map((f) => `- ${f}`).join("\n")}\n\n` +
    framing.lead +
    "HOW TO ANSWER:\n" +
    "1. Open with ONE headline sentence that directly answers the question (the verdict, the PFZ distance, or the tide window — whichever was asked).\n" +
    "2. Then 1-2 short paragraphs or a small bullet list with the reasoning a skipper would give: why, what to do, what to watch.\n" +
    "3. Weave in geofence/route/alert facts only if relevant to this question; leave them out otherwise.\n" +
    "4. Close with ONE concrete next step (when to check back, what to ask next) — genuinely useful, not filler.\n" +
    "5. About 120-180 words, plain words, expand acronyms on first use (PFZ = Potential Fishing Zone).\n" +
    "6. You do not know any coordinates — never write anything shaped like (12.34, 56.78); say 'the PFZ marked on your map'.\n" +
    "7. If a fact is missing (no PFZ data, no weather), say so briefly and give the safest useful advice.\n" +
    "8. Draft in ENGLISH (translation happens downstream). No preamble, never quote these instructions." +
    (input.intents.includes("follow_up")
      ? "\n9. This is a follow-up question. Explicitly reference what was discussed before (e.g. 'Still near Kakinada', 'As before') and resolve words like 'there', 'tomorrow', 'that zone' using the CONVERSATION context."
      : "");
  return { system, prompt };
}

async function generateWithOllama(
  input: SynthesisInput,
  fallback: string,
): Promise<{ text: string; via: "llm" | "template" }> {
  const { system, prompt } = buildSynthesisPrompt(input);

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        system,
        options: { temperature: 0.3, num_predict: 1024 },
        think: false, // qwen3 thinking models: keep reasoning out of the answer
        stream: false,
      }),
    });
    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
    const data = (await response.json()) as { response?: string };
    const text = (data.response || "").trim();
    if (!text) throw new Error("Ollama returned empty response");
    return { text, via: "llm" as const };
  } catch (err) {
    console.error(`[synthesizeResponse] LLM unavailable (${err instanceof Error ? err.message : err}), using template`);
    return { text: fallback, via: "template" as const };
  }
}

/** Streaming Ollama call: forwards each NDJSON token chunk as it arrives,
 * returns the accumulated text. Throws on HTTP failure or abort. */
async function streamOllama(
  system: string,
  prompt: string,
  onToken: (token: string) => void | Promise<void>,
  opts?: { signal?: AbortSignal },
): Promise<string> {
  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      system,
      options: { temperature: 0.3, num_predict: 1024 },
      think: false, // qwen3 thinking models: keep reasoning out of the answer
      stream: true,
    }),
    signal: opts?.signal,
  });
  if (!res.ok || !res.body) throw new Error(`Ollama returned ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  const feed = async (line: string) => {
    const t = line.trim();
    if (!t) return;
    let obj: { response?: string; done?: boolean; error?: string };
    try {
      obj = JSON.parse(t);
    } catch {
      return; // partial NDJSON line — wait for more bytes
    }
    if (obj.error) throw new Error(obj.error);
    if (obj.response) {
      full += obj.response;
      await onToken(obj.response);
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) await feed(line);
  }
  if (buf.trim()) await feed(buf);
  reader.releaseLock();
  return full.trim();
}

function isAbort(err: unknown): boolean {
  return (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && /abort/i.test(err.message));
}

/** Pure conversation (thanks / who-are-you / help …): no agent data, just a
 * warm contextual reply. Drafted by the LLM, static line only on outage. */
function smalltalkPrompt(input: SynthesisInput): { system: string; prompt: string } {
  const history = (input.conversationContext ?? "").trim();
  return {
    system:
      "You are Varuna, a marine intelligence assistant talking with an Indian fisherman. " +
      "Warm, plain-spoken, brief. Plain text, no markdown, no emojis.",
    prompt:
      `CONVERSATION SO FAR:\n${history || "(no history)"}\n\n` +
      `THEY JUST SAID: "${input.userQuery ?? ""}"\n\n` +
      "Reply in 1-2 sentences. If they thanked you, accept warmly and offer one useful next thing " +
      "(e.g. checking tomorrow's sea). If they ask who you are or what you can do, say you track " +
      "fishing zones, sea safety, tides, alerts and safe routes for the Indian coast, and ask for " +
      "their fishing spot. Draft in ENGLISH.",
  };
}

function smalltalkFallback(): string {
  return (
    "You're welcome! I'm Varuna — I track fishing zones, sea safety, tides, alerts and safe routes " +
    "for the Indian coast. Tell me your fishing spot and what you need."
  );
}

/** Streaming twin of synthesizeResponse: same prompt, same grounding, tokens
 * forwarded as they arrive. Returns the translated FinalResponse. On stop
 * (abort) with partial text it returns what was streamed; with nothing
 * streamed it throws a "cancelled" error. */
export async function synthesizeResponseStream(
  state: SynthesisInput,
  onToken: (token: string) => void | Promise<void>,
  opts?: { signal?: AbortSignal },
): Promise<FinalResponse> {
  console.log(`[synthesizeResponse] stream for ${state.region.name} intents=${state.intents.join(",")}`);

  if (state.intents.length === 1 && state.intents[0] === "greeting") {
    const text = await translateFromEnglish(buildGreeting(state), state.language);
    await onToken(text);
    return {
      text,
      mapMarkers: [],
      evidence: ["Conversational greeting — no marine data fetched (ask+suggest)"],
    };
  }

  // Smalltalk: conversational reply, no data agents ran.
  if (state.intents.length === 1 && state.intents[0] === "smalltalk") {
    const { system, prompt } = smalltalkPrompt(state);
    try {
      const text = await streamOllama(system, prompt, onToken, { signal: opts?.signal });
      if (!text) throw new Error("Ollama returned empty response");
      const translatedText = await translateFromEnglish(text, state.language);
      return { text: translatedText, mapMarkers: [], evidence: ["Smalltalk — no marine data fetched (conversational)"] };
    } catch (err) {
      if (isAbort(err)) throw new Error("cancelled");
      const text = await translateFromEnglish(smalltalkFallback(), state.language);
      await onToken(text);
      return { text, mapMarkers: [], evidence: ["Smalltalk — template fallback (LLM down)"] };
    }
  }

  const mapMarkers = buildMapMarkers(state);
  const evidenceBase = buildEvidence(state);
  const fallback = buildTemplateText(state);
  const { system, prompt } = buildSynthesisPrompt(state);

  let streamed = "";
  const forward = async (token: string) => {
    streamed += token;
    await onToken(token);
  };

  try {
    const text = await streamOllama(system, prompt, forward, { signal: opts?.signal });
    if (!text) throw new Error("Ollama returned empty response");
    const translatedText = await translateFromEnglish(text, state.language);
    const evidence = [...evidenceBase, `synthesis: llm-stream (${OLLAMA_MODEL}) — verbatim-grounded`];
    return { text: translatedText, mapMarkers, evidence };
  } catch (err) {
    if (isAbort(err)) {
      if (streamed.trim()) {
        console.log("[synthesizeResponse] stream stopped by client, returning partial text");
        const translatedText = await translateFromEnglish(streamed.trim(), state.language);
        const evidence = [...evidenceBase, `synthesis: llm-stream (${OLLAMA_MODEL}) — stopped, partial answer`];
        return { text: translatedText, mapMarkers, evidence };
      }
      throw new Error("cancelled");
    }
    console.error(`[synthesizeResponse] LLM unavailable (${err instanceof Error ? err.message : err}), using template`);
    await onToken(fallback);
    const translatedText = await translateFromEnglish(fallback, state.language);
    const evidence = [...evidenceBase, `synthesis: template (${OLLAMA_MODEL}) — template fallback`];
    return { text: translatedText, mapMarkers, evidence };
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

  // Smalltalk: conversational reply, no data agents ran.
  if (state.intents.length === 1 && state.intents[0] === "smalltalk") {
    const { system, prompt } = smalltalkPrompt(state);
    try {
      const text = await streamOllama(system, prompt, () => {});
      if (!text) throw new Error("Ollama returned empty response");
      const translatedText = await translateFromEnglish(text, state.language);
      return { text: translatedText, mapMarkers: [], evidence: ["Smalltalk — no marine data fetched (conversational)"] };
    } catch {
      const text = await translateFromEnglish(smalltalkFallback(), state.language);
      return { text, mapMarkers: [], evidence: ["Smalltalk — template fallback (LLM down)"] };
    }
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
