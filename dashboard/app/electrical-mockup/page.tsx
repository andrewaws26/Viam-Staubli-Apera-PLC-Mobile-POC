// Electrical Monitoring Mockup — Preview of the full hardware-enabled electrical
// monitoring dashboard. Shows fuse status, voltage rails, current draw, junction
// temps, auto-diagnosis, and cross-system event correlation.
//
// This is a DEMO page with simulated live data. No hardware connection needed.
"use client";

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Simulated data with jitter
// ---------------------------------------------------------------------------

const j = () => (Math.random() - 0.5) * 2;

interface FuseState {
  id: string;
  name: string;
  rating: number;
  blown: boolean;
  location: string;
  color: string;
}

interface VoltageRail {
  channel: string;
  label: string;
  nominal: number;
  value: number;
  unit: string;
}

interface CurrentSensor {
  label: string;
  circuit: string;
  value: number;
  fuseRating: number;
}

interface JunctionTemp {
  label: string;
  location: string;
  value: number;
  warn: number;
  crit: number;
}

interface TimelineEvent {
  time: string;
  message: string;
  severity: "critical" | "warning" | "info";
}

function initFuses(): FuseState[] {
  return [
    { id: "F1", name: "SERVO", rating: 30, blown: false, location: "Left panel, row 1, red blade", color: "red" },
    { id: "F2", name: "SERVO 2", rating: 30, blown: false, location: "Left panel, row 1, red blade", color: "red" },
    { id: "F3", name: "BELT", rating: 15, blown: false, location: "Left panel, row 2, blue blade", color: "blue" },
    { id: "F4", name: "MAIN STATION", rating: 20, blown: false, location: "Left panel, row 2, yellow blade", color: "yellow" },
    { id: "F5", name: "OP STATION", rating: 15, blown: true, location: "Left panel, row 3, blue blade", color: "blue" },
    { id: "F6", name: "VISION", rating: 15, blown: false, location: "Right panel, row 1, blue blade", color: "blue" },
    { id: "F7", name: "PLC", rating: 10, blown: false, location: "Right panel, row 1, red blade", color: "red" },
  ];
}

function initVoltages(): VoltageRail[] {
  return [
    { channel: "A0", label: "Main 24V Bus", nominal: 24, value: 24.1, unit: "V" },
    { channel: "A1", label: "Robot Supply", nominal: 24, value: 23.8, unit: "V" },
    { channel: "A2", label: "Vision Supply", nominal: 24, value: 0.0, unit: "V" },
    { channel: "A3", label: "PLC Supply", nominal: 24, value: 24.0, unit: "V" },
    { channel: "A4", label: "Pneumatic Supply", nominal: 24, value: 23.5, unit: "V" },
    { channel: "A5", label: "Truck Battery", nominal: 12, value: 12.8, unit: "V" },
    { channel: "A6", label: "Pi 5V Rail", nominal: 5, value: 5.02, unit: "V" },
    { channel: "A7", label: "Generator Output", nominal: 120, value: 121.3, unit: "V" },
  ];
}

function initCurrents(): CurrentSensor[] {
  return [
    { label: "Robot Circuit", circuit: "F1 SERVO", value: 15.2, fuseRating: 30 },
    { label: "Vision Circuit", circuit: "F6 VISION", value: 0.0, fuseRating: 15 },
  ];
}

function initTemps(): JunctionTemp[] {
  return [
    { label: "CMD Center Cabinet", location: "Inside command center enclosure", value: 48.3, warn: 45, crit: 55 },
    { label: "Main Junction Box", location: "Floor-mounted pass-through", value: 34.1, warn: 50, crit: 65 },
    { label: "Cable Run (Exhaust)", location: "Near exhaust manifold", value: 42.7, warn: 55, crit: 70 },
    { label: "Generator Compartment", location: "Winco W6010DE bay", value: 38.5, warn: 50, crit: 65 },
    { label: "Ambient", location: "Outside truck bed", value: 28.2, warn: 40, crit: 50 },
  ];
}

