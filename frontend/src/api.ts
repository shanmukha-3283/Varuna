// src/api.ts — Laptop C. Single wrapper around the backend's POST /api/query.
// Until Hour 22 (real backend wired), USE_MOCK serves a type-correct
// Visakhapatnam response so the UI builds standalone. Flip to false then.

export interface Region {
  name: string;
  lat: number;
  lon: number;
}

export interface MapMarker {
  lat: number;
  lon: number;
  label: string;
  type: string; // "pfz" (green) | "hazard" (red)
}

export interface TraceEntry {
  agent: string;
  action: string;
  timestamp: string;
}

export interface QueryState {
  userQuery: string;
  region: Region;
  timestamp: string;
  intents: string[];
  language: string;
  marineData?: {
    pfzZones: { lat: number; lon: number; distanceKm: number }[];
    sstCelsius?: number;
    chlorophyll?: number;
    source: string;
    fetchedAt: string;
  };
  weatherRisk?: {
    waveHeightM: number;
    windSpeedKmh: number;
    alerts: string[];
    verdict: "safe" | "caution" | "unsafe";
    reasoning: string;
  };
  executionTrace: TraceEntry[];
  finalResponse?: {
    text: string;
    mapMarkers: MapMarker[];
    evidence: string[];
  };
}

export const API_BASE = "http://localhost:3000";

// Hour 14: backend is live — use the real call. (Mock kept below for offline UI work.)
const USE_MOCK = false;

function mockResponse(userQuery: string): QueryState {
  const now = new Date().toISOString();
  return {
    userQuery,
    region: { name: "Visakhapatnam", lat: 17.6868, lon: 83.2185 },
    timestamp: now,
    intents: ["pfz_lookup", "safety_check"],
    language: "English",
    marineData: {
      pfzZones: [
        { lat: 17.72, lon: 83.25, distanceKm: 4.2 },
        { lat: 17.65, lon: 83.3, distanceKm: 6.8 },
        { lat: 17.78, lon: 83.18, distanceKm: 11.3 },
      ],
      sstCelsius: 28.4,
      chlorophyll: 1.2,
      source: "INCOIS (mock)",
      fetchedAt: now,
    },
    weatherRisk: {
      waveHeightM: 1.8,
      windSpeedKmh: 22,
      alerts: [],
      verdict: "caution",
      reasoning:
        "Wave height of 1.8m is in the caution range (1.5-2.5m). Wind speed is moderate at 22 km/h.",
    },
    executionTrace: [
      { agent: "intentParser", action: "parse_intent", timestamp: now },
      { agent: "marineDataAgent", action: "fetch_marine_data", timestamp: now },
      { agent: "weatherRiskAgent", action: "fetch_weather_risk", timestamp: now },
      { agent: "synthesisAgent", action: "synthesize_response", timestamp: now },
    ],
    finalResponse: {
      text: "For Visakhapatnam: the nearest Potential Fishing Zone is 4.2 km away (17.72, 83.25), with sea surface temperature 28.4°C. Sea conditions are caution — waves 1.8 m, wind 22 km/h — so venture out only with caution and monitor IMD updates closely. No active alerts for the coast right now. (mock response — real backend not wired yet)",
      mapMarkers: [
        { lat: 17.72, lon: 83.25, label: "PFZ (4.2 km)", type: "pfz" },
        { lat: 17.65, lon: 83.3, label: "PFZ (6.8 km)", type: "pfz" },
        { lat: 17.78, lon: 83.18, label: "PFZ (11.3 km)", type: "pfz" },
        { lat: 17.6868, lon: 83.2185, label: "Weather: caution", type: "hazard" },
      ],
      evidence: [
        "INCOIS PFZ data (INCOIS (mock)): 3 zone(s) found",
        "SST 28.4°C, chlorophyll 1.2 mg/m³",
        "IMD weather: waves 1.8 m, wind 22 km/h",
        "No active alerts",
      ],
    },
  };
}

export async function queryBackend(
  userQuery: string,
  outerSignal?: AbortSignal,
): Promise<QueryState> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 600));
    return mockResponse(userQuery);
  }
  // Generous timeout: the graph makes 2 Ollama calls (intent + synthesis),
  // and a cold model can take 60-90s. Caller may also cancel via outerSignal
  // (e.g. user sends a new query) — that surfaces as a "cancelled" error.
  const QUERY_TIMEOUT_MS = 120_000;
  if (outerSignal?.aborted) throw new Error("cancelled"); // already superseded
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  outerSignal?.addEventListener("abort", onOuterAbort);
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userQuery }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(body?.error || `Backend returned ${res.status}`);
    }
    return (await res.json()) as QueryState;
  } catch (err) {
    if (controller.signal.aborted) {
      if (outerSignal?.aborted) throw new Error("cancelled");
      throw new Error(
        "Query timed out after 120s — Ollama may be cold-starting. Please retry once.",
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onOuterAbort);
  }
}
