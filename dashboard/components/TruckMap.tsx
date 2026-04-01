"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import L from "leaflet";

// Dynamically import Leaflet components (SSR incompatible)
const MapContainer = dynamic(() => import("react-leaflet").then((m) => m.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import("react-leaflet").then((m) => m.TileLayer), { ssr: false });
const Marker = dynamic(() => import("react-leaflet").then((m) => m.Marker), { ssr: false });
const Popup = dynamic(() => import("react-leaflet").then((m) => m.Popup), { ssr: false });
const Polyline = dynamic(() => import("react-leaflet").then((m) => m.Polyline), { ssr: false });
const useMap = dynamic(() => import("react-leaflet").then((m) => m.useMap), { ssr: false });

// 1. FIX: Custom Truck Icon
const truckIcon = L.divIcon({
  html: '<div style="font-size: 24px; line-height: 1; filter: drop-shadow(0px 2px 2px rgba(0,0,0,0.5));">🚛</div>',
  className: "custom-truck-marker",
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -12],
});

// 2. FIX: Camera follow logic
function RecenterView({ lat, lng }: { lat: number; lng: number }) {
  const map = (useMap as any)();
  useEffect(() => {
    if (map) {
      map.setView([lat, lng]);
    }
  }, [lat, lng, map]);
  return null;
}

interface TruckMapProps {
  latitude: number | null;
  longitude: number | null;
  heading: number | null;
  speed: number | null;
  altitude: number | null;
  vehicleState: string;
}

export default function TruckMap({
  latitude,
  longitude,
  heading,
  speed,
  altitude,
  vehicleState,
}: TruckMapProps) {
  const [trail, setTrail] = useState<[number, number][]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof document !== "undefined" && !document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
  }, []);

  useEffect(() => {
    if (latitude && longitude && latitude !== 0 && longitude !== 0) {
      setTrail((prev) => {
        const last = prev[prev.length - 1];
        if (!last || Math.abs(last[0] - latitude) > 0.00001 || Math.abs(last[1] - longitude) > 0.00001) {
          const next = [...prev, [latitude, longitude] as [number, number]];
          return next.slice(-200);
        }
        return prev;
      });
    }
  }, [latitude, longitude]);

  if (!mounted || !latitude || !longitude || latitude === 0 || longitude === 0) {
    return (
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 mb-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm">📍</span>
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Location</span>
        </div>
        <div className="text-xs text-gray-500">Waiting for GPS data...</div>
      </div>
    );
  }

  const headingStr = heading !== null ? `${heading.toFixed(0)}°` : "--";
  const speedStr = speed !== null ? `${speed.toFixed(1)} mph` : "--";
  const altStr = altitude !== null ? `${altitude.toFixed(0)} ft` : "--";
  const compassDir = heading !== null
    ? ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"][
        Math.round(heading / 22.5) % 16
      ]
    : "--";

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden mb-3">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <span className="text-sm">📍</span>
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Live Location</span>
          <span className={`w-2 h-2 rounded-full ${vehicleState === "Engine On" ? "bg-green-500 animate-pulse" : "bg-gray-600"}`} />
        </div>
        <div className="flex items-center gap-3 text-[10px] text-gray-400">
          <span>🧭 {compassDir} {headingStr}</span>
          <span>🏔 {altStr}</span>
          <span>{latitude.toFixed(5)}, {longitude.toFixed(5)}</span>
        </div>
      </div>

      <div style={{ height: "250px", width: "100%" }}>
        <MapContainer
          center={[latitude, longitude]}
          zoom={14}
          style={{ height: "100%", width: "100%" }}
          zoomControl={false}
          attributionControl={false}
        >
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
          <RecenterView lat={latitude} lng={longitude} />
          {trail.length > 1 && (
            <Polyline positions={trail} pathOptions={{ color: "#00D4AA", weight: 3, opacity: 0.7 }} />
          )}
          <Marker position={[latitude, longitude]} icon={truckIcon}>
            <Popup>
              <div style={{ color: "#000", fontSize: "12px" }}>
                <strong>🚛 Mack Truck</strong><br />
                Speed: {speedStr}<br />
                Heading: {compassDir} ({headingStr})<br />
                Altitude: {altStr}<br />
                State: {vehicleState}
              </div>
            </Popup>
          </Marker>
        </MapContainer>
      </div>
    </div>
  );
}
