"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker } from "react-leaflet";
import L from "leaflet";

interface SnapshotMapProps {
  latitude: number;
  longitude: number;
  heading?: number | null;
  speed?: number | null;
  altitude?: number | null;
}

export default function SnapshotMap({ latitude, longitude, heading, speed, altitude }: SnapshotMapProps) {
  const [mounted, setMounted] = useState(false);
  const [icon, setIcon] = useState<L.DivIcon | null>(null);

  useEffect(() => {
    setMounted(true);
    setIcon(
      L.divIcon({
        html: '<div style="font-size: 28px; filter: drop-shadow(0px 3px 3px rgba(0,0,0,0.3));">📍</div>',
        className: "custom-snapshot-marker",
        iconSize: [28, 28],
        iconAnchor: [14, 28],
      })
    );
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
  }, []);

  if (!mounted) return null;

  return (
    <div className="bg-white border border-gray-300 rounded-xl overflow-hidden shadow-sm">
      <div className="h-[220px] sm:h-[280px] w-full" style={{ background: "#f8f9fa" }}>
        <MapContainer
          center={[latitude, longitude]}
          zoom={15}
          style={{ height: "100%" }}
          zoomControl={true}
          attributionControl={false}
        >
          <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
          {icon && <Marker position={[latitude, longitude]} icon={icon} />}
        </MapContainer>
      </div>
      <div className="px-3 py-2 border-t border-gray-200 flex flex-wrap justify-between items-center gap-2 bg-gray-50">
        <span className="text-xs text-gray-600 font-mono font-bold">
          {latitude.toFixed(6)}, {longitude.toFixed(6)}
        </span>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {heading != null && <span>Heading: <b className="text-gray-700">{Math.round(heading)}&deg;</b></span>}
          {speed != null && <span>GPS Speed: <b className="text-gray-700">{Number(speed).toFixed(1)} mph</b></span>}
          {altitude != null && <span>Alt: <b className="text-gray-700">{Math.round(Number(altitude))} ft</b></span>}
        </div>
      </div>
    </div>
  );
}
