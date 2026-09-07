// backend/src/services/geocode.ts — live fallback for unlisted coastal places.
// Nominatim (OpenStreetMap), India-bboxed, cached, with timeout. Used ONLY
// when the keyword table misses, so "Bapatla" resolves instead of sticky Vizag.

import type { QueryState } from "../types.ts";

type Region = QueryState["region"];

const cache = new Map<string, Region>();

const INDIA_BBOX = { minLat: 6, maxLat: 24, minLon: 68, maxLon: 91 };

function inIndia(lat: number, lon: number): boolean {
  return lat >= INDIA_BBOX.minLat && lat <= INDIA_BBOX.maxLat &&
    lon >= INDIA_BBOX.minLon && lon <= INDIA_BBOX.maxLon;
}

/** Extract a candidate place token: capitalized word(s) not in the stoplist. */
function candidatePlace(query: string): string | null {
  const stop = new Set(["where", "what", "when", "is", "the", "nearest", "near", "today", "tomorrow", "morning", "evening", "beach", "fish", "fishing", "safe", "safety", "weather", "tide", "alert", "route", "visit", "best", "time", "spot", "spots", "plan", "go", "for", "to", "at", "in", "of", "a", "an", "me", "my", "our", "and", "or", "how"]);
  const matches = query.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) ?? [];
  for (const m of matches) {
    const words = m.split(/\s+/).filter((w) => !stop.has(w.toLowerCase()));
    if (words.length === 0) continue;
    const cand = words.join(" ");
    if (cand.length >= 4) return cand;
  }
  // Fallback: trailing "near X" / "at X" / "in X" phrase (lowercase ok).
  const near = query.match(/(?:near|at|in|around|off|from)\s+([a-zA-Z][a-zA-Z\s]{3,30})/i);
  if (near) {
    const cand = near[1].trim().split(/\s+/).slice(0, 2).join(" ");
    if (cand.length >= 4) return cand;
  }
  return null;
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
    const data = (await res.json()) as { display_name?: string; lat?: string; lon?: string }[];
    for (const d of data ?? []) {
      const lat = parseFloat(d.lat ?? "");
      const lon = parseFloat(d.lon ?? "");
      if (Number.isNaN(lat) || Number.isNaN(lon) || !inIndia(lat, lon)) continue;
      const name = (d.display_name ?? candidate).split(",")[0].trim() || candidate;
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
