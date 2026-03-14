interface Props {
  connected: boolean;
  error: string | null;
  isMock: boolean;
}

export default function ConnectionDot({ connected, error, isMock }: Props) {
  if (isMock) {
    return (
      <div className="flex items-center gap-2" title="Running in mock mode — no hardware required">
        <div className="w-2.5 h-2.5 rounded-full bg-yellow-400 animate-pulse" />
        <span className="uppercase tracking-widest text-xs font-bold text-yellow-400">
          Mock Mode
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2"
      title={error ?? (connected ? "Connected to Viam Cloud" : "Connecting…")}
    >
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
        {connected ? "Viam Connected" : "Disconnected"}
      </span>
    </div>
  );
}