const TIMELINE: TimelineEvent[] = [
  { time: "14:31:47", message: "Vision current spiked to 16.2A (F5 rated 15A)", severity: "warning" },
  { time: "14:31:49", message: "F5 (OP STATION) fuse blown \u2014 0V on load side", severity: "critical" },
  { time: "14:31:50", message: "Apera Vue PC \u2014 ping timeout (192.168.3.151)", severity: "critical" },
  { time: "14:31:51", message: "Staubli CS9 reports: No trajectory available", severity: "warning" },
  { time: "14:32:03", message: "Watchdog: Vision System Offline \u2014 Blown Fuse F5", severity: "critical" },
];

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

function voltageStatus(value: number, nominal: number): "ok" | "warn" | "crit" {
  if (value === 0) return "crit";
  const pctDev = Math.abs(value - nominal) / nominal;
  if (pctDev > 0.2) return "crit";
  if (pctDev > 0.1) return "warn";
  return "ok";
}

function statusColor(s: "ok" | "warn" | "crit") {
  return s === "crit" ? "text-red-400" : s === "warn" ? "text-orange-400" : "text-emerald-400";
}

function statusBg(s: "ok" | "warn" | "crit") {
  return s === "crit"
    ? "bg-red-950/30 border-red-900/50"
    : s === "warn"
    ? "bg-orange-950/30 border-orange-900/50"
    : "bg-gray-900/50 border-gray-800/50";
}

function tempStatus(val: number, warn: number, crit: number): "ok" | "warn" | "crit" {
  if (val >= crit) return "crit";
  if (val >= warn) return "warn";
  return "ok";
}

const cToF = (c: number) => c * 9 / 5 + 32;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 border-b border-gray-800/50 pb-1">
      {children}
    </h3>
  );
}

