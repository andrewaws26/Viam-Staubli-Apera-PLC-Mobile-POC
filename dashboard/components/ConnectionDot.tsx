interface Props {
  connected: boolean;
  error: string | null;
}

export default function ConnectionDot({ connected, error }: Props) {
  return (
    <div
      className="flex flex-col items-end gap-0.5"
      title={error ?? (connected ? "PLC responding via Modbus TCP" : "No PLC response — truck may be off")}
    >
      <div className="flex items-center gap-2">
        <div
          className={[
            "w-2.5 h-2.5 rounded-full",
            connected ? "bg-green-400" : "bg-red-500 animate-pulse",
          ].join(" ")}
        />
        <span
          className={[
            "uppercase tracking-widest text-xs font-bold",
            connected ? "text-green-400" : "text-red-400",
          ].join(" ")}
        >
          {connected ? "Truck Online" : "Truck Offline"}
        </span>
      </div>
      <span className="text-[9px] sm:text-[10px] text-gray-600 tracking-wide">
        {connected ? "PLC connected" : error || "No PLC response"}
      </span>
    </div>
  );
}
