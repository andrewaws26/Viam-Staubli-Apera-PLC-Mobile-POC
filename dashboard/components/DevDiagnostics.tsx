"use client";

/**
 * DevDiagnostics — Developer-only panel showing raw sensor errors,
 * out-of-range flags, and connection diagnostics.
 *
 * Rendered inline on the main dashboard when dev mode is active.
 * Only visible to users with the "developer" role.
 */

import { validateReadings, type RangeFlag } from "../lib/sensor-ranges";
import type { ComponentState, SensorReadings } from "../lib/types";

interface Props {
  components: ComponentState[];
  truckReadings: Record<string, unknown> | null;
  connectionStatus: string;
  connectionError: string | null;
}

export default function DevDiagnostics({ components, truckReadings, connectionStatus, connectionError }: Props) {
  // Validate PLC readings
  const plcComp = components.find((c) => c.id === "plc");
  const plcFlags = plcComp?.readings ? validateReadings(plcComp.readings as unknown as Record<string, unknown>) : [];

  // Validate truck readings
  const truckFlags = truckReadings ? validateReadings(truckReadings) : [];

  // Extract PLC diagnostic messages from readings
  const plcDiagnostics = plcComp?.readings?.diagnostics;
  let diagArray: { level: string; code?: string; message: string }[] = [];
  if (typeof plcDiagnostics === "string") {
    try { diagArray = JSON.parse(plcDiagnostics); } catch { /* not JSON */ }
  } else if (Array.isArray(plcDiagnostics)) {
    diagArray = plcDiagnostics as { level: string; code?: string; message: string }[];
  }

  const allFlags = [...plcFlags, ...truckFlags];
  const errorFlags = allFlags.filter((f) => f.level === "error");
  const warnFlags = allFlags.filter((f) => f.level === "warn");

  return (
    <div className="border border-amber-900/50 rounded-2xl bg-amber-950/10 overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-amber-900/30 flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500">Dev Diagnostics</span>
        {errorFlags.length > 0 && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-900/30 text-red-400">{errorFlags.length} ERROR</span>
        )}
        {warnFlags.length > 0 && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-900/30 text-yellow-400">{warnFlags.length} WARN</span>
        )}
        {allFlags.length === 0 && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-900/30 text-green-400">ALL OK</span>
        )}
        <a href="/dev" className="ml-auto text-[10px] text-amber-600 hover:text-amber-400 transition-colors">
          Full Dev Panel &rarr;
        </a>
      </div>

      <div className="px-4 sm:px-5 py-3 space-y-3">
        {/* ── Connection Status ── */}
        <Section title="Connection">
          <KV label="Status" value={connectionStatus} color={statusColor(connectionStatus)} />
          {connectionError && <KV label="Error" value={connectionError} color="text-red-400" />}
          {plcComp?.readings && (
            <>
              <KV label="PLC Connected" value={String(plcComp.readings.connected ?? "--")}
                color={plcComp.readings.connected ? "text-green-400" : "text-red-400"} />
              {plcComp.readings.last_fault && plcComp.readings.fault && (
                <KV label="Last Fault" value={String(plcComp.readings.last_fault)} color="text-red-400" />
              )}
              {typeof plcComp.readings.modbus_response_time_ms === "number" && (
                <KV label="Modbus Latency" value={`${(plcComp.readings.modbus_response_time_ms as number).toFixed(1)}ms`}
                  color={(plcComp.readings.modbus_response_time_ms as number) > 500 ? "text-yellow-400" : undefined} />
              )}
              {typeof plcComp.readings.connection_status === "string" && (
                <KV label="Link Quality" value={String(plcComp.readings.connection_status)}
                  color={plcComp.readings.connection_status === "healthy" ? "text-green-400" :
                    plcComp.readings.connection_status === "down" ? "text-red-400" : "text-yellow-400"} />
              )}
              {typeof plcComp.readings.total_errors === "number" && (plcComp.readings.total_errors as number) > 0 && (
                <KV label="Total Errors" value={`${plcComp.readings.total_errors} / ${plcComp.readings.total_reads ?? "?"} reads`}
                  color="text-yellow-400" />
              )}
            </>
          )}
          {truckReadings && (
            <>
              <KV label="CAN Bus" value={truckReadings._bus_connected ? "Connected" : "No bus"}
                color={truckReadings._bus_connected ? "text-green-400" : "text-red-400"} />
              {typeof truckReadings._frame_count === "number" && (
                <KV label="CAN Frames" value={String(truckReadings._frame_count)} />
              )}
              {typeof truckReadings._seconds_since_last_frame === "number" && (
                <KV label="Last Frame" value={`${(truckReadings._seconds_since_last_frame as number).toFixed(1)}s ago`}
                  color={(truckReadings._seconds_since_last_frame as number) > 5 ? "text-yellow-400" : undefined} />
              )}
            </>
          )}
        </Section>

        {/* ── Flagged Values ── */}
        {allFlags.length > 0 && (
          <Section title={`Flagged Values (${allFlags.length})`}>
            {allFlags.map((flag, i) => (
              <div key={`${flag.field}-${i}`} className="flex items-start gap-2">
                <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                  flag.level === "error" ? "bg-red-500" : "bg-yellow-500"
                }`} />
                <div className="min-w-0">
                  <span className="text-[10px] text-gray-400">{flag.label}: </span>
                  <span className={`text-[10px] font-mono ${flag.level === "error" ? "text-red-400" : "text-yellow-400"}`}>
                    {typeof flag.value === "number" ? flag.value.toFixed(1) : flag.value}
                  </span>
                  <p className="text-[10px] text-gray-600">{flag.reason}</p>
                </div>
              </div>
            ))}
          </Section>
        )}

        {/* ── PLC Diagnostics (from 19-rule engine) ── */}
        {diagArray.length > 0 && (
          <Section title={`PLC Diagnostics (${diagArray.length})`}>
            {diagArray.map((d, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                  d.level === "critical" ? "bg-red-500" : d.level === "warning" ? "bg-yellow-500" : "bg-blue-500"
                }`} />
                <div className="min-w-0">
                  {d.code && <span className="text-[10px] font-mono text-gray-500">{d.code} </span>}
                  <span className="text-[10px] text-gray-300">{d.message}</span>
                </div>
              </div>
            ))}
          </Section>
        )}

        {/* ── Hardware Health ── */}
        {plcComp?.readings && (
          <Section title="Hardware Health">
            <KV label="Encoder (DD1)" value={plcComp.readings.dd1_frozen ? "FROZEN" : "OK"}
              color={plcComp.readings.dd1_frozen ? "text-red-400" : "text-green-400"} />
            <KV label="PLC Counter (DS10)" value={plcComp.readings.ds10_frozen ? "FROZEN" : "OK"}
              color={plcComp.readings.ds10_frozen ? "text-red-400" : "text-green-400"} />
            {typeof plcComp.readings.encoder_noise === "number" && (
              <KV label="Encoder Noise" value={String(plcComp.readings.encoder_noise)}
                color={(plcComp.readings.encoder_noise as number) > 10 ? "text-yellow-400" : undefined} />
            )}
            {typeof plcComp.readings.total_link_flaps === "number" && (plcComp.readings.total_link_flaps as number) > 0 && (
              <KV label="Ethernet Link Flaps" value={String(plcComp.readings.total_link_flaps)} color="text-yellow-400" />
            )}
          </Section>
        )}

        {/* ── Truck DTCs ── */}
        {truckReadings && typeof truckReadings.active_dtc_count === "number" && (truckReadings.active_dtc_count as number) > 0 && (
          <Section title={`Active DTCs (${truckReadings.active_dtc_count})`}>
            {Array.from({ length: Math.min(truckReadings.active_dtc_count as number, 5) }).map((_, i) => {
              const spn = truckReadings[`dtc_${i}_spn`];
              const fmi = truckReadings[`dtc_${i}_fmi`];
              if (spn === undefined) return null;
              return (
                <KV key={i} label={`DTC ${i}`} value={`SPN ${spn} FMI ${fmi}`} color="text-red-400" />
              );
            })}
          </Section>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-1.5 border-b border-gray-800/30 pb-1">
        {title}
      </h4>
      <div className="space-y-1">
        {children}
      </div>
    </div>
  );
}

function KV({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[10px]">
      <span className="text-gray-500">{label}</span>
      <span className={`font-mono ${color ?? "text-gray-300"}`}>{value}</span>
    </div>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case "connected": return "text-green-400";
    case "stale": return "text-yellow-400";
    case "plc-disconnected": return "text-yellow-400";
    case "truck-off": return "text-gray-500";
    case "offline": return "text-red-400";
    default: return "text-gray-500";
  }
}
