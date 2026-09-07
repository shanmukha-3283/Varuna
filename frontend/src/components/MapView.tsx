import { CircleMarker, MapContainer, Popup, TileLayer, Polyline, useMapEvents } from "react-leaflet";
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

function markerColor(type: string): string {
  if (type === "pfz") return "#16a34a";
  if (type === "hazard") return "#dc2626";
  if (type === "route") return "#9333ea"; // Purple for route markers
  return "#2563eb";
}

function MapEvents({ onRegionChange }: { onRegionChange?: (r: Region) => void }) {
  useMapEvents({
    click(e) {
      if (!onRegionChange) return;
      const { lat, lng } = e.latlng;
      // Reverse geocode to get a rough name
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
  return (
    <section className="map-panel" aria-label="Map">
      {/* key remounts the map so it re-centers on every new region */}
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
        <CircleMarker
          center={[center.lat, center.lon]}
          radius={9}
          pathOptions={{ color: "#2563eb", fillColor: "#2563eb", fillOpacity: 0.7 }}
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
              pathOptions={{ color, fillColor: color, fillOpacity: 0.6 }}
            >
              <Popup>{m.label}</Popup>
            </CircleMarker>
          );
        })}
        {(() => {
          const routePoints = markers.filter(m => m.type === "route").map(m => [m.lat, m.lon] as [number, number]);
          if (routePoints.length > 1) {
            return <Polyline positions={routePoints} pathOptions={{ color: "#9333ea", weight: 3, dashArray: "4 4" }} />;
          }
          return null;
        })()}
      </MapContainer>
      <div className="map-legend">
        <span>
          <i className="dot dot-region" /> query region
        </span>
        <span>
          <i className="dot dot-pfz" /> fishing zone
        </span>
        <span>
          <i className="dot dot-hazard" /> hazard
        </span>
        <span>
          <i className="dot dot-route" style={{backgroundColor: "#9333ea"}} /> route
        </span>
      </div>
      {markers.length === 0 && <p className="map-hint">No PFZ markers — marine data not requested for this intent.</p>}
      {markers.length > 0 && !markers.some((m) => m.type === "pfz") && (
        <p className="map-hint">PFZ not fetched — query was alert/weather/tide only (tool selection).</p>
      )}
    </section>
  );
}
