import { useRef, useState, useEffect } from "react";
import ChatPanel, { type ChatMessage } from "./components/ChatPanel.tsx";
import MapView from "./components/MapView.tsx";
import ExecutionTrace from "./components/ExecutionTrace.tsx";
import SafetyPanels from "./components/SafetyPanels.tsx";
import { queryStream, type QueryState, type TraceEntry, API_BASE } from "./api.ts";
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
  const [dashTab, setDashTab] = useState<"map" | "safety" | "trace">("map");
  const [regionPulse, setRegionPulse] = useState(0);
  const [liveTrace, setLiveTrace] = useState<TraceEntry[]>([]);
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

  async function handleSend(userQuery: string, opts?: { echo?: boolean }) {
    const q = userQuery.trim();
    if (!q) return;
    // Cancel any in-flight query so a stale response can't overwrite fresh state.
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const echo = opts?.echo ?? true;
    if (echo) setMessages((m) => [...m, { role: "user", text: q, ts: Date.now() }]);
    // Streaming placeholder the deltas append to.
    setMessages((m) => [...m, { role: "assistant", text: "", streaming: true, ts: Date.now() }]);
    setLiveTrace([]);
    setLoading(true);
    setLoadingSince(Date.now());
    const finalizeLast = (patch: Partial<ChatMessage>) =>
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = { ...next[next.length - 1], ...patch, streaming: false } as ChatMessage;
        return next;
      });
    try {
      // Map messages to simple {role, text} array, excluding errors and the live placeholder
      const chatHistory = messages
        .filter((m) => m.role !== "error" && !m.streaming)
        .map((m) => ({ role: m.role, text: m.text }));

      const result = await queryStream(q, chatHistory, preferredLanguage, currentRegion, {
        onMeta: (meta) => {
          if (controller.signal.aborted) return;
          if (meta.region) {
            setCurrentRegion((prev) => {
              if (prev.name !== meta.region.name) setRegionPulse((n) => n + 1);
              return meta.region;
            });
          }
        },
        onAgent: (entry) => {
          if (controller.signal.aborted) return;
          setLiveTrace((prev) => [...prev, entry]);
        },
        onDelta: (token) => {
          if (controller.signal.aborted || !token) return;
          setMessages((m) => {
            const next = [...m];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, text: last.text + token };
            return next;
          });
        },
      }, controller.signal);
      if (controller.signal.aborted) return; // superseded by a newer query
      setLatest(result);
      // Auto-sync: the visible pin follows the resolved spot so follow-up
      // queries without a place-name stay in Kakinada (not sticky Vizag).
      if (result.region) {
        setCurrentRegion((prev) => {
          if (prev.name !== result.region.name) setRegionPulse((n) => n + 1);
          return result.region;
        });
      }
      const viaTag = result.finalResponse?.evidence?.find((e) => e.startsWith("synthesis:")) ?? undefined;
      finalizeLast({
        text: result.finalResponse?.text ?? "I got a response but it had no text.",
        evidence: result.finalResponse?.evidence,
        intents: result.intents,
        language: result.language,
        synthesisVia: viaTag,
      });
    } catch (err) {
      if (err instanceof Error && err.message === "cancelled") {
        finalizeLast({}); // stopped or superseded — keep the partial text
        return;
      }
      // Turn the placeholder into an error bubble (or keep partial text).
      setMessages((m) => {
        const next = [...m];
        const last = next[next.length - 1];
        next[next.length - 1] = last.text
          ? { ...last, streaming: false }
          : {
              role: "error",
              text: `Could not reach the backend (${err instanceof Error ? err.message : "unknown error"}). Is the server running on http://localhost:3000?`,
              ts: Date.now(),
            };
        return next;
      });
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        setLoading(false);
        setLoadingSince(null);
      }
    }
  }

  function handleStop() {
    inFlight.current?.abort();
  }

  function handleRegenerate() {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        void handleSend(messages[i].text, { echo: false });
        return;
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
          <span className="pill region-pill" key={regionPulse}>📍 {(latest?.region ?? currentRegion).name}</span>
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
          onStop={handleStop}
          onRegenerate={handleRegenerate}
          preferredLanguage={preferredLanguage}
          onLanguageChange={setPreferredLanguage}
        />
        <div className="side">
          <div className="dash-tabs" role="tablist" aria-label="Dashboard views">
            {(["map", "safety", "trace"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={dashTab === t}
                className={`dash-tab ${dashTab === t ? "active" : ""}`}
                onClick={() => setDashTab(t)}
              >
                {t === "map" ? "🗺 Map" : t === "safety" ? "🛟 Safety" : "⚙ Trace"}
              </button>
            ))}
          </div>
          <div className="dash-panel anim-fade" key={dashTab}>
            {dashTab === "map" && (
              <MapView
                region={latest?.region ?? currentRegion}
                markers={latest?.finalResponse?.mapMarkers ?? []}
                userLocation={userLocation}
                onRegionChange={setCurrentRegion}
                onUserLocation={setUserLocation}
              />
            )}
            {dashTab === "safety" && <SafetyPanels latest={latest} />}
            {dashTab === "trace" && <ExecutionTrace trace={loading ? liveTrace : (latest?.executionTrace ?? [])} />}
          </div>
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
