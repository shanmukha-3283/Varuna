# Laptop A — Orchestrator (paste this into OpenCode / AGENTS.md)

ROLE: Build the Orchestrator for "Varuna" (SIH26176 - ORCA).
Repo folder: backend/src/orchestrator/ and backend/src/server.ts only.

STACK: TypeScript, Hono, @langchain/langgraph, Ollama (local, http://localhost:11434).

## Tasks

1. Use backend/src/types.ts exactly as defined (do not modify without team agreement).
2. intentParser.ts: send userQuery to local Ollama, extract strict JSON
   `{ region: {name, lat, lon}, intents: string[] }`. Hardcode a lookup table
   for our one demo region as a fallback if the LLM output is unreliable.
3. graph.ts: build a LangGraph StateGraph over QueryState with nodes:
   `parseIntent -> callMarineAgent -> callWeatherAgent -> synthesizeResponse -> END`
   IMPORTANT: callMarineAgent and callWeatherAgent are plain function
   imports from `../agents/marineData` and `../agents/weatherRisk` (NOT http
   calls). synthesizeResponse imports from `../synthesis/synthesizeResponse`.
4. Every node appends to `state.executionTrace`: `{ agent, action, timestamp }`.
5. server.ts: Hono app, `POST /api/query { userQuery }` -> runs the graph,
   returns final QueryState. Add CORS for the frontend's dev server.
6. Until Laptop B/C's real functions exist, stub them in-file with fake
   return values matching the types, so you can test the graph end-to-end
   immediately. Swap to real imports once B/C push their code.

## Acceptance Criteria

- `POST /api/query` returns full QueryState with all fields populated and a
  4-entry executionTrace, using stubs first, real functions after first merge.

## Checkpoints

- Hour 6: graph runs end-to-end with stubs, merged to `main`.
- Hour 14: swap stubs for real imports from B and C's merged code.
- Hour 22: full pipeline tested with frontend.
- Hour 29: feature freeze — bug fixes only.
