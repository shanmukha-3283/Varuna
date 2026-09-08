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

  // Generate 5-7 waypoints along the great-circle path.
  const numWaypoints = 6;
  const dLat = end.lat - start.lat;
  const dLon = end.lon - start.lon;
  const len = Math.sqrt(dLat * dLat + dLon * dLon) || 1;
  // Perpendicular direction for weather deviation.
  const perpLat = -dLon / len;
  const perpLon = dLat / len;

  const waypoints: { lat: number; lon: number }[] = [start];
  let deviated = false;

  for (let i = 1; i < numWaypoints; i++) {
    const t = i / numWaypoints;
    let wpLat = start.lat + dLat * t;
    let wpLon = start.lon + dLon * t;

    // Weather avoidance: if hazardous and near the middle third, offset perpendicular.
    if (hazardous && t > 0.25 && t < 0.75) {
      const waveScale = weatherRisk!.waveHeightM > 2.5 ? 0.08 : 0.05;
      wpLat += perpLat * waveScale;
      wpLon += perpLon * waveScale;
      deviated = true;
    }

    waypoints.push({ lat: +wpLat.toFixed(4), lon: +wpLon.toFixed(4) });
  }
  waypoints.push(end);

  const distance = pathLengthKm(waypoints);
  const speedKmh = 22.2; // ~12 knots
  const time = distance / speedKmh;
  const fuelLiters = Math.ceil(time * 15); // 15 L/hr consumption

  let message = `Safest route to the nearest PFZ: ${distance.toFixed(1)} km, ~${time.toFixed(1)} h at 12 kn via ${waypoints.length} waypoints.`;
  if (deviated) {
    message += ` Route deviates around rough seas (waves ${weatherRisk!.waveHeightM} m, ${weatherRisk!.verdict}).`;
  } else if (hazardous) {
    message += ` Seas ${weatherRisk!.verdict} (waves ${weatherRisk!.waveHeightM} m) — approach with caution.`;
  } else {
    message += " Near-direct track — seas moderate, keep a lookout.";
  }
  message += ` Estimated fuel: ~${fuelLiters} L.`;

  return {
    waypoints: waypoints.map((w) => ({ lat: +w.lat.toFixed(4), lon: +w.lon.toFixed(4) })),
    distanceKm: +distance.toFixed(1),
    estTimeHours: +time.toFixed(1),
    message,
  };
}
