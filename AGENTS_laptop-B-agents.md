# Laptop B — Marine Data Agent + Weather & Risk Agent (paste into OpenCode / AGENTS.md)

ROLE: Build the Marine Data Agent and Weather & Risk Agent for "Varuna".
Repo folder: backend/src/agents/ and backend/src/data/ only.

STACK: TypeScript, plain functions (no HTTP server needed on this laptop).

## Tasks

1. Before writing logic, source and save real data as JSON:
   - `backend/src/data/incois_pfz.json` — PFZ advisories for our one demo region
   - `backend/src/data/imd_weather.json` — weather/wave-height/alerts for same region
2. marineData.ts: export `async function getMarineData(region)` that reads
   incois_pfz.json, finds nearest zones, returns shape matching
   `QueryState["marineData"]` from types.ts exactly.
3. weatherRisk.ts: export `async function getWeatherRisk(region)` that reads
   imd_weather.json, computes verdict:
   - `"unsafe"` if any alert active OR waveHeight > 2.5m
   - `"caution"` if waveHeight 1.5–2.5m
   - else `"safe"`
   Include a one-sentence `reasoning` string. Return shape matching
   `QueryState["weatherRisk"]` exactly.
4. Write a small standalone test script (`backend/src/agents/test.ts`) that
   calls both functions directly and logs output — verify against
   types.ts shape before pushing.

## Acceptance Criteria

- Both functions run standalone with `npx tsx test.ts`, return real (not
  fake) data for the demo region, and match types.ts exactly — Laptop A
  imports these directly, so shape mismatches break the whole graph.

## Checkpoints

- Hour 6: both functions work standalone, merged to `main`.
- Hour 14: Laptop A imports these directly — confirm no shape mismatches.
- Hour 22: full pipeline tested with frontend.
- Hour 29: feature freeze — bug fixes only.
