// backend/src/services/geocode.ts — live fallback for unlisted coastal places.
// Nominatim (OpenStreetMap), India-bboxed, cached, with timeout. Used ONLY
// when the keyword table misses, so "Bapatla" resolves instead of sticky Vizag.
// Guards: word-boundary prepositions, generic-word stoplist, and result
// name-similarity — a query like "safest route for my vessel" must NEVER
// resolve to a place.

import type { QueryState } from "../types.ts";

type Region = QueryState["region"];

const cache = new Map<string, Region>();

const INDIA_BBOX = { minLat: 6, maxLat: 24, minLon: 68, maxLon: 91 };

function inIndia(lat: number, lon: number): boolean {
  return lat >= INDIA_BBOX.minLat && lat <= INDIA_BBOX.maxLat &&
    lon >= INDIA_BBOX.minLon && lon <= INDIA_BBOX.maxLon;
}

// Words that are never place names in our domain.
const GENERIC = new Set([
  "where", "what", "when", "is", "the", "nearest", "near", "today", "tomorrow",
  "morning", "evening", "beach", "fish", "fishing", "fisherman", "fishermen",
  "safe", "safety", "safest", "weather", "tide", "alert", "alerts", "route",
  "routes", "visit", "visiting", "best", "time", "spot", "spots", "plan",
  "planning", "go", "for", "to", "at", "in", "of", "a", "an", "me", "my",
  "our", "and", "or", "how", "vessel", "boat", "sea", "ocean", "water",
  "coast", "coastal", "zone", "zones", "harbour", "harbor", "possible",
  "considering", "consider", "tomorrow", "daily", "live", "give", "tell",
  "there", "any", "are", "was", "were", "will", "would", "should", "can",
]);

function cleanCandidate(words: string[]): string | null {
  const kept = words.filter((w) => !GENERIC.has(w.toLowerCase()));
  if (kept.length === 0) return null;
  const cand = kept.join(" ");
  return cand.length >= 4 ? cand : null;
}

/** Extract a candidate place token, or null when the query names no place. */
function candidatePlace(query: string): string | null {
  // Path 1: capitalized proper nouns ("near Kakinada", "Bapatla beach").
  const matches = query.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) ?? [];
  for (const m of matches) {
    const cand = cleanCandidate(m.split(/\s+/));
    if (cand) return cand;
  }
  // Path 2: preposition + place ("fish near kakinada"). Word boundaries are
  // load-bearing: without \b, "at" matches inside "What" and "in" inside
  // "considering", which once resolved a route query to "The Island".
  const near = query.match(/\b(?:near|at|in|around|off|from|beside|across)\s+([A-Za-z][A-Za-z\s]{3,30})/);
  if (near) {
    // Only accept when the place word itself is capitalized ("near Kakinada");
    // lowercase overflow ("for my fishing vessel…") is not a place mention.
    const raw = near[1].trim().split(/\s+/).slice(0, 2).join(" ");
    if (/^[A-Z]/.test(raw)) {
      const cand = cleanCandidate(raw.split(/\s+/));
      if (cand) return cand;
    }
  }
  return null;
}

interface NominatimHit {
  display_name?: string;
  lat?: string;
  lon?: string;
  class?: string;
  type?: string;
}

const PLACE_TYPES = new Set([
  "city", "town", "village", "hamlet", "suburb", "neighbourhood", "quarter",
  "county", "district", "state", "administrative", "island", "municipality",
]);

/** The result must actually be about the candidate ("fishing" -> "The Island" is rejected). */
function resultMatches(candidate: string, displayName: string, type?: string): boolean {
  const candTokens = candidate.toLowerCase().split(/\s+/).filter((w) => !GENERIC.has(w));
  if (candTokens.length === 0) return false;
  const dn = displayName.toLowerCase();
  const nameHit = candTokens.some((t) => t.length >= 4 && dn.includes(t));
  if (!nameHit) return false;
  if (type && !PLACE_TYPES.has(type)) return false;
  return true;
}

export async function geocodePlace(query: string, timeoutMs = 8000): Promise<{ region: Region; candidate: string } | null> {
  const candidate = candidatePlace(query);
  if (!candidate) return null;
  const key = candidate.toLowerCase();
  const hit = cache.get(key);
  if (hit) return { region: hit, candidate };

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(candidate)}&format=json&limit=3&countrycodes=in&featuretype=city`;
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { "User-Agent": "Varuna-Marine-Assistant/1.0 (SIH demo)" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as NominatimHit[];
    for (const d of data ?? []) {
      const lat = parseFloat(d.lat ?? "");
      const lon = parseFloat(d.lon ?? "");
      if (Number.isNaN(lat) || Number.isNaN(lon) || !inIndia(lat, lon)) continue;
      const displayName = d.display_name ?? candidate;
      if (!resultMatches(candidate, displayName, d.type)) {
        console.log(`[geocode] rejected "${candidate}" -> "${displayName}" (type ${d.type})`);
        continue;
      }
      const name = displayName.split(",")[0].trim() || candidate;
      const region: Region = { name, lat: +lat.toFixed(4), lon: +lon.toFixed(4) };
      cache.set(key, region);
      if (cache.size > 200) {
        const first = cache.keys().next().value;
        if (first) cache.delete(first);
      }
      console.log(`[geocode] "${candidate}" -> ${name} (${region.lat}, ${region.lon})`);
      return { region, candidate };
    }
    return null;
  } catch (err) {
    console.error("[geocode] lookup failed:", err);
    return null;
  } finally {
    clearTimeout(t);
  }
}
