export type ConnectionStatus = "connected" | "stale" | "plc-disconnected" | "offline" | "loading";

interface Props {
  status: ConnectionStatus;
  dataAge?: number | null;
  error?: string | null;
}

export default function ConnectionDot({ status, dataAge, error }: Props) {
  const configs: Record<ConnectionStatus, { dotClass: string; textClass: string; label: string; subtitle: string; tooltip: string }> = {
    connected: {
      dotClass: "bg-green-400",
      textClass: "text-green-400",
      label: "Truck Online",
      subtitle: "PLC connected",
      tooltip: "PLC responding via Modbus TCP — data is fresh",
    },
    stale: {
      dotClass: "bg-yellow-500 animate-pulse",
      textClass: "text-yellow-400",
      label: "Truck Online",
      subtitle: `Data stale${dataAge != null ? ` (${dataAge}s ago)` : ""}`,
      tooltip: "Receiving data, but readings are not fresh — possible intermittent connection",
    },
    "plc-disconnected": {
      dotClass: "bg-yellow-500 animate-pulse",
      textClass: "text-yellow-400",
      label: "Truck Online",
      subtitle: "PLC disconnected",
      tooltip: "Pi is reachable but PLC Modbus connection is failing",
    },
    offline: {
      dotClass: "bg-red-500 animate-pulse",
      textClass: "text-red-400",
      label: "Truck Offline",
      subtitle: error || "No data received",
      tooltip: "No data from Pi 5 — truck may be off or out of range",
    },
    loading: {
      dotClass: "bg-gray-500",
      textClass: "text-gray-500",
      label: "Connecting",
      subtitle: "Waiting for data...",
      tooltip: "Initial connection — waiting for first response",
    },
  };

  const c = configs[status];

  return (
    <div
      className="flex flex-col items-end gap-0.5"
      title={c.tooltip}
    >
      <div className="flex items-center gap-2">
        <div
          className={[
            "w-2.5 h-2.5 rounded-full",
            c.dotClass,
          ].join(" ")}
        />
        <span
          className={[
            "uppercase tracking-widest text-xs font-bold",
            c.textClass,
          ].join(" ")}
        >
          {c.label}
        </span>
      </div>
      <span className="text-[9px] sm:text-[10px] text-gray-600 tracking-wide">
        {c.subtitle}
      </span>
    </div>
  );
}
