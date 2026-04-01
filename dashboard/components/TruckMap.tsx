"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import L from "leaflet";

const MapContainer = dynamic(() => import("react-leaflet").then((m) => m.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import("react-leaflet").then((m) => m.TileLayer), { ssr: false });
const Marker = dynamic(() => import("react-leaflet").then((m) => m.Marker), { ssr: false });
const Popup = dynamic(() => import("react-leaflet").then((m) => m.Popup), { ssr: false });
const Polyline = dynamic(() => import("react-leaflet").then((m) => m.Polyline), { ssr: false });
const useMap = dynamic(() => import("react-leaflet").then((m) => m.useMap), { ssr: false });

const truckIcon = L.divIcon({
  html: '<div style="font-size: 24px; line-height: 1; filter: drop-shadow(0px 2px 2px rgba(0,0,0,0.5));">🚛</div>',
  className: "custom-truck-marker",
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

function RecenterView({ lat, lng }: { lat: number; lng: number }) {
  const map = (useMap as any)();
  useEffect(() => { if (map) map.setView([lat, lng]); }, [lat, lng, map]);
  return null;
}

export default function TruckMap({ latitude, longitude, heading, speed, altitude, vehicleState }: any) {
  const [trail, setTrail] = useState<[number, number][]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof document !== "undefined" && !document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css"; link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
  }, []);

  useEffect(() => {
    if (latitude && longitude && latitude !== 0 && longitude !== 0) {
      setTrail(prev => [...prev, [latitude, longitude] as [number, number]].slice(-200));
    }
  }, [latitude, longitude]);

  if (!mounted) return null;
  if (!latitude || !longitude || latitude === 0) {
    return <div className="p-4 text-gray-500 bg-gray-900/50 rounded-lg border border-gray-800 mb-3 text-center">📍 Waiting for GPS lock...</div>;
  }

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden mb-3">
      <div style={{ height: "250px", width: "100%" }}>
        <MapContainer center={[latitude, longitude]} zoom={14} style={{ height: "100%" }} zoomControl={false} attributionControl={false}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
          <RecenterView lat={latitude} lng={longitude} />
          {trail.length > 1 && <Polyline positions={trail} pathOptions={{ color: "#00D4AA", weight: 3 }} />}
          <Marker position={[latitude, longitude]} icon={truckIcon}>
            <Popup>
              <div className="text-black text-xs">
                <strong>Mack Truck</strong><br/>
                State: {vehicleState}
              </div>
            </Popup>
          </Marker>
        </MapContainer>
      </div>
    </div>
  );
}
