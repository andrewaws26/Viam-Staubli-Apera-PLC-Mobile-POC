// CellSection.tsx — Self-contained orchestrator for robot cell monitoring.
// Polls /api/cell-readings, distributes data to StaubliPanel, AperaPanel,
// and CellWatchdog. Follows the same self-polling pattern as TruckPanel.
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import StaubliPanel from "./StaubliPanel";
import AperaPanel from "./AperaPanel";
import CellWatchdog from "./CellWatchdog";
import InfraPanel from "./InfraPanel";
import type { CellState } from "./CellTypes";

const CELL_POLL_MS = 2000;

interface Props {
  simMode?: boolean;
  truckId?: string;
}

export default function CellSection({ simMode = false, truckId }: Props) {
  // Sim mode is only allowed for truck "00" (the demo truck)
  const effectiveSimMode = truckId === "00" ? simMode : false;

  const [data, setData] = useState<CellState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [hasCell, setHasCell] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        sim: effectiveSimMode ? "true" : "false",
      });
      if (truckId) params.set("truck", truckId);

      const res = await fetch(`/api/cell-readings?${params}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();

      // API returns _no_cell when the truck has no cell-monitor configured
      if (json._no_cell) {
        setData(null);
        setConnected(false);
        setHasCell(false);
        setError(json._offline ? "Cell offline" : null);
        return;
      }

      setData(json as CellState);
      setConnected(true);
      setHasCell(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cell poll failed");
      setConnected(false);
    }
  }, [effectiveSimMode, truckId]);

  useEffect(() => {
    // Reset state when truck changes
    setData(null);
    setConnected(false);
    setHasCell(true);
    setError(null);

    poll();
    timerRef.current = setInterval(poll, CELL_POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [poll]);

  // Don't render the cell section at all for trucks with no cell
  if (!hasCell && !error) return null;

  return (
    <div className="space-y-2 sm:space-y-4">
      {/* Section header */}
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
          connected ? "bg-green-500" : error ? "bg-red-500" : "bg-gray-600"
        }`} />
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400">
          Robot Cell Monitoring
        </h2>
        {effectiveSimMode && (
          <span className="px-2 py-0.5 rounded text-xs font-bold bg-purple-900/30 text-purple-400 border border-purple-800/50">
            SIM
          </span>
        )}
      </div>

      {/* Watchdog first — alerts at the top */}
      <CellWatchdog
        staubli={data?.staubli ?? null}
        apera={data?.apera ?? null}
        network={data?.network ?? []}
        internet={data?.internet ?? null}
        switchVpn={data?.switchVpn ?? null}
        piHealth={data?.piHealth ?? null}
      />

      {/* Staubli + Apera side-by-side on large screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-4">
        <StaubliPanel readings={data?.staubli ?? null} pollError={error} />
        <AperaPanel readings={data?.apera ?? null} pollError={!data?.staubli ? null : error} />
      </div>

      {/* Infrastructure monitoring — internet, switch/VPN, Pi health */}
      <InfraPanel
        internet={data?.internet ?? null}
        switchVpn={data?.switchVpn ?? null}
        piHealth={data?.piHealth ?? null}
      />

      {/* Network status strip */}
      {data?.network && data.network.length > 0 && (
        <div className="border border-gray-800 rounded-2xl p-4 sm:p-5">
          <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">
            Cell Network
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {[...data.network].sort((a, b) => a.name.localeCompare(b.name)).map((dev) => (
              <div key={dev.ip} className={`flex items-center gap-2 p-2 rounded-lg border ${
                dev.reachable
                  ? "bg-gray-900/30 border-gray-800/50"
                  : "bg-red-950/20 border-red-900/40"
              }`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  dev.reachable ? "bg-green-500" : "bg-red-500 animate-pulse"
                }`} />
                <div className="min-w-0">
                  <div className="text-xs text-gray-300 truncate">{dev.name}</div>
                  <div className="text-xs text-gray-500 font-mono">{dev.ip}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
