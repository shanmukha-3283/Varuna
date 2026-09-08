import { useEffect, useRef, useState } from "react";
import { Markdown } from "../lib/markdown.tsx";

// Fallback for browser prefixes
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

export interface ChatMessage {
  role: "user" | "assistant" | "error";
  text: string;
  evidence?: string[];
  intents?: string[];
  synthesisVia?: string;
  language?: string;
  streaming?: boolean;
  ts?: number;
  executionTrace?: { agent: string; action: string; elapsedMs?: number }[];
}

interface ChatPanelProps {
  messages: ChatMessage[];
  loading: boolean;
  loadingSince: number | null;
  onSend: (query: string) => void;
  onStop: () => void;
  onRegenerate: () => void;
  chips: string[];
  preferredLanguage: string;
  liveTrace?: { agent: string; action: string; elapsedMs?: number }[];
}

export default function ChatPanel({ messages, loading, loadingSince, onSend, onStop, onRegenerate, chips, preferredLanguage, liveTrace }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [readAloud, setReadAloud] = useState(true);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  // Initialize Speech Recognition
  useEffect(() => {
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;

      recognition.onstart = () => setIsListening(true);
      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        
        if (finalTranscript) {
          setDraft(prev => (prev ? prev + ' ' : '') + finalTranscript);
        }
      };
      recognition.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        setIsListening(false);
      };
      recognition.onend = () => setIsListening(false);
      
      recognitionRef.current = recognition;
    }
  }, []);

  // Keep recognition locale in sync with the language selector.
  useEffect(() => {
    const r = recognitionRef.current;
    if (!r) return;
    let langCode = 'en-IN';
    if (preferredLanguage === 'Hindi') langCode = 'hi-IN';
    if (preferredLanguage === 'Telugu') langCode = 'te-IN';
    if (preferredLanguage === 'Tamil') langCode = 'ta-IN';
    if (preferredLanguage === 'Bengali') langCode = 'bn-IN';
    r.lang = langCode;
  }, [preferredLanguage]);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      // Set locale at start time too (covers first render before ref sync).
      let langCode = 'en-IN';
      if (preferredLanguage === 'Hindi') langCode = 'hi-IN';
      if (preferredLanguage === 'Telugu') langCode = 'te-IN';
      if (preferredLanguage === 'Tamil') langCode = 'ta-IN';
      if (preferredLanguage === 'Bengali') langCode = 'bn-IN';
      if (recognitionRef.current) recognitionRef.current.lang = langCode;
      recognitionRef.current?.start();
    }
  };

  // Text-to-Speech: speak the finished reply only (never mid-stream).
  useEffect(() => {
    if (!readAloud || loading || messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === "assistant" && lastMsg.text && !lastMsg.streaming) {
      // Don't read the initial greeting again on hot reloads
      if (messages.length === 1 && lastMsg.text.startsWith("Namaste")) return;
      
      const utterance = new SpeechSynthesisUtterance(lastMsg.text);
      let langCode = 'en-IN';
      if (preferredLanguage === 'Hindi') langCode = 'hi-IN';
      if (preferredLanguage === 'Telugu') langCode = 'te-IN';
      if (preferredLanguage === 'Tamil') langCode = 'ta-IN';
      if (preferredLanguage === 'Bengali') langCode = 'bn-IN';
      utterance.lang = langCode;
      window.speechSynthesis.cancel(); // Stop any current speech
      window.speechSynthesis.speak(utterance);
    }
  }, [messages, readAloud, loading, preferredLanguage]);

  function copyText(text: string, idx: number) {
    const done = () => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(done);
    } else {
      done();
    }
  }

  function fmtTime(ts?: number): string {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }

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

  const isEmpty = messages.length === 0;
  const isOnlyGreeting = messages.length === 1 && messages[0].role === "assistant" && /^(hi|hello|welcome|namaste|hey)/i.test(messages[0].text.slice(0, 60));

  return (
    <section className="chat-panel" aria-label="Chat">
      <div className="chat-header-actions">
        <button
          className={`toggle-btn ${readAloud ? 'active' : ''}`}
          onClick={() => {
            setReadAloud(!readAloud);
            if (readAloud) window.speechSynthesis.cancel();
          }}
          title={readAloud ? "Mute Voice Responses" : "Enable Voice Responses"}
        >
          {readAloud ? "🔊 Voice On" : "🔈 Voice Off"}
        </button>
      </div>

      {isEmpty || isOnlyGreeting ? (
        <div className="chat-empty-hero">
          <div className="hero-brand">◈</div>
          <h2>Ask me about the sea</h2>
          <p>Fishing zones, weather, tides, safe routes — just ask.</p>
          <div className="hero-chips">
            {chips.map((q) => (
              <button key={q} type="button" className="hero-chip" onClick={() => submit(q)}>
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="chat-messages">
        {(isEmpty || isOnlyGreeting) ? null : messages.map((m, i) => (
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
            {m.role === "assistant" ? (
              <div className="md">
                {m.text ? (
                  <Markdown text={m.text} />
                ) : (m.executionTrace && m.executionTrace.length > 0) || (m.streaming && liveTrace && liveTrace.length > 0) ? (
                  <div className="agent-steps">
                    {(m.streaming ? liveTrace : m.executionTrace)!.map((step, si) => (
                      <span key={si} className="agent-step">
                        <span className="agent-step-dot" />
                        <span className="agent-step-label">{step.agent}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>
                )}
                {m.streaming && m.text !== "" && <span className="stream-cursor" aria-hidden="true">▍</span>}
              </div>
            ) : (
              <p>{m.text}</p>
            )}
            <div className="msg-actions">
              {m.ts != null && <span className="msg-time">{fmtTime(m.ts)}</span>}
              {m.role === "assistant" && !m.streaming && m.text && (
                <button type="button" className="msg-btn" onClick={() => copyText(m.text, i)} title="Copy reply">
                  {copiedIdx === i ? "✓ Copied" : "⧉ Copy"}
                </button>
              )}
              {m.role === "assistant" && !m.streaming && !loading && i === messages.length - 1 && i > 0 && (
                <button type="button" className="msg-btn" onClick={onRegenerate} title="Regenerate reply">
                  ↻ Regenerate
                </button>
              )}
              {m.streaming && <span className="typing-elapsed">{elapsed}s</span>}
            </div>
            {m.evidence && m.evidence.length > 0 && (
              <div className="evidence-cards">
                {m.evidence.map((e, j) => {
                  const icon = /INCOIS|PFZ/i.test(e) ? "🛰" : /IMD|wave|wind/i.test(e) ? "🌤" : /Geofence|boundary/i.test(e) ? "🗺" : "📎";
                  return <span key={j} className="evidence-card">{icon} {e}</span>;
                })}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {(isEmpty || isOnlyGreeting) ? null : (
        <div className="chat-examples">
          {chips.map((q) => (
            <button key={q} type="button" className="chip" onClick={() => submit(q)}>
              {q}
            </button>
          ))}
        </div>
      )}

      <form
        className="chat-input"
        onSubmit={(e) => { e.preventDefault(); submit(draft); }}
      >
        <input
          type="text"
          value={draft}
          placeholder={loading ? "Type a new question to supersede this one…" : "Ask about fishing, safety, weather…"}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Your question"
        />
        {SpeechRecognition && (
          <button type="button" className={`mic-btn ${isListening ? 'listening' : ''}`} onClick={toggleListening} title="Speak">
            🎤
          </button>
        )}
        {loading ? (
          <button type="button" className="stop-btn" onClick={onStop} title="Stop generating">■ Stop</button>
        ) : (
          <button type="submit" disabled={!draft.trim()}>Send</button>
        )}
      </form>
    </section>
  );
}
