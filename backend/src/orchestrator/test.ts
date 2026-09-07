import { runQuery } from "./graph.ts";
import type { QueryState } from "../types.ts";

let failures = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}`);
  }
}

async function run(name: string, query: string): Promise<QueryState> {
  console.log(`\n=== ${name} ===`);
  console.log(`query: "${query}"`);
  const state = await runQuery(query);

  assert(typeof state.region?.name === "string", "region.name is string");
  assert(typeof state.region?.lat === "number", "region.lat is number");
  assert(typeof state.region?.lon === "number", "region.lon is number");
  assert(Array.isArray(state.intents) && state.intents.length > 0, "intents non-empty");

  assert(
    Array.isArray(state.executionTrace) && state.executionTrace.length === 4,
    `executionTrace has 4 entries (got ${state.executionTrace?.length})`,
  );
  const agents = state.executionTrace.map((e) => e.agent);
  assert(
    JSON.stringify(agents) ===
      JSON.stringify([
        "intentParser",
        "marineDataAgent",
        "weatherRiskAgent",
        "synthesisAgent",
      ]),
    `executionTrace order correct (${agents.join(" -> ")})`,
  );
  assert(
    state.executionTrace.every(
      (e) => typeof e.agent === "string" && typeof e.action === "string" && typeof e.timestamp === "string",
    ),
    "each trace entry has agent/action/timestamp",
  );

  assert(Array.isArray(state.marineData?.pfzZones), "marineData.pfzZones present");
  assert(typeof state.marineData?.source === "string", "marineData.source present");

  const verdict = state.weatherRisk?.verdict;
  assert(
    verdict === "safe" || verdict === "caution" || verdict === "unsafe",
    `weatherRisk.verdict valid (${verdict})`,
  );
  assert(typeof state.weatherRisk?.reasoning === "string", "weatherRisk.reasoning present");

  assert(typeof state.finalResponse?.text === "string", "finalResponse.text present");
  assert(
    Array.isArray(state.finalResponse?.mapMarkers) && (state.finalResponse?.mapMarkers?.length ?? 0) > 0,
    "finalResponse.mapMarkers non-empty",
  );
  assert(Array.isArray(state.finalResponse?.evidence), "finalResponse.evidence present");

  return state;
}

async function main() {
  await run(
    "Safety query",
    "Is it safe to fish near Vizag tomorrow morning?",
  );
  await run(
    "PFZ query",
    "Where is the nearest fishing zone today near Vizag?",
  );
  await run(
    "Alert query",
    "Are there any cyclone or lightning alerts near Visakhapatnam?",
  );

  console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test run crashed:", err);
  process.exit(1);
});
