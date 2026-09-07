// backend/src/types.ts — the contract every agent speaks.
// SHARED FILE: do not edit alone. Agree as a team, one person edits,
// push immediately, everyone else pulls before continuing.

export interface QueryState {
  userQuery: string;
  region: { name: string; lat: number; lon: number };
  timestamp: string;
  intents: string[]; // e.g. ["pfz_lookup", "safety_check"]

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
    alerts: string[]; // e.g. ["high-wave", "cyclone-watch"]
    verdict: "safe" | "caution" | "unsafe";
    reasoning: string;
  };

  executionTrace: { agent: string; action: string; timestamp: string }[];

  finalResponse?: {
    text: string;
    mapMarkers: { lat: number; lon: number; label: string; type: string }[];
    evidence: string[];
  };
}
