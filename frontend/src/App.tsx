import { useState } from "react";
import ChatPanel, { type ChatMessage } from "./components/ChatPanel.tsx";
import MapView from "./components/MapView.tsx";
import ExecutionTrace from "./components/ExecutionTrace.tsx";
import { queryBackend, type QueryState } from "./api.ts";
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

  async function handleSend(userQuery: string) {
    const q = userQuery.trim();
    if (!q || loading) return;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setLoading(true);
    try {
      const result = await queryBackend(q);
      setLatest(result);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: result.finalResponse?.text ?? "I got a response but it had no text.",
          evidence: result.finalResponse?.evidence,
        },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          role: "error",
          text: `Could not reach the backend (${err instanceof Error ? err.message : "unknown error"}). Is the server running on http://localhost:3000?`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Varuna</h1>
        <p>ORCA · Marine EcOsystem Reasoning with Collaborative Agents · Visakhapatnam coast</p>
      </header>

      <main className="app-main">
        <ChatPanel messages={messages} loading={loading} onSend={handleSend} />
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
      </footer>
    </div>
  );
}

export default App;
