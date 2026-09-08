const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:8b";

function scriptDetect(text: string): string | null {
  if (/[\u0900-\u097F]/.test(text)) return "Hindi";
  if (/[\u0C00-\u0C7F]/.test(text)) return "Telugu";
  if (/[\u0B80-\u0BFF]/.test(text)) return "Tamil";
  if (/[\u0980-\u09FF]/.test(text)) return "Bengali";
  if (/[\u0D00-\u0D7F]/.test(text)) return "Malayalam";
  if (/[\u0C80-\u0CFF]/.test(text)) return "Kannada";
  if (/[\u0A80-\u0AFF]/.test(text)) return "Gujarati";
  if (/[\u0B00-\u0B7F]/.test(text)) return "Odia";
  return null;
}

async function ollamaGenerate(prompt: string, system: string, timeoutMs = 20000): Promise<string | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        system,
        think: false, // qwen3 thinking models: keep reasoning out of the reply
        options: { temperature: 0, num_predict: 64 },
        stream: false,
      }),
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { response?: string };
    return (data.response || "").trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function detectLanguage(text: string): Promise<string> {
  const script = scriptDetect(text);
  if (script) {
    console.log(`[translation] Detected language by script: ${script}`);
    return script;
  }
  // Latin script: confirm via LLM (handles transliterated Hindi/Telugu etc.),
  // fall back to English on failure/timeout.
  const out = await ollamaGenerate(
    `Detect the language of this query. Reply with exactly one word: English, Hindi, Telugu, Tamil, Bengali, Malayalam, Kannada, Gujarati, Odia, or Marathi.\n\nQuery: "${text}"`,
    "You are a language detector. Reply with exactly one language name, nothing else.",
    15000,
  );
  const cleaned = (out || "").replace(/[^A-Za-z]/g, "");
  const known = ["English", "Hindi", "Telugu", "Tamil", "Bengali", "Malayalam", "Kannada", "Gujarati", "Odia", "Marathi"];
  const match = known.find((k) => k.toLowerCase() === cleaned.toLowerCase());
  const lang = match ?? "English";
  console.log(`[translation] Detected language: ${lang}`);
  return lang;
}

export async function translateToEnglish(text: string, sourceLang: string): Promise<string> {
  if (sourceLang === "English") return text;
  console.log(`[translation] Translating from ${sourceLang} to English: "${text}"`);
  const out = await ollamaGenerate(
    `Translate this ${sourceLang} fisherman query to English. Preserve place names and numbers exactly. Return ONLY the translation, no explanation.\n\nQuery: "${text}"`,
    "You are a translator for Indian fishermen queries. Return only the English translation.",
    25000,
  );
  if (out) return out.replace(/^["']|["']$/g, "");
  // Fallback: return original text so the intent parser still sees content
  // (better than a hardcoded wrong query that destroys user intent).
  console.error("[translation] to-English failed, passing through original text");
  return text;
}

export async function translateFromEnglish(text: string, targetLang: string): Promise<string> {
  if (!targetLang || targetLang === "English") return text;
  console.log(`[translation] Translating from English to ${targetLang}...`);
  const out = await ollamaGenerate(
    `Translate this marine safety answer to ${targetLang}. Preserve ALL numbers, units (km, m, km/h, °C), and place names verbatim. Return ONLY the translation.\n\nAnswer: "${text}"`,
    `You are a translator to ${targetLang}. Return only the translation, preserving numbers exactly.`,
    30000,
  );
  if (out) return out.replace(/^["']|["']$/g, "");
  console.error("[translation] from-English failed, returning English with tag");
  return `[${targetLang} translation unavailable] ${text}`;
}
