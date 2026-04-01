"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";

// This helper component handles moving the camera
function RecenterView({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    if (map) {
      map.setView([lat, lng]);
    }
  }, [lat, lng, map]);
  return null;
}

export default function TruckMap({ latitude, longitude, vehicleState }: any) {
  const [mounted, setMounted] = useState(false);
  const [truckIcon, setTruckIcon] = useState<L.DivIcon | null>(null);

  useEffect(() => {
    setMounted(true);
    
    // Create the icon only on the client side
    const icon = L.divIcon({
      html: '<div style="font-size: 24px; filter: drop-shadow(0px 2px 2px rgba(0,0,0,0.5));">🚛</div>',
      className: "custom-truck-marker",
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
    setTruckIcon(icon);

    // Load Leaflet CSS
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
  }, []);

  if (!mounted) return null;

  if (!latitude || !longitude || latitude === 0) {
    return (
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-8 mb-3 text-center">
        <div className="text-2xl mb-2">📡</div>
        <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">Waiting for GPS Lock</div>
        <div className="text-[10px] text-gray-600 mt-1">Vehicle must be outdoors with clear sky view</div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden mb-3">
      <div style={{ height: "250px", width: "100%", background: "#0e1117" }}>
        <MapContainer 
          center={[latitude, longitude]} 
          zoom={14} 
          style={{ height: "100%" }} 
          zoomControl={false} 
          attributionControl={false}
        >
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
          <RecenterView lat={latitude} lng={longitude} />
          <Polyline positions={[[latitude, longitude]]} pathOptions={{ color: "#00D4AA", weight: 3 }} />
          {truckIcon && <Marker position={[latitude, longitude]} icon={truckIcon} />}
        </MapContainer>
      </div>
      <div className="px-3 py-1.5 border-t border-gray-800 flex justify-between items-center bg-black/20 text-[10px]">
         <span className="text-gray-500 font-mono">{latitude.toFixed(4)}, {longitude.toFixed(4)}</span>
         <span className="text-green-500 font-bold uppercase tracking-widest">{vehicleState}</span>
      </div>
    </div>
  );
}
