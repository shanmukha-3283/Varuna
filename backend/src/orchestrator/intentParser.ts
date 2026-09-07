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
  choppler: { name: "Visakhapatnam", lat: 17.6868, lon: 83.2185 },
};

const INTENT_KEYWORDS: Record<string, string[]> = {
  pfz_lookup: ["pfz", "fishing zone", "fish", "catch", "potential fishing"],
  safety_check: ["safe", "danger", "risk", "venture", "go to sea", "sailing"],
  weather_lookup: ["weather", "temperature", "forecast", "rain", "wind"],
  tide_lookup: ["tide", "high tide", "low tide", "tidal"],
  alert_check: ["alert", "warning", "cyclone", "lightning", "storm", "emergency"],
  route_advice: ["route", "path", "navigate", "course", "direction"],
  chlorophyll_sst: ["chlorophyll", "sst", "sea surface temperature", "productivity"],
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

function inferRegion(query: string): Region | null {
  const lower = query.toLowerCase();
  for (const [key, region] of Object.entries(REGION_FALLBACKS)) {
    if (lower.includes(key)) return region;
  }
  return null;
}

export async function parseIntent(
  userQuery: string,
): Promise<{ region: Region; intents: string[]; language: string; source: "llm" | "fallback" }> {
  const prompt = `Extract structured data from this marine/fishing query.

QUERY: "${userQuery}"

Return ONLY valid JSON (no markdown, no explanation) with this exact shape:
{
  "region": { "name": "string", "lat": number, "lon": number },
  "intents": ["pfz_lookup" | "safety_check" | "weather_lookup" | "tide_lookup" | "alert_check" | "route_advice" | "chlorophyll_sst"],
  "language": "string"
}

Rules:
- If no specific region is mentioned, use Visakhapatnam (lat: 17.6868, lon: 83.2185)
- region.name should be a real coastal place name
- intents must be from the allowed list only
- Return at least one intent
- language should be the natural language of the query (e.g. "English", "Telugu", "Tamil", "Hindi")`;

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
      language?: string;
    };

    const region: Region = {
      name: parsed.region?.name || "Visakhapatnam",
      lat: parsed.region?.lat ?? 17.6868,
      lon: parsed.region?.lon ?? 83.2185,
    };

    const validIntents = [
      "pfz_lookup",
      "safety_check",
      "weather_lookup",
      "tide_lookup",
      "alert_check",
      "route_advice",
      "chlorophyll_sst",
    ];
    const intents =
      parsed.intents && parsed.intents.length > 0
        ? parsed.intents.filter((i) => validIntents.includes(i))
        : inferIntents(userQuery);

    if (intents.length === 0) intents.push("safety_check");
    const language = parsed.language || "English";

    return { region, intents, language, source: "llm" };
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      console.error("[intentParser] Ollama timeout (45s), using fallback");
    } else {
      console.error("[intentParser] LLM failed, using fallback:", err);
    }
    const region = inferRegion(userQuery) || {
      name: "Visakhapatnam",
      lat: 17.6868,
      lon: 83.2185,
    };
    const intents = inferIntents(userQuery);
    return { region, intents, language: "English", source: "fallback" };
  }
}
