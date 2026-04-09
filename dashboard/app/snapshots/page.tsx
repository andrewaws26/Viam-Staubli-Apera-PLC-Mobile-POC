"use client";

import { useState, useEffect, useCallback } from "react";
import { formatValue } from "@/components/GaugeGrid";

// ── Types ────────────────────────────────────────────────────────────

interface SnapshotSummary {
  id: string;
  truck_id: string;
  truck_name: string;
  captured_at: string;
  created_at: string;
  created_by_name: string;
  label: string | null;
  notes: string | null;
  source: "live" | "historical";
  engine_rpm: number | null;
  vehicle_speed_mph: number | null;
  coolant_temp_f: number | null;
  battery_voltage_v: number | null;
  engine_hours: number | null;
  vehicle_distance_mi: number | null;
  vin: string | null;
  active_dtc_count: number | null;
}

interface SnapshotFull extends SnapshotSummary {
  reading_data: Record<string, unknown>;
}

// ── Field definitions (mirrors GaugeGrid categories) ─────────────────

interface Field { key: string; label: string }

const SECTIONS: { title: string; icon: string; fields: Field[] }[] = [
  { title: "Engine", icon: "\u2699\uFE0F", fields: [
    { key: "engine_rpm", label: "Engine RPM" }, { key: "engine_load_pct", label: "Engine Load" },
    { key: "accel_pedal_pos_pct", label: "Accelerator" }, { key: "driver_demand_torque_pct", label: "Demand Torque" },
    { key: "actual_engine_torque_pct", label: "Actual Torque" },
  ]},
  { title: "Temperatures", icon: "\uD83C\uDF21\uFE0F", fields: [
    { key: "coolant_temp_f", label: "Coolant" }, { key: "oil_temp_f", label: "Oil" },
    { key: "fuel_temp_f", label: "Fuel" }, { key: "intake_manifold_temp_f", label: "Intake" },
    { key: "trans_oil_temp_f", label: "Trans Oil" }, { key: "ambient_temp_f", label: "Ambient" },
  ]},
  { title: "Pressures", icon: "\uD83D\uDCCA", fields: [
    { key: "oil_pressure_psi", label: "Oil Pressure" }, { key: "fuel_pressure_psi", label: "Fuel" },
    { key: "boost_pressure_psi", label: "Boost" }, { key: "barometric_pressure_psi", label: "Baro" },
  ]},
  { title: "Vehicle", icon: "\uD83D\uDE98", fields: [
    { key: "vehicle_speed_mph", label: "Speed" }, { key: "current_gear", label: "Gear" },
    { key: "fuel_rate_gph", label: "Fuel Rate" }, { key: "fuel_economy_mpg", label: "Fuel Economy" },
    { key: "fuel_level_pct", label: "Fuel Level" }, { key: "battery_voltage_v", label: "Battery" },
  ]},
  { title: "Aftertreatment", icon: "\u2601\uFE0F", fields: [
    { key: "def_level_pct", label: "DEF Level" }, { key: "def_temp_f", label: "DEF Temp" },
    { key: "dpf_soot_load_pct", label: "DPF Soot Load" }, { key: "dpf_regen_status", label: "DPF Regen" },
    { key: "dpf_diff_pressure_psi", label: "DPF Diff Pressure" },
    { key: "protect_lamp_engine", label: "Protect (Engine)" }, { key: "protect_lamp_acm", label: "Protect (ACM)" },
  ]},
  { title: "Brakes & Safety", icon: "\uD83D\uDED1", fields: [
    { key: "brake_pedal_pos_pct", label: "Brake Pedal" }, { key: "abs_active", label: "ABS Active" },
    { key: "brake_air_pressure_psi", label: "Brake Air" },
  ]},
  { title: "PTO / Hydraulics", icon: "\uD83D\uDD27", fields: [
    { key: "retarder_torque_pct", label: "Retarder Torque" }, { key: "pto_engaged", label: "PTO Status" },
    { key: "pto_rpm", label: "PTO Speed" }, { key: "hydraulic_oil_temp_f", label: "Hydraulic Temp" },
    { key: "hydraulic_oil_pressure_psi", label: "Hydraulic Pressure" },
  ]},
  { title: "Idle / Trip / Service", icon: "\u23F1\uFE0F", fields: [
    { key: "idle_fuel_used_gal", label: "Idle Fuel Used" }, { key: "idle_engine_hours", label: "Idle Hours" },
    { key: "trip_fuel_gal", label: "Trip Fuel" }, { key: "service_distance_mi", label: "Next Service" },
  ]},
  { title: "Air / Wheel Speed", icon: "\uD83D\uDEDE\uFE0F", fields: [
    { key: "air_supply_pressure_psi", label: "Air Supply" },
    { key: "air_pressure_circuit1_psi", label: "Circuit 1" }, { key: "air_pressure_circuit2_psi", label: "Circuit 2" },
    { key: "front_axle_speed_mph", label: "Front Axle Speed" },
  ]},
  { title: "Navigation / GPS", icon: "\uD83D\uDCCD", fields: [
    { key: "gps_latitude", label: "Latitude" }, { key: "gps_longitude", label: "Longitude" },
    { key: "compass_bearing_deg", label: "Heading" }, { key: "altitude_ft", label: "Altitude" },
    { key: "nav_speed_mph", label: "GPS Speed" }, { key: "vehicle_pitch_deg", label: "Pitch" },
  ]},
  { title: "Extended Engine", icon: "\uD83D\uDD0C", fields: [
    { key: "exhaust_gas_pressure_psi", label: "Exhaust Pressure" },
    { key: "vehicle_distance_mi", label: "Odometer" }, { key: "vehicle_distance_hr_mi", label: "Odometer (HR)" },
    { key: "cruise_control_active", label: "Cruise" }, { key: "trans_output_rpm", label: "Trans Output RPM" },
  ]},
  { title: "Fuel Cost", icon: "\u26FD", fields: [
    { key: "fuel_cost_per_hour", label: "Burn Rate" }, { key: "fuel_cost_per_mile", label: "Cost/Mile" },
  ]},
  { title: "System Health", icon: "\uD83D\uDEA8", fields: [
    { key: "dpf_health", label: "DPF Filter" }, { key: "battery_health", label: "Battery" },
    { key: "def_low", label: "DEF Fluid Low" }, { key: "idle_pct", label: "Lifetime Idle %" },
    { key: "idle_fuel_pct", label: "Idle Fuel %" },
  ]},
  { title: "Lifetime / Identity", icon: "\uD83D\uDCC8", fields: [
    { key: "vin", label: "VIN" }, { key: "vehicle_vin", label: "VIN" },
    { key: "engine_hours", label: "Engine Hours" }, { key: "total_fuel_used_gal", label: "Total Fuel" },
    { key: "idle_fuel_used_gal", label: "Idle Fuel" }, { key: "idle_engine_hours", label: "Idle Hours" },
    { key: "vehicle_distance_mi", label: "Odometer" },
    { key: "prop_start_counter_a", label: "Start Count A" }, { key: "prop_start_counter_b", label: "Start Count B" },
  ]},
  { title: "Warning Lamps", icon: "\uD83D\uDEA6", fields: [
    { key: "mil_engine", label: "MIL Engine" }, { key: "amber_lamp_engine", label: "Amber Engine" },
    { key: "red_stop_lamp_engine", label: "Red Stop Engine" },
    { key: "mil_acm", label: "MIL ACM" }, { key: "amber_lamp_acm", label: "Amber ACM" },
    { key: "mil_trans", label: "MIL Trans" }, { key: "amber_lamp_trans", label: "Amber Trans" },
    { key: "mil_abs", label: "MIL ABS" }, { key: "amber_lamp_abs", label: "Amber ABS" },
  ]},
  { title: "DTC Summary", icon: "\u26A0\uFE0F", fields: [
    { key: "active_dtc_count", label: "Active DTCs" },
    { key: "dtc_engine_count", label: "Engine DTCs" }, { key: "dtc_trans_count", label: "Trans DTCs" },
    { key: "dtc_abs_count", label: "ABS DTCs" }, { key: "dtc_acm_count", label: "ACM DTCs" },
    { key: "prev_dtc_count", label: "Previous DTCs" },
  ]},
  { title: "Pi System", icon: "\uD83E\uDD16", fields: [
    { key: "cpu_temp_c", label: "CPU Temp" }, { key: "cpu_usage_pct", label: "CPU Usage" },
    { key: "memory_used_pct", label: "Memory Used" }, { key: "disk_used_pct", label: "Disk Used" },
    { key: "wifi_ssid", label: "WiFi SSID" }, { key: "wifi_signal_pct", label: "WiFi Signal" },
    { key: "tailscale_online", label: "Tailscale" }, { key: "internet", label: "Internet" },
    { key: "_bus_connected", label: "CAN Bus" }, { key: "_frame_count", label: "CAN Frames" },
  ]},
];

