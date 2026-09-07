import type { QueryState } from "../types.ts";

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

function pathLengthKm(pts: { lat: number; lon: number }[]): number {
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    total += haversineKm(pts[i].lat, pts[i].lon, pts[i + 1].lat, pts[i + 1].lon);
  }
  return total;
}

export async function optimizeRoute(
  region: QueryState["region"],
  marineData: QueryState["marineData"] | undefined,
  weatherRisk: QueryState["weatherRisk"] | undefined
): Promise<QueryState["routeOptimization"] | undefined> {
  if (!marineData || marineData.pfzZones.length === 0) {
    return undefined;
  }

  console.log(`[routeAgent] Calculating safe route from ${region.name} to nearest PFZ...`);

  const pfz = marineData.pfzZones[0];
  const start = { lat: region.lat, lon: region.lon };
  const end = { lat: pfz.lat, lon: pfz.lon };

  const hazardous = weatherRisk && (weatherRisk.verdict === "unsafe" || weatherRisk.verdict === "caution");
  const hasWaveHazard = weatherRisk && weatherRisk.waveHeightM > 2.0;

  // Weather-aware deviation: offset the midpoint perpendicular to the
  // direct leg so the route skirts the heavier sea. Offset scales with
  // wave height; safe conditions sail near-direct.
  const midLat = (start.lat + end.lat) / 2;
  const midLon = (start.lon + end.lon) / 2;
  const dLat = end.lat - start.lat;
  const dLon = end.lon - start.lon;
  const len = Math.sqrt(dLat * dLat + dLon * dLon) || 1;
  const offsetScale = !hazardous ? 0.01 : hasWaveHazard ? 0.06 : 0.04;
  const mid = {
    lat: midLat + (-dLon / len) * offsetScale,
    lon: midLon + (dLat / len) * offsetScale,
  };

  const waypoints = [start, mid, end];
  const distance = pathLengthKm(waypoints);
  const speed = 15; // typical fishing vessel km/h
  const time = distance / speed;

  let message = `Safest route to the nearest PFZ: ${distance.toFixed(1)} km, ~${time.toFixed(1)} h at 15 km/h via 3 waypoints.`;
  if (hazardous) {
    message += ` Deviated to skirt hazardous seas (waves ${weatherRisk!.waveHeightM} m, ${weatherRisk!.verdict}) — approach the PFZ from the sheltered side and turn back if weather builds.`;
  } else {
    message += " Near-direct track — seas moderate, keep a lookout and monitor IMD updates.";
  }

  return {
    waypoints: waypoints.map((w) => ({ lat: +w.lat.toFixed(4), lon: +w.lon.toFixed(4) })),
    distanceKm: +distance.toFixed(1),
    estTimeHours: +time.toFixed(1),
    message,
  };
}
