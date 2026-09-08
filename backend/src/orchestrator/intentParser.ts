import type { QueryState } from "../types.ts";
import { geocodePlace } from "../services/geocode.ts";

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:8b";

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
  bapatla: { name: "Bapatla", lat: 15.9042, lon: 80.4678 },
  "బాపట్ల": { name: "Bapatla", lat: 15.9042, lon: 80.4678 },
  chirala: { name: "Chirala", lat: 15.8235, lon: 80.3522 },
  nizampatnam: { name: "Nizampatnam", lat: 15.9068, lon: 80.6718 },
  machilipatnam: { name: "Machilipatnam", lat: 16.1875, lon: 81.1388 },
  ongole: { name: "Ongole", lat: 15.5058, lon: 80.0499 },
  nellore: { name: "Nellore", lat: 14.4426, lon: 79.9865 },
  dhanushkodi: { name: "Dhanushkodi", lat: 9.152, lon: 79.4152 },
  // Native-script aliases so Telugu/Tamil/Hindi place names match even when
  // query translation is unavailable (scan runs on the original text too).
  "విశాఖపట్నం": { name: "Visakhapatnam", lat: 17.6868, lon: 83.2185 },
  "వైజాగ్": { name: "Visakhapatnam", lat: 17.6868, lon: 83.2185 },
  "விசாகப்பட்டினம்": { name: "Visakhapatnam", lat: 17.6868, lon: 83.2185 },
  "विशाखापत्तनम": { name: "Visakhapatnam", lat: 17.6868, lon: 83.2185 },
  "विजाग": { name: "Visakhapatnam", lat: 17.6868, lon: 83.2185 },
  "కాకినాడ": { name: "Kakinada", lat: 16.933, lon: 82.25 },
  "காக்கிநாடா": { name: "Kakinada", lat: 16.933, lon: 82.25 },
  "काकीनाडा": { name: "Kakinada", lat: 16.933, lon: 82.25 },
  "చెన్నై": { name: "Chennai", lat: 13.0827, lon: 80.2707 },
  "சென்னை": { name: "Chennai", lat: 13.0827, lon: 80.2707 },
  "चेन्नई": { name: "Chennai", lat: 13.0827, lon: 80.2707 },
  "కొచ్చి": { name: "Kochi", lat: 9.9312, lon: 76.2673 },
  "கொச்சி": { name: "Kochi", lat: 9.9312, lon: 76.2673 },
  "कोच्चि": { name: "Kochi", lat: 9.9312, lon: 76.2673 },
  "రామేశ్వరం": { name: "Rameswaram", lat: 9.2876, lon: 79.3129 },
  "இராமேஸ்வரம்": { name: "Rameswaram", lat: 9.2876, lon: 79.3129 },
  "ముంబై": { name: "Mumbai", lat: 18.922, lon: 72.8347 },
  "மும்பை": { name: "Mumbai", lat: 18.922, lon: 72.8347 },
  "मुंबई": { name: "Mumbai", lat: 18.922, lon: 72.8347 },
  "గోవా": { name: "Goa", lat: 15.2993, lon: 74.124 },
  "கோவா": { name: "Goa", lat: 15.2993, lon: 74.124 },
  "गोवा": { name: "Goa", lat: 15.2993, lon: 74.124 },
};

export const REGION_TABLE = REGION_FALLBACKS;

const INTENT_KEYWORDS: Record<string, string[]> = {
  pfz_lookup: ["pfz", "fishing zone", "fish", "catch", "potential fishing", "productivity", "where to fish"],
  safety_check: ["safe", "danger", "risk", "venture", "go to sea", "sailing", "should i go", "beach", "visit", "visiting", "picnic", "swim", "swimming", "best time", "evening visit", "morning visit"],
  weather_lookup: ["weather", "temperature", "forecast", "rain", "wind", "sea condition", "wave"],
  tide_lookup: ["tide", "high tide", "low tide", "tidal", "harbour timing"],
  alert_check: ["alert", "warning", "cyclone", "lightning", "storm", "emergency", "thunder"],
  route_advice: ["route", "path", "navigate", "course", "direction", "safest way"],
  chlorophyll_sst: ["chlorophyll", "sst", "sea surface temperature", "chloro"],
};

function inferIntents(query: string, chatHistory: { role: string; text: string }[] = []): string[] {
  if (isGreeting(query)) return ["greeting"];
  if (isSmalltalk(query)) return ["smalltalk"];
  const lower = query.toLowerCase();
  const intents: string[] = [];
  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      intents.push(intent);
    }
  }
  if (intents.length === 0) intents.push("safety_check");
  // Reference words with prior turns = follow-up: keep the data intents,
  // but flag it so synthesis leans on the conversation context.
  if (chatHistory.length > 0 && refersToHistory(lower)) {
    intents.push("follow_up");
  }
  return [...new Set(intents)];
}

/** Pure smalltalk ("thanks", "who are you", …) — short queries only, so
 * "help me find fish" still routes to the data agents. */
export function isSmalltalk(query: string): boolean {
  const t = query.trim().toLowerCase().replace(/[!.?,]+$/g, "").trim();
  if (t.length === 0 || t.length > 60) return false;
  return [
    /^(thanks|thank you|thankyou|thx|dhanyavadalu|dhanyavad|nandri|shukriya)\b/,
    /^(ok|okay|alright|great|nice|bye|goodbye|good night)\b/,
    /who are you/,
    /what can you do/,
    /^(help|help me)\b/,
  ].some((p) => p.test(t));
}

