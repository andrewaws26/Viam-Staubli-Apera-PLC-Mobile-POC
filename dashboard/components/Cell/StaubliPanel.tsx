// StaubliPanel.tsx — Robot health, position, temperatures, safety, and
// production metrics from the Staubli TX2-140 CS9 controller.
// Data source: Pi 5 polls REST API + FTP log parsing, pushes to Viam.
"use client";

import { useState } from "react";
import type { StaubliReadings } from "./CellTypes";
import { TEMP_THRESHOLDS, tempColor, tempBg } from "./CellTypes";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KV({ label, value, color, mono }: { label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-xs text-gray-500 uppercase tracking-wide truncate">{label}</span>
      <span className={`text-xs sm:text-sm truncate ${mono ? "font-mono" : ""} ${color || "text-gray-300"}`}>{value}</span>
    </div>
  );
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${ok ? "bg-green-500" : "bg-red-500"}`} />
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  );
}

function TempGauge({ label, value, warn, crit }: { label: string; value: number; warn: number; crit: number }) {
  const pct = Math.min((value / crit) * 100, 100);
  const barColor = value >= crit ? "bg-red-500" : value >= warn ? "bg-orange-500" : "bg-emerald-500";
  const fahrenheit = value * 9 / 5 + 32;
  return (
    <div className={`p-2.5 rounded-lg border ${tempBg(value, warn, crit)}`}>
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-xs text-gray-500 uppercase tracking-wide">{label}</span>
        <span className={`font-mono text-sm font-bold ${tempColor(value, warn, crit)}`}>
          {fahrenheit.toFixed(0)}°F
        </span>
      </div>
      <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function PositionBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider ${
      active ? "bg-emerald-900/40 text-emerald-400 border border-emerald-800/50" : "bg-gray-900/30 text-gray-700 border border-gray-800/30"
    }`}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// I/O Point Labels — map raw VAL3 variable keys to human-readable names
// ---------------------------------------------------------------------------

const IO_INPUT_LABELS: Record<string, string> = {
  // Terminal 1 — Servo control
  servo_enable: "Servo Enable Button",
  servo_disable1: "E-Stop 1 (Cell)",
  servo_disable2: "E-Stop 2 (Panel)",
  servo_doorswitch: "Safety Gate Interlock",
  servo_disable_remote: "PLC Remote Disable",
  // Terminal 2 — Operator buttons
  btn_tps_cycle: "Start / Cycle Button",
  btn_abort: "Abort / Stow Button",
  btn_clearpose: "Clear Position Button",
  btn_warmup: "Warmup Select",
  opt_speed: "Hi/Low Speed Toggle",
  opt_belt_fwd: "Belt Jog Forward",
  opt_belt_rev: "Belt Jog Reverse",
  opt_gripper_lock: "Gripper Lock Toggle",
  // Terminal 3 — Gripper feedback
  gripper_on: "Gripper Magnetized",
  gripper_off: "Gripper Released",
  gripper_alarm: "Gripper Alarm",
  gripper_busy: "Gripper Cycling",
  gripper_status: "Gripper Status",
  gripper_malfunction: "Gripper Malfunction",
  gripper_part_detect: "Part Detected (Magnet)",
};

