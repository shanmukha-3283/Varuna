import { useRef, useState, useEffect } from "react";
import ChatPanel, { type ChatMessage } from "./components/ChatPanel.tsx";
import MapView from "./components/MapView.tsx";
import ExecutionTrace from "./components/ExecutionTrace.tsx";
import SafetyPanels from "./components/SafetyPanels.tsx";
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
  const [preferredLanguage, setPreferredLanguage] = useState("English");
  const [currentRegion, setCurrentRegion] = useState(DEFAULT_REGION);
  const [userLocation, setUserLocation] = useState<typeof DEFAULT_REGION | null>(null);
  const [alertBanner, setAlertBanner] = useState<string | null>(null);
  const [backendUp, setBackendUp] = useState<boolean | null>(null);
  const seenAlerts = useRef<Set<string>>(new Set());
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/health`).then((r) => {
      if (!cancelled) setBackendUp(r.ok);
    }).catch(() => {
      if (!cancelled) setBackendUp(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Proactive Alerts Polling (severity-aware toast + dedup by alert id)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const region = latest?.region ?? currentRegion;
        const res = await fetch(`${API_BASE}/api/check_alerts?lat=${region.lat}&lon=${region.lon}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.alerts && data.alerts.length > 0) {
          const fresh = (data.alerts as string[]).filter((a) => !seenAlerts.current.has(a));
          if (fresh.length === 0) return;
          fresh.forEach((a) => seenAlerts.current.add(a));
          // Cap memory: keep last 50 ids.
          if (seenAlerts.current.size > 50) {
            seenAlerts.current = new Set([...seenAlerts.current].slice(-50));
          }
          const alertText = "🚨 PROACTIVE ALERT: " + fresh.join(" ");
          const severe = /danger|unsafe|cyclone|IMBL/i.test(alertText);
          setAlertBanner(alertText);
          if (severe) {
            try {
              const ctx = new AudioContext();
              const osc = ctx.createOscillator();
              osc.connect(ctx.destination);
              osc.start();
              osc.stop(ctx.currentTime + 0.3);
              void ctx.close();
            } catch { /* audio not available — banner is enough */ }
          }
          setMessages((prev) => [...prev, { role: "assistant", text: alertText, intents: ["alert_check"] }]);
        }
      } catch (err) {
        console.error("Alert polling failed", err);
      }
    }, 30000); // Poll every 30 seconds
    return () => clearInterval(interval);
  }, [latest?.region, currentRegion]);

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
        
      const result = await queryBackend(q, chatHistory, preferredLanguage, currentRegion, controller.signal);
      if (controller.signal.aborted) return; // superseded by a newer query
      setLatest(result);
      // Auto-sync: the visible pin follows the resolved spot so follow-up
      // queries without a place-name stay in Kakinada (not sticky Vizag).
      if (result.region) setCurrentRegion(result.region);
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
        <div className="brand">
          <div className="brand-mark">◈</div>
          <div>
            <h1>Varuna <span className="brand-sub">ORCA</span></h1>
            <p>Marine EcOsystem Reasoning with Collaborative Agents · INCOIS + IMD + Open-Meteo</p>
          </div>
        </div>
        <div className="header-meta">
          <span className={`status-pill ${backendUp === false ? "down" : backendUp ? "up" : "unknown"}`}>
            {backendUp === false ? "● backend offline" : backendUp ? "● backend live" : "● checking…"}
          </span>
          <span className="pill">📍 {(latest?.region ?? currentRegion).name}</span>
          <span className="pill">🌐 {preferredLanguage}</span>
        </div>
      </header>

      {alertBanner && (
        <div className="alert-banner" role="alert">
          <span>{alertBanner}</span>
          <button type="button" onClick={() => setAlertBanner(null)} aria-label="Dismiss alert">
            ✕
          </button>
        </div>
      )}

      <main className="app-main">
        <ChatPanel 
          messages={messages} 
          loading={loading} 
          loadingSince={loadingSince} 
          onSend={handleSend} 
          preferredLanguage={preferredLanguage}
          onLanguageChange={setPreferredLanguage}
        />
        <div className="side">
          <MapView
            region={latest?.region ?? currentRegion}
            markers={latest?.finalResponse?.mapMarkers ?? []}
            userLocation={userLocation}
            onRegionChange={setCurrentRegion}
            onUserLocation={setUserLocation}
          />
          <SafetyPanels latest={latest} />
          <ExecutionTrace trace={latest?.executionTrace ?? []} />
        </div>
      </main>

      <footer className="app-footer">
        <span>Evidence-grounded · INCOIS PFZ + IMD bulletins + live sea-state · 6-agent LangGraph trace</span>
        <span className="roadmap">Boundary polygons approximate — verify against official charts before operational use</span>
      </footer>
    </div>
  );
}

export default App;
