// backend/src/services/suggest.ts — adaptive example queries, slotted with
// the live region + verdict + time of day. Single owner of chip content:
// /api/opening serves them on load and refreshes them after every turn.

export type SeaVerdict = "safe" | "caution" | "unsafe";

export function suggestQueries(
  place: string,
  verdict: SeaVerdict | undefined,
  alerts: string[],
  hourIST: number,
): string[] {
  const rough = verdict === "unsafe" || alerts.length > 0;
  if (rough) {
    return [
      `What alerts are active near ${place} right now?`,
      `When will the sea calm down near ${place}?`,
      `Show me the safest route back to ${place} harbour.`,
    ];
  }
  if (hourIST < 11) {
    return [
      `Where is the nearest fishing zone near ${place} today?`,
      `Is it safe to stay out till evening near ${place}?`,
      `Any tide or wind changes I should watch near ${place}?`,
    ];
  }
  if (hourIST >= 16) {
    return [
      `Is it safe for an evening trip near ${place}?`,
      `What time is high tide near ${place} harbour?`,
      `Any alerts I should know before heading out from ${place}?`,
    ];
  }
  return [
    `Where is the nearest fishing zone near ${place}?`,
    `How are the sea conditions near ${place} right now?`,
    `Plan me a safe route out from ${place}.`,
  ];
}

/** Current hour on the Indian coast (IST = UTC+5:30). */
export function currentHourIST(now = new Date()): number {
  return (now.getUTCHours() + 5 + (now.getUTCMinutes() >= 30 ? 0.5 : 0)) % 24;
}

export function timeOfDay(hourIST: number): "morning" | "afternoon" | "evening" | "night" {
  if (hourIST >= 5 && hourIST < 12) return "morning";
  if (hourIST >= 12 && hourIST < 17) return "afternoon";
  if (hourIST >= 17 && hourIST < 21) return "evening";
  return "night";
}
