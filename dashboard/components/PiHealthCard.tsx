"use client";

import React, { useState, useEffect, useCallback } from "react";

interface PiHealth {
  hostname: string;
  cpu_temp_c: number;
  cpu_usage_pct: number;
  memory_used_pct: number;
  memory_used_mb: number;
  memory_total_mb: number;
  disk_used_pct: number;
  disk_free_gb: number;
  uptime_hours: number;
  wifi_ssid: string;
  wifi_signal_dbm: number;
  tailscale_ip: string;
  tailscale_online: boolean;
  internet: boolean;
  load_1m: number;
  load_5m: number;
}

const HEALTH_POLL_MS = 5000;

function tempColor(c: number): string {
  if (c > 80) return "text-red-400";
  if (c > 70) return "text-yellow-400";
  return "text-green-400";
}

function usageColor(pct: number): string {
  if (pct > 90) return "text-red-400";
  if (pct > 75) return "text-yellow-400";
  return "text-green-400";
}

function signalColor(dbm: number): string {
  if (dbm > -50) return "text-green-400";
  if (dbm > -70) return "text-yellow-400";
  return "text-red-400";
}

function ProgressBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function barColor(pct: number): string {
  if (pct > 90) return "bg-red-500";
  if (pct > 75) return "bg-yellow-500";
  return "bg-green-500";
}

interface Props {
  label: string;
  icon: string;
  host: string;
  simMode?: boolean;
}

export default function PiHealthCard({ label, icon, host, simMode = false }: Props) {
  const [health, setHealth] = useState<PiHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    if (simMode) {
      const t = Date.now() / 1000;
      setHealth({
        hostname: label.includes("TPS") ? "viam-pi" : "truck-diagnostics",
        cpu_temp_c: 52 + Math.sin(t * 0.1) * 8 + Math.random() * 3,
        cpu_usage_pct: 15 + Math.sin(t * 0.05) * 10 + Math.random() * 5,
        memory_used_pct: label.includes("TPS") ? 35 + Math.random() * 5 : 62 + Math.random() * 5,
        memory_used_mb: label.includes("TPS") ? 2800 : 320,
        memory_total_mb: label.includes("TPS") ? 8192 : 512,
        disk_used_pct: 6,
        disk_free_gb: label.includes("TPS") ? 213 : 53,
        uptime_hours: 2.5 + (t % 3600) / 3600,
        wifi_ssid: label.includes("TPS") ? "BB-Shop" : "IronSight-Truck",
        wifi_signal_dbm: -45 + Math.random() * 15,
        tailscale_ip: label.includes("TPS") ? "100.112.68.52" : "100.113.196.68",
        tailscale_online: true,
        internet: true,
        load_1m: 0.3 + Math.random() * 0.4,
        load_5m: 0.25 + Math.random() * 0.2,
      });
      setError(null);
      return;
    }

    try {
      const res = await fetch(`/api/pi-health?host=${encodeURIComponent(host)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHealth(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Offline");
      setHealth(null);
    }
  }, [host, simMode, label]);

  useEffect(() => {
    fetchHealth();
    const id = setInterval(fetchHealth, HEALTH_POLL_MS);
    return () => clearInterval(id);
  }, [fetchHealth]);

  if (!health && !error) {
    return (
      <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-3">
        <div className="flex items-center gap-2 mb-2">
          <span>{icon}</span>
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{label}</span>
        </div>
        <p className="text-xs text-gray-600">Connecting...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gray-900/50 rounded-xl border border-red-800/30 p-3">
        <div className="flex items-center gap-2 mb-2">
          <span>{icon}</span>
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{label}</span>
          <div className="w-2 h-2 rounded-full bg-red-500 ml-auto" />
        </div>
        <p className="text-xs text-red-400">{error}</p>
      </div>
    );
  }

  const h = health!;
  const cpuTempF = ((h.cpu_temp_c ?? 0) * 9 / 5 + 32).toFixed(0);

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-3">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span>{icon}</span>
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{label}</span>
        <div className={`w-2 h-2 rounded-full ml-auto ${h.internet ? "bg-green-500" : "bg-red-500"}`} />
      </div>

      {/* CPU & Temp */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mb-2">
        <div>
          <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
            <span>CPU</span>
            <span className={usageColor(h.cpu_usage_pct ?? 0)}>{(h.cpu_usage_pct ?? 0).toFixed(0)}%</span>
          </div>
          <ProgressBar value={h.cpu_usage_pct ?? 0} color={barColor(h.cpu_usage_pct ?? 0)} />
        </div>
        <div>
          <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
            <span>Temp</span>
            <span className={tempColor(h.cpu_temp_c ?? 0)}>{cpuTempF}°F</span>
          </div>
          <ProgressBar value={h.cpu_temp_c ?? 0} max={100} color={barColor(h.cpu_temp_c ?? 0)} />
        </div>
        <div>
          <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
            <span>RAM</span>
            <span className={usageColor(h.memory_used_pct ?? 0)}>{(h.memory_used_pct ?? 0).toFixed(0)}%</span>
          </div>
          <ProgressBar value={h.memory_used_pct ?? 0} color={barColor(h.memory_used_pct ?? 0)} />
        </div>
        <div>
          <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
            <span>Disk</span>
            <span className={usageColor(h.disk_used_pct ?? 0)}>{h.disk_free_gb ?? 0}GB free</span>
          </div>
          <ProgressBar value={h.disk_used_pct ?? 0} color={barColor(h.disk_used_pct ?? 0)} />
        </div>
      </div>

      {/* Network */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
        <span className="text-gray-500">
          WiFi: <span className={signalColor(h.wifi_signal_dbm ?? 0)}>{h.wifi_ssid ?? 'N/A'} ({h.wifi_signal_dbm}dBm)</span>
        </span>
        <span className="text-gray-500">
          TS: <span className={h.tailscale_online ? "text-green-400" : "text-red-400"}>
            {h.tailscale_online ? h.tailscale_ip : "offline"}
          </span>
        </span>
        <span className="text-gray-500">
          Up: {(h.uptime_hours ?? 0).toFixed(1)}h
        </span>
        <span className="text-gray-500">
          Load: {(h.load_1m ?? 0).toFixed(1)}
        </span>
      </div>
    </div>
  );
}
