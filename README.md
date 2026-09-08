# Varuna — SIH26176 (ORCA: Marine EcOsystem Reasoning with Collaborative Agents)

Agentic AI conversational platform for marine intelligence. Unifies INCOIS,
IMD and live Open-Meteo sea-state data into one conversational,
evidence-grounded assistant for fishermen, coastal authorities, and researchers.

## Features

- **Multi-agent LangGraph orchestration** — 6 specialized agents (marine data, weather, geofencing, routing, translation, synthesis) coordinated via a state graph
- **Real-time streaming** — SSE token-by-token responses with live agent step indicators and a stop button
- **Live weather data** — Open-Meteo API for current conditions and multi-day forecasts (wave height, wind, weather code) with IMD cache fallback
- **Pan-India coverage** — keyword-based region detection + Nominatim geocoder fallback; covers Visakhapatnam, Kakinada, Chennai, Kochi, Palk Bay and any coastal location
- **Real INCOIS PFZ data** — cached advisory sectors with haversine nearest-sector matching; honest labeling for simulated sectors
- **Multilingual support** — automatic language detection, selector-wins reply policy, Ollama translation to Hindi, Telugu, Tamil, Bengali
- **Voice input/output** — Web Speech API for speech recognition and TTS; voice reads only finished replies
- **Interactive map** — react-leaflet with draggable pin, place search, reverse geocoding on click, IMBL maritime boundary visualization, locate-me button
- **Geofencing with real maritime boundary data** — IMBL and MPA polygon checks with info/warning/danger alerts
- **Auto-routing to PFZ** — 5-7 waypoint weather-aware route with perpendicular deviation around hazardous seas and fuel estimate
- **Proactive safety alerts** — background polling for IMD cyclone/storm warnings with dismissible banner
- **Multi-turn conversation** — session memory with buildConversationContext, follow-up intent detection, smalltalk
- **Temporal reasoning** — "tomorrow morning" queries use Open-Meteo forecast endpoint
- **Rich markdown replies** — bold verdicts, bullet lists, section headings, zero-dep renderer
- **Productivity decline analysis** — trend comparison across SST/chlorophyll snapshots per sector
- **Execution trace** — visible per-query agent pipeline with timing
- **PWA installable** — service worker with offline shell caching

## How It Works

```
User Query (any language)
    │
    ▼
┌─────────────────────┐
│  Translation Agent   │  Detect language, translate to English if needed
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Intent Parser       │  Keyword scan → LLM fallback → geocoder → region + intents
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Marine Data Agent   │  Nearest PFZ sector from INCOIS cache (haversine)
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Weather Risk Agent  │  IMD cache + Open-Meteo live; verdict (safe/caution/unsafe)
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Geofence Agent      │  IMBL / MPA boundary proximity checks
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Route Agent         │  Multi-waypoint weather-aware routing + fuel estimate
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Synthesis Agent     │  Grounded conversational reply (verdict-first, ~120-180 words)
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Translation Agent   │  Translate to user's selected language
└─────────┬───────────┘
          ▼
   Streamed Reply
```

## Tech Stack

- **Language/runtime:** TypeScript + Node.js
- **Backend server:** Hono (single unified server)
- **Orchestration:** LangGraph (`@langchain/langgraph`)
- **LLM:** Ollama, local — `qwen3:8b` (env overrides: `OLLAMA_HOST`, `OLLAMA_MODEL`)
- **Data:** local JSON cache files (pre-fetched INCOIS/IMD data) + live Open-Meteo fallback — no DB
- **Geocoding:** Nominatim (backend fallback for unlisted coastal places, frontend map search / reverse-geocode)
- **Frontend:** React + Vite + TypeScript, `react-leaflet` for the map
- **Version control:** Git + GitHub

## Folder Structure

```
varuna/
  backend/
    src/
      types.ts                     <- shared contract, edit together only
      server.ts                    <- Hono entrypoint: POST /api/query, POST /api/query/stream,
                                      GET /api/opening, /api/check_alerts, /api/intents, /health
      orchestrator/
        graph.ts                   <- LangGraph StateGraph (6 nodes, streaming + non-streaming)
        intentParser.ts            <- region + intents (keyword > LLM > geocoder > fallback)
        conversation.ts            <- in-memory session store (30-min TTL, 500 cap)
      agents/
        marineData.ts              <- getMarineData(region): nearest PFZ sector from INCOIS cache
        weatherRisk.ts             <- getWeatherRisk(region): IMD cache + Open-Meteo live + forecast
        geofenceAgent.ts           <- IMBL / MPA boundary checks
        routeAgent.ts              <- 5-7 waypoint weather-aware routing + fuel estimate
        cacheUtils.ts              <- staleness / expiry helpers
        preflight.ts               <- GO/BLOCKED demo readiness check
        refreshCaches.ts           <- ops cache refresh + validation
      services/
        translation.ts             <- Ollama language detect + translation (cleaned, 512 token limit)
        geocode.ts                 <- Nominatim fallback for unknown places
        suggest.ts                 <- adaptive suggestion chips (time + alerts + verdict)
      synthesis/
        synthesizeResponse.ts      <- conversational grounded answer (stream + non-stream)
      data/
        incois_pfz.json            <- Vizag sector (pre-fetched real data)
        incois_pfz_sectors.json    <- pan-India sectors (Vizag/Kakinada/Chennai/Kochi/Palk Bay)
        imd_weather.json           <- CWC Vizag bulletin (pre-fetched real data)
        maritime_boundaries.json   <- IMBL corridors + MPA polygons (approximate)
        productivity_history.json  <- SST/chlorophyll snapshots per sector
    package.json                   <- scripts: dev, start, test, test:all, preflight, typecheck
    tsconfig.json
  frontend/
    src/
      App.tsx                      <- chat + dashboard shell, streaming, dynamic greeting, adaptive chips
      api.ts                       <- POST /api/query + POST /api/query/stream (SSE)
      components/
        ChatPanel.tsx              <- streaming bubbles, empty-state hero, card chips, evidence cards, voice
        MapView.tsx                <- chart, flyTo, place search, draggable pin, locate FAB, IMBL tooltips
        SafetyPanels.tsx           <- safety / productivity / tide / geofence / route + 7-day trends
        ExecutionTrace.tsx         <- per-query agent trace with timing
      lib/
        markdown.tsx               <- zero-dep markdown renderer
    package.json
    vite.config.ts
  README.md
  problem statement.txt
```

## Run Locally

```bash
# backend (http://localhost:3000)
cd backend && npm install && npm start

# frontend (http://localhost:5173)
cd frontend && npm install && npm run dev

# checks
cd backend && npm run typecheck && npm run test:all && npm run preflight
```

Warm the model before demos (cold Ollama adds 60–90s per query):
`curl http://localhost:11434/api/generate -d '{"model":"qwen3:8b","prompt":"hi","stream":false}'`

## File Ownership

| Laptop | Owns |
|---|---|
| A | `backend/src/orchestrator/`, `backend/src/server.ts` |
| B | `backend/src/agents/`, `backend/src/data/` |
| C | `backend/src/synthesis/`, all of `frontend/` |
| Shared | `backend/src/types.ts` — nobody edits alone; agree first, push immediately |

## What's Not Shipped (Honest Scope)

- Exact per-pixel satellite scenes (INCOIS WebGIS)
- Official-chart-grade boundaries (current polygons are approximate)
- True optimal weather routing (bathymetry/traffic-aware)
- Real-time INCOIS API integration (uses pre-fetched cache + Open-Meteo)
