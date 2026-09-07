# Laptop C — Response Synthesis + Frontend (paste into OpenCode / AGENTS.md)

ROLE: Build the Response Synthesis function and the full frontend for "Varuna".
Repo folder: backend/src/synthesis/ and all of frontend/.

STACK: TypeScript, Ollama (local) for synthesis, React + Vite + react-leaflet
for frontend.

## Tasks

1. synthesizeResponse.ts: export `async function synthesizeResponse(state)`
   that prompts local Ollama: "Given this marine data and weather risk JSON,
   write a 2-3 sentence conversational safety answer for a fisherman, citing
   the specific numbers." Low temperature. Build mapMarkers from
   `state.marineData.pfzZones` (green) and any hazards (red). Return shape
   matching `QueryState["finalResponse"]` exactly.
2. Frontend — ChatPanel.tsx: text input, POST to backend's
   `http://localhost:3000/api/query` (same machine as demo), render
   `finalResponse.text` as chat bubbles.
3. MapView.tsx: react-leaflet map centered on the demo region, render
   mapMarkers as colored pins per type.
4. ExecutionTrace.tsx: collapsible panel listing executionTrace entries —
   this must be visibly shown in the demo, it's a PS requirement.
5. api.ts: single function wrapping the fetch call to the backend.
6. Until Laptop A's real graph is wired, mock the API response in api.ts
   so you can build UI independently, then swap to the real call.

## Acceptance Criteria

- Frontend runs standalone against a mocked response first, then against
  the real backend after merge. Map shows real demo-region coordinates,
  execution trace panel updates per query.

## Checkpoints

- Hour 6: synthesis function + frontend UI work standalone with mocks, merged to `main`.
- Hour 14: still mocked, watch for A's real graph landing.
- Hour 22: swap to real backend call, full pipeline tested end-to-end.
- Hour 29: feature freeze — bug fixes and demo rehearsal only.
