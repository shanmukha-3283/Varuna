// backend/src/services/conversation.ts — compact multi-turn context for the
// synthesis LLM, so follow-ups ("and tomorrow?", "what about Bapatla?") read
// naturally instead of resetting every turn. Session pinning lands in step 3;
// this builder is pure (no storage) and shared by both query paths.

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
