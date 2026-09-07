import { useEffect, useState } from "react";
import type { QueryState } from "../api.ts";

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="meter" role="progressbar" aria-valuenow={Math.round(pct)}>
      <div className="meter-fill" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

function verdictColor(v?: string): string {
  if (v === "unsafe") return "#dc2626";
  if (v === "caution") return "#d97706";
  return "#15803d";
}

function tideFromReasoning(reasoning?: string): string | null {
  if (!reasoning) return null;
  const m = reasoning.match(/Next high tide .*?IST.*?low .*?IST.*?(?:—|–)/i)
    ?? reasoning.match(/high tide.*?IST.*?low.*?IST.*/i);
  return m ? m[0].trim() : null;
}

function productivity(sst?: number, chl?: number): { label: string; tone: string } | null {
  if (sst === undefined || chl === undefined) return null;
  if (sst >= 27 && sst <= 29.5 && chl >= 0.5) return { label: "Favourable — plankton-rich, good PFZ potential", tone: "#15803d" };
  return { label: "Subdued — fish may be deeper or dispersed", tone: "#b45309" };
}

function Spark({ values, color, label }: { values: number[]; color: string; label: string }) {
  if (values.length < 2) return null;
  const w = 220, h = 48, pad = 4;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${pad + (i * (w - 2 * pad)) / (values.length - 1)},${h - pad - ((v - min) / span) * (h - 2 * pad)}`).join(" ");
  return (
    <div className="spark-block">
      <div className="kv"><span>{label}</span><strong>{min.toFixed(1)} – {max.toFixed(1)}</strong></div>
      <svg viewBox={`0 0 ${w} ${h}`} className="spark" role="img" aria-label={`${label} 7-day trend`}>
        <polyline points={pts} pathLength={1} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function TrendCharts({ lat, lon }: { lat: number; lon: number }) {
  const [waves, setWaves] = useState<number[]>([]);
  const [winds, setWinds] = useState<number[]>([]);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [m, w] = await Promise.all([
          fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&daily=wave_height_max&forecast_days=7&timezone=auto`).then((r) => r.json()),
          fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=wind_speed_10m_max&forecast_days=7&timezone=auto`).then((r) => r.json()),
        ]);
        if (cancelled) return;
        if (Array.isArray(m?.daily?.wave_height_max)) setWaves(m.daily.wave_height_max.filter((v: unknown) => typeof v === "number"));
        if (Array.isArray(w?.daily?.wind_speed_10m_max)) setWinds(w.daily.wind_speed_10m_max.filter((v: unknown) => typeof v === "number"));
      } catch {
        if (!cancelled) setNote("Trend unavailable offline");
      }
    }
    load();
    return () => { cancelled = true; };
  }, [lat, lon]);
  if (waves.length === 0 && winds.length === 0) {
    return note ? <p className="muted small">{note}</p> : <p className="muted small">Loading 7-day trend…</p>;
  }
  return (
    <div>
      {waves.length > 0 && <Spark values={waves} color="#0b5fa5" label="🌊 Wave max (m, 7d)" />}
      {winds.length > 0 && <Spark values={winds} color="#7c3aed" label="💨 Wind max (km/h, 7d)" />}
    </div>
  );
}

export default function SafetyPanels({ latest }: { latest: QueryState | null }) {
  if (!latest) {
    return (
      <section className="card empty-card" aria-label="Safety details">
        <h3>Decision dashboard</h3>
        <p className="muted">Ask a question to populate sea safety, productivity, tide, geofence and route panels.</p>
      </section>
    );
  }
  const marine = latest.marineData;
  const weather = latest.weatherRisk;
  const geofence = latest.geofenceAlerts ?? [];
  const route = latest.routeOptimization;
  const tide = tideFromReasoning(weather?.reasoning);
  const prod = productivity(marine?.sstCelsius, marine?.chlorophyll);
  const avoidEvidence = latest.finalResponse?.evidence?.find((e) => e.startsWith("Zones to avoid"));

  return (
    <section className="safety-grid" aria-label="Safety details">
      {weather && (
        <div className={`card tone-${weather.verdict}`}>
          <div className="card-head tone-head">
            <h3>🌊 Sea safety</h3>
            <span className={`verdict-pill verdict-${weather.verdict}`}>{weather.verdict.toUpperCase()}</span>
          </div>
          <div className="kv"><span>Waves</span><strong>{weather.waveHeightM} m</strong></div>
          <Bar value={weather.waveHeightM} max={4} color={verdictColor(weather.verdict)} />
          <div className="kv"><span>Wind</span><strong>{weather.windSpeedKmh} km/h</strong></div>
          <Bar value={weather.windSpeedKmh} max={60} color="#0b5fa5" />
          {weather.alerts.length > 0 ? (
            <p className="alert-line danger">⚠️ {weather.alerts.join(" · ")}</p>
          ) : (
            <p className="alert-line ok">✓ No active weather alerts</p>
          )}
          <TrendCharts lat={latest.region.lat} lon={latest.region.lon} />
        </div>
      )}

      {marine && (
        <div className="card tone-info">
          <div className="card-head tone-head">
            <h3>🪸 Ocean productivity</h3>
            {prod && <span className="pill" style={{ borderColor: prod.tone, color: prod.tone }}>{prod.label.split(" — ")[0]}</span>}
          </div>
          <div className="kv"><span>SST</span><strong>{marine.sstCelsius}°C</strong></div>
          <Bar value={(marine.sstCelsius ?? 24) - 24} max={8} color="#0284c7" />
          <div className="kv"><span>Chlorophyll</span><strong>{marine.chlorophyll} mg/m³</strong></div>
          <Bar value={marine.chlorophyll ?? 0} max={3} color="#15803d" />
          <div className="kv"><span>PFZ zones</span><strong>{marine.pfzZones.length} found</strong></div>
          {prod && <p className="muted small">{prod.label}</p>}
          {tide && <p className="tide">🌊 {tide}</p>}
          {latest.finalResponse?.evidence?.filter((e) => e.startsWith("Productivity trend:")).map((e, i) => (
            <p key={i} className="muted small">📉 {e}</p>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h3>Boundaries & avoidance</h3>
          <span className="pill">{geofence.length === 0 ? "clear" : `${geofence.length} notice${geofence.length > 1 ? "s" : ""}`}</span>
        </div>
        {geofence.length === 0 ? (
          <p className="alert-line ok">✓ No boundary violations for this location</p>
        ) : (
          <ul className="geofence-list">
            {geofence.map((g, i) => (
              <li key={i} className={`geofence-${g.alertLevel}`}>
                <strong>{g.zoneName}</strong>
                <span className={`mini-pill ${g.alertLevel}`}>{g.alertLevel}</span>
                <div className="muted small">{g.message}</div>
              </li>
            ))}
          </ul>
        )}
        {avoidEvidence && <p className="avoid">{avoidEvidence}</p>}
        {route && (
          <div className="route-block">
            <div className="kv"><span>Safe route</span><strong>{route.distanceKm} km · ~{route.estTimeHours} h</strong></div>
            <p className="muted small">{route.message}</p>
          </div>
        )}
      </div>
    </section>
  );
}
