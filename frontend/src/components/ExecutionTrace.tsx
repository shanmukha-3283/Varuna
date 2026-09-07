import type { TraceEntry } from "../api.ts";

interface ExecutionTraceProps {
  trace: TraceEntry[];
}

const AGENT_GLYPH: Record<string, string> = {
  intentParser: "🧠",
  marineDataAgent: "🌊",
  weatherRiskAgent: "⛅",
  geofenceAgent: "🛟",
  routeAgent: "🧭",
  synthesisAgent: "✍️",
};

// Timeline of per-query agent collaboration.
// Must stay visibly shown in the demo — it's a problem-statement requirement.
export default function ExecutionTrace({ trace }: ExecutionTraceProps) {
  if (trace.length === 0) {
    return (
      <section className="trace-panel" aria-label="Execution trace">
        <p className="trace-empty">
          Agent execution trace will appear here after your first query.
        </p>
      </section>
    );
  }
  return (
    <section className="trace-panel" aria-label="Execution trace">
      <details open>
        <summary>Agent execution trace ({trace.length} steps)</summary>
        <ol className="trace-timeline">
          {trace.map((t, i) => (
            <li key={i} className="anim-rise" style={{ animationDelay: `${Math.min(i * 60, 360)}ms` }}>
              <span className="trace-dot" aria-hidden="true">
                {AGENT_GLYPH[t.agent] ?? "⚙️"}
              </span>
              <div className="trace-body">
                <code>{t.agent}</code>
                <span className="trace-action">{t.action}</span>
                <span className="trace-time">
                  {new Date(t.timestamp).toLocaleTimeString()}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