const IO_OUTPUT_LABELS: Record<string, string> = {
  // Indicator lamps
  lamp_ispowered: "Power On Lamp",
  lamp_warmup: "Warmup Lamp",
  lamp_servoenabled: "Servo Enabled Lamp",
  lamp_servodisabled: "Servo Disabled Lamp",
  lamp_servodisabled1: "E-Stop 1 Lamp",
  lamp_servodisabled2: "E-Stop 2 Lamp",
  lamp_cycle: "Cycle Active Lamp",
  lamp_abort: "Abort Lamp",
  lamp_slowspeed: "Slow Speed Lamp",
  lamp_clearpose: "Clear Position Lamp",
  lamp_gripperlocked: "Gripper Locked Lamp",
  // Belt commands
  belt_fwd: "Belt Conveyor Forward",
  belt_rev: "Belt Conveyor Reverse",
  // Gripper commands
  gripper_enable: "Gripper Controller Enable",
  gripper_mag: "Magnetize Command",
  gripper_demag: "Demagnetize Command",
  gripper_de_mag: "Demagnetize Command",
  // Safety status lamps
  safety_none: "Safety OK (Green)",
  safety_waiting: "Safety Restart Needed",
  safety_ss1: "Safety Stop 1 Active",
  safety_ss2: "Safety Stop 2 Active",
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface Props {
  readings: StaubliReadings | null;
  pollError?: string | null;
}

export default function StaubliPanel({ readings, pollError }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [showJoints, setShowJoints] = useState(false);
  const [showExtTemps, setShowExtTemps] = useState(true);
  const [showIO, setShowIO] = useState(true);

  const isConnected = readings?.connected ?? false;
  const r = readings;

  return (
    <section className="border border-gray-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full p-4 sm:p-5 flex items-center justify-between gap-3 text-left hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
            isConnected && !pollError ? "bg-green-500" : pollError ? "bg-red-500" : "bg-gray-600"
          }`} />
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400">
            Staubli TX2-140 &mdash; Robot Controller
          </h2>
        </div>
        <span className="text-gray-500 text-xs shrink-0">{expanded ? "\u25B2" : "\u25BC"}</span>
      </button>

      {expanded && (
        <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-5">
          {pollError && (
            <div className="p-3 bg-red-950/30 border border-red-900/50 rounded-lg text-xs text-red-400">
              {pollError}
            </div>
          )}

          {!r ? (
            <p className="text-xs text-gray-700 animate-pulse">Waiting for robot connection&hellip;</p>
          ) : (
            <>
              {/* ---- Safety Status ---- */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2 border-b border-gray-800/50 pb-1">
                  Safety
                </h3>
                <div className="flex flex-wrap gap-3">
                  <StatusDot ok={!r.stop1_active} label={r.stop1_active ? "STOP 1 ACTIVE" : "Stop 1 OK"} />
                  <StatusDot ok={!r.stop2_active} label={r.stop2_active ? "STOP 2 ACTIVE" : "Stop 2 OK"} />
                  <StatusDot ok={!r.door_open} label={r.door_open ? "DOOR OPEN" : "Door Closed"} />
                  <StatusDot ok={r.trajectory_found} label={r.trajectory_found ? "Trajectory OK" : "No Trajectory"} />
                </div>
              </div>

              {/* ---- Motor Temperatures ---- */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2 border-b border-gray-800/50 pb-1">
                  Motor Temperatures
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <TempGauge label="J1" value={r.temp_j1} warn={TEMP_THRESHOLDS.motor_warn} crit={TEMP_THRESHOLDS.motor_crit} />
                  <TempGauge label="J2" value={r.temp_j2} warn={TEMP_THRESHOLDS.motor_warn} crit={TEMP_THRESHOLDS.motor_crit} />
                  <TempGauge label="J3" value={r.temp_j3} warn={TEMP_THRESHOLDS.motor_warn} crit={TEMP_THRESHOLDS.motor_crit} />
                  <TempGauge label="J4" value={r.temp_j4} warn={TEMP_THRESHOLDS.motor_warn} crit={TEMP_THRESHOLDS.motor_crit} />
                  <TempGauge label="J5" value={r.temp_j5} warn={TEMP_THRESHOLDS.motor_warn} crit={TEMP_THRESHOLDS.motor_crit} />
                  <TempGauge label="J6" value={r.temp_j6} warn={TEMP_THRESHOLDS.motor_warn} crit={TEMP_THRESHOLDS.motor_crit} />
                  <TempGauge label="DSI" value={r.temp_dsi} warn={TEMP_THRESHOLDS.dsi_warn} crit={TEMP_THRESHOLDS.dsi_crit} />
                </div>
              </div>

              {/* ---- Extended Temperatures (Collapsed) ---- */}
              <div>
                <button
                  onClick={() => setShowExtTemps(!showExtTemps)}
                  className="w-full text-left text-xs font-bold uppercase tracking-widest text-gray-500 mb-2 border-b border-gray-800/50 pb-1 hover:text-gray-400 transition-colors"
                >
                  {showExtTemps ? "\u25BC" : "\u25B6"} Extended Temperatures ({showExtTemps ? "hide" : "show"})
                </button>
                {showExtTemps && (
                  <div className="space-y-3">
                    <div>
                      <span className="text-xs text-gray-600 uppercase tracking-wide">Encoder</span>
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-1">
                        {[1,2,3,4,5,6].map(i => (
                          <TempGauge key={`enc${i}`} label={`J${i}`} value={(r as any)[`temp_encoder_j${i}`] || 0} warn={TEMP_THRESHOLDS.encoder_warn} crit={TEMP_THRESHOLDS.encoder_crit} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <span className="text-xs text-gray-600 uppercase tracking-wide">Drive Case</span>
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-1">
                        {[1,2,3,4,5,6].map(i => (
                          <TempGauge key={`dc${i}`} label={`J${i}`} value={(r as any)[`temp_drive_case_j${i}`] || 0} warn={TEMP_THRESHOLDS.drive_case_warn} crit={TEMP_THRESHOLDS.drive_case_crit} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <span className="text-xs text-gray-600 uppercase tracking-wide">Motor Winding</span>
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-1">
                        {[1,2,3,4,5,6].map(i => (
                          <TempGauge key={`mw${i}`} label={`J${i}`} value={(r as any)[`temp_winding_j${i}`] || 0} warn={TEMP_THRESHOLDS.winding_warn} crit={TEMP_THRESHOLDS.winding_crit} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <span className="text-xs text-gray-600 uppercase tracking-wide">Drive Junction</span>
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-1">
                        {[1,2,3,4,5,6].map(i => (
                          <TempGauge key={`dj${i}`} label={`J${i}`} value={(r as any)[`temp_junction_j${i}`] || 0} warn={TEMP_THRESHOLDS.junction_warn} crit={TEMP_THRESHOLDS.junction_crit} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <span className="text-xs text-gray-600 uppercase tracking-wide">Board Temps</span>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
                        <TempGauge label="CPU" value={r.temp_cpu} warn={TEMP_THRESHOLDS.cpu_warn} crit={TEMP_THRESHOLDS.cpu_crit} />
                        <TempGauge label="CPU Board" value={r.temp_cpu_board} warn={TEMP_THRESHOLDS.board_warn} crit={TEMP_THRESHOLDS.board_crit} />
                        <TempGauge label="RSI" value={r.temp_rsi} warn={TEMP_THRESHOLDS.board_warn} crit={TEMP_THRESHOLDS.board_crit} />
                        <TempGauge label="STARC" value={r.temp_starc_board} warn={TEMP_THRESHOLDS.board_warn} crit={TEMP_THRESHOLDS.board_crit} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ---- Joint Torques ---- */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2 border-b border-gray-800/50 pb-1">
                  Joint Torques
                </h3>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-4 gap-y-1">
                  {[1,2,3,4,5,6].map(i => (
                    <KV key={`tq${i}`} label={`J${i}`} value={`${((r as any)[`torque_j${i}`] || 0).toFixed(1)} N\u00B7m`} mono />
                  ))}
                </div>
              </div>

              {/* ---- EtherCAT I/O Board ---- */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2 border-b border-gray-800/50 pb-1">
                  EtherCAT I/O Board
                </h3>
                <div className="flex flex-wrap gap-3 mb-2">
                  <StatusDot ok={r.ioboard_connected} label={r.ioboard_connected ? "Connected" : "Disconnected"} />
                  <StatusDot ok={r.ioboard_op_state} label={r.ioboard_op_state ? "All Slaves OP" : "Slaves Not OP"} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
                  <KV label="Bus State" value={r.ioboard_bus_state || "\u2014"} />
                  <KV label="Slave Count" value={String(r.ioboard_slave_count)} mono color={r.ioboard_slave_count < 3 ? "text-red-400" : "text-gray-300"} />
                </div>
              </div>

              {/* ---- EtherCAT I/O Points ---- */}
              {(r.io_inputs && Object.keys(r.io_inputs).length > 0) || (r.io_outputs && Object.keys(r.io_outputs).length > 0) ? (
              <div>
                <button
                  onClick={() => setShowIO(!showIO)}
                  className="w-full text-left text-xs font-bold uppercase tracking-widest text-gray-500 mb-2 border-b border-gray-800/50 pb-1 hover:text-gray-400 transition-colors"
                >
                  {showIO ? "\u25BC" : "\u25B6"} EtherCAT I/O Points ({showIO ? "hide" : "show"})
                </button>
                {showIO && (
                  <div className="space-y-3">
                    {r.io_inputs && Object.keys(r.io_inputs).length > 0 && (
                      <div>
                        <span className="text-xs text-gray-600 uppercase tracking-wide">Digital Inputs (Hardware Signals)</span>
                        <div className="flex flex-wrap gap-2 mt-1.5">
                          {Object.entries(r.io_inputs).map(([key, val]) => (
                            <span key={key} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs border ${
                              val ? "bg-emerald-900/30 text-emerald-400 border-emerald-800/50" : "bg-gray-900/30 text-gray-600 border-gray-800/30"
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${val ? "bg-emerald-500" : "bg-gray-700"}`} />
                              {IO_INPUT_LABELS[key] || key}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {r.io_outputs && Object.keys(r.io_outputs).length > 0 && (
                      <div>
                        <span className="text-xs text-gray-600 uppercase tracking-wide">Digital Outputs (Commands &amp; Lamps)</span>
                        <div className="flex flex-wrap gap-2 mt-1.5">
                          {Object.entries(r.io_outputs).map(([key, val]) => (
                            <span key={key} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs border ${
                              val ? "bg-blue-900/30 text-blue-400 border-blue-800/50" : "bg-gray-900/30 text-gray-600 border-gray-800/30"
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${val ? "bg-blue-500" : "bg-gray-700"}`} />
                              {IO_OUTPUT_LABELS[key] || key}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              ) : null}

              {/* ---- Production ---- */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2 border-b border-gray-800/50 pb-1">
                  Production
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                  <KV label="Task" value={r.task_selected || "NONE"} color={r.task_selected === "Cycle" ? "text-emerald-400" : "text-gray-300"} />
                  <KV label="Status" value={r.task_status || "\u2014"} />
                  <KV label="Parts Found" value={String(r.parts_found)} mono />
                  <KV label="Move ID" value={String(r.move_id)} mono />
                  <KV label="Picked" value={r.part_picked || "\u2014"} />
                  <KV label="Desired" value={r.part_desired || "\u2014"} color={r.part_picked !== r.part_desired && r.part_picked ? "text-red-400" : undefined} />
                  <KV label="Conveyor" value={r.conveyor_fwd ? "FORWARD" : "OFF"} color={r.conveyor_fwd ? "text-emerald-400" : "text-gray-500"} />
                </div>

                {/* Class breakdown */}
                {r.class_ids && r.class_ids.some(Boolean) && (
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {r.class_ids.map((cls, i) => cls ? (
                      <div key={i} className="bg-gray-900/50 border border-gray-800/50 rounded-lg p-2 text-center">
                        <div className="text-xs text-gray-500 truncate">{cls}</div>
                        <div className="font-mono font-bold text-sm text-gray-200">{r.class_counts[i] ?? 0}</div>
                      </div>
                    ) : null)}
                  </div>
                )}
              </div>

              {/* ---- Robot Position ---- */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2 border-b border-gray-800/50 pb-1">
                  Position
                </h3>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <PositionBadge label="Home" active={r.at_home} />
                  <PositionBadge label="Stow" active={r.at_stow} />
                  <PositionBadge label="Clear" active={r.at_clear} />
                  <PositionBadge label="Capture" active={r.at_capture} />
                  <PositionBadge label="Start" active={r.at_start} />
                  <PositionBadge label="End" active={r.at_end} />
                  <PositionBadge label="Accept" active={r.at_accept} />
                  <PositionBadge label="Reject" active={r.at_reject} />
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-4 gap-y-1">
                  <KV label="X" value={`${r.tcp_x.toFixed(1)} mm`} mono />
                  <KV label="Y" value={`${r.tcp_y.toFixed(1)} mm`} mono />
                  <KV label="Z" value={`${r.tcp_z.toFixed(1)} mm`} mono />
                  <KV label="Rx" value={`${r.tcp_rx.toFixed(1)}°`} mono />
                  <KV label="Ry" value={`${r.tcp_ry.toFixed(1)}°`} mono />
                  <KV label="Rz" value={`${r.tcp_rz.toFixed(1)}°`} mono />
                </div>
                <button
                  onClick={() => setShowJoints(!showJoints)}
                  className="mt-2 text-xs text-gray-500 hover:text-gray-400 uppercase tracking-wider"
                >
                  {showJoints ? "\u25BC" : "\u25B6"} Joint angles
                </button>
                {showJoints && (
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-4 gap-y-1 mt-1">
                    <KV label="J1" value={`${r.j1_pos.toFixed(2)}°`} mono />
                    <KV label="J2" value={`${r.j2_pos.toFixed(2)}°`} mono />
                    <KV label="J3" value={`${r.j3_pos.toFixed(2)}°`} mono />
                    <KV label="J4" value={`${r.j4_pos.toFixed(2)}°`} mono />
                    <KV label="J5" value={`${r.j5_pos.toFixed(2)}°`} mono />
                    <KV label="J6" value={`${r.j6_pos.toFixed(2)}°`} mono />
                  </div>
                )}
              </div>

              {/* ---- System Health ---- */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2 border-b border-gray-800/50 pb-1">
                  System Health
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                  <KV label="Arm Cycles" value={r.arm_cycles.toLocaleString()} mono />
                  <KV label="Power-on Hours" value={r.power_on_hours.toFixed(1)} mono />
                  <KV label="URPS Errors (24h)" value={String(r.urps_errors_24h)} color={r.urps_errors_24h > 0 ? "text-red-400" : "text-gray-300"} mono />
                  <KV label="EtherCAT Errors (24h)" value={String(r.ethercat_errors_24h)} color={r.ethercat_errors_24h > 0 ? "text-orange-400" : "text-gray-300"} mono />
                  {r.last_error_code && (
                    <>
                      <KV label="Last Error" value={r.last_error_code} color="text-red-400" mono />
                      <KV label="Error Time" value={r.last_error_time} />
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
