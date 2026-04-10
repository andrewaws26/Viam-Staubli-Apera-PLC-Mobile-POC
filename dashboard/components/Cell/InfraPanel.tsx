// InfraPanel.tsx — Infrastructure monitoring: internet uplink, switch/VPN, Pi health.
"use client";

import type { InternetHealth, SwitchVpnHealth, PiHealth } from "./CellTypes";
import { tempColor, tempBg } from "./CellTypes";

interface Props {
  internet: InternetHealth | null;
  switchVpn: SwitchVpnHealth | null;
  piHealth: PiHealth | null;
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className={`w-2 h-2 rounded-full shrink-0 ${ok ? "bg-green-500" : "bg-red-500 animate-pulse"}`} />
  );
}

function Metric({ label, value, unit, warn }: { label: string; value: string | number; unit?: string; warn?: boolean }) {
  return (
    <div className="flex justify-between items-baseline gap-2">
      <span className="text-[11px] text-gray-500">{label}</span>
      <span className={`text-xs font-mono ${warn ? "text-orange-400" : "text-gray-300"}`}>
        {value}{unit && <span className="text-gray-500 ml-0.5">{unit}</span>}
      </span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function cToF(c: number): number { return c * 9 / 5 + 32; }
function ms(v: number): string { return Math.round(v).toLocaleString(); }
function ms1(v: number): string { return v.toFixed(1); }

export default function InfraPanel({ internet, switchVpn, piHealth }: Props) {
  const inet = internet;
  const sw = switchVpn;
  const pi = piHealth;

  return (
    <div className="border border-gray-800 rounded-2xl p-4 sm:p-5 space-y-4">
      <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500">
        Infrastructure
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Internet Uplink */}
        <div className="space-y-2 p-3 rounded-xl bg-gray-900/30 border border-gray-800/50">
          <div className="flex items-center gap-2 mb-2">
            <StatusDot ok={inet?.reachable ?? false} />
            <span className="text-xs font-semibold text-gray-300">Internet</span>
            {inet?.reachable && (
              <span className="ml-auto text-xs text-gray-500">via {inet.gateway_ip}</span>
            )}
          </div>
          {inet ? (
            <>
              <Metric label="Latency" value={ms(inet.latency_ms)} unit="ms" warn={inet.latency_ms > 200} />
              <Metric label="Jitter" value={ms(inet.jitter_ms)} unit="ms" warn={inet.jitter_ms > 50} />
              <Metric label="Packet Loss" value={Math.round(inet.packet_loss_pct)} unit="%" warn={inet.packet_loss_pct > 0} />
              <Metric label="DNS" value={inet.dns_ok ? `${ms(inet.dns_resolve_ms)}ms` : "FAIL"} warn={!inet.dns_ok} />
              <Metric label="Viam Cloud" value={inet.viam_reachable ? `${ms(inet.viam_latency_ms)}ms` : "DOWN"} warn={!inet.viam_reachable} />
              <Metric label="Link" value={`${inet.link_speed_mbps} Mbps`} />
              <div className="flex justify-between text-xs text-gray-500 mt-1 pt-1 border-t border-gray-800/50">
                <span>RX {formatBytes(inet.rx_bytes)}</span>
                <span>TX {formatBytes(inet.tx_bytes)}</span>
              </div>
              {(inet.rx_errors > 0 || inet.tx_errors > 0) && (
                <div className="text-xs text-orange-400">
                  Errors: RX {inet.rx_errors} / TX {inet.tx_errors}
                </div>
              )}
            </>
          ) : (
            <div className="text-xs text-gray-500">No data</div>
          )}
        </div>

        {/* Switch & VPN */}
        <div className="space-y-2 p-3 rounded-xl bg-gray-900/30 border border-gray-800/50">
          <div className="flex items-center gap-2 mb-2">
            <StatusDot ok={sw?.eth0_up ?? false} />
            <span className="text-xs font-semibold text-gray-300">Switch / VPN</span>
          </div>
          {sw ? (
            <>
              <Metric label="Ethernet" value={sw.eth0_up ? `${sw.eth0_speed_mbps} Mbps ${sw.eth0_duplex}` : "DOWN"} warn={!sw.eth0_up} />
              <Metric label="Devices on Switch" value={sw.devices_on_switch} />
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-800/50">
                <StatusDot ok={sw.vpn_reachable} />
                <span className="text-[11px] text-gray-400">Stridelinx VPN</span>
              </div>
              <Metric label="VPN Latency" value={ms1(sw.vpn_latency_ms)} unit="ms" />
              <Metric label="Web UI" value={sw.vpn_web_ok ? "OK" : "DOWN"} warn={!sw.vpn_web_ok} />
              <Metric label="Is Gateway" value={sw.vpn_is_gateway ? "Yes" : "No"} />
              <div className="text-xs text-gray-500 mt-1">{sw.vpn_ip}</div>
            </>
          ) : (
            <div className="text-xs text-gray-500">No data</div>
          )}
        </div>

        {/* Pi 5 Health */}
        <div className="space-y-2 p-3 rounded-xl bg-gray-900/30 border border-gray-800/50">
          <div className="flex items-center gap-2 mb-2">
            <StatusDot ok={pi ? !pi.throttled_now && !pi.undervoltage_now : false} />
            <span className="text-xs font-semibold text-gray-300">Pi 5</span>
            {pi && (
              <span className="ml-auto text-xs text-gray-500">{pi.uptime_hours.toFixed(1)}h up</span>
            )}
          </div>
          {pi ? (
            <>
              <div className={`p-2 rounded-lg border ${tempBg(pi.cpu_temp_c, 70, 80)}`}>
                <div className="flex justify-between">
                  <span className="text-[11px] text-gray-500">CPU Temp</span>
                  <span className={`text-xs font-mono ${tempColor(pi.cpu_temp_c, 70, 80)}`}>
                    {cToF(pi.cpu_temp_c).toFixed(0)}°F
                  </span>
                </div>
              </div>
              <Metric label="Load" value={`${pi.load_1m.toFixed(2)} / ${pi.load_5m.toFixed(2)} / ${pi.load_15m.toFixed(2)}`} warn={pi.load_1m > 3} />
              <Metric label="Memory" value={`${pi.mem_used_pct.toFixed(0)}%`} warn={pi.mem_used_pct > 80} />
              <Metric label="Disk" value={`${pi.disk_used_pct.toFixed(0)}% (${pi.disk_free_gb.toFixed(0)} GB free)`} warn={pi.disk_used_pct > 90} />
              {/* Throttle flags */}
              {(pi.undervoltage_now || pi.freq_capped_now || pi.throttled_now) && (
                <div className="mt-1 p-2 rounded-lg bg-red-950/40 border border-red-900/50 space-y-0.5">
                  {pi.undervoltage_now && <div className="text-xs text-red-400">Undervoltage detected</div>}
                  {pi.freq_capped_now && <div className="text-xs text-orange-400">Frequency capped</div>}
                  {pi.throttled_now && <div className="text-xs text-orange-400">Thermal throttled</div>}
                </div>
              )}
              {!pi.undervoltage_now && !pi.freq_capped_now && !pi.throttled_now && (pi.undervoltage_ever || pi.freq_capped_ever || pi.throttled_ever) && (
                <div className="text-xs text-yellow-600 mt-1">
                  Past throttle events detected
                </div>
              )}
            </>
          ) : (
            <div className="text-xs text-gray-500">No data</div>
          )}
        </div>
      </div>
    </div>
  );
}
