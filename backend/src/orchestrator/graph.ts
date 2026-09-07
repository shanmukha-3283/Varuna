import { StateGraph, Annotation, END } from "@langchain/langgraph";
import type { QueryState } from "../types.ts";
import { parseIntent } from "./intentParser.ts";
import {
  getMarineData,
  getWeatherRisk,
  synthesizeResponse,
} from "./stubs.ts";
// TODO Hour14: swap stubs for real imports:
// import { getMarineData } from "../agents/marineData.ts";
// import { getWeatherRisk } from "../agents/weatherRisk.ts";
// import { synthesizeResponse } from "../synthesis/synthesizeResponse.ts";

const GraphState = Annotation.Root({
  userQuery: Annotation<string>,
  region: Annotation<QueryState["region"]>,
  timestamp: Annotation<string>,
  intents: Annotation<string[]>,
  marineData: Annotation<QueryState["marineData"] | undefined>,
  weatherRisk: Annotation<QueryState["weatherRisk"] | undefined>,
  executionTrace: Annotation<QueryState["executionTrace"]>,
  finalResponse: Annotation<QueryState["finalResponse"] | undefined>,
});

type GraphStateType = typeof GraphState.State;

function trace(
  state: GraphStateType,
  agent: string,
  action: string,
): QueryState["executionTrace"] {
  return [
    ...state.executionTrace,
    { agent, action, timestamp: new Date().toISOString() },
  ];
}

async function parseIntentNode(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  console.log("[graph] parseIntent");
  const { region, intents } = await parseIntent(state.userQuery);
  return {
    region,
    intents,
    executionTrace: trace(state, "intentParser", "parse_intent"),
  };
}

async function callMarineAgentNode(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  console.log("[graph] callMarineAgent");
  const marineData = await getMarineData(state.region);
  return {
    marineData,
    executionTrace: trace(state, "marineDataAgent", "fetch_marine_data"),
  };
}

async function callWeatherAgentNode(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  console.log("[graph] callWeatherAgent");
  const weatherRisk = await getWeatherRisk(state.region);
  return {
    weatherRisk,
    executionTrace: trace(state, "weatherRiskAgent", "fetch_weather_risk"),
  };
}

async function synthesizeResponseNode(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  console.log("[graph] synthesizeResponse");
  const finalResponse = await synthesizeResponse({
    region: state.region,
    intents: state.intents,
    marineData: state.marineData,
    weatherRisk: state.weatherRisk,
  });
  return {
    finalResponse,
    executionTrace: trace(
      state,
      "synthesisAgent",
      "synthesize_response",
    ),
  };
}

const workflow = new StateGraph(GraphState)
  .addNode("parseIntent", parseIntentNode)
  .addNode("callMarineAgent", callMarineAgentNode)
  .addNode("callWeatherAgent", callWeatherAgentNode)
  .addNode("synthesizeResponse", synthesizeResponseNode)
  .addEdge("__start__", "parseIntent")
  .addEdge("parseIntent", "callMarineAgent")
  .addEdge("callMarineAgent", "callWeatherAgent")
  .addEdge("callWeatherAgent", "synthesizeResponse")
  .addEdge("synthesizeResponse", END);

export const graph = workflow.compile();

export async function runQuery(userQuery: string): Promise<QueryState> {
  const result = await graph.invoke({
    userQuery,
    region: { name: "", lat: 0, lon: 0 },
    timestamp: new Date().toISOString(),
    intents: [],
    executionTrace: [],
  });
  return result as QueryState;
}
