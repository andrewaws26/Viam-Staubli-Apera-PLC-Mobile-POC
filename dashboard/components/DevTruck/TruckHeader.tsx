"use client";

import React from "react";

type VehicleMode = "truck" | "car";

export interface TruckHeaderProps {
  vehicleMode: VehicleMode;
  setVehicleMode: (mode: VehicleMode) => void;
  readings?: Record<string, unknown> | null;
  busConnected?: boolean;
  connected?: boolean;
  frameCount?: number;
  error?: string | null;
  historyVins?: string[];
  selectedHistoryVin?: string;
  setSelectedHistoryVin?: (vin: string) => void;
}

export default function TruckHeader({
  vehicleMode,
  setVehicleMode,
  readings,
  busConnected = false,
  connected = false,
  frameCount = 0,
  error = null,
  historyVins = [],
  selectedHistoryVin = "",
  setSelectedHistoryVin,
}: TruckHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3 sm:mb-4">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-lg sm:text-xl">{vehicleMode === "truck" ? "\u{1F69B}" : "\u{1F697}"}</span>
        <div className="min-w-0">
          <h3 className="text-sm sm:text-lg font-black tracking-widest uppercase text-gray-100 truncate">
            {vehicleMode === "truck" ? "Truck Diagnostics" : "Vehicle Diagnostics"}
          </h3>
          <p className="text-xs sm:text-xs text-gray-500 truncate">
            {vehicleMode === "truck" ? "J1939 CAN Bus — Heavy Duty" : "OBD-II CAN Bus — Live Data"}
          </p>
          {readings?.vehicle_vin && String(readings.vehicle_vin) !== "UNKNOWN" && String(readings.vehicle_vin) !== "0" ? (
            <p className="text-xs sm:text-xs text-blue-400 font-mono tracking-wider truncate">
              VIN: {String(readings.vehicle_vin)}
            </p>
          ) : readings?.vehicle_vin === "UNKNOWN" ? (
            <p className="text-xs sm:text-xs text-gray-500 italic">VIN: Unknown</p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
        {/* Vehicle history VIN selector */}
        {historyVins.length > 1 && setSelectedHistoryVin && (
          <select
            value={selectedHistoryVin}
            onChange={(e) => setSelectedHistoryVin(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-300 text-xs sm:text-xs rounded px-1.5 py-2 min-h-[44px] focus:outline-none focus:border-blue-500"
            title="Filter history by vehicle"
          >
            <option value="">All Vehicles</option>
            {historyVins.map((v) => (
              <option key={v} value={v}>
                {v.length === 17 ? `...${v.slice(-6)}` : v}
              </option>
            ))}
          </select>
        )}
        {/* Vehicle mode toggle */}
        <div className="flex rounded-lg overflow-hidden border border-gray-700">
          <button
            onClick={() => setVehicleMode("truck")}
            className={`px-2 sm:px-3 py-2 min-h-[44px] text-xs sm:text-xs font-bold uppercase tracking-wider transition-colors ${
              vehicleMode === "truck"
                ? "bg-blue-600 text-white"
                : "bg-gray-800 text-gray-500 hover:text-gray-300"
            }`}
          >
            <span className="hidden sm:inline">Semi-</span>Truck
          </button>
          <button
            onClick={() => setVehicleMode("car")}
            className={`px-2 sm:px-3 py-2 min-h-[44px] text-xs sm:text-xs font-bold uppercase tracking-wider transition-colors ${
              vehicleMode === "car"
                ? "bg-green-600 text-white"
                : "bg-gray-800 text-gray-500 hover:text-gray-300"
            }`}
          >
            <span className="hidden sm:inline">Passenger</span><span className="sm:hidden">Car</span>
          </button>
        </div>
        {/* Connection status */}
        <div className="flex items-center gap-1.5">
          <div
            className={`w-2 h-2 rounded-full shrink-0 ${
              busConnected
                ? "bg-green-500"
                : connected
                ? "bg-yellow-500"
                : "bg-red-500"
            }`}
          />
          <span className="text-xs text-gray-500 whitespace-nowrap">
            {busConnected
              ? `CAN OK (${frameCount} frames)`
              : connected
              ? "CAN bus down"
              : error || "Disconnected"}
          </span>
        </div>
      </div>
    </div>
  );
}
