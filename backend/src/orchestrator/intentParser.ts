import type { QueryState } from "../types.ts";

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b";

type Region = QueryState["region"];

const REGION_FALLBACKS: Record<string, Region> = {
  visakhapatnam: { name: "Visakhapatnam", lat: 17.6868, lon: 83.2185 },
  vizag: { name: "Visakhapatnam", lat: 17.6868, lon: 83.2185 },
  "rk beach": { name: "Visakhapatnam", lat: 17.6868, lon: 83.2185 },
  waltair: { name: "Visakhapatnam", lat: 17.6868, lon: 83.2185 },
  "king george": { name: "Visakhapatnam", lat: 17.6868, lon: 83.2185 },
  kakinada: { name: "Kakinada", lat: 16.933, lon: 82.25 },
  chennai: { name: "Chennai", lat: 13.0827, lon: 80.2707 },
  puducherry: { name: "Puducherry", lat: 11.9416, lon: 79.8083 },
  pondicherry: { name: "Puducherry", lat: 11.9416, lon: 79.8083 },
  rameswaram: { name: "Rameswaram", lat: 9.2876, lon: 79.3129 },
  kanyakumari: { name: "Kanyakumari", lat: 8.0883, lon: 77.5385 },
  kochi: { name: "Kochi", lat: 9.9312, lon: 76.2673 },
  cochin: { name: "Kochi", lat: 9.9312, lon: 76.2673 },
  mumbai: { name: "Mumbai", lat: 18.922, lon: 72.8347 },
  veraval: { name: "Veraval", lat: 20.9077, lon: 70.3679 },
  paradip: { name: "Paradip", lat: 20.2659, lon: 86.6408 },
  puri: { name: "Puri", lat: 19.8135, lon: 85.8312 },
  goa: { name: "Goa", lat: 15.2993, lon: 74.124 },
  mangalore: { name: "Mangalore", lat: 12.9141, lon: 74.856 },
  karwar: { name: "Karwar", lat: 14.8131, lon: 74.1294 },
};

const INTENT_KEYWORDS: Record<string, string[]> = {
  pfz_lookup: ["pfz", "fishing zone", "fish", "catch", "potential fishing", "productivity", "where to fish"],
  safety_check: ["safe", "danger", "risk", "venture", "go to sea", "sailing", "should i go"],
  weather_lookup: ["weather", "temperature", "forecast", "rain", "wind", "sea condition", "wave"],
  tide_lookup: ["tide", "high tide", "low tide", "tidal", "harbour timing"],
  alert_check: ["alert", "warning", "cyclone", "lightning", "storm", "emergency", "thunder"],
  route_advice: ["route", "path", "navigate", "course", "direction", "safest way"],
  chlorophyll_sst: ["chlorophyll", "sst", "sea surface temperature", "chloro"],
};

function inferIntents(query: string): string[] {
  const lower = query.toLowerCase();
  const intents: string[] = [];
  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      intents.push(intent);
    }
  }
  return intents.length > 0 ? intents : ["safety_check"];
}

function inferRegion(query: string, defaultRegion: Region): Region {
  const lower = query.toLowerCase();
  // Longest-match first so "rk beach" beats generic substrings.
  const keys = Object.keys(REGION_FALLBACKS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (lower.includes(key)) return REGION_FALLBACKS[key];
  }
  return defaultRegion;
}

/** Explicit place-name in the CURRENT query, or null if none. */
function extractExplicitRegion(query: string): Region | null {
  const lower = query.toLowerCase();
  const keys = Object.keys(REGION_FALLBACKS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (lower.includes(key)) return REGION_FALLBACKS[key];
  }
  return null;
}

function coordsFar(a: Region, b: Region, km = 50): boolean {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)) > km;
}

export async function parseIntent(
  userQuery: string,
  chatHistory: { role: string; text: string }[] = [],
  currentRegion: Region = { name: "Visakhapatnam", lat: 17.6868, lon: 83.2185 }
): Promise<{ region: Region; intents: string[]; source: "llm" | "keyword" | "fallback" }> {
  // Rule 1: explicit place-name in the CURRENT query always wins —
  // skip the LLM for region so history/defaults (e.g. sticky Vizag)
  // can never override "Kakinada".
  const explicit = extractExplicitRegion(userQuery);
  const validIntents = [
    "pfz_lookup",
    "safety_check",
    "weather_lookup",
    "tide_lookup",
    "alert_check",
    "route_advice",
    "chlorophyll_sst",
  ];

  // Only the last 2 turns go to the LLM to reduce sticky-history bias.
  const recent = chatHistory.slice(-4);
  let historyStr = "";
  if (recent.length > 0) {
    historyStr = "RECENT CHAT (context only — CURRENT QUERY place-name overrides it):\n" + recent.map(m => `${m.role.toUpperCase()}: ${m.text.slice(0, 300)}`).join("\n") + "\n\n";
  }

  const prompt = `Extract structured data from this marine/fishing query.

${historyStr}CURRENT QUERY: "${userQuery}"

Return ONLY valid JSON (no markdown, no explanation) with this exact shape:
{
  "region": { "name": "string", "lat": number, "lon": number },
  "intents": ["pfz_lookup" | "safety_check" | "weather_lookup" | "tide_lookup" | "alert_check" | "route_advice" | "chlorophyll_sst"]
}

Rules:
- If no specific region is mentioned in CURRENT QUERY, use the current region: ${currentRegion.name} (lat: ${currentRegion.lat}, lon: ${currentRegion.lon})
- If CURRENT QUERY names a place, return that place with its real coordinates (do NOT return the current region).
- region.name should be a real coastal place name
- intents must be from the allowed list only
- Return at least one intent`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        system:
          "You are a structured data extractor. Return only valid JSON, nothing else.",
        format: "json",
        options: { temperature: 0, num_predict: 256 },
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}`);
    }

    clearTimeout(timeout);
    const data = (await response.json()) as { response: string };
    const parsed = JSON.parse(data.response) as {
      region?: { name?: string; lat?: number; lon?: number };
      intents?: string[];
    };

    let region: Region = {
      name: parsed.region?.name || currentRegion.name,
      lat: parsed.region?.lat ?? currentRegion.lat,
      lon: parsed.region?.lon ?? currentRegion.lon,
    };
    let source: "llm" | "keyword" | "fallback" = "llm";

    // Rule 2: validate LLM region against the explicit mention.
    // If the query names Kakinada but the LLM echoed Vizag/default,
    // the keyword wins.
    if (explicit) {
      const llmMatchesExplicit =
        region.name.toLowerCase().includes(explicit.name.toLowerCase()) ||
        (!coordsFar(region, explicit) && region.name === explicit.name);
      if (!llmMatchesExplicit) {
        console.log(`[intentParser] LLM region "${region.name}" overridden by explicit "${explicit.name}"`);
        region = explicit;
        source = "keyword";
      }
    }

    const intents =
      parsed.intents && parsed.intents.length > 0
        ? parsed.intents.filter((i) => validIntents.includes(i))
        : inferIntents(userQuery);

    if (intents.length === 0) intents.push("safety_check");

    return { region, intents, source };
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      console.error("[intentParser] Ollama timeout (45s), using fallback");
    } else {
      console.error("[intentParser] LLM failed, using fallback:", err);
    }
    // Offline path: keyword scan first (explicit wins), else default.
    if (explicit) {
      return { region: explicit, intents: inferIntents(userQuery), source: "keyword" };
    }
    const region = inferRegion(userQuery, currentRegion);
    const intents = inferIntents(userQuery);
    return { region, intents, source: "fallback" };
  }
}
