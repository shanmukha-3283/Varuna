// src/api.ts - single wrapper around the backend POST /api/query (live only).

export interface Region {
  name: string;
  lat: number;
  lon: number;
}

export interface MapMarker {
  lat: number;
  lon: number;
  label: string;
  type: string; // "pfz" (green) | "hazard" (red) | "route" (purple)
}

export interface TraceEntry {
  agent: string;
  action: string;
  timestamp: string;
}

export interface QueryState {
  chatHistory?: { role: string; text: string }[];
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
  geofenceAlerts?: {
    zoneName: string;
    alertLevel: "warning" | "danger" | "info";
    message: string;
  }[];
  routeOptimization?: {
    waypoints: { lat: number; lon: number }[];
    distanceKm: number;
    estTimeHours: number;
    message: string;
  };
  executionTrace: TraceEntry[];
  finalResponse?: {
    text: string;
    mapMarkers: MapMarker[];
    evidence: string[];
  };
}

export const API_BASE = "http://localhost:3000";

export async function queryBackend(
  userQuery: string,
  chatHistory: { role: string; text: string }[] = [],
  preferredLanguage: string = "English",
  currentRegion?: Region,
  outerSignal?: AbortSignal,
): Promise<QueryState> {
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
      body: JSON.stringify({ userQuery, chatHistory, preferredLanguage, currentRegion }),
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
