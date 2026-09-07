import { useEffect, useRef, useState } from "react";

// Fallback for browser prefixes
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

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
  preferredLanguage: string;
  onLanguageChange: (lang: string) => void;
}

const EXAMPLE_QUERIES = [
  "Where is the nearest Potential Fishing Zone today?",
  "Find a safe route avoiding weather hazards.",
  "Am I dangerously close to the Sri Lanka maritime border?",
];

export default function ChatPanel({ messages, loading, loadingSince, onSend, preferredLanguage, onLanguageChange }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [readAloud, setReadAloud] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  // Initialize Speech Recognition
  useEffect(() => {
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      
      let langCode = 'en-IN';
      if (preferredLanguage === 'Hindi') langCode = 'hi-IN';
      if (preferredLanguage === 'Telugu') langCode = 'te-IN';
      if (preferredLanguage === 'Tamil') langCode = 'ta-IN';
      if (preferredLanguage === 'Bengali') langCode = 'bn-IN';
      recognition.lang = langCode;

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

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      recognitionRef.current?.start();
    }
  };

  // Text-to-Speech: Watch for new assistant messages
  useEffect(() => {
    if (!readAloud || messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === "assistant" && lastMsg.text) {
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
  }, [messages, readAloud]);

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
      <div className="chat-header-actions">
        <select 
          value={preferredLanguage} 
          onChange={(e) => onLanguageChange(e.target.value)}
          className="language-select"
        >
          <option value="English">English</option>
          <option value="Hindi">हिंदी (Hindi)</option>
          <option value="Telugu">తెలుగు (Telugu)</option>
          <option value="Tamil">தமிழ் (Tamil)</option>
          <option value="Bengali">বাংলা (Bengali)</option>
        </select>
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
        {SpeechRecognition && (
          <button 
            type="button" 
            className={`mic-btn ${isListening ? 'listening' : ''}`}
            onClick={toggleListening}
            title="Speak"
          >
            🎤
          </button>
        )}
        <button type="submit" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
