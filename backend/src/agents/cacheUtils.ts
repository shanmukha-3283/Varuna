// backend/src/agents/cacheUtils.ts — Laptop B shared helpers.
// Pure date/staleness logic used by both agents (and their tests).
// Standalone module: no imports from sibling agent files, so the
// dependency direction stays clean (agents -> cacheUtils, never sideways).

export const STALE_AFTER_DAYS = 3;

const DAY_MS = 86_400_000;

export function daysBetween(fromMs: number, toMs: number): number {
  return Math.floor((toMs - fromMs) / DAY_MS);
}

/**
 * Returns a staleness warning like
 *   "cache is 5 days old (fetched 2026-09-02) — refresh advised",
 * or null when the cache is fresh (or the timestamp is unparseable,
 * in which case we stay silent rather than cry wolf).
 */
export function stalenessNote(
  fetchedAtISO: string,
  nowMs: number = Date.now(),
  thresholdDays: number = STALE_AFTER_DAYS,
): string | null {
  const fetchedMs = Date.parse(fetchedAtISO);
  if (Number.isNaN(fetchedMs)) return null;
  const ageDays = daysBetween(fetchedMs, nowMs);
  if (ageDays < thresholdDays) return null;
  const fetchedDay = new Date(fetchedMs).toISOString().slice(0, 10);
  return `cache is ${ageDays} days old (fetched ${fetchedDay}) — refresh advised`;
}

/**
 * Returns "advisory expired <date>" when a calendar-date validity
 * (e.g. PFZ "validUpto": "2026-09-07", valid through end of that day UTC)
 * has passed, else null.
 */
export function expiryNote(
  validUptoDate: string,
  nowMs: number = Date.now(),
): string | null {
  const dayStartMs = Date.parse(validUptoDate);
  if (Number.isNaN(dayStartMs)) return null;
  if (nowMs < dayStartMs + DAY_MS) return null;
  return `advisory expired ${validUptoDate}`;
}
