import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { QueryState } from "../types.ts";

type Alert = NonNullable<QueryState["geofenceAlerts"]>[number];

interface LatLon { lat: number; lon: number; }

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Distance from point to segment (equirectangular approx, good for <100km).
function distToSegmentKm(p: LatLon, a: LatLon, b: LatLon): number {
  const kx = 111.32 * Math.cos(((p.lat + a.lat) / 2) * (Math.PI / 180));
  const ky = 110.57;
  const px = p.lon * kx, py = p.lat * ky;
  const ax = a.lon * kx, ay = a.lat * ky;
  const bx = b.lon * kx, by = b.lat * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
}

function pointInPolygon(p: LatLon, poly: LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lon, yi = poly[i].lat;
    const xj = poly[j].lon, yj = poly[j].lat;
    const intersect = yi > p.lat !== yj > p.lat &&
      p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

interface BoundariesFile {
  imblSegments: { id: string; name: string; points: LatLon[]; dangerWithinKm: number }[];
  protectedAreas: { id: string; name: string; alertLevel: "warning" | "danger" | "info"; polygon: LatLon[]; message: string }[];
}

let cached: BoundariesFile | null = null;
function loadBoundaries(): BoundariesFile {
  if (cached) return cached;
  const dir = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(dir, "..", "data", "maritime_boundaries.json"), "utf-8");
  cached = JSON.parse(raw) as BoundariesFile;
  return cached;
}

export async function checkGeofence(region: QueryState["region"]): Promise<QueryState["geofenceAlerts"]> {
  console.log(`[geofenceAgent] Checking boundaries for ${region.name} (${region.lat}, ${region.lon})...`);
  const alerts: Alert[] = [];
  let bounds: BoundariesFile;
  try {
    bounds = loadBoundaries();
  } catch (err) {
    console.error("[geofenceAgent] boundaries file unreadable:", err);
    return alerts;
  }

  const p: LatLon = { lat: region.lat, lon: region.lon };

  // IMBL proximity: distance to each segment.
  for (const seg of bounds.imblSegments) {
    let minD = Infinity;
    for (let i = 0; i < seg.points.length - 1; i++) {
      minD = Math.min(minD, distToSegmentKm(p, seg.points[i], seg.points[i + 1]));
    }
    if (minD <= seg.dangerWithinKm) {
      alerts.push({
        zoneName: seg.name,
        alertLevel: "danger",
        message: `You are ~${minD.toFixed(1)} km from the ${seg.name} (segment ${seg.id}). Do not cross — legal and safety risk.`,
      });
    } else if (minD <= seg.dangerWithinKm * 2) {
      alerts.push({
        zoneName: seg.name,
        alertLevel: "warning",
        message: `You are ~${minD.toFixed(1)} km from the ${seg.name}. Stay on the Indian side and monitor your heading.`,
      });
    }
  }

  // MPA containment.
  for (const mpa of bounds.protectedAreas) {
    if (pointInPolygon(p, mpa.polygon)) {
      alerts.push({ zoneName: mpa.name, alertLevel: mpa.alertLevel, message: mpa.message });
    }
  }

  // Distance context for evidence (nearest IMBL).
  void haversineKm;

  return alerts;
}
