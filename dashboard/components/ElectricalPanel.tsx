"use client";

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface FuseState { id: string; name: string; rating: number; blown: boolean; location: string; color: string }
interface VoltageRail { channel: string; label: string; nominal: number; value: number; unit: string }
interface CurrentSensor { label: string; circuit: string; value: number; fuseRating: number }
interface JunctionTemp { label: string; location: string; value: number; warn: number; crit: number }
interface TimelineEvent { time: string; message: string; severity: "critical" | "warning" | "info" }

// ---------------------------------------------------------------------------
// Sim data init (matches electrical-mockup exactly)
// ---------------------------------------------------------------------------
const j = () => (Math.random() - 0.5) * 2;

const INIT_FUSES: FuseState[] = [
  { id: "F1", name: "SERVO", rating: 30, blown: false, location: "Left panel, row 1, red blade", color: "red" },
  { id: "F2", name: "SERVO 2", rating: 30, blown: false, location: "Left panel, row 1, red blade", color: "red" },
  { id: "F3", name: "BELT", rating: 15, blown: false, location: "Left panel, row 2, blue blade", color: "blue" },
  { id: "F4", name: "MAIN STATION", rating: 20, blown: false, location: "Left panel, row 2, yellow blade", color: "yellow" },
  { id: "F5", name: "OP STATION", rating: 15, blown: false, location: "Left panel, row 3, blue blade", color: "blue" },
  { id: "F6", name: "VISION", rating: 15, blown: true, location: "Right panel, row 1, blue blade", color: "blue" },
  { id: "F7", name: "PLC", rating: 10, blown: false, location: "Right panel, row 1, red blade", color: "red" },
];

const INIT_VOLTAGES: VoltageRail[] = [
  { channel: "A0", label: "Main 24V Bus", nominal: 24, value: 24.1, unit: "V" },
  { channel: "A1", label: "Robot Supply", nominal: 24, value: 23.8, unit: "V" },
  { channel: "A2", label: "Vision Supply", nominal: 24, value: 0.0, unit: "V" },
  { channel: "A3", label: "PLC Supply", nominal: 24, value: 24.0, unit: "V" },
  { channel: "A4", label: "Pneumatic Supply", nominal: 24, value: 23.5, unit: "V" },
  { channel: "A5", label: "Truck Battery", nominal: 12, value: 13.85, unit: "V" },
  { channel: "A6", label: "Pi 5V Rail", nominal: 5, value: 5.02, unit: "V" },
  { channel: "A7", label: "Generator Output", nominal: 120, value: 121.3, unit: "V" },
];

const INIT_CURRENTS: CurrentSensor[] = [
  { label: "Robot 24V Field I/O", circuit: "F1 SERVO", value: 6.8, fuseRating: 30 },
  { label: "Vision + Cameras", circuit: "F6 VISION", value: 0.0, fuseRating: 15 },
];

const INIT_TEMPS: JunctionTemp[] = [
  { label: "CMD Center Cabinet", location: "Inside command center enclosure", value: 48.3, warn: 45, crit: 55 },
  { label: "Main Junction Box", location: "Floor-mounted pass-through", value: 34.1, warn: 50, crit: 65 },
  { label: "Cable Run (Exhaust)", location: "Near exhaust manifold", value: 42.7, warn: 55, crit: 70 },
  { label: "Generator Compartment", location: "Winco W6010DE bay", value: 38.5, warn: 50, crit: 65 },
  { label: "Ambient", location: "Outside truck bed", value: 28.2, warn: 40, crit: 50 },
];