// ── Helpers ──────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit",
  });
}

// ── Snapshot Detail View ─────────────────────────────────────────────

function SnapshotDetail({ snapshot, onBack }: { snapshot: SnapshotFull; onBack: () => void }) {
  const data = snapshot.reading_data;
  const fieldCount = Object.keys(data).filter(k => !k.startsWith("_") || k === "_bus_connected" || k === "_frame_count").length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 no-print">
        <button onClick={onBack} className="text-sm text-gray-400 hover:text-white transition-colors">
          &larr; Back to list
        </button>
        <button onClick={() => window.print()} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-semibold transition-colors">
          Print / PDF
        </button>
      </div>

      {/* Title banner */}
      <div className="bg-gradient-to-r from-blue-900/40 to-purple-900/40 border border-blue-800/50 rounded-xl p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">{snapshot.truck_name || `Truck ${snapshot.truck_id}`}</h1>
            <p className="text-blue-300 text-sm mt-1">
              Digital Twin Snapshot &mdash; {fmtDate(snapshot.captured_at)}
            </p>
            {snapshot.label && <p className="text-yellow-300 font-semibold text-sm mt-1">{snapshot.label}</p>}
            {snapshot.notes && <p className="text-gray-400 text-sm mt-1">{snapshot.notes}</p>}
          </div>
          <div className="text-right text-xs text-gray-400 space-y-1">
            <p>{fieldCount} data points captured</p>
            <p>Source: {snapshot.source === "historical" ? "Historical" : "Live"}</p>
            <p>By: {snapshot.created_by_name}</p>
            {snapshot.vin && <p className="font-mono text-gray-300">{snapshot.vin}</p>}
          </div>
        </div>

        {/* Key metrics banner */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-blue-800/40">
          <KeyMetric label="Engine RPM" value={snapshot.engine_rpm != null ? `${Math.round(snapshot.engine_rpm)}` : "--"} />
          <KeyMetric label="Speed" value={snapshot.vehicle_speed_mph != null ? `${Math.round(snapshot.vehicle_speed_mph)} mph` : "--"} />
          <KeyMetric label="Coolant" value={snapshot.coolant_temp_f != null ? `${Math.round(snapshot.coolant_temp_f)}\u00B0F` : "--"} />
          <KeyMetric label="Battery" value={snapshot.battery_voltage_v != null ? `${snapshot.battery_voltage_v.toFixed(1)}V` : "--"} />
        </div>
      </div>

      {/* Data grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {SECTIONS.map((section) => {
          const available = section.fields.filter(f => data[f.key] !== undefined && data[f.key] !== null);
          if (available.length === 0) return null;
          return (
            <div key={section.title} className="bg-gray-900/50 rounded-xl p-4 border border-gray-800/50">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
                {section.icon} {section.title}
              </h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {available.map(f => (
                  <div key={f.key} className="flex justify-between items-baseline">
                    <span className="text-xs text-gray-500 truncate mr-2">{f.label}</span>
                    <span className="text-xs font-mono font-bold text-gray-100">
                      {formatValue(f.key, data[f.key])}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Raw data for DTCs */}
      {Object.keys(data).some(k => k.startsWith("dtc_0_")) && (
        <div className="mt-4 bg-gray-900/50 rounded-xl p-4 border border-gray-800/50">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
            \u26A0\uFE0F Active DTC Details
          </h3>
          <div className="space-y-1">
            {Array.from({ length: 20 }).map((_, i) => {
              const spn = data[`dtc_${i}_spn`];
              const fmi = data[`dtc_${i}_fmi`];
              if (spn === undefined) return null;
              return (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <span className="font-mono text-red-400">SPN {String(spn)} / FMI {String(fmi)}</span>
                  {data[`dtc_${i}_occurrence`] !== undefined && (
                    <span className="text-gray-500 text-xs">({String(data[`dtc_${i}_occurrence`])} occurrences)</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="text-center text-xs text-gray-600 mt-6 pt-4 border-t border-gray-800">
        IronSight Digital Twin Snapshot &mdash; Captured {fmtDate(snapshot.captured_at)} &mdash; {fieldCount} data points
      </div>
    </div>
  );
}

function KeyMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-lg font-bold text-white font-mono">{value}</p>
    </div>
  );
}

// ── Capture Form ─────────────────────────────────────────────────────

function CaptureForm({ onCapture, onCancel }: {
  onCapture: (snapshot: SnapshotSummary) => void;
  onCancel: () => void;
}) {
  const [truckId, setTruckId] = useState("01");
  const [mode, setMode] = useState<"live" | "historical">("historical");
  const [date, setDate] = useState("2026-04-08");
  const [time, setTime] = useState("15:30");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCapture() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, string> = { truck_id: truckId };
      if (mode === "historical") {
        body.timestamp = new Date(`${date}T${time}:00`).toISOString();
      }
      if (label) body.label = label;
      if (notes) body.notes = notes;

      const res = await fetch("/api/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const snapshot = await res.json();
      onCapture(snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to capture");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-lg">
      <h2 className="text-lg font-bold text-white mb-4">Capture Snapshot</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Truck ID</label>
          <input type="text" value={truckId} onChange={e => setTruckId(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
        </div>

        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wider mb-2">Source</label>
          <div className="flex gap-2">
            <button onClick={() => setMode("live")}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${mode === "live" ? "bg-green-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}>
              Live (Now)
            </button>
            <button onClick={() => setMode("historical")}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${mode === "historical" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}>
              Historical
            </button>
          </div>
        </div>

        {mode === "historical" && (
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Time</label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Label (optional)</label>
          <input type="text" value={label} onChange={e => setLabel(e.target.value)}
            placeholder="e.g. Test Run, Pre-Maintenance, Shift Start"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600" />
        </div>

        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Notes (optional)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            placeholder="Additional context..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 resize-none" />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button onClick={handleCapture} disabled={saving}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-semibold transition-colors">
            {saving ? "Capturing..." : "Capture Snapshot"}
          </button>
          <button onClick={onCancel}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-semibold transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

export default function SnapshotsPage() {
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFull, setSelectedFull] = useState<SnapshotFull | null>(null);
  const [showCapture, setShowCapture] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchList = useCallback(async () => {
    try {
      const res = await fetch("/api/snapshots");
      if (res.ok) setSnapshots(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);

  async function openSnapshot(id: string) {
    setSelectedId(id);
    setSelectedFull(null);
    try {
      const res = await fetch(`/api/snapshots/${id}`);
      if (res.ok) setSelectedFull(await res.json());
    } catch { /* ignore */ }
  }

  async function deleteSnapshot(id: string) {
    await fetch(`/api/snapshots/${id}`, { method: "DELETE" });
    setSnapshots(prev => prev.filter(s => s.id !== id));
    if (selectedId === id) { setSelectedId(null); setSelectedFull(null); }
  }

  // Detail view
  if (selectedFull) {
    return (
      <div className="min-h-screen bg-gray-950 text-white px-4 sm:px-6 py-6">
        <SnapshotDetail snapshot={selectedFull} onBack={() => { setSelectedId(null); setSelectedFull(null); }} />
      </div>
    );
  }

  // Loading detail
  if (selectedId) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-gray-500">Loading snapshot...</div>
      </div>
    );
  }

  // List + capture view
  return (
    <div className="min-h-screen bg-gray-950 text-white px-4 sm:px-6 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Digital Twin Snapshots</h1>
          <p className="text-sm text-gray-500 mt-1">Capture and review the complete state of any truck at any point in time</p>
        </div>
        <button onClick={() => setShowCapture(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold transition-colors">
          + Capture Snapshot
        </button>
      </div>

      {showCapture && (
        <div className="mb-6">
          <CaptureForm
            onCapture={(s) => { setSnapshots(prev => [s, ...prev]); setShowCapture(false); }}
            onCancel={() => setShowCapture(false)}
          />
        </div>
      )}

      {loading ? (
        <div className="text-gray-500 text-center py-20">Loading...</div>
      ) : snapshots.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-500 text-lg">No snapshots yet</p>
          <p className="text-gray-600 text-sm mt-2">
            Capture your first snapshot to see the complete state of a truck at a specific moment
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {snapshots.map(s => (
            <div key={s.id}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors cursor-pointer"
              onClick={() => openSnapshot(s.id)}
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">{s.truck_name || `Truck ${s.truck_id}`}</span>
                    {s.label && <span className="px-2 py-0.5 bg-yellow-900/40 text-yellow-300 text-xs font-semibold rounded-full">{s.label}</span>}
                    <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${s.source === "live" ? "bg-green-900/40 text-green-300" : "bg-blue-900/40 text-blue-300"}`}>
                      {s.source === "live" ? "Live" : "Historical"}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {fmtDate(s.captured_at)} &mdash; by {s.created_by_name}
                  </p>
                  {s.notes && <p className="text-xs text-gray-600 mt-1">{s.notes}</p>}
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-400">
                  {s.engine_rpm != null && <span>RPM: <b className="text-gray-200">{Math.round(s.engine_rpm)}</b></span>}
                  {s.vehicle_speed_mph != null && <span>Speed: <b className="text-gray-200">{Math.round(s.vehicle_speed_mph)} mph</b></span>}
                  {s.coolant_temp_f != null && <span>Coolant: <b className="text-gray-200">{Math.round(s.coolant_temp_f)}&deg;F</b></span>}
                  {s.battery_voltage_v != null && <span>Batt: <b className="text-gray-200">{s.battery_voltage_v.toFixed(1)}V</b></span>}
                  {(s.active_dtc_count ?? 0) > 0 && <span className="text-red-400">{s.active_dtc_count} DTCs</span>}
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSnapshot(s.id); }}
                    className="text-gray-600 hover:text-red-400 transition-colors ml-2"
                    title="Delete snapshot"
                  >
                    &times;
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
