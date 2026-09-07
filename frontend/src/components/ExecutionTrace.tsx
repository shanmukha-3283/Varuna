import type { TraceEntry } from "../api.ts";

interface ExecutionTraceProps {
  trace: TraceEntry[];
}

// Collapsible panel listing per-query agent execution trace.
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
        <ol>
          {trace.map((t, i) => (
            <li key={i}>
              <code>{t.agent}</code> → {t.action}
              <span className="trace-time">
                {" "}
                · {new Date(t.timestamp).toLocaleTimeString()}
              </span>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
