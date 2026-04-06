"use client";

import React from "react";

export interface StatusAlertBarProps {
  vehicleState?: string;
  idleWaste?: boolean;
  harshBehavior?: boolean;
  readings?: Record<string, unknown> | null;
  dtcFlash?: boolean;
}

export default function StatusAlertBar({
  vehicleState = "Unknown",
  idleWaste = false,
  harshBehavior = false,
  readings,
  dtcFlash = false,
}: StatusAlertBarProps) {
  return (
    <div className="flex items-center gap-2 mb-3 flex-wrap">
      {/* State Badge */}
      <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
        vehicleState === "Engine On" ? "bg-green-600 text-white" :
        vehicleState === "Ignition On" ? "bg-yellow-600 text-white" :
        vehicleState === "Truck Off" ? "bg-gray-700 text-gray-300" :
        "bg-red-800 text-white"
      }`}>
        {vehicleState}
      </span>

      {/* Idle Waste Alert */}
      {idleWaste && (
        <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-orange-600/30 text-orange-300 border border-orange-600/50">
          IDLE WASTE
        </span>
      )}

      {/* Harsh Behavior Alert */}
      {harshBehavior && (
        <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-red-600/30 text-red-300 border border-red-600/50 animate-pulse">
          HARSH EVENT
        </span>
      )}

      {/* Lamp Indicator Badges — always visible when active */}
      {(readings?.malfunction_lamp as number) > 0 && (
        <span className="px-2 py-1 rounded-full text-xs font-bold bg-yellow-600 text-white animate-pulse shadow-lg shadow-yellow-600/30">
          CHECK ENGINE
        </span>
      )}
      {(readings?.amber_warning_lamp as number) > 0 && (
        <span className="px-2 py-1 rounded-full text-xs font-bold bg-amber-500 text-white animate-pulse shadow-lg shadow-amber-500/30">
          WARNING
        </span>
      )}
      {(readings?.red_stop_lamp as number) > 0 && (
        <span className="px-2 py-1 rounded-full text-xs font-bold bg-red-600 text-white animate-pulse shadow-lg shadow-red-600/30">
          STOP
        </span>
      )}
      {(readings?.protect_lamp as number) > 0 && (
        <span className="px-2 py-1 rounded-full text-xs font-bold bg-orange-500 text-white animate-pulse shadow-lg shadow-orange-500/30">
          PROTECT
        </span>
      )}

      {/* DTC flash alert — appears briefly when DTCs first appear */}
      {dtcFlash && (
        <span className="px-2 py-1 rounded-full text-xs font-bold bg-red-500 text-white animate-bounce shadow-lg shadow-red-500/50">
          NEW DTC DETECTED
        </span>
      )}
    </div>
  );
}
