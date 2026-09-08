import { StateGraph, Annotation, END } from "@langchain/langgraph";
import type { QueryState } from "../types.ts";
import { parseIntent, extractExplicitRegion } from "./intentParser.ts";
import { getMarineData } from "../agents/marineData.ts";
import { getWeatherRisk } from "../agents/weatherRisk.ts";
import { checkGeofence } from "../agents/geofenceAgent.ts";
import { optimizeRoute } from "../agents/routeAgent.ts";
import { synthesizeResponse, synthesizeResponseStream } from "../synthesis/synthesizeResponse.ts";
import { detectLanguage, translateToEnglish } from "../services/translation.ts";
import { buildConversationContext } from "../services/conversation.ts";

const GraphState = Annotation.Root({
  chatHistory: Annotation<QueryState["chatHistory"]>,
  userQuery: Annotation<string>,
  originalQuery: Annotation<string | undefined>,
  region: Annotation<QueryState["region"]>,
  timestamp: Annotation<string>,
  intents: Annotation<string[]>,
  language: Annotation<string>, // reply language = UI selector, never overwritten by detection
  detectedLanguage: Annotation<string | undefined>, // internal: what the user typed
  regionSource: Annotation<string | undefined>, // keyword|geocoder|llm|fallback
  marineData: Annotation<QueryState["marineData"] | undefined>,
  weatherRisk: Annotation<QueryState["weatherRisk"] | undefined>,
  geofenceAlerts: Annotation<QueryState["geofenceAlerts"] | undefined>,
  routeOptimization: Annotation<QueryState["routeOptimization"] | undefined>,
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
  
  const inputLanguage = await detectLanguage(state.userQuery);
  let translatedQuery = state.userQuery;
  let originalQuery = undefined;

  // Detection only decides whether the QUERY needs English translation
  // for the agents. The REPLY language stays as the UI selector
  // (state.language, seeded from preferredLanguage).
  if (inputLanguage !== "English") {
    originalQuery = state.userQuery;
    translatedQuery = await translateToEnglish(state.userQuery, inputLanguage);
    console.log(`[graph] Translated query to English: ${translatedQuery}`);
  }

  const { region, intents, source } = await parseIntent(translatedQuery, state.chatHistory || [], state.region);
  let finalRegion = region;
  let finalSource = source;
  // Backup: scan the ORIGINAL text for native-script place names
  // (e.g. విశాఖపట్నం) that translation may have dropped or mangled.
  if ((source === "fallback" || source === "llm") && originalQuery) {
    const nativeHit = extractExplicitRegion(originalQuery);
    if (nativeHit && nativeHit.name !== region.name) {
      console.log(`[graph] native-script region "${nativeHit.name}" from original text`);
      finalRegion = nativeHit;
      finalSource = "keyword";
    }
  }
  const action = finalSource === "llm" ? "parse_intent" : finalSource === "keyword" ? "parse_intent_keyword" : finalSource === "geocoder" ? "parse_intent_geocoder" : "parse_intent_fallback";
  return {
    userQuery: translatedQuery,
    originalQuery,
    detectedLanguage: inputLanguage,
    region: finalRegion,
    regionSource: finalSource,
    intents,
    executionTrace: trace(state, "intentParser", action),
  };
}

const MARINE_INTENTS = new Set(["pfz_lookup", "chlorophyll_sst", "route_advice"]);

function needsMarine(intents: string[]): boolean {
  return intents.some((i) => MARINE_INTENTS.has(i));
}

function isConversational(intents: string[]): boolean {
  return intents.length === 1 && intents[0] === "greeting";
}

async function callMarineAgentNode(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  if (isConversational(state.intents)) {
    console.log("[graph] skipMarineAgent (greeting — conversational)");
    return {
      executionTrace: trace(state, "marineDataAgent", "skip_marine_data (greeting)"),
    };
  }
  if (!needsMarine(state.intents)) {
    console.log(`[graph] skipMarineAgent (intents: ${state.intents.join(",")})`);
    return {
      executionTrace: trace(
        state,
        "marineDataAgent",
        `skip_marine_data (intent: ${state.intents.join(",")})`,
      ),
    };
  }
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
  if (isConversational(state.intents)) {
    console.log("[graph] skipWeatherAgent (greeting — conversational)");
    return {
      executionTrace: trace(state, "weatherRiskAgent", "skip_weather_risk (greeting)"),
    };
  }
  console.log("[graph] callWeatherAgent");
  const weatherRisk = await getWeatherRisk(state.region);
  return {
    weatherRisk,
    executionTrace: trace(state, "weatherRiskAgent", "fetch_weather_risk"),
  };
}

async function callGeofenceAgentNode(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  if (isConversational(state.intents)) {
    console.log("[graph] skipGeofenceAgent (greeting — conversational)");
    return {
      executionTrace: trace(state, "geofenceAgent", "skip_boundaries (greeting)"),
    };
  }
  console.log("[graph] callGeofenceAgent");
  const geofenceAlerts = await checkGeofence(state.region);
  return {
    geofenceAlerts,
    executionTrace: trace(state, "geofenceAgent", "check_boundaries"),
  };
}

async function callRouteAgentNode(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  if (!state.intents.includes("route_advice") && !state.intents.includes("pfz_lookup")) {
    console.log("[graph] skipRouteAgent (intent not present)");
    return {
      executionTrace: trace(state, "routeAgent", "skip_route_optimization"),
    };
  }
  
  console.log("[graph] callRouteAgent");
  const routeOptimization = await optimizeRoute(state.region, state.marineData, state.weatherRisk);
  return {
    routeOptimization,
    executionTrace: trace(state, "routeAgent", "calculate_route"),
  };
}

async function synthesizeResponseNode(
  state: GraphStateType,
): Promise<Partial<GraphStateType>> {
  console.log("[graph] synthesizeResponse");
  const finalResponse = await synthesizeResponse({
    region: state.region,
    intents: state.intents,
    language: state.language,
    marineData: state.marineData,
    weatherRisk: state.weatherRisk,
    geofenceAlerts: state.geofenceAlerts,
    routeOptimization: state.routeOptimization,
    regionSource: state.regionSource,
    userQuery: state.userQuery,
    conversationContext: buildConversationContext(state.chatHistory ?? []),
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
  .addNode("callGeofenceAgent", callGeofenceAgentNode)
  .addNode("callRouteAgent", callRouteAgentNode)
  .addNode("synthesizeResponse", synthesizeResponseNode)
  .addEdge("__start__", "parseIntent")
  .addEdge("parseIntent", "callMarineAgent")
  .addEdge("callMarineAgent", "callWeatherAgent")
  .addEdge("callWeatherAgent", "callGeofenceAgent")
  .addEdge("callGeofenceAgent", "callRouteAgent")
  .addEdge("callRouteAgent", "synthesizeResponse")
  .addEdge("synthesizeResponse", END);

export const graph = workflow.compile();

export async function runQuery(userQuery: string, chatHistory: { role: string; text: string }[] = [], preferredLanguage: string = "English", currentRegion?: QueryState["region"]): Promise<QueryState> {
  const result = await graph.invoke({
    chatHistory,
    userQuery,
    originalQuery: undefined,
    region: currentRegion || { name: "Visakhapatnam", lat: 17.6868, lon: 83.2185 },
    timestamp: new Date().toISOString(),
    intents: [],
    language: preferredLanguage,
    executionTrace: [],
  });
  return result as QueryState;
}

export interface QueryStreamMeta {
  intents: string[];
  region: QueryState["region"];
  regionSource?: string;
  language: string;
  detectedLanguage?: string;
}

export interface QueryStreamEvents {
  onMeta?: (meta: QueryStreamMeta) => void | Promise<void>;
  onAgent?: (entry: QueryState["executionTrace"][number]) => void | Promise<void>;
  onDelta?: (token: string) => void | Promise<void>;
  signal?: AbortSignal;
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("cancelled");
}

/** Streaming twin of runQuery: runs the same nodes in the same order, but
 * emits meta + per-node agent progress live and streams the synthesis tokens.
 * Returns the full end state (identical shape to runQuery). */
export async function runQueryStream(
  userQuery: string,
  chatHistory: { role: string; text: string }[] = [],
  preferredLanguage: string = "English",
  currentRegion?: QueryState["region"],
  events: QueryStreamEvents = {},
): Promise<QueryState> {
  throwIfCancelled(events.signal);
  let state: GraphStateType = {
    chatHistory,
    userQuery,
    originalQuery: undefined,
    region: currentRegion || { name: "Visakhapatnam", lat: 17.6868, lon: 83.2185 },
    timestamp: new Date().toISOString(),
    intents: [],
    language: preferredLanguage,
    detectedLanguage: undefined,
    regionSource: undefined,
    marineData: undefined,
    weatherRisk: undefined,
    geofenceAlerts: undefined,
    routeOptimization: undefined,
    executionTrace: [],
    finalResponse: undefined,
  };
  const emitAgent = async (partial: Partial<GraphStateType>) => {
    const last = partial.executionTrace?.[partial.executionTrace.length - 1];
    if (last && events.onAgent) await events.onAgent(last);
  };

  let partial = await parseIntentNode(state);
  state = { ...state, ...partial };
  await emitAgent(partial);
  if (events.onMeta) {
    await events.onMeta({
      intents: state.intents,
      region: state.region,
      regionSource: state.regionSource,
      language: state.language,
      detectedLanguage: state.detectedLanguage,
    });
  }

  const steps = [callMarineAgentNode, callWeatherAgentNode, callGeofenceAgentNode, callRouteAgentNode];
  for (const step of steps) {
    throwIfCancelled(events.signal);
    partial = await step(state);
    state = { ...state, ...partial };
    await emitAgent(partial);
  }

  throwIfCancelled(events.signal);
  const finalResponse = await synthesizeResponseStream(
    {
      region: state.region,
      intents: state.intents,
      language: state.language,
      marineData: state.marineData,
      weatherRisk: state.weatherRisk,
      geofenceAlerts: state.geofenceAlerts,
      routeOptimization: state.routeOptimization,
      regionSource: state.regionSource,
      userQuery: state.userQuery,
      conversationContext: buildConversationContext(state.chatHistory ?? []),
    },
    async (token) => { if (events.onDelta) await events.onDelta(token); },
    { signal: events.signal },
  );
  state = {
    ...state,
    finalResponse,
    executionTrace: trace(state, "synthesisAgent", "synthesize_response"),
  };
  await emitAgent({ executionTrace: state.executionTrace });
  return state as QueryState;
}
