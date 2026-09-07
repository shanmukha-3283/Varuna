// backend/src/agents/marineData.ts — Laptop B (Marine Data Agent).
// Reads the pre-fetched INCOIS PFZ cache (backend/src/data/incois_pfz.json),
// computes haversine distance from the query region to each advisory zone,
// and returns zones sorted nearest-first in the exact QueryState["marineData"]
// shape. Pure function: no network, no LLM — safe to call from the graph.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { QueryState } from "../types.ts";

type Region = QueryState["region"];
type MarineData = NonNullable<QueryState["marineData"]>;

const ZoneSchema = z.object({
  id: z.string(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  depthM: z.number().positive(),
  bearingFromShore: z.string(),
});

const CacheSchema = z.object({
  sector: z.string(),
  landingCentre: z.object({
    name: z.string(),
    lat: z.number(),
    lon: z.number(),
  }),
  advisoryDate: z.string(),
  validUpto: z.string(),
  zones: z.array(ZoneSchema).min(1),
  sstCelsius: z.number(),
  chlorophyll: z.number(),
  source: z.string(),
  fetchedAt: z.string(),
});

type Cache = z.infer<typeof CacheSchema>;

// Embedded fallback: same North-AP shelf positions as the cache, used ONLY if
// the JSON cache cannot be read/validated, so the graph never 500s because of
// Laptop B. Source string says so explicitly.
const FALLBACK: Cache = {
  sector: "NORTH ANDHRA PRADESH",
  landingCentre: { name: "Visakhapatnam", lat: 17.6868, lon: 83.2185 },
  advisoryDate: "2026-09-06",
  validUpto: "2026-09-07",
  zones: [
    { id: "PFZ-NAP-01", lat: 17.62, lon: 83.38, depthM: 45, bearingFromShore: "SE of Visakhapatnam fishing harbour" },
    { id: "PFZ-NAP-02", lat: 17.78, lon: 83.42, depthM: 85, bearingFromShore: "ESE of Visakhapatnam fishing harbour" },
    { id: "PFZ-NAP-03", lat: 17.95, lon: 83.5, depthM: 140, bearingFromShore: "ENE of Visakhapatnam fishing harbour" },
  ],
  sstCelsius: 28.6,
  chlorophyll: 1.1,
  source: "INCOIS (embedded fallback — data cache unreadable)",
  fetchedAt: "2026-09-07T00:00:00.000Z",
};

export function haversineKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function loadCache(): Cache {
  const dir = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(dir, "..", "data", "incois_pfz.json"), "utf-8");
  return CacheSchema.parse(JSON.parse(raw));
}

export async function getMarineData(region: Region): Promise<MarineData> {
  console.log(`[marineDataAgent] getMarineData called for ${region.name}`);
  let cache: Cache;
  try {
    cache = loadCache();
  } catch (err) {
    console.error("[marineDataAgent] cache read failed, using fallback:", err);
    cache = FALLBACK;
  }

  const pfzZones = cache.zones
    .map((z) => ({
      lat: z.lat,
      lon: z.lon,
      distanceKm: Math.round(haversineKm(region.lat, region.lon, z.lat, z.lon) * 10) / 10,
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  return {
    pfzZones,
    sstCelsius: cache.sstCelsius,
    chlorophyll: cache.chlorophyll,
    source: cache.source,
    fetchedAt: cache.fetchedAt,
  };
}
