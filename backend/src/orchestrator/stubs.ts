// TODO Hour14-B: delete this file after real imports from B are merged.
// Currently only marine/weather remain stubbed; synthesis is now real (../synthesis/synthesizeResponse.ts).

import type { QueryState } from "../types.ts";

type Region = QueryState["region"];
type MarineData = NonNullable<QueryState["marineData"]>;
type WeatherRisk = NonNullable<QueryState["weatherRisk"]>;

export async function getMarineData(region: Region): Promise<MarineData> {
  console.log(`[stub] getMarineData called for ${region.name}`);
  return {
    pfzZones: [
      { lat: 17.72, lon: 83.25, distanceKm: 4.2 },
      { lat: 17.65, lon: 83.30, distanceKm: 6.8 },
      { lat: 17.78, lon: 83.18, distanceKm: 11.3 },
    ],
    sstCelsius: 28.4,
    chlorophyll: 1.2,
    source: "INCOIS (stub)",
    fetchedAt: new Date().toISOString(),
  };
}

export async function getWeatherRisk(region: Region): Promise<WeatherRisk> {
  console.log(`[stub] getWeatherRisk called for ${region.name}`);
  return {
    waveHeightM: 1.8,
    windSpeedKmh: 22,
    alerts: [],
    verdict: "caution",
    reasoning:
      "Wave height of 1.8m is in the caution range (1.5-2.5m). Wind speed is moderate at 22 km/h. No active alerts for the Visakhapatnam coast.",
  };
}

// synthesizeResponse removed — now imported from ../synthesis/synthesizeResponse.ts (Laptop C real)
