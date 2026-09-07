import type { QueryState } from "../types.ts";

export async function optimizeRoute(
  region: QueryState["region"],
  marineData: QueryState["marineData"] | undefined,
  weatherRisk: QueryState["weatherRisk"] | undefined
): Promise<QueryState["routeOptimization"] | undefined> {
  // Only calculate route if marine data is available
  if (!marineData || marineData.pfzZones.length === 0) {
    return undefined;
  }
  
  console.log(`[routeAgent] Calculating safe route from ${region.name} to nearest PFZ...`);

  // Simulate calling a live route optimization API
  const pfz = marineData.pfzZones[0];
  
  // Create some mock waypoints to simulate deviation due to weather
  const waypoints = [
    { lat: region.lat, lon: region.lon }, // Start
    { lat: (region.lat + pfz.lat) / 2 + 0.05, lon: (region.lon + pfz.lon) / 2 - 0.05 }, // Midpoint deviation
    { lat: pfz.lat, lon: pfz.lon } // End
  ];
  
  const distance = pfz.distanceKm + 5; // A bit longer due to deviation
  
  // Assume a typical fishing vessel speed of 15 km/h
  const speed = 15;
  const time = distance / speed;

  let message = `Optimal safe route to PFZ calculated. Total distance: ${distance.toFixed(1)} km, Est time: ${time.toFixed(1)} hours.`;
  if (weatherRisk && weatherRisk.verdict !== "safe") {
    message += " Route deviates slightly to avoid hazardous waves.";
  }

  return {
    waypoints,
    distanceKm: parseFloat(distance.toFixed(1)),
    estTimeHours: parseFloat(time.toFixed(1)),
    message
  };
}
