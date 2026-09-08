// backend/src/services/conversation.ts — compact multi-turn context for the
// synthesis LLM, so follow-ups ("and tomorrow?", "what about Bapatla?") read
// naturally instead of resetting every turn. Plus a lightweight in-memory
// session map so the pin + last answer survive page reloads.

export interface ChatTurn {
  role: string;
  text: string;
}

/** Last N turns, truncated, labelled for the prompt. Empty string when none. */
export function buildConversationContext(
  chatHistory: ChatTurn[] = [],
  maxTurns = 6,
  maxChars = 300,
): string {
  const turns = chatHistory
    .filter((t) => t.role !== "error" && t.text && t.text.trim().length > 0)
    .slice(-maxTurns);
  if (turns.length === 0) return "";
  const lines = turns.map((t) => {
    const who = t.role === "user" ? "FISHERMAN" : "VARUNA";
    const text = t.text.length > maxChars ? t.text.slice(0, maxChars) + "…" : t.text;
    return `${who}: ${text}`;
  });
  return lines.join("\n");
}

export interface SessionState {
  region?: { name: string; lat: number; lon: number };
  intents?: string[];
  lastAnswer?: string;
  updatedAt: number;
}

const sessions = new Map<string, SessionState>();
const SESSION_TTL_MS = 30 * 60_000;
const SESSION_CAP = 500;

export function getSession(id?: string): SessionState | undefined {
  if (!id) return undefined;
  const s = sessions.get(id);
  if (!s) return undefined;
  if (Date.now() - s.updatedAt > SESSION_TTL_MS) {
    sessions.delete(id);
    return undefined;
  }
  return s;
}

/** Record the outcome of a turn. No-op without an id. Prunes stale entries. */
export function touchSession(
  id: string | undefined,
  patch: Pick<SessionState, "region" | "intents"> & { answer?: string },
): void {
  if (!id) return;
  const prev = getSession(id);
  sessions.set(id, {
    region: patch.region ?? prev?.region,
    intents: patch.intents ?? prev?.intents,
    lastAnswer: patch.answer?.slice(0, 300) ?? prev?.lastAnswer,
    updatedAt: Date.now(),
  });
  if (sessions.size > SESSION_CAP) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0]?.[0];
    if (oldest) sessions.delete(oldest);
  }
}

/** One-line session recap for the prompt, used when the visible history is
 * thin (e.g. right after a reload). Empty string when nothing is stored. */
export function sessionContextNote(s: SessionState | undefined): string {
  if (!s || (!s.region && !s.lastAnswer)) return "";
  const parts: string[] = ["Earlier this session:"];
  if (s.region) parts.push(`the fishing spot was ${s.region.name}.`);
  if (s.intents && s.intents.length > 0) parts.push(`Topics covered: ${s.intents.join(", ")}.`);
  if (s.lastAnswer) parts.push(`Your last reply ended: "${s.lastAnswer.slice(-200)}"`);
  return parts.join(" ");
}

/** Merge visible history with the session recap (recap only fills gaps). */
export function buildFullContext(chatHistory: ChatTurn[] = [], sessionId?: string): string {
  const history = buildConversationContext(chatHistory);
  const visibleTurns = chatHistory.filter((t) => t.role !== "error" && t.text?.trim()).length;
  const note = visibleTurns < 2 ? sessionContextNote(getSession(sessionId)) : "";
  return [history, note].filter(Boolean).join("\n");
}
