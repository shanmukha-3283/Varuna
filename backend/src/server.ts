import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { runQuery } from "./orchestrator/graph.ts";
import { parseIntent } from "./orchestrator/intentParser.ts";
import { getWeatherRisk } from "./agents/weatherRisk.ts";
import { checkGeofence } from "./agents/geofenceAgent.ts";

const app = new Hono();

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";

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
    if (!body.userQuery || typeof body.userQuery !== "string") {
      return c.json({ error: "Missing or invalid 'userQuery' field" }, 400);
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

const PORT = parseInt(process.env.PORT || "3000", 10);

app.get("/api/check_alerts", async (c) => {
  const lat = parseFloat(c.req.query("lat") || "17.6868");
  const lon = parseFloat(c.req.query("lon") || "83.2185");
  const region = { name: "Current Location", lat, lon };
  
  try {
    // import these dynamically or at top. Wait, better to import at top. Let's do it inline for now or add imports at top.
    // I need to add imports for getWeatherRisk and checkGeofence.
    // I'll add a separate replace block for imports.
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
console.log(`[varuna] Model: ${process.env.OLLAMA_MODEL || "qwen2.5:7b"}`);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[varuna] Backend running at http://localhost:${info.port}`);
  console.log(`[varuna] Health: http://localhost:${info.port}/health`);
  console.log(`[varuna] Query:  POST http://localhost:${info.port}/api/query`);
});
