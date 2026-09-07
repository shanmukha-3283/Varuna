import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { runQuery } from "./orchestrator/graph.ts";
import { parseIntent } from "./orchestrator/intentParser.ts";

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
    const body = await c.req.json<{ userQuery?: string }>();
    if (!body.userQuery || typeof body.userQuery !== "string") {
      return c.json({ error: "Missing or invalid 'userQuery' field" }, 400);
    }

    console.log(`[server] POST /api/query — "${body.userQuery}"`);
    const t0 = Date.now();
    const result = await runQuery(body.userQuery);
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

console.log(`[varuna] Starting backend on port ${PORT}...`);
console.log(`[varuna] Ollama: ${process.env.OLLAMA_HOST || "http://localhost:11434"}`);
console.log(`[varuna] Model: ${process.env.OLLAMA_MODEL || "qwen2.5:7b"}`);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[varuna] Backend running at http://localhost:${info.port}`);
  console.log(`[varuna] Health: http://localhost:${info.port}/health`);
  console.log(`[varuna] Query:  POST http://localhost:${info.port}/api/query`);
});
