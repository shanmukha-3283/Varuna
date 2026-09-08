import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { runQuery, runQueryStream } from "./orchestrator/graph.ts";
import { parseIntent } from "./orchestrator/intentParser.ts";
import { getWeatherRisk } from "./agents/weatherRisk.ts";
import { checkGeofence } from "./agents/geofenceAgent.ts";
import { suggestQueries, currentHourIST, timeOfDay } from "./services/suggest.ts";
import { translateFromEnglish } from "./services/translation.ts";

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:8b";

const app = new Hono();

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const PORT = parseInt(process.env.PORT || "3000", 10);

app.use(
  "*",
  cors({
    origin: [FRONTEND_ORIGIN, "http://localhost:5173", "http://127.0.0.1:5173"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

app.get("/health", (c) => {
  return c.json({ status: "ok", service: "varuna-backend", timestamp: new Date().toISOString() });
});

app.get("/api/intents", async (c) => {
  const q = c.req.query("q");
  if (!q) return c.json({ error: "Missing ?q=userQuery" }, 400);
  try {
    const parsed = await parseIntent(q);
    return c.json(parsed);
  } catch (err) {
    console.error("[server] /api/intents error:", err);
    return c.json({ error: "Failed to parse intent" }, 500);
  }
});

app.post("/api/query", async (c) => {
  try {
    const body = await c.req.json<{ userQuery?: string, chatHistory?: { role: string; text: string }[], preferredLanguage?: string, currentRegion?: { name: string; lat: number; lon: number }, sessionId?: string }>();
    if (!body.userQuery || typeof body.userQuery !== "string" || !body.userQuery.trim()) {
      return c.json({ error: "Missing or invalid 'userQuery' field" }, 400);
    }
    if (body.currentRegion) {
      const { lat, lon } = body.currentRegion;
      if (typeof lat !== "number" || typeof lon !== "number" || Number.isNaN(lat) || Number.isNaN(lon) ||
          lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return c.json({ error: "Invalid 'currentRegion' lat/lon" }, 400);
      }
    }

    console.log(`[server] POST /api/query — "${body.userQuery}" (${body.preferredLanguage || 'English'}) at ${body.currentRegion?.name || 'Visakhapatnam'}`);
    const t0 = Date.now();
    const result = await runQuery(body.userQuery, body.chatHistory || [], body.preferredLanguage || "English", body.currentRegion, body.sessionId);
    const dt = Date.now() - t0;
    const intentAction = result.executionTrace[0]?.action ?? "unknown";
    const marineAction = result.executionTrace[1]?.action ?? "unknown";
    console.log(
      `[server] query done in ${dt}ms — intent:${intentAction} marine:${marineAction} verdict:${result.weatherRisk?.verdict} trace:${result.executionTrace.map((e) => e.agent).join("->")}`,
    );
    return c.json(result);
  } catch (err) {
    console.error("[server] Error:", err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.post("/api/query/stream", async (c) => {
  const body = await c.req.json<{ userQuery?: string, chatHistory?: { role: string; text: string }[], preferredLanguage?: string, currentRegion?: { name: string; lat: number; lon: number }, sessionId?: string }>().catch(() => null);
  if (!body?.userQuery || typeof body.userQuery !== "string" || !body.userQuery.trim()) {
    return c.json({ error: "Missing or invalid 'userQuery' field" }, 400);
  }
  if (body.currentRegion) {
    const { lat, lon } = body.currentRegion;
    if (typeof lat !== "number" || typeof lon !== "number" || Number.isNaN(lat) || Number.isNaN(lon) ||
        lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return c.json({ error: "Invalid 'currentRegion' lat/lon" }, 400);
    }
  }
  console.log(`[server] POST /api/query/stream — "${body.userQuery}" (${body.preferredLanguage || 'English'}) at ${body.currentRegion?.name || 'Visakhapatnam'}`);
  const t0 = Date.now();
  return streamSSE(c, async (stream) => {
    let closed = false;
    // Best-effort: stop pulling tokens once the client goes away.
    (c.req.raw.signal as AbortSignal | undefined)?.addEventListener("abort", () => { closed = true; });
    const send = async (event: string, data: unknown) => {
      if (closed) return;
      try {
        await stream.writeSSE({ event, data: typeof data === "string" ? data : JSON.stringify(data) });
      } catch {
        closed = true;
      }
    };
    try {
      const result = await runQueryStream(
        body.userQuery as string,
        body.chatHistory || [],
        body.preferredLanguage || "English",
        body.currentRegion,
        {
          onMeta: (meta) => send("meta", meta),
          onAgent: (entry) => send("agent", entry),
          onDelta: (token) => send("delta", { token }),
          signal: c.req.raw.signal as AbortSignal | undefined,
        },
        body.sessionId,
      );
      await send("done", result);
      console.log(`[server] stream done in ${Date.now() - t0}ms — trace:${result.executionTrace.map((e) => e.agent).join("->")}`);
    } catch (err) {
      if (err instanceof Error && err.message === "cancelled") {
        await send("error", { error: "cancelled" });
      } else {
        console.error("[server] /api/query/stream error:", err);
        await send("error", { error: "Internal server error" });
      }
    }
  });
});

/** Dynamic opening: LLM-composed greeting (time + place + live sea) plus
 * adaptive suggestion chips. ?suggestionsOnly=1 skips the LLM for a fast
 * per-turn chip refresh. */
app.get("/api/opening", async (c) => {
  const place = (c.req.query("place") || "Visakhapatnam").slice(0, 60);
  const lat = parseFloat(c.req.query("lat") || "17.6868");
  const lon = parseFloat(c.req.query("lon") || "83.2185");
  const language = c.req.query("language") || "English";
  const suggestionsOnly = c.req.query("suggestionsOnly") === "1";
  if (Number.isNaN(lat) || Number.isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return c.json({ error: "Invalid lat/lon query params" }, 400);
  }
  try {
    const weather = await getWeatherRisk({ name: place, lat, lon });
    const hour = currentHourIST();
    const tod = timeOfDay(hour);
    const suggestions = suggestQueries(place, weather.verdict, weather.alerts, hour);
    if (suggestionsOnly) return c.json({ suggestions, place, language });
    const alertBit = weather.alerts.length > 0 ? ` Alerts: ${weather.alerts.join(", ")}.` : "";
    const fallback =
      `Good ${tod}! I'm Varuna, your marine intelligence assistant for the ${place} coast. ` +
      `The sea is ${weather.verdict} right now — ask me about fishing zones, safety, tides, alerts, or the safest route out.`;
    let greeting = fallback;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 30_000);
      const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt:
            `Write a warm 1-2 sentence greeting from Varuna, a marine intelligence assistant for Indian fishermen. ` +
            `Facts: time of day: ${tod}; place: ${place}; sea right now: ${weather.verdict} ` +
            `(waves ${weather.waveHeightM} m, wind ${weather.windSpeedKmh} km/h).${alertBit} ` +
            `Invite them to ask about fishing zones, safety, tides, alerts or routes. ` +
            `Plain text, no markdown, no emojis. Draft in ENGLISH.`,
          system: "You write short warm greetings. 1-2 sentences, plain text.",
          think: false,
          options: { temperature: 0.5, num_predict: 128 },
          stream: false,
        }),
        signal: ctl.signal,
      }).finally(() => clearTimeout(t));
      if (res.ok) {
        const data = (await res.json()) as { response?: string };
        if (data.response?.trim()) greeting = data.response.trim();
      }
    } catch {
      // fall back to the templated greeting below
    }
    const text = await translateFromEnglish(greeting, language);
    return c.json({ greeting: text, suggestions, place, language });
  } catch (err) {
    console.error("[server] /api/opening error:", err);
    return c.json({ error: "Failed to build opening" }, 500);
  }
});

app.get("/api/check_alerts", async (c) => {  const lat = parseFloat(c.req.query("lat") || "17.6868");
  const lon = parseFloat(c.req.query("lon") || "83.2185");
  if (Number.isNaN(lat) || Number.isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return c.json({ error: "Invalid lat/lon query params" }, 400);
  }
  const region = { name: "Current Location", lat, lon };

  try {
    const [weatherRisk, geofenceAlerts] = await Promise.all([
      getWeatherRisk(region),
      checkGeofence(region)
    ]);
    
    const alerts = [];
    if (weatherRisk.verdict === "unsafe" || weatherRisk.alerts.length > 0) {
      alerts.push(`Weather Alert: ${weatherRisk.alerts.join(", ")} - Sea is ${weatherRisk.verdict}.`);
    }
    for (const geo of geofenceAlerts || []) {
      if (geo.alertLevel === "danger" || geo.alertLevel === "warning") {
        alerts.push(`Geofence ${geo.alertLevel}: ${geo.message}`);
      }
    }
    
    return c.json({ alerts });
  } catch (err) {
    console.error("[server] /api/check_alerts error:", err);
    return c.json({ error: "Failed to check alerts" }, 500);
  }
});

console.log(`[varuna] Starting backend on port ${PORT}...`);
console.log(`[varuna] Ollama: ${process.env.OLLAMA_HOST || "http://localhost:11434"}`);
console.log(`[varuna] Model: ${process.env.OLLAMA_MODEL || "qwen3:8b"}`);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[varuna] Backend running at http://localhost:${info.port}`);
  console.log(`[varuna] Health: http://localhost:${info.port}/health`);
  console.log(`[varuna] Query:  POST http://localhost:${info.port}/api/query`);
});
