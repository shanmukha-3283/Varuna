// backend/src/synthesis/integration-check.ts — Laptop C.
// Hour-14 readiness proof WITHOUT touching A's files:
// runs A's real graph (stubs for B legs) to get a real QueryState,
// then feeds it into MY real synthesizeResponse and validates the
// combined output matches types.ts. Run: npx tsx src/synthesis/integration-check.ts
import { runQuery } from "../orchestrator/graph.ts";
import { synthesizeResponse } from "./synthesizeResponse.ts";
import type { QueryState } from "../types.ts";

const QUERIES = [
  "Where is the nearest Potential Fishing Zone today?",
  "Is it safe to venture into the sea tomorrow morning?",
  "Are there any cyclone alerts near Visakhapatnam?",
];

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`ASSERT FAILED: ${msg}`);
    process.exit(1);
  }
}

for (const q of QUERIES) {
  console.log(`\n=== query: "${q}" ===`);
  const state = await runQuery(q);

  assert(state.region.name.length > 0, "region populated by graph");
  assert(state.executionTrace.length === 4, "graph produced 4-entry trace");
  assert(state.marineData && state.weatherRisk, "B-leg stubs populated");

  const mine = await synthesizeResponse({
    language: "English",
    region: state.region,
    intents: state.intents,
    marineData: state.marineData,
    weatherRisk: state.weatherRisk,
  });
  const check: NonNullable<QueryState["finalResponse"]> = mine;
  assert(check.text.length > 20, "real synthesis text non-trivial");
  assert(
    check.mapMarkers.some((m) => m.type === "pfz"),
    "pfz markers present",
  );

  console.log(`region: ${state.region.name} | intents: ${state.intents.join(",")}`);
  console.log(`trace: ${state.executionTrace.map((t) => t.agent).join(" -> ")}`);
  console.log(`text: ${check.text.slice(0, 160)}...`);
  console.log(`markers: ${check.mapMarkers.length}, evidence: ${check.evidence.length}`);
}

console.log("\nintegration-check PASSED: real graph output composes with real synthesis");
