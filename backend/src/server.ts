import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { runQuery, runQueryStream } from "./orchestrator/graph.ts";
import { parseIntent } from "./orchestrator/intentParser.ts";
import { getWeatherRisk } from "./agents/weatherRisk.ts";
import { checkGeofence } from "./agents/geofenceAgent.ts";

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
    const body = await c.req.json<{ userQuery?: string, chatHistory?: { role: string; text: string }[], preferredLanguage?: string, currentRegion?: { name: string; lat: number; lon: number } }>();
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
    const result = await runQuery(body.userQuery, body.chatHistory || [], body.preferredLanguage || "English", body.currentRegion);
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
  const body = await c.req.json<{ userQuery?: string, chatHistory?: { role: string; text: string }[], preferredLanguage?: string, currentRegion?: { name: string; lat: number; lon: number } }>().catch(() => null);
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

app.get("/api/check_alerts", async (c) => {
  const lat = parseFloat(c.req.query("lat") || "17.6868");
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
