// TODO Hour14: delete this file after real imports from B and C are merged.
// All three stubs return type-correct Visakhapatnam data for standalone testing.

import type { QueryState } from "../types.ts";

type Region = QueryState["region"];
type MarineData = NonNullable<QueryState["marineData"]>;
type WeatherRisk = NonNullable<QueryState["weatherRisk"]>;
type FinalResponse = NonNullable<QueryState["finalResponse"]>;

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

export async function synthesizeResponse(
  state: Pick<QueryState, "region" | "intents" | "marineData" | "weatherRisk">,
): Promise<FinalResponse> {
  console.log(`[stub] synthesizeResponse called for ${state.region.name}`);

  const marine = state.marineData;
  const weather = state.weatherRisk;

  const pfzText = marine
    ? `The nearest Potential Fishing Zone is ${marine.pfzZones[0].distanceKm} km away at coordinates (${marine.pfzZones[0].lat}, ${marine.pfzZones[0].lon}).`
    : "";
  const weatherText = weather
    ? `Sea conditions are ${weather.verdict}: waves at ${weather.waveHeightM}m, wind ${weather.windSpeedKmh} km/h.`
    : "";
  const sstText = marine?.sstCelsius ? `Sea surface temperature is ${marine.sstCelsius}°C.` : "";

  const text = `For ${state.region.name}: ${pfzText} ${weatherText} ${sstText} ${weather?.reasoning || ""}`.trim();

  const mapMarkers: FinalResponse["mapMarkers"] = [];

  if (marine) {
    for (const zone of marine.pfzZones) {
      mapMarkers.push({
        lat: zone.lat,
        lon: zone.lon,
        label: `PFZ (${zone.distanceKm} km)`,
        type: "pfz",
      });
    }
  }

  if (weather && weather.verdict !== "safe") {
    mapMarkers.push({
      lat: state.region.lat,
      lon: state.region.lon,
      label: `Weather: ${weather.verdict}`,
      type: "hazard",
    });
  }

  const evidence: string[] = [];
  if (marine) {
    evidence.push(`INCOIS PFZ data: ${marine.pfzZones.length} zones found`);
    evidence.push(`SST: ${marine.sstCelsius}°C, Chlorophyll: ${marine.chlorophyll} mg/m³`);
  }
  if (weather) {
    evidence.push(`IMD weather: waves ${weather.waveHeightM}m, wind ${weather.windSpeedKmh} km/h`);
    if (weather.alerts.length > 0) {
      evidence.push(`Active alerts: ${weather.alerts.join(", ")}`);
    }
  }

  return { text, mapMarkers, evidence };
}
