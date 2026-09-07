import type { QueryState } from "../api.ts";

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="meter">
      <div className="meter-fill" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

function verdictColor(v?: string): string {
  if (v === "unsafe") return "#dc2626";
  if (v === "caution") return "#d97706";
  return "#16a34a";
}

export default function SafetyPanels({ latest }: { latest: QueryState | null }) {
  if (!latest) return null;
  const marine = latest.marineData;
  const weather = latest.weatherRisk;
  const geofence = latest.geofenceAlerts ?? [];
  const route = latest.routeOptimization;

  return (
    <section className="safety-panels" aria-label="Safety details">
      {weather && (
        <div className="safety-card">
          <h3>
            Sea safety ·{" "}
            <span className="verdict" style={{ color: verdictColor(weather.verdict) }}>
              {weather.verdict.toUpperCase()}
            </span>
          </h3>
          <div className="meter-row">
            <span>🌊 {weather.waveHeightM} m</span>
            <Bar value={weather.waveHeightM} max={4} color={verdictColor(weather.verdict)} />
          </div>
          <div className="meter-row">
            <span>💨 {weather.windSpeedKmh} km/h</span>
            <Bar value={weather.windSpeedKmh} max={60} color="#2563eb" />
          </div>
          {marine?.sstCelsius !== undefined && (
            <div className="meter-row">
              <span>🌡️ SST {marine.sstCelsius}°C</span>
              <Bar value={marine.sstCelsius - 24} max={8} color="#0ea5e9" />
            </div>
          )}
          {marine?.chlorophyll !== undefined && (
            <div className="meter-row">
              <span>🟢 Chl {marine.chlorophyll} mg/m³</span>
              <Bar value={marine.chlorophyll} max={3} color="#16a34a" />
            </div>
          )}
          {weather.alerts.length > 0 ? (
            <p className="alert-line danger">⚠️ {weather.alerts.join(", ")}</p>
          ) : (
            <p className="alert-line ok">No active weather alerts</p>
          )}
        </div>
      )}

      {geofence.length > 0 && (
        <div className="safety-card">
          <h3>🛟 Geofence ({geofence.length})</h3>
          <ul className="geofence-list">
            {geofence.map((g, i) => (
              <li key={i} className={`geofence-${g.alertLevel}`}>
                <strong>{g.zoneName}</strong> [{g.alertLevel}] — {g.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {route && (
        <div className="safety-card">
          <h3>🧭 Safe route</h3>
          <p>
            {route.distanceKm} km · ~{route.estTimeHours} h · {route.waypoints.length} waypoints
          </p>
          <p className="route-msg">{route.message}</p>
        </div>
      )}
    </section>
  );
}
