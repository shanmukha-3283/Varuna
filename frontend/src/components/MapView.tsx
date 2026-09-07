import { CircleMarker, MapContainer, Popup, TileLayer, Polyline, Polygon, useMapEvents } from "react-leaflet";
import type { MapMarker, Region } from "../api.ts";

interface MapViewProps {
  region: Region;
  markers: MapMarker[];
  onRegionChange?: (region: Region) => void;
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

function markerColor(type: string): string {
  if (type === "pfz") return "#15803d";
  if (type === "hazard") return "#dc2626";
  if (type === "route") return "#7c3aed";
  return "#0b5fa5";
}

function MapEvents({ onRegionChange }: { onRegionChange?: (r: Region) => void }) {
  useMapEvents({
    click(e) {
      if (!onRegionChange) return;
      const { lat, lng } = e.latlng;
      fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`)
        .then(r => r.json())
        .then(data => {
          const name = data.address?.city || data.address?.town || data.address?.village || data.address?.county || "Coastal Region";
          onRegionChange({ name, lat, lon: lng });
        })
        .catch(() => {
          onRegionChange({ name: "Selected Location", lat, lon: lng });
        });
    }
  });
  return null;
}

export default function MapView({ region, markers, onRegionChange }: MapViewProps) {
  const center = region ?? DEFAULT_REGION;
  const routePoints = markers.filter(m => m.type === "route").map(m => [m.lat, m.lon] as [number, number]);
  return (
    <section className="map-panel card" aria-label="Map">
      <div className="card-head">
        <div>
          <h3>Operational chart</h3>
          <p className="muted">{center.name} · {center.lat.toFixed(4)}, {center.lon.toFixed(4)} · click map to reposition</p>
        </div>
        <span className="pill">{markers.length} markers</span>
      </div>
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
        <CircleMarker
          center={[center.lat, center.lon]}
          radius={9}
          pathOptions={{ color: "#0b5fa5", fillColor: "#0b5fa5", fillOpacity: 0.8 }}
        >
          <Popup>{center.name} (query region)</Popup>
        </CircleMarker>
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
        <span><i className="dot dot-region" /> query</span>
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
