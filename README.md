# Varuna — SIH26176 (ORCA: Marine EcOsystem Reasoning with Collaborative Agents)

Agentic AI conversational platform for marine intelligence. Unifies INCOIS,
IMD and satellite data into one conversational, evidence-grounded assistant
for fishermen, coastal authorities, and researchers.

## Tech Stack (fixed — do not substitute)

- **Language/runtime:** TypeScript + Node.js
- **Backend server:** Hono (single unified server)
- **Orchestration:** LangGraph (`@langchain/langgraph`)
- **LLM:** Ollama, local — one model agreed across all 3 laptops
  (`llama3.1:8b` or `qwen2.5:7b`, whichever is already cached)
- **Data:** local JSON cache files (pre-fetched INCOIS/IMD data) — no DB
- **Frontend:** React + Vite + TypeScript, `react-leaflet` for the map
- **Version control:** Git + GitHub — one shared repo, branch-per-laptop

## Folder Structure (fixed)

```
varuna/
  backend/
    src/
      types.ts                     <- shared contract, edit together only
      server.ts                    <- Hono entrypoint, POST /api/query
      orchestrator/
        graph.ts                   <- LangGraph StateGraph definition
        intentParser.ts            <- Ollama call: query -> region + intents
      agents/
        marineData.ts              <- getMarineData(region) function
        weatherRisk.ts             <- getWeatherRisk(region) function
      synthesis/
        synthesizeResponse.ts      <- Ollama call: state -> finalResponse
      data/
        incois_pfz.json            <- pre-fetched real data
        imd_weather.json           <- pre-fetched real data
    package.json
    tsconfig.json
  frontend/
    src/
      App.tsx
      api.ts                       <- calls backend's /api/query
      components/
        ChatPanel.tsx
        MapView.tsx
        ExecutionTrace.tsx
    package.json
    vite.config.ts
  README.md
```

## File Ownership

| Laptop | Owns |
|---|---|
| A | `backend/src/orchestrator/`, `backend/src/server.ts` |
| B | `backend/src/agents/`, `backend/src/data/` |
| C | `backend/src/synthesis/`, all of `frontend/` |
| Shared | `backend/src/types.ts` — nobody edits alone; agree first, push immediately |

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

## Demo Scope (in scope vs. explicitly cut)

**In scope:** one coastal region, 4-agent orchestration, English conversation,
map + evidence-backed answers, visible execution trace per query.

**Cut for this build (mention as roadmap only):** multilingual support,
geofencing near maritime boundaries, route optimization, pan-India coverage.