function FuseCard({ fuse }: { fuse: FuseState }) {
  return (
    <div className={`p-3 rounded-xl border transition-all ${
      fuse.blown
        ? "bg-red-950/40 border-red-800/60 shadow-[0_0_20px_rgba(239,68,68,0.15)]"
        : "bg-gray-900/50 border-gray-800/50"
    }`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{fuse.id}</span>
        <div className="flex items-center gap-1.5">
          <span className={`w-2.5 h-2.5 rounded-full ${
            fuse.blown ? "bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]" : "bg-emerald-500"
          }`} />
          <span className={`text-xs font-bold uppercase ${fuse.blown ? "text-red-400" : "text-emerald-400"}`}>
            {fuse.blown ? "BLOWN" : "OK"}
          </span>
        </div>
      </div>
      <div className="text-sm font-semibold text-gray-200 mb-1">{fuse.name}</div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 font-mono">{fuse.rating}A {fuse.color}</span>
      </div>
      <div className="text-xs text-gray-600 mt-1.5 leading-snug">{fuse.location}</div>
    </div>
  );
}

function VoltageBar({ rail }: { rail: VoltageRail }) {
  const s = voltageStatus(rail.value, rail.nominal);
  const pct = rail.nominal > 0 ? Math.min((rail.value / (rail.nominal * 1.3)) * 100, 100) : 0;
  const barColor = s === "crit" ? "bg-red-500" : s === "warn" ? "bg-orange-500" : "bg-emerald-500";

  return (
    <div className={`p-3 rounded-xl border ${statusBg(s)}`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-gray-500 font-mono shrink-0">{rail.channel}</span>
          <span className="text-xs text-gray-400 uppercase tracking-wide truncate">{rail.label}</span>
        </div>
        <div className="flex items-baseline gap-1 shrink-0">
          <span className={`font-mono text-sm font-bold ${statusColor(s)}`}>
            {rail.value.toFixed(1)}
          </span>
          <span className="text-xs text-gray-600">{rail.unit}</span>
        </div>
      </div>
      <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-xs text-gray-600">0</span>
        <span className="text-xs text-gray-600 font-mono">{rail.nominal}{rail.unit} nom</span>
      </div>
    </div>
  );
}

function CurrentGauge({ sensor }: { sensor: CurrentSensor }) {
  const pct = sensor.fuseRating > 0 ? (sensor.value / sensor.fuseRating) * 100 : 0;
  const isZero = sensor.value < 0.01;
  const isDanger = pct > 80;
  const isWarn = pct > 60;

  const barColor = isZero ? "bg-gray-700" : isDanger ? "bg-red-500" : isWarn ? "bg-orange-500" : "bg-emerald-500";
  const textColor = isZero ? "text-red-400" : isDanger ? "text-red-400" : isWarn ? "text-orange-400" : "text-emerald-400";

  return (
    <div className={`p-4 rounded-xl border ${
      isZero
        ? "bg-red-950/20 border-red-900/40"
        : isDanger
        ? "bg-orange-950/20 border-orange-900/40"
        : "bg-gray-900/50 border-gray-800/50"
    }`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400 uppercase tracking-widest font-bold">{sensor.label}</span>
        <span className="text-xs text-gray-600 font-mono">{sensor.circuit}</span>
      </div>
      <div className="flex items-baseline gap-2 mb-3">
        <span className={`font-mono text-3xl font-black ${textColor}`}>
          {sensor.value.toFixed(1)}
        </span>
        <span className="text-sm text-gray-500">A</span>
        {isZero && (
          <span className="text-xs font-bold text-red-400 bg-red-950/50 border border-red-900/50 px-2 py-0.5 rounded uppercase tracking-wider animate-pulse">
            No Current
          </span>
        )}
      </div>
      <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden mb-1">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor}`}
          style={{ width: `${Math.max(pct, 0.5)}%` }}
        />
      </div>
      <div className="flex justify-between">
        <span className="text-xs text-gray-600">0A</span>
        <span className={`text-xs font-mono ${pct > 80 ? "text-orange-400" : "text-gray-500"}`}>
          {pct.toFixed(0)}% of {sensor.fuseRating}A fuse
        </span>
        <span className="text-xs text-gray-600 font-mono">{sensor.fuseRating}A</span>
      </div>
    </div>
  );
}

function TempCard({ temp }: { temp: JunctionTemp }) {
  const s = tempStatus(temp.value, temp.warn, temp.crit);
  const f = cToF(temp.value);
  const pct = Math.min((temp.value / temp.crit) * 100, 100);
  const barColor = s === "crit" ? "bg-red-500" : s === "warn" ? "bg-orange-500" : "bg-emerald-500";

  return (
    <div className={`p-3 rounded-xl border ${statusBg(s)}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400 uppercase tracking-wide font-bold truncate">{temp.label}</span>
        <span className={`font-mono text-sm font-bold ${statusColor(s)}`}>{f.toFixed(0)}&deg;F</span>
      </div>
      <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden mb-1">
        <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-600 leading-tight">{temp.location}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ElectricalMockup() {
  const [fuses, setFuses] = useState(initFuses);
  const [voltages, setVoltages] = useState(initVoltages);
  const [currents, setCurrents] = useState(initCurrents);
  const [temps, setTemps] = useState(initTemps);
  const [tick, setTick] = useState(0);

  // Jitter simulation — update every 2 seconds
  const updateSim = useCallback(() => {
    setVoltages((prev) =>
      prev.map((r) => ({
        ...r,
        value: r.label === "Vision Supply"
          ? 0.0 // blown fuse
          : +(r.value + j() * (r.nominal > 50 ? 0.5 : 0.1)).toFixed(2),
      }))
    );
    setCurrents((prev) =>
      prev.map((s) => ({
        ...s,
        value: s.label === "Vision Circuit"
          ? 0.0
          : +(s.value + j() * 0.3).toFixed(1),
      }))
    );
    setTemps((prev) =>
      prev.map((t) => ({
        ...t,
        value: +(t.value + j() * 0.3).toFixed(1),
      }))
    );
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    const interval = setInterval(updateSim, 2000);
    return () => clearInterval(interval);
  }, [updateSim]);

  // Power flow values
  const truckBatt = voltages.find((v) => v.label === "Truck Battery")?.value ?? 12.8;
  const genOut = voltages.find((v) => v.label === "Generator Output")?.value ?? 121;
  const mainBus = voltages.find((v) => v.label === "Main 24V Bus")?.value ?? 24.1;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Mockup banner */}
      <div className="bg-amber-900/30 border-b border-amber-800/50 px-4 py-2 text-center">
        <span className="text-xs font-bold uppercase tracking-widest text-amber-400">
          Electrical Monitoring Mockup &mdash; Hardware Not Yet Installed
        </span>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Page header */}
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
          <h1 className="text-sm sm:text-base font-bold uppercase tracking-widest text-gray-300">
            Electrical Systems &mdash; RAIV 3
          </h1>
          <span className="text-xs text-gray-600 font-mono ml-auto">Live sim &middot; tick {tick}</span>
        </div>

        {/* ================================================================ */}
        {/* 1. Power Flow Overview */}
        {/* ================================================================ */}
        <section className="border border-gray-800 rounded-2xl overflow-hidden">
          <div className="p-4 sm:p-5">
            <SectionHeader>Power Flow</SectionHeader>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-0">
              {/* Truck Battery */}
              <div className={`flex-1 p-3 rounded-xl border text-center ${statusBg(voltageStatus(truckBatt, 12))}`}>
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Truck Battery</div>
                <div className={`font-mono text-xl font-black ${statusColor(voltageStatus(truckBatt, 12))}`}>
                  {truckBatt.toFixed(1)}V
                </div>
              </div>
              <div className="hidden sm:flex items-center px-2">
                <div className="w-8 h-px bg-gray-700" />
                <span className="text-gray-600 text-lg">&rarr;</span>
                <div className="w-8 h-px bg-gray-700" />
              </div>
              <div className="flex sm:hidden items-center justify-center py-1">
                <span className="text-gray-600 text-lg">&darr;</span>
              </div>
              {/* Inverter */}
              <div className={`flex-1 p-3 rounded-xl border text-center ${statusBg(voltageStatus(genOut, 120))}`}>
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">3000W Inverter</div>
                <div className={`font-mono text-xl font-black ${statusColor(voltageStatus(genOut, 120))}`}>
                  {genOut.toFixed(0)}VAC
                </div>
              </div>
              <div className="hidden sm:flex items-center px-2">
                <div className="w-8 h-px bg-gray-700" />
                <span className="text-gray-600 text-lg">&rarr;</span>
                <div className="w-8 h-px bg-gray-700" />
              </div>
              <div className="flex sm:hidden items-center justify-center py-1">
                <span className="text-gray-600 text-lg">&darr;</span>
              </div>
              {/* RHINO PSU */}
              <div className={`flex-1 p-3 rounded-xl border text-center ${statusBg(voltageStatus(mainBus, 24))}`}>
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">RHINO 24V PSU</div>
                <div className={`font-mono text-xl font-black ${statusColor(voltageStatus(mainBus, 24))}`}>
                  {mainBus.toFixed(1)}V
                </div>
              </div>
              <div className="hidden sm:flex items-center px-2">
                <div className="w-8 h-px bg-gray-700" />
                <span className="text-gray-600 text-lg">&rarr;</span>
                <div className="w-8 h-px bg-gray-700" />
              </div>
              <div className="flex sm:hidden items-center justify-center py-1">
                <span className="text-gray-600 text-lg">&darr;</span>
              </div>
              {/* Distribution */}
              <div className="flex-1 p-3 rounded-xl border bg-gray-900/50 border-gray-800/50 text-center">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Fuse Distribution</div>
                <div className="font-mono text-xl font-black text-gray-300">
                  {fuses.filter((f) => !f.blown).length}/{fuses.length}
                </div>
                <div className="text-xs text-gray-600">fuses OK</div>
              </div>
            </div>
          </div>
        </section>

        {/* ================================================================ */}
        {/* 2. Fuse Status Panel */}
        {/* ================================================================ */}
        <section className="border border-gray-800 rounded-2xl overflow-hidden p-4 sm:p-5">
          <SectionHeader>Fuse Status</SectionHeader>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {fuses.map((f) => (
              <FuseCard key={f.id} fuse={f} />
            ))}
          </div>
        </section>

        {/* ================================================================ */}
        {/* 3. Voltage Rails */}
        {/* ================================================================ */}
        <section className="border border-gray-800 rounded-2xl overflow-hidden p-4 sm:p-5">
          <SectionHeader>Voltage Rails &mdash; 2x ADS1115</SectionHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {voltages.map((v) => (
              <VoltageBar key={v.channel} rail={v} />
            ))}
          </div>
        </section>

        {/* ================================================================ */}
        {/* 4. Current Monitoring */}
        {/* ================================================================ */}
        <section className="border border-gray-800 rounded-2xl overflow-hidden p-4 sm:p-5">
          <SectionHeader>Current Monitoring &mdash; 2x INA219</SectionHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {currents.map((c) => (
              <CurrentGauge key={c.label} sensor={c} />
            ))}
          </div>
        </section>

        {/* ================================================================ */}
        {/* 5. Junction Temperatures */}
        {/* ================================================================ */}
        <section className="border border-gray-800 rounded-2xl overflow-hidden p-4 sm:p-5">
          <SectionHeader>Junction Temperatures &mdash; DS18B20 Chain</SectionHeader>
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {temps.map((t) => (
              <TempCard key={t.label} temp={t} />
            ))}
          </div>
        </section>

        {/* Two-column layout for diagnosis + timeline */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ================================================================ */}
          {/* 6. Quick Diagnosis Card */}
          {/* ================================================================ */}
          <section className="border border-red-900/50 rounded-2xl overflow-hidden bg-red-950/10">
            <div className="p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <h3 className="text-xs font-bold uppercase tracking-widest text-red-400">
                  Auto-Diagnosis
                </h3>
              </div>

              <div className="bg-gray-950/80 border border-gray-800 rounded-xl p-4 font-mono text-xs leading-relaxed space-y-2">
                <div className="text-red-400 font-bold text-sm mb-3">VISION SYSTEM OFFLINE</div>

                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                  <span className="text-gray-500">Power:</span>
                  <span className="text-red-400">F5 (OP STATION, 15A) = BLOWN</span>

                  <span className="text-gray-500">Voltage:</span>
                  <span className="text-red-400">Vision rail = 0.0V (was 24.1V)</span>

                  <span className="text-gray-500">Current:</span>
                  <span className="text-red-400">Vision circuit = 0.0A (was 3.2A)</span>

                  <span className="text-gray-500">Upstream:</span>
                  <span className="text-emerald-400">Main 24V bus = {mainBus.toFixed(1)}V &check;</span>

                  <span className="text-gray-500">Cabinet:</span>
                  <span className="text-orange-400">{cToF(temps[0]?.value ?? 48).toFixed(0)}&deg;F &mdash; approaching URPS threshold</span>
                </div>

                <div className="border-t border-gray-800 pt-2 mt-3">
                  <div className="text-gray-400 mb-1">
                    <span className="text-gray-500">Diagnosis: </span>
                    Fuse F5 blew due to overcurrent. Vision PC lost power.
                  </div>
                  <div className="text-emerald-400">
                    <span className="text-gray-500">Action: </span>
                    Replace F5 (blue 15A, left panel row 3). Investigate why current exceeded 15A.
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ================================================================ */}
          {/* 7. Cross-System Correlation Timeline */}
          {/* ================================================================ */}
          <section className="border border-gray-800 rounded-2xl overflow-hidden">
            <div className="p-4 sm:p-5">
              <SectionHeader>Event Correlation Timeline</SectionHeader>
              <div className="space-y-0">
                {TIMELINE.map((evt, i) => (
                  <div key={i} className="flex gap-3 group">
                    {/* Timeline spine */}
                    <div className="flex flex-col items-center">
                      <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${
                        evt.severity === "critical" ? "bg-red-500" : evt.severity === "warning" ? "bg-orange-500" : "bg-blue-500"
                      }`} />
                      {i < TIMELINE.length - 1 && <div className="w-px flex-1 bg-gray-800 my-1" />}
                    </div>
                    {/* Event content */}
                    <div className="pb-4 min-w-0">
                      <span className="font-mono text-xs text-gray-500">{evt.time}</span>
                      <p className={`text-xs leading-relaxed mt-0.5 ${
                        evt.severity === "critical" ? "text-red-400" : evt.severity === "warning" ? "text-orange-400" : "text-gray-400"
                      }`}>
                        {evt.message}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

        </div>

        {/* Footer info */}
        <div className="text-center pb-8">
          <p className="text-xs text-gray-700">
            Hardware: MCP23017 (fuses) + 2x ADS1115 (voltages) + 2x INA219 (current) + 5x DS18B20 (temps) &mdash; $45 total &mdash; 3 GPIO pins on Pi 5
          </p>
        </div>
      </div>
    </div>
  );
}
