import { useEffect, useRef, useState } from "react";

export interface ChatMessage {
  role: "user" | "assistant" | "error";
  text: string;
  evidence?: string[];
  intents?: string[];
  synthesisVia?: string;
  language?: string;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  loading: boolean;
  loadingSince: number | null;
  onSend: (query: string) => void;
}

const EXAMPLE_QUERIES = [
  "Where is the nearest Potential Fishing Zone today?",
  "Is it safe to venture into the sea tomorrow morning?",
  "Are there any cyclone alerts near Visakhapatnam?",
];

export default function ChatPanel({ messages, loading, loadingSince, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Elapsed-seconds ticker so slow LLM calls show visible progress.
  useEffect(() => {
    if (!loading || loadingSince === null) {
      setElapsed(0);
      return;
    }
    setElapsed(Math.floor((Date.now() - loadingSince) / 1000));
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - loadingSince) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [loading, loadingSince]);

  function submit(query: string) {
    const q = query.trim();
    if (!q) return;
    setDraft("");
    onSend(q); // sending while loading cancels the in-flight query (see App)
  }

  return (
    <section className="chat-panel" aria-label="Chat">
      <div className="chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`bubble bubble-${m.role}`}>
            {m.intents && m.intents.length > 0 && (
              <div className="intent-badges">
                {m.intents.map((it) => (
                  <span key={it} className="intent-badge">{it}</span>
                ))}
                {m.language && <span className="intent-badge lang-badge">Lang: {m.language}</span>}
                {m.synthesisVia && <span className="via-badge">{m.synthesisVia}</span>}
              </div>
            )}
            <p>{m.text}</p>
            {m.evidence && m.evidence.length > 0 && (
              <details className="evidence">
                <summary>Evidence ({m.evidence.length})</summary>
                <ul>
                  {m.evidence.map((e, j) => (
                    <li key={j}>{e}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
        {loading && (
          <div className="bubble bubble-assistant typing">
            Varuna is reasoning… ({elapsed}s)
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-examples">
        {EXAMPLE_QUERIES.map((q) => (
          <button
            key={q}
            type="button"
            className="chip"
            onClick={() => submit(q)}
          >
            {q}
          </button>
        ))}
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <input
          type="text"
          value={draft}
          placeholder={
            loading ? "Type a new question to supersede this one…" : "Ask about fishing zones, safety, weather…"
          }
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Your question"
        />
        <button type="submit" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
