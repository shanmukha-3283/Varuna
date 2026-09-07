import type { QueryState } from "../types.ts";

export async function checkGeofence(region: QueryState["region"]): Promise<QueryState["geofenceAlerts"]> {
  console.log(`[geofenceAgent] Checking live API for geofence alerts at ${region.name} (${region.lat}, ${region.lon})...`);
  
  // Simulate an external agency API call for boundary data
  // In real life, this would hit something like https://incois.gov.in/api/boundaries?lat=...&lon=...
  
  const alerts: NonNullable<QueryState["geofenceAlerts"]> = [];
  
  // Mock logic to simulate live boundaries based on coordinates
  if (region.lon > 85 || region.name.toLowerCase().includes("sri lanka") || region.lat < 10 && region.lon > 79 && region.lon < 82) {
    alerts.push({
      zoneName: "International Maritime Boundary Line (IMBL)",
      alertLevel: "danger",
      message: "You are approaching the IMBL. Please do not cross to avoid legal and safety risks."
    });
  } else if (region.lon < 75) {
    alerts.push({
       zoneName: "Marine Protected Area (MPA)",
       alertLevel: "warning",
       message: "You are near an ecologically sensitive MPA. Fishing is restricted."
    });
  }
  
  return alerts;
}