const TIMELINE: TimelineEvent[] = [
  { time: "14:31:47", message: "Vision current spiked to 16.2A (F6 rated 15A)", severity: "warning" },
  { time: "14:31:49", message: "F6 (VISION) fuse blown — 0V on load side", severity: "critical" },
  { time: "14:31:50", message: "Apera Vue PC — ping timeout (192.168.3.151)", severity: "critical" },
  { time: "14:31:51", message: "Staubli CS9 reports: No trajectory available", severity: "warning" },
  { time: "14:32:03", message: "Watchdog: Vision System Offline — Blown Fuse F6", severity: "critical" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function vStatus(value: number, nominal: number): "ok" | "warn" | "crit" {
  if (value === 0) return "crit";
  const d = Math.abs(value - nominal) / nominal;
  return d > 0.2 ? "crit" : d > 0.1 ? "warn" : "ok";
}
function tStatus(val: number, warn: number, crit: number): "ok" | "warn" | "crit" {
  return val >= crit ? "crit" : val >= warn ? "warn" : "ok";
}
const sc = (s: "ok" | "warn" | "crit") => s === "crit" ? "text-red-400" : s === "warn" ? "text-orange-400" : "text-emerald-400";
const sb = (s: "ok" | "warn" | "crit") => s === "crit" ? "bg-red-950/30 border-red-900/50" : s === "warn" ? "bg-orange-950/30 border-orange-900/50" : "bg-gray-900/50 border-gray-800/50";
const cToF = (c: number) => c * 9 / 5 + 32;

function HwBanner({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 bg-amber-950/30 border border-amber-900/40 rounded-lg px-3 py-1.5 mb-3">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
      <span className="text-xs text-amber-400/80 font-medium">FUTURE INTEGRATION — Requires {text}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ElectricalPanel — inline dashboard component
// ---------------------------------------------------------------------------
export default function ElectricalPanel() {
  const [fuses] = useState<FuseState[]>(INIT_FUSES);
  const [voltages, setVoltages] = useState<VoltageRail[]>(INIT_VOLTAGES);
  const [currents, setCurrents] = useState<CurrentSensor[]>(INIT_CURRENTS);
  const [temps, setTemps] = useState<JunctionTemp[]>(INIT_TEMPS);

  const updateSim = useCallback(() => {
    setVoltages(p => p.map(r => ({
      ...r,
      value: r.label === "Vision Supply" ? 0.0 : +(r.value + j() * (r.nominal > 50 ? 0.3 : 0.05)).toFixed(2),
    })));
    setCurrents(p => p.map(s => ({
      ...s,
      value: s.label === "Vision Circuit" ? 0.0 : +(s.value + j() * 0.3).toFixed(1),
    })));
    setTemps(p => p.map(t => ({ ...t, value: +(t.value + j() * 0.3).toFixed(1) })));
  }, []);

  useEffect(() => {
    const iv = setInterval(updateSim, 2000);
    return () => clearInterval(iv);
  }, [updateSim]);

  const truckBatt = voltages.find(v => v.label === "Truck Battery")?.value ?? 12.8;
  const genOut = voltages.find(v => v.label === "Generator Output")?.value ?? 121;
  const mainBus = voltages.find(v => v.label === "Main 24V Bus")?.value ?? 24.1;

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.381z" clipRule="evenodd" />
          </svg>
          <h2 className="text-sm sm:text-base font-bold uppercase tracking-widest text-gray-300">
            Electrical Systems
          </h2>
        </div>
        <span className="text-xs font-bold uppercase tracking-wider text-amber-400 bg-amber-950/40 border border-amber-800/50 px-2.5 py-1 rounded-lg w-fit">
          FUTURE — $58 Hardware Upgrade
        </span>
      </div>

      {/* 1. Power Flow */}
      <section className="border border-gray-800 rounded-2xl p-4 sm:p-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 border-b border-gray-800/50 pb-1">Power Flow</h3>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-0">
          {/* Truck Battery */}
          <div className={`flex-1 p-3 rounded-xl border text-center ${sb(vStatus(truckBatt, 12))}`}>
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Truck Battery</div>
            <div className={`font-mono text-xl font-black ${sc(vStatus(truckBatt, 12))}`}>{truckBatt.toFixed(1)}V</div>
          </div>
          <div className="hidden sm:flex items-center px-2"><div className="w-8 h-px bg-gray-700" /><span className="text-gray-600 text-lg">&rarr;</span><div className="w-8 h-px bg-gray-700" /></div>
          <div className="flex sm:hidden items-center justify-center py-1"><span className="text-gray-600 text-lg">&darr;</span></div>
          {/* Generator — no telemetry */}
          <div className="flex-1 p-3 rounded-xl border bg-gray-900/50 border-gray-800/50 text-center relative">
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Generator</div>
            <div className={`font-mono text-xl font-black ${sc(vStatus(genOut, 120))}`}>{genOut.toFixed(0)}VAC</div>
            <span className="absolute top-1.5 right-1.5 text-[9px] font-bold uppercase tracking-wider text-red-400 bg-red-950/50 border border-red-900/40 px-1.5 py-0.5 rounded">NO TELEMETRY</span>
          </div>
          <div className="hidden sm:flex items-center px-2"><div className="w-8 h-px bg-gray-700" /><span className="text-gray-600 text-lg">&rarr;</span><div className="w-8 h-px bg-gray-700" /></div>
          <div className="flex sm:hidden items-center justify-center py-1"><span className="text-gray-600 text-lg">&darr;</span></div>
          {/* RHINO PSU */}
          <div className={`flex-1 p-3 rounded-xl border text-center ${sb(vStatus(mainBus, 24))}`}>
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">RHINO 24V PSU</div>
            <div className={`font-mono text-xl font-black ${sc(vStatus(mainBus, 24))}`}>{mainBus.toFixed(1)}V</div>
          </div>
          <div className="hidden sm:flex items-center px-2"><div className="w-8 h-px bg-gray-700" /><span className="text-gray-600 text-lg">&rarr;</span><div className="w-8 h-px bg-gray-700" /></div>
          <div className="flex sm:hidden items-center justify-center py-1"><span className="text-gray-600 text-lg">&darr;</span></div>
          {/* Distribution */}
          <div className="flex-1 p-3 rounded-xl border bg-gray-900/50 border-gray-800/50 text-center">
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Fuse Distribution</div>
            <div className="font-mono text-xl font-black text-gray-300">{fuses.filter(f => !f.blown).length}/{fuses.length}</div>
            <div className="text-xs text-gray-600">fuses OK</div>
          </div>
        </div>
      </section>

      {/* 2. Fuse Status */}
      <section className="border border-gray-800 rounded-2xl p-4 sm:p-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 border-b border-gray-800/50 pb-1">Fuse Status</h3>
        <HwBanner text="3x MCP23017 GPIO Expander ($9) + 48x PC817 Optoisolator ($7.50)" />
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {fuses.map(f => (
            <div key={f.id} className={`p-3 rounded-xl border transition-all ${f.blown ? "bg-red-950/40 border-red-800/60 shadow-[0_0_20px_rgba(239,68,68,0.15)]" : "bg-gray-900/50 border-gray-800/50"}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{f.id}</span>
                <div className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${f.blown ? "bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]" : "bg-emerald-500"}`} />
                  <span className={`text-xs font-bold uppercase ${f.blown ? "text-red-400" : "text-emerald-400"}`}>{f.blown ? "BLOWN" : "OK"}</span>
                </div>
              </div>
              <div className="text-sm font-semibold text-gray-200 mb-1">{f.name}</div>
              <div className="text-xs text-gray-500 font-mono">{f.rating}A {f.color}</div>
              <div className="text-xs text-gray-600 mt-1.5 leading-snug">{f.location}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 3. Voltage Rails */}
      <section className="border border-gray-800 rounded-2xl p-4 sm:p-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 border-b border-gray-800/50 pb-1">Voltage Rails — 2x ADS1115</h3>
        <HwBanner text="2x ADS1115 16-bit ADC ($12)" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {voltages.map(r => {
            const s = vStatus(r.value, r.nominal);
            const pct = r.nominal > 0 ? Math.min((r.value / (r.nominal * 1.3)) * 100, 100) : 0;
            const bar = s === "crit" ? "bg-red-500" : s === "warn" ? "bg-orange-500" : "bg-emerald-500";
            return (
              <div key={r.channel} className={`p-3 rounded-xl border ${sb(s)}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-gray-500 font-mono shrink-0">{r.channel}</span>
                    <span className="text-xs text-gray-400 uppercase tracking-wide truncate">{r.label}</span>
                  </div>
                  <div className="flex items-baseline gap-1 shrink-0">
                    <span className={`font-mono text-sm font-bold ${sc(s)}`}>{r.value.toFixed(1)}</span>
                    <span className="text-xs text-gray-600">{r.unit}</span>
                  </div>
                </div>
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-700 ${bar}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-xs text-gray-600">0</span>
                  <span className="text-xs text-gray-600 font-mono">{r.nominal}{r.unit} nom</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 4. Current Monitoring */}
      <section className="border border-gray-800 rounded-2xl p-4 sm:p-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 border-b border-gray-800/50 pb-1">Current Monitoring — 2x INA219</h3>
        <HwBanner text="2x INA219 Current Sensor ($8)" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {currents.map(s => {
            const pct = s.fuseRating > 0 ? (s.value / s.fuseRating) * 100 : 0;
            const isZero = s.value < 0.01;
            const isDanger = pct > 80;
            const isWarn = pct > 60;
            const bar = isZero ? "bg-gray-700" : isDanger ? "bg-red-500" : isWarn ? "bg-orange-500" : "bg-emerald-500";
            const txt = isZero ? "text-red-400" : isDanger ? "text-red-400" : isWarn ? "text-orange-400" : "text-emerald-400";
            return (
              <div key={s.label} className={`p-4 rounded-xl border ${isZero ? "bg-red-950/20 border-red-900/40" : isDanger ? "bg-orange-950/20 border-orange-900/40" : "bg-gray-900/50 border-gray-800/50"}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-400 uppercase tracking-widest font-bold">{s.label}</span>
                  <span className="text-xs text-gray-600 font-mono">{s.circuit}</span>
                </div>
                <div className="flex items-baseline gap-2 mb-3">
                  <span className={`font-mono text-3xl font-black ${txt}`}>{s.value.toFixed(1)}</span>
                  <span className="text-sm text-gray-500">A</span>
                  {isZero && <span className="text-xs font-bold text-red-400 bg-red-950/50 border border-red-900/50 px-2 py-0.5 rounded uppercase tracking-wider animate-pulse">No Current</span>}
                </div>
                <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden mb-1">
                  <div className={`h-full rounded-full transition-all duration-700 ${bar}`} style={{ width: `${Math.max(pct, 0.5)}%` }} />
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-gray-600">0A</span>
                  <span className={`text-xs font-mono ${pct > 80 ? "text-orange-400" : "text-gray-500"}`}>{pct.toFixed(0)}% of {s.fuseRating}A fuse</span>
                  <span className="text-xs text-gray-600 font-mono">{s.fuseRating}A</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 5. Junction Temperatures */}
      <section className="border border-gray-800 rounded-2xl p-4 sm:p-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 border-b border-gray-800/50 pb-1">Junction Temperatures — DS18B20 Chain</h3>
        <HwBanner text="5x DS18B20 Temp Probe ($10)" />
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {temps.map(t => {
            const s = tStatus(t.value, t.warn, t.crit);
            const f = cToF(t.value);
            const pct = Math.min((t.value / t.crit) * 100, 100);
            const bar = s === "crit" ? "bg-red-500" : s === "warn" ? "bg-orange-500" : "bg-emerald-500";
            return (
              <div key={t.label} className={`p-3 rounded-xl border ${sb(s)}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-400 uppercase tracking-wide font-bold truncate">{t.label}</span>
                  <span className={`font-mono text-sm font-bold ${sc(s)}`}>{f.toFixed(0)}&deg;F</span>
                </div>
                <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden mb-1">
                  <div className={`h-full rounded-full transition-all duration-500 ${bar}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs text-gray-600 leading-tight">{t.location}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* 6 + 7: Diagnosis + Timeline side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Quick Diagnosis */}
        <section className="border border-red-900/50 rounded-2xl bg-red-950/10 p-4 sm:p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-red-400">Auto-Diagnosis</h3>
          </div>
          <div className="bg-gray-950/80 border border-gray-800 rounded-xl p-4 font-mono text-xs leading-relaxed space-y-2">
            <div className="text-red-400 font-bold text-sm mb-3">VISION SYSTEM OFFLINE</div>
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <span className="text-gray-500">Power:</span>
              <span className="text-red-400">F6 (VISION, 15A) = BLOWN</span>
              <span className="text-gray-500">Voltage:</span>
              <span className="text-red-400">Vision rail = 0.0V (was 24.1V)</span>
              <span className="text-gray-500">Current:</span>
              <span className="text-red-400">Vision circuit = 0.0A (was 3.2A)</span>
              <span className="text-gray-500">Upstream:</span>
              <span className="text-emerald-400">Main 24V bus = {mainBus.toFixed(1)}V &#10003;</span>
              <span className="text-gray-500">Cabinet:</span>
              <span className="text-orange-400">{cToF(temps[0]?.value ?? 48).toFixed(0)}&deg;F — approaching URPS threshold</span>
            </div>
            <div className="border-t border-gray-800 pt-2 mt-3">
              <div className="text-gray-400 mb-1">
                <span className="text-gray-500">Diagnosis: </span>
                Fuse F6 blew due to overcurrent. Vision PC + cameras lost power.
              </div>
              <div className="text-emerald-400">
                <span className="text-gray-500">Action: </span>
                Replace F6 (blue 15A, right panel row 1). Investigate why current exceeded 15A.
              </div>
            </div>
          </div>
        </section>

        {/* Event Correlation Timeline */}
        <section className="border border-gray-800 rounded-2xl p-4 sm:p-5">
          <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 border-b border-gray-800/50 pb-1">Event Correlation Timeline</h3>
          <div className="space-y-0">
            {TIMELINE.map((evt, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${evt.severity === "critical" ? "bg-red-500" : evt.severity === "warning" ? "bg-orange-500" : "bg-blue-500"}`} />
                  {i < TIMELINE.length - 1 && <div className="w-px flex-1 bg-gray-800 my-1" />}
                </div>
                <div className="pb-4 min-w-0">
                  <span className="font-mono text-xs text-gray-500">{evt.time}</span>
                  <p className={`text-xs leading-relaxed mt-0.5 ${evt.severity === "critical" ? "text-red-400" : evt.severity === "warning" ? "text-orange-400" : "text-gray-400"}`}>
                    {evt.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Total hardware cost footer */}
      <div className="text-center">
        <p className="text-xs text-gray-700">
          Hardware: MCP23017 (fuses) + 2x ADS1115 (voltages) + 2x INA219 (current) + 5x DS18B20 (temps) — $58 total — 3 GPIO pins on Pi 5
        </p>
      </div>
    </div>
  );
}
