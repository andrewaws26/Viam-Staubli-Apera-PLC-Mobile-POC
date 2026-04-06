"use client";

// ---------------------------------------------------------------------------
// BusStatsPanel — Connection/Protocol info, Pi System Health, Viam Data Sync
// ---------------------------------------------------------------------------

export interface BusStatsPanelProps {
  data: Record<string, unknown> | null;
  isOffline: boolean;
  protocol: string | undefined;
  pollCount: number;
}

export default function BusStatsPanel({ data, isOffline, protocol, pollCount }: BusStatsPanelProps) {
  const dataAge = data?._data_age_seconds as number | undefined;
  const vin = (data?.vehicle_vin ?? data?.vin) as string | undefined;
  const vehicleMake = data?.vehicle_make as string | undefined;
  const vehicleModel = data?.vehicle_model as string | undefined;
  const vehicleYear = data?.vehicle_year as number | undefined;
  const canBitrate = data?.can_bitrate as number | undefined;
  const framesPerSec = data?.frames_per_second as number | undefined;
  const busLoad = data?.bus_load_pct as number | undefined;

  return (
    <>
      {/* Connection & Protocol */}
      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
          Connection &amp; Protocol
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2">
          <KV
            label="Protocol"
            value={
              protocol
                ? protocol.toUpperCase()
                : isOffline
                  ? "Offline"
                  : "Detecting\u2026"
            }
          />
          <KV
            label="CAN Bitrate"
            value={canBitrate ? `${canBitrate / 1000}k` : "\u2014"}
          />
          <KV label="VIN" value={vin || "\u2014"} mono />
          {vehicleMake && (
            <KV
              label="Vehicle"
              value={`${vehicleYear || ""} ${vehicleMake} ${vehicleModel || ""}`.trim()}
            />
          )}
          <KV
            label="Frames/sec"
            value={framesPerSec !== undefined ? framesPerSec.toLocaleString() : "\u2014"}
          />
          <KV
            label="Bus Load"
            value={busLoad !== undefined ? `${busLoad.toFixed(1)}%` : "\u2014"}
          />
          <KV
            label="Data Age"
            value={
              dataAge !== undefined
                ? dataAge < 5
                  ? "live"
                  : `${Math.round(dataAge)}s`
                : "\u2014"
            }
          />
          <KV label="Poll #" value={String(pollCount)} />
        </div>
      </div>

      {/* Pi System Health */}
      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
          Pi System Health
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2">
          <KV
            label="CPU Temp"
            value={
              data?.cpu_temp_c != null
                ? `${(data.cpu_temp_c as number).toFixed(1)}\u00B0C / ${((data.cpu_temp_c as number) * 9 / 5 + 32).toFixed(0)}\u00B0F`
                : "\u2014"
            }
          />
          <KV
            label="CPU Usage"
            value={data?.cpu_usage_pct != null ? `${(data.cpu_usage_pct as number).toFixed(1)}%` : "\u2014"}
          />
          <KV
            label="RAM"
            value={
              data?.memory_used_mb != null && data?.memory_total_mb != null
                ? `${Math.round(data.memory_used_mb as number)}/${Math.round(data.memory_total_mb as number)} MB (${(data.memory_used_pct as number)?.toFixed(0) ?? "?"}%)`
                : "\u2014"
            }
          />
          <KV
            label="Disk Free"
            value={
              data?.disk_free_gb != null
                ? `${(data.disk_free_gb as number).toFixed(1)} GB (${(data.disk_used_pct as number)?.toFixed(0) ?? "?"}% used)`
                : "\u2014"
            }
          />
          <KV
            label="WiFi"
            value={
              data?.wifi_ssid
                ? `${data.wifi_ssid} (${data.wifi_signal_dbm != null ? `${Math.round(data.wifi_signal_dbm as number)} dBm` : "?"})`
                : "\u2014"
            }
          />
          <KV
            label="Tailscale"
            value={
              data?.tailscale_ip
                ? String(data.tailscale_ip)
                : data?.tailscale_online === false
                  ? "Offline"
                  : "\u2014"
            }
            mono
          />
          <KV
            label="Internet"
            value={
              data?.internet === true
                ? "Connected"
                : data?.internet === false
                  ? "No Internet"
                  : "\u2014"
            }
          />
          <KV
            label="Uptime"
            value={
              data?.uptime_seconds != null
                ? `${((data.uptime_seconds as number) / 3600).toFixed(1)}h`
                : "\u2014"
            }
          />
          <KV
            label="Load Avg"
            value={
              data?.load_1m != null
                ? `${(data.load_1m as number).toFixed(2)} / ${(data.load_5m as number)?.toFixed(2) ?? "?"}`
                : "\u2014"
            }
          />
        </div>
      </div>

      {/* Viam Data Sync */}
      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
          Viam Data Sync
          {data?.sync_ok === true && (
            <span className="ml-2 text-green-400 normal-case tracking-normal font-normal">
              &mdash; OK
            </span>
          )}
          {data?.sync_ok === false && (
            <span className="ml-2 text-red-400 normal-case tracking-normal font-normal">
              &mdash; BEHIND
            </span>
          )}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
          <KV
            label="Pending Files"
            value={data?.sync_pending_files != null ? String(data.sync_pending_files) : "\u2014"}
          />
          <KV
            label="Pending Size"
            value={data?.sync_pending_mb != null ? `${(data.sync_pending_mb as number).toFixed(2)} MB` : "\u2014"}
          />
          <KV
            label="Oldest File"
            value={
              data?.sync_oldest_age_min != null
                ? (data.sync_oldest_age_min as number) > 60
                  ? `${((data.sync_oldest_age_min as number) / 60).toFixed(1)}h`
                  : `${Math.round(data.sync_oldest_age_min as number)} min`
                : "\u2014"
            }
          />
          <KV
            label="Failed Files"
            value={data?.sync_failed_files != null ? String(data.sync_failed_files) : "\u2014"}
          />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// KV sub-component
// ---------------------------------------------------------------------------

export function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-[10px] text-gray-600 uppercase tracking-wide truncate">
        {label}
      </span>
      <span className={`text-xs sm:text-sm text-gray-300 truncate ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}
