# Varuna — SIH26176 (ORCA: Marine EcOsystem Reasoning with Collaborative Agents)

Agentic AI conversational platform for marine intelligence. Unifies INCOIS,
IMD and live Open-Meteo sea-state data into one conversational,
evidence-grounded assistant for fishermen, coastal authorities, and researchers.

## Tech Stack (fixed — do not substitute)

- **Language/runtime:** TypeScript + Node.js
- **Backend server:** Hono (single unified server)
- **Orchestration:** LangGraph (`@langchain/langgraph`)
- **LLM:** Ollama, local — `qwen2.5:7b`
  (env overrides: `OLLAMA_HOST`, `OLLAMA_MODEL`)
- **Data:** local JSON cache files (pre-fetched INCOIS/IMD data) + live
  Open-Meteo fallback — no DB
- **Geocoding:** Nominatim (backend fallback for unlisted coastal places,
  frontend map search / reverse-geocode)
- **Frontend:** React + Vite + TypeScript, `react-leaflet` for the map
- **Version control:** Git + GitHub — one shared repo, branch-per-laptop

## Folder Structure

```
varuna/
  backend/
    src/
      types.ts                     <- shared contract, edit together only
      server.ts                    <- Hono entrypoint: POST /api/query,
                                      GET /api/check_alerts, /api/intents, /health
      orchestrator/
        graph.ts                   <- LangGraph StateGraph (6 nodes)
        intentParser.ts            <- region + intents (keyword > LLM > geocoder > fallback)
      agents/
        marineData.ts              <- getMarineData(region): nearest PFZ sector
        weatherRisk.ts             <- getWeatherRisk(region): IMD cache + Open-Meteo live
        geofenceAgent.ts           <- IMBL / MPA boundary checks
        routeAgent.ts              <- hazard-aware safe-route heuristic
        cacheUtils.ts              <- staleness / expiry helpers
        preflight.ts               <- GO/BLOCKED demo readiness check
        refreshCaches.ts           <- ops cache refresh + validation
      services/
        translation.ts             <- Ollama language detect + translation
        geocode.ts                 <- Nominatim fallback for unknown places
      synthesis/
        synthesizeResponse.ts      <- grounded answer + markers + evidence
      data/
        incois_pfz.json            <- Vizag sector (pre-fetched real data)
        incois_pfz_sectors.json    <- pan-India sectors (Vizag/Kakinada/Chennai/Kochi)
        imd_weather.json           <- CWC Vizag bulletin (pre-fetched real data)
        maritime_boundaries.json   <- IMBL corridors + MPA polygons (approximate)
        productivity_history.json  <- SST/chlorophyll snapshots per sector
    package.json                   <- scripts: dev, start, test, test:all, preflight, typecheck
    tsconfig.json
  frontend/
    src/
      App.tsx                      <- chat + dashboard shell, alert polling, pin auto-sync
      api.ts                       <- live POST /api/query wrapper
      components/
        ChatPanel.tsx              <- bubbles, evidence, voice (STT/TTS), language selector
        MapView.tsx                <- chart, locate-me, place search, draggable pin
        SafetyPanels.tsx           <- safety / productivity / tide / geofence / route + 7-day trends
        ExecutionTrace.tsx         <- per-query agent trace (demo requirement)
    package.json
    vite.config.ts
  README.md
  problem statement.txt
```

## File Ownership

| Laptop | Owns |
|---|---|
| A | `backend/src/orchestrator/`, `backend/src/server.ts` |
| B | `backend/src/agents/`, `backend/src/data/` |
| C | `backend/src/synthesis/`, all of `frontend/` |
| Shared | `backend/src/types.ts` — nobody edits alone; agree first, push immediately |

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
`curl http://localhost:11434/api/generate -d '{"model":"qwen2.5:7b","prompt":"hi","stream":false}'`

## Git Workflow

```bash
git clone <repo-url>
git checkout -b feature/orchestrator        # Laptop A
git checkout -b feature/agents              # Laptop B
git checkout -b feature/frontend-synthesis  # Laptop C

# repeatedly, every 30-60 min
git add .
git commit -m "short description of change"
git push origin <your-branch>

# at each checkpoint
git checkout main
git pull origin main
git merge <your-branch>
git push origin main
git checkout <your-branch>
git merge main   # pull in what others merged
```

## Integration Checkpoints

| Hour | Milestone |
|---|---|
| 0–1 | Repo set up, branches created, `types.ts` agreed and pushed |
| 6 | Each laptop's own piece works standalone (stubs/mocks OK); first merge to `main` |
| 14 | Laptop A wires real function calls to B/C's modules (no more stubs) |
| 22 | Full pipeline tested end-to-end on one machine |
| 29 | **Feature freeze** — bug fixes and demo rehearsal only |
| 34 | Record backup demo video |

## Demo Scope (shipped)

**In scope:** pan-India coastal queries (keyword table + live geocoder),
6-agent orchestration, multilingual replies (Hindi/Telugu/Tamil/Bengali + voice),
map + 7-day trends + evidence-backed answers, visible execution trace per query,
proactive weather/geofence alerts, geofencing near IMBL/MPAs, safe-route heuristic.

**Roadmap only:** exact per-pixel satellite scenes (INCOIS WebGIS),
official-chart-grade boundaries (current polygons are approximate),
true optimal weather routing (bathymetry/traffic-aware).
