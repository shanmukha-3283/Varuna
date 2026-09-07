import { useEffect, useRef, useState } from "react";

export interface ChatMessage {
  role: "user" | "assistant" | "error";
  text: string;
  evidence?: string[];
}

interface ChatPanelProps {
  messages: ChatMessage[];
  loading: boolean;
  onSend: (query: string) => void;
}

const EXAMPLE_QUERIES = [
  "Where is the nearest Potential Fishing Zone today?",
  "Is it safe to venture into the sea tomorrow morning?",
  "Are there any cyclone alerts near Visakhapatnam?",
];

export default function ChatPanel({ messages, loading, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function submit(query: string) {
    const q = query.trim();
    if (!q || loading) return;
    setDraft("");
    onSend(q);
  }

  return (
    <section className="chat-panel" aria-label="Chat">
      <div className="chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`bubble bubble-${m.role}`}>
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
        {loading && <div className="bubble bubble-assistant typing">Varuna is reasoning…</div>}
        <div ref={bottomRef} />
      </div>

      <div className="chat-examples">
        {EXAMPLE_QUERIES.map((q) => (
          <button
            key={q}
            type="button"
            className="chip"
            disabled={loading}
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
          disabled={loading}
          placeholder="Ask about fishing zones, safety, weather…"
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Your question"
        />
        <button type="submit" disabled={loading || !draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
