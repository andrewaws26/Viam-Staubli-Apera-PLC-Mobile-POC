interface Props {
  faultNames: string[];
  isEstop?: boolean;
}

export default function AlertBanner({ faultNames, isEstop = false }: Props) {
  const bgClass = isEstop
    ? "bg-red-900 border-b-4 border-red-600"
    : "bg-red-700 border-b-4 border-red-400";

  const title = isEstop ? "E-STOP ACTIVATED" : "FAULT DETECTED";
  const subtitle = isEstop
    ? "System halted — twist E-stop to reset, then press Servo Power"
    : faultNames.join("  ·  ");
  const symbol = isEstop ? "🛑" : "⚠";

  return (
    <div
      role="alert"
      className={`flex items-center gap-4 ${bgClass} px-6 py-5`}
      style={{ animation: "bannerIn 0.2s ease-out" }}
    >
      {/* Flashing warning symbol */}
      <span
        className="text-4xl font-black text-white animate-pulse select-none"
        aria-hidden="true"
      >
        {symbol}
      </span>

      <div className="flex-1">
        <p className="text-2xl font-black tracking-widest uppercase text-white leading-none">
          {title}
        </p>
        <p className="text-red-200 text-base mt-1 font-semibold">
          {subtitle}
        </p>
      </div>

      {/* Pulse bar — visual heartbeat indicating alert is live */}
      <div className="hidden sm:flex gap-1 items-center h-10">
        {[0.4, 0.7, 1, 0.7, 0.4].map((h, i) => (
          <div
            key={i}
            className={`w-1.5 ${isEstop ? "bg-red-500" : "bg-red-300"} rounded-full animate-pulse`}
            style={{ height: `${h * 100}%`, animationDelay: `${i * 0.1}s` }}
          />
        ))}
      </div>
    </div>
  );
}
