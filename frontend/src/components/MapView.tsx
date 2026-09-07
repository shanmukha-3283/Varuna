import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import type { MapMarker, Region } from "../api.ts";

interface MapViewProps {
  region: Region;
  markers: MapMarker[];
}

const DEFAULT_REGION: Region = {
  name: "Visakhapatnam",
  lat: 17.6868,
  lon: 83.2185,
};

function markerColor(type: string): string {
  if (type === "pfz") return "#16a34a";
  if (type === "hazard") return "#dc2626";
  return "#2563eb";
}

export default function MapView({ region, markers }: MapViewProps) {
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
              radius={m.type === "hazard" ? 10 : 7}
              pathOptions={{ color, fillColor: color, fillOpacity: 0.6 }}
            >
              <Popup>{m.label}</Popup>
            </CircleMarker>
          );
        })}
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
      </div>
    </section>
  );
}