/** Pronouns / references that point at previous turns. */
function refersToHistory(lower: string): boolean {
  return /\b(there|that|those|they|them|it|this|here|tomorrow|day after|next|what about|how about|and then|also|too|again|instead)\b/.test(lower);
}

/** Pure conversational openers ("hi", "namaste", …) — no data query inside. */
export function isGreeting(query: string): boolean {
  const t = query.trim().toLowerCase().replace(/[!.?,]+$/g, "").trim();
  if (t.length === 0 || t.length > 30) return false;
  const patterns = [
    /^(hi|hii+|hey|hello|yo)\b/,
    /^(good\s?(morning|afternoon|evening|day))\b/,
    /^(namaste|namaskar|vanakkam|namaskaram)\b/,
    /^నమస్తే$/, /^హాయ్$/,
    /^నమస్కారం$/,
    /^வணக்கம்$/,
    /^नमस्ते$/,
  ];
  return patterns.some((p) => p.test(t));
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

/** Explicit place-name in the CURRENT query, or null if none. Exported so
 * the graph can re-scan the ORIGINAL (untranslated) text as a backup. */
export function extractExplicitRegion(query: string): Region | null {
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
): Promise<{ region: Region; intents: string[]; source: "llm" | "keyword" | "geocoder" | "fallback" }> {
  // Rule 0: pure greeting — no LLM, no data agents downstream.
  // Keep the current pin; the graph short-circuits to a warm ask+suggest reply.
  if (isGreeting(userQuery)) {
    return { region: currentRegion, intents: ["greeting"], source: "keyword" };
  }
  // Pure smalltalk — no LLM, no data agents downstream (graph skips them).
  if (isSmalltalk(userQuery)) {
    return { region: currentRegion, intents: ["smalltalk"], source: "keyword" };
  }
  const explicit = extractExplicitRegion(userQuery);
  const validIntents = [
    "pfz_lookup",
    "safety_check",
    "weather_lookup",
    "tide_lookup",
    "alert_check",
    "route_advice",
    "chlorophyll_sst",
    "greeting",
    "smalltalk",
    "follow_up",
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
  "intents": ["pfz_lookup" | "safety_check" | "weather_lookup" | "tide_lookup" | "alert_check" | "route_advice" | "chlorophyll_sst" | "greeting" | "smalltalk" | "follow_up"]
}

Rules:
- If no specific region is mentioned in CURRENT QUERY, use the current region: ${currentRegion.name} (lat: ${currentRegion.lat}, lon: ${currentRegion.lon})
- If CURRENT QUERY names a place, return that place with its real coordinates (do NOT return the current region).
- region.name should be a real coastal place name
- intents must be from the allowed list only
- "smalltalk" ONLY for thanks/bye/who-are-you/what-can-you-do/help with no fishing question inside
- Add "follow_up" when the query references previous turns (there/that/tomorrow/what about/and then) alongside the data intent
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
        think: false, // qwen3 thinking models: keep reasoning out of the JSON
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
    let source: "llm" | "keyword" | "geocoder" | "fallback" = "llm";

    // Rule 2: validate LLM region against the explicit mention.
    // The keyword table is curated — if the LLM's coordinates are >50 km
    // off (even with a matching name, e.g. Dhanushkodi at 10.75,78.75),
    // the keyword wins.
    if (explicit) {
      const llmMatchesExplicit =
        region.name.toLowerCase().includes(explicit.name.toLowerCase()) &&
        !coordsFar(region, explicit);
      if (!llmMatchesExplicit) {
        console.log(`[intentParser] LLM region "${region.name}" (${region.lat},${region.lon}) overridden by explicit "${explicit.name}" (${explicit.lat},${explicit.lon})`);
        region = explicit;
        source = "keyword";
      }
    }

    // Rule 3: unlisted place (e.g. Bapatla before it was tabled, or any
    // Indian coastal town) — live geocoder before accepting the default.
    // Triggers when the LLM merely echoed currentRegion/default.
    if (source === "llm" && region.name === currentRegion.name) {
      const geo = await geocodePlace(userQuery);
      if (geo) {
        console.log(`[intentParser] geocoder resolved "${geo.candidate}" -> ${geo.region.name}`);
        region = geo.region;
        source = "geocoder";
      }
    }

    const intents =
      parsed.intents && parsed.intents.length > 0
        ? parsed.intents.filter((i) => validIntents.includes(i))
        : inferIntents(userQuery, chatHistory);

    if (intents.length === 0) intents.push("safety_check");

    return { region, intents, source };
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      console.error("[intentParser] Ollama timeout (45s), using fallback");
    } else {
      console.error(`[intentParser] LLM unavailable (${err instanceof Error ? err.message : err}), using fallback`);
    }
    // Offline path: keyword scan first (explicit wins), geocoder second, else default.
    if (explicit) {
      return { region: explicit, intents: inferIntents(userQuery, chatHistory), source: "keyword" };
    }
    try {
      const geo = await geocodePlace(userQuery);
      if (geo) {
        return { region: geo.region, intents: inferIntents(userQuery, chatHistory), source: "geocoder" };
      }
    } catch {
      // fall through to keyword/default
    }
    const region = inferRegion(userQuery, currentRegion);
    const intents = inferIntents(userQuery, chatHistory);
    return { region, intents, source: "fallback" };
  }
}
