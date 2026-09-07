// backend/src/synthesis/synthesizeResponse.ts — Laptop C.
// Real response-synthesis agent for "Varuna" (SIH26176 - ORCA).
//
// Contract (must match what graph.ts imports at Hour 14):
//   synthesizeResponse(state: Pick<QueryState, "region"|"intents"|"marineData"|"weatherRisk">)
//     => Promise<FinalResponse { text, mapMarkers, evidence }>
// This function does NOT append to executionTrace — the graph node does that.

import type { QueryState } from "../types.ts";

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b";

export type SynthesisInput = Pick<
  QueryState,
  "region" | "intents" | "marineData" | "weatherRisk"
>;

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
  }
  if (weather) {
    evidence.push(
      `IMD weather: waves ${weather.waveHeightM} m, wind ${weather.windSpeedKmh} km/h`,
    );
    if (weather.alerts.length > 0)
      evidence.push(`Active alerts: ${weather.alerts.join(", ")}`);
    else evidence.push("No active alerts");
    evidence.push(`Risk reasoning: ${weather.reasoning}`);
  }
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
        "(Tide tables are not in the data — advise timing from waves/wind/verdict only.) ",
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
): Promise<{ text: string; source: "llm" | "template" }> {
  const context = {
    region: input.region,
    intents: input.intents,
    marineData: input.marineData ?? null,
    weatherRisk: input.weatherRisk ?? null,
  };
  const marine = input.marineData;
  const weather = input.weatherRisk;
  const framing = framingFor(input.intents);
  // Explicit key facts as PURE DATA LINES (no meta-language inline — the
  // model otherwise echoes instruction words like "EXACTLY" into the answer).
  // All citation rules live in the prompt body below, never in the facts.
  const marineFacts: string[] = [];
  const weatherFacts: string[] = [];
  if (marine && marine.pfzZones.length > 0) {
    const n = marine.pfzZones[0];
    marineFacts.push(`Nearest PFZ distance (km): ${n.distanceKm}`);
    marineFacts.push(`Nearest PFZ coordinates: (${n.lat}, ${n.lon})`);
    if (marine.sstCelsius !== undefined)
      marineFacts.push(`Sea surface temperature (C): ${marine.sstCelsius}`);
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
  }
  const facts = [
    `Region: ${input.region.name}`,
    ...(framing.hazardFirst ? [...weatherFacts, ...marineFacts] : [...marineFacts, ...weatherFacts]),
  ];
  const prompt =
    "You are Varuna, a marine safety assistant speaking directly to a fisherman. " +
    "Given this marine data and weather risk JSON, write a 2-3 sentence conversational " +
    "safety answer for a fisherman, citing the specific numbers " +
    "(PFZ distance, wave height, wind speed, sea surface temperature). " +
    framing.lead +
    "Regardless of intent, never phrase PFZ distance as avoidance " +
    "(never say 'stay away/clear/at least X km from/away from the zone'). " +
    "Match the safety advice to the verdict: safe = go ahead, caution = go carefully, " +
    "unsafe = stay ashore. " +
    "CRITICAL: the KEY FACTS below contain the exact numbers — reproduce every number " +
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
    return { text, source: "llm" };
  } catch (err) {
    console.error("[synthesizeResponse] LLM failed, using template:", err);
    return { text: fallback, source: "template" };
  }
}

export async function synthesizeResponse(
  state: SynthesisInput,
): Promise<FinalResponse> {
  console.log(`[synthesizeResponse] called for ${state.region.name}`);
  const mapMarkers = buildMapMarkers(state);
  const evidence = buildEvidence(state);
  const fallback = buildTemplateText(state);
  const { text, source } = await generateWithOllama(state, fallback);
  // Provenance tag: lets the demo/UI show whether the answer is LLM-written
  // or the deterministic template (e.g. when Ollama is down).
  evidence.push(`synthesis: ${source}`);
  return { text, mapMarkers, evidence };
}
