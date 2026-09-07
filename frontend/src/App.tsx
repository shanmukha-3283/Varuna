import { useRef, useState, useEffect } from "react";
import ChatPanel, { type ChatMessage } from "./components/ChatPanel.tsx";
import MapView from "./components/MapView.tsx";
import ExecutionTrace from "./components/ExecutionTrace.tsx";
import { queryBackend, type QueryState, API_BASE } from "./api.ts";
import "./App.css";

const DEFAULT_REGION = { name: "Visakhapatnam", lat: 17.6868, lon: 83.2185 };

const GREETING: ChatMessage = {
  role: "assistant",
  text: "Namaste! I am Varuna, your marine intelligence assistant for the Visakhapatnam coast. Ask me about fishing zones, sea safety, or weather alerts.",
};

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [latest, setLatest] = useState<QueryState | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSince, setLoadingSince] = useState<number | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  // Proactive Alerts Polling
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const region = latest?.region ?? DEFAULT_REGION;
        const res = await fetch(`${API_BASE}/api/check_alerts?lat=${region.lat}&lon=${region.lon}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.alerts && data.alerts.length > 0) {
          const alertText = "🚨 PROACTIVE ALERT: " + data.alerts.join(" ");
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            // Prevent spamming the same alert
            if (last && last.text === alertText) return prev;
            return [...prev, { role: "assistant", text: alertText, intents: ["alert_check"] }];
          });
        }
      } catch (err) {
        console.error("Alert polling failed", err);
      }
    }, 30000); // Poll every 30 seconds
    return () => clearInterval(interval);
  }, [latest?.region]);

  async function handleSend(userQuery: string) {
    const q = userQuery.trim();
    if (!q) return;
    // Cancel any in-flight query so a stale response can't overwrite fresh state.
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setLoading(true);
    setLoadingSince(Date.now());
    try {
      // Map messages to simple {role, text} array, excluding errors
      const chatHistory = messages
        .filter(m => m.role !== "error")
        .map(m => ({ role: m.role, text: m.text }));
        
      const result = await queryBackend(q, chatHistory, controller.signal);
      if (controller.signal.aborted) return; // superseded by a newer query
      setLatest(result);
      const viaTag = result.finalResponse?.evidence?.find((e) => e.startsWith("synthesis:")) ?? undefined;
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: result.finalResponse?.text ?? "I got a response but it had no text.",
          evidence: result.finalResponse?.evidence,
          intents: result.intents,
          language: result.language,
          synthesisVia: viaTag,
        },
      ]);
    } catch (err) {
      if (err instanceof Error && err.message === "cancelled") return; // user re-sent; stay silent
      setMessages((m) => [
        ...m,
        {
          role: "error",
          text: `Could not reach the backend (${err instanceof Error ? err.message : "unknown error"}). Is the server running on http://localhost:3000?`,
        },
      ]);
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setLoading(false);
        setLoadingSince(null);
      }
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Varuna</h1>
        <p>ORCA · Marine EcOsystem Reasoning with Collaborative Agents · Visakhapatnam coast</p>
      </header>

      <main className="app-main">
        <ChatPanel messages={messages} loading={loading} loadingSince={loadingSince} onSend={handleSend} />
        <div className="side">
          <MapView
            region={latest?.region ?? DEFAULT_REGION}
            markers={latest?.finalResponse?.mapMarkers ?? []}
          />
          <ExecutionTrace trace={latest?.executionTrace ?? []} />
        </div>
      </main>

      <footer className="app-footer">
        Evidence-grounded answers · INCOIS + IMD data · multi-agent orchestration
        <span className="roadmap">
          {" "}· Roadmap: multilingual replies · multi-turn context · geofencing · route optimization
        </span>
      </footer>
    </div>
  );
}

export default App;
