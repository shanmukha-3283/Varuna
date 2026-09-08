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

export interface StreamMeta {
  intents: string[];
  region: Region;
  regionSource?: string;
  language: string;
  detectedLanguage?: string;
}

export interface StreamCallbacks {
  onMeta?: (meta: StreamMeta) => void;
  onAgent?: (entry: TraceEntry) => void;
  onDelta?: (token: string) => void;
}

function parseSSEBlock(block: string): { event: string; data: string } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

/** Streaming twin of queryBackend: POSTs to /api/query/stream and forwards
 * SSE events as they arrive. Resolves with the full QueryState from `done`. */
export async function queryStream(
  userQuery: string,
  chatHistory: { role: string; text: string }[] = [],
  preferredLanguage: string = "English",
  currentRegion?: Region,
  cbs: StreamCallbacks = {},
  outerSignal?: AbortSignal,
  sessionId?: string,
): Promise<QueryState> {
  const QUERY_TIMEOUT_MS = 180_000;
  if (outerSignal?.aborted) throw new Error("cancelled");
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  outerSignal?.addEventListener("abort", onOuterAbort);
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/api/query/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ userQuery, chatHistory, preferredLanguage, currentRegion, sessionId }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      const body = (!res.ok ? await res.json().catch(() => null) : null) as { error?: string } | null;
      throw new Error(body?.error || `Backend returned ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const handleBlock = (block: string): QueryState | null => {
      const parsed = parseSSEBlock(block);
      if (!parsed) return null;
      const { event, data } = parsed;
      if (event === "meta") cbs.onMeta?.(JSON.parse(data) as StreamMeta);
      else if (event === "agent") cbs.onAgent?.(JSON.parse(data) as TraceEntry);
      else if (event === "delta") cbs.onDelta?.((JSON.parse(data) as { token: string }).token ?? "");
      else if (event === "error") {
        const msg = (JSON.parse(data) as { error?: string }).error || "stream error";
        throw new Error(msg);
      } else if (event === "done") return JSON.parse(data) as QueryState;
      return null;
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const blocks = buf.split("\n\n");
      buf = blocks.pop() ?? "";
      for (const block of blocks) {
        const final = handleBlock(block);
        if (final) {
          try { reader.cancel(); } catch { /* already closed */ }
          return final;
        }
      }
    }
    if (buf.trim()) {
      const final = handleBlock(buf);
      if (final) return final;
    }
    throw new Error("Stream ended without a result — please retry.");
  } catch (err) {
    if (controller.signal.aborted) {
      if (outerSignal?.aborted) throw new Error("cancelled");
      throw new Error("Query timed out after 180s — Ollama may be cold-starting. Please retry once.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onOuterAbort);
  }
}

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
