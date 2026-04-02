"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip } from "react-leaflet";

interface RoutePoint {
  lat: number;
  lon: number;
  t: string;
}

interface Stop {
  lat: number;
  lon: number;
  t: string;
  durationMin: number;
}

interface Props {
  points: RoutePoint[];
  stops: Stop[];
  startLocation: { lat: number; lon: number } | null;
  endLocation: { lat: number; lon: number } | null;
}

function fmtTimeET(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York",
  });
}

export default function ShiftRouteMap({ points, stops, startLocation, endLocation }: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
  }, []);

  if (!mounted) return null;

  const routePositions: [number, number][] = points.map((p) => [p.lat, p.lon]);
  if (routePositions.length === 0) return null;

  // Compute center from all points
  const avgLat = routePositions.reduce((s, p) => s + p[0], 0) / routePositions.length;
  const avgLon = routePositions.reduce((s, p) => s + p[1], 0) / routePositions.length;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden print-card">
      <div className="h-[200px] sm:h-[300px] w-full">
        <MapContainer
          center={[avgLat, avgLon]}
          zoom={13}
          style={{ height: "100%", width: "100%" }}
          zoomControl={true}
          attributionControl={false}
        >
          <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />

          {/* Route line */}
          <Polyline positions={routePositions} pathOptions={{ color: "#2563eb", weight: 3, opacity: 0.9 }} />

          {/* Start marker */}
          {startLocation && (
            <CircleMarker
              center={[startLocation.lat, startLocation.lon]}
              radius={8}
              pathOptions={{ color: "#22c55e", fillColor: "#22c55e", fillOpacity: 1, weight: 2 }}
            >
              <Tooltip permanent direction="top" offset={[0, -10]}>
                <span style={{ fontWeight: "bold", fontSize: "11px" }}>START</span>
              </Tooltip>
            </CircleMarker>
          )}

          {/* End marker */}
          {endLocation && (
            <CircleMarker
              center={[endLocation.lat, endLocation.lon]}
              radius={8}
              pathOptions={{ color: "#ef4444", fillColor: "#ef4444", fillOpacity: 1, weight: 2 }}
            >
              <Tooltip permanent direction="top" offset={[0, -10]}>
                <span style={{ fontWeight: "bold", fontSize: "11px" }}>END</span>
              </Tooltip>
            </CircleMarker>
          )}

          {/* Stop markers */}
          {stops.map((stop, i) => (
            stop.lat !== 0 && stop.lon !== 0 && (
              <CircleMarker
                key={i}
                center={[stop.lat, stop.lon]}
                radius={6}
                pathOptions={{ color: "#f59e0b", fillColor: "#f59e0b", fillOpacity: 0.8, weight: 2 }}
              >
                <Tooltip direction="top" offset={[0, -8]}>
                  <span style={{ fontSize: "11px" }}>Stopped {stop.durationMin} min at {fmtTimeET(stop.t)}</span>
                </Tooltip>
              </CircleMarker>
            )
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
