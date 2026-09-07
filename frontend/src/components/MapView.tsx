import { useState } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, Polyline, Polygon, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { MapMarker, Region } from "../api.ts";

interface MapViewProps {
  region: Region;
  markers: MapMarker[];
  userLocation?: Region | null;
  onRegionChange?: (region: Region) => void;
  onUserLocation?: (region: Region) => void;
}

const DEFAULT_REGION: Region = {
  name: "Visakhapatnam",
  lat: 17.6868,
  lon: 83.2185,
};

// Operational overlays mirroring backend maritime_boundaries.json (approximate).
const IMBL_PALK: [number, number][] = [[10.5, 79.5], [10.0, 79.85], [9.5, 79.5], [9.0, 79.3]];
const IMBL_OFFSHORE: [number, number][] = [[15.0, 86.5], [12.0, 84.5], [9.5, 82.0]];
const MANNAR: [number, number][] = [[9.3, 78.0], [9.3, 79.2], [8.5, 79.2], [8.5, 78.0]];
const VIZAG_ZONE: [number, number][] = [[17.9, 83.1], [17.9, 83.5], [17.5, 83.5], [17.5, 83.1]];

const pinIcon = L.divIcon({
  className: "query-pin",
  html: '<div class="query-pin-dot"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

const userIcon = L.divIcon({
  className: "user-pin",
  html: '<div class="user-pin-dot"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function markerColor(type: string): string {
  if (type === "pfz") return "#15803d";
  if (type === "hazard") return "#dc2626";
  if (type === "route") return "#7c3aed";
  return "#0b5fa5";
}

async function reverseName(lat: number, lon: number): Promise<string> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
    const data = await r.json();
    return data.address?.city || data.address?.town || data.address?.village || data.address?.county || data.display_name?.split(",")[0] || "Selected Location";
  } catch {
    return "Selected Location";
  }
}

function MapEvents({ onRegionChange }: { onRegionChange?: (r: Region) => void }) {
  useMapEvents({
    click(e) {
      if (!onRegionChange) return;
      const { lat, lng } = e.latlng;
      reverseName(lat, lng).then((name) => {
        onRegionChange({ name, lat, lon: lng });
      });
    }
  });
  return null;
}

export default function MapView({ region, markers, userLocation, onRegionChange, onUserLocation }: MapViewProps) {
  const center = region ?? DEFAULT_REGION;
  const routePoints = markers.filter(m => m.type === "route").map(m => [m.lat, m.lon] as [number, number]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<{ name: string; lat: number; lon: number }[]>([]);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function locateMe() {
    if (!navigator.geolocation) {
      setNotice("Geolocation is not supported by this browser.");
      return;
    }
    setLocating(true);
    setNotice(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = +pos.coords.latitude.toFixed(4);
        const lon = +pos.coords.longitude.toFixed(4);
        const name = await reverseName(lat, lon);
        const r = { name: `My location (${name})`, lat, lon };
        onUserLocation?.(r);
        onRegionChange?.(r);
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setNotice(err.code === 1 ? "Location permission denied — allow access or click the map." : "Could not get your location — click the map instead.");
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&countrycodes=in`);
      const data = await r.json();
      setResults((data || []).map((d: { display_name: string; lat: string; lon: string }) => ({
        name: d.display_name.split(",").slice(0, 2).join(","),
        lat: parseFloat(d.lat),
        lon: parseFloat(d.lon),
      })));
      if ((data || []).length === 0) setNotice("No matching place found — try another spelling.");
    } catch {
      setNotice("Place search failed — check your connection.");
    }
  }

  return (
    <section className="map-panel card" aria-label="Map">
      <div className="card-head">
        <div>
          <h3>Operational chart</h3>
          <p className="muted">{center.name} · {center.lat.toFixed(4)}, {center.lon.toFixed(4)} · click / drag pin or locate me</p>
        </div>
        <span className="pill">{markers.length} markers</span>
      </div>
      <div className="map-toolbar">
        <button type="button" className="map-btn" onClick={locateMe} disabled={locating}>
          {locating ? "Locating…" : "📍 Locate me"}
        </button>
        <form className="map-search" onSubmit={runSearch}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search place (e.g. Kakinada)"
            aria-label="Search place"
          />
          <button type="submit">Go</button>
        </form>
      </div>
      {results.length > 0 && (
        <ul className="map-results">
          {results.map((r, i) => (
            <li key={i}>
              <button type="button" onClick={() => { onRegionChange?.({ name: r.name, lat: r.lat, lon: r.lon }); setResults([]); setSearch(""); }}>
                📍 {r.name} ({r.lat.toFixed(3)}, {r.lon.toFixed(3)})
              </button>
            </li>
          ))}
        </ul>
      )}
      {notice && <p className="map-hint">{notice}</p>}
      <MapContainer
        key={`${center.lat},${center.lon}`}
        center={[center.lat, center.lon]}
        zoom={10}
        className="map"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapEvents onRegionChange={onRegionChange} />
        <Polyline positions={IMBL_PALK} pathOptions={{ color: "#dc2626", weight: 2, dashArray: "6 4" }} />
        <Polyline positions={IMBL_OFFSHORE} pathOptions={{ color: "#dc2626", weight: 2, dashArray: "6 4", opacity: 0.7 }} />
        <Polygon positions={MANNAR} pathOptions={{ color: "#d97706", weight: 1.5, fillOpacity: 0.08 }} />
        <Polygon positions={VIZAG_ZONE} pathOptions={{ color: "#0b5fa5", weight: 1.5, fillOpacity: 0.06 }} />
        <Marker
          position={[center.lat, center.lon]}
          icon={pinIcon}
          draggable
          eventHandlers={{
            dragend: (e) => {
              const m = e.target as L.Marker;
              const { lat, lng } = m.getLatLng();
              reverseName(+lat.toFixed(4), +lng.toFixed(4)).then((name) => {
                onRegionChange?.({ name, lat: +lat.toFixed(4), lon: +lng.toFixed(4) });
              });
            },
          }}
        >
          <Popup>{center.name} (query spot — drag me)</Popup>
        </Marker>
        {userLocation && (
          <Marker position={[userLocation.lat, userLocation.lon]} icon={userIcon}>
            <Popup>You are here ({userLocation.name})</Popup>
          </Marker>
        )}
        {markers.map((m, i) => {
          const color = markerColor(m.type);
          return (
            <CircleMarker
              key={i}
              center={[m.lat, m.lon]}
              radius={m.type === "hazard" ? 10 : m.type === "route" ? 5 : 7}
              pathOptions={{ color, fillColor: color, fillOpacity: 0.65 }}
            >
              <Popup>{m.label}</Popup>
            </CircleMarker>
          );
        })}
        {routePoints.length > 1 && (
          <Polyline positions={routePoints} pathOptions={{ color: "#7c3aed", weight: 3, dashArray: "4 4" }} />
        )}
      </MapContainer>
      <div className="map-legend">
        <span><i className="dot dot-region" /> query spot</span>
        <span><i className="dot dot-pfz" /> PFZ</span>
        <span><i className="dot dot-hazard" /> hazard</span>
        <span><i className="dot dot-route" style={{ backgroundColor: "#7c3aed" }} /> route</span>
        <span><i className="line line-imbl" /> IMBL</span>
        <span><i className="box box-mpa" /> MPA</span>
      </div>
      {markers.length === 0 && <p className="map-hint">No markers — marine data not requested for this intent (tool selection).</p>}
      {markers.length > 0 && !markers.some((m) => m.type === "pfz") && (
        <p className="map-hint">PFZ not fetched — query was alert/weather/tide only.</p>
      )}
    </section>
  );
}
