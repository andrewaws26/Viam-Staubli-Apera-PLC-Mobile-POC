"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMap } from "react-leaflet";
import L from "leaflet";

// Camera control helper
function RecenterView({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    if (map) map.setView([lat, lng]);
  }, [lat, lng, map]);
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- props typed loosely for dynamic sensor data
export default function TruckMap({ latitude, longitude, vehicleState }: any) {
  const [mounted, setMounted] = useState(false);
  const [truckIcon, setTruckIcon] = useState<L.DivIcon | null>(null);
  const [trail, setTrail] = useState<[number, number][]>([]);

  useEffect(() => {
    setMounted(true);
    
    // Truck Icon with a shadow for depth
    const icon = L.divIcon({
      html: '<div style="font-size: 28px; filter: drop-shadow(0px 3px 3px rgba(0,0,0,0.3));">🚛</div>',
      className: "custom-truck-marker",
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    setTruckIcon(icon);

    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
  }, []);

  // Update trail history
  useEffect(() => {
    if (latitude && longitude && latitude !== 0) {
      setTrail(prev => [...prev, [latitude, longitude] as [number, number]].slice(-100));
    }
  }, [latitude, longitude]);

  if (!mounted) return null;

  if (!latitude || !longitude || latitude === 0) {
    return (
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 sm:p-8 mb-3 text-center">
        <div className="text-2xl mb-2">📡</div>
        <div className="text-xs font-bold text-gray-500 uppercase tracking-widest">Waiting for GPS Lock</div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-300 rounded-lg overflow-hidden mb-3 shadow-sm">
      <div className="h-[200px] sm:h-[300px] w-full" style={{ background: "#f8f9fa" }}>
        <MapContainer 
          center={[latitude, longitude]} 
          zoom={15} 
          style={{ height: "100%" }} 
          zoomControl={true} 
          attributionControl={false}
        >
          {/* Switched to Carto Voyager: Much brighter and easier to read */}
          <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
          
          <RecenterView lat={latitude} lng={longitude} />
          
          {/* Bright Blue Trail for high visibility */}
          {trail.length > 1 && (
            <Polyline positions={trail} pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.7 }} />
          )}
          
          {truckIcon && <Marker position={[latitude, longitude]} icon={truckIcon} />}
        </MapContainer>
      </div>
      <div className="px-3 py-2 border-t border-gray-200 flex flex-wrap justify-between items-center gap-1 bg-gray-50">
         <span className="text-xs text-gray-500 font-mono font-bold">{latitude.toFixed(5)}, {longitude.toFixed(5)}</span>
         <div className="flex items-center gap-2">
           <span className="text-xs text-gray-400 uppercase font-bold tracking-tighter">Status:</span>
           <span className="text-xs text-blue-600 font-black uppercase">{vehicleState}</span>
         </div>
      </div>
    </div>
  );
}
