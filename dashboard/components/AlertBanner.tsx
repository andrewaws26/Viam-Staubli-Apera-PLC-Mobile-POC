interface Props {
  faultNames: string[];
}

export default function AlertBanner({ faultNames }: Props) {
  return (
    <div
      role="alert"
      className="flex items-center gap-4 bg-red-700 border-b-4 border-red-400 px-6 py-5"
      style={{ animation: "bannerIn 0.2s ease-out" }}
    >
      {/* Flashing warning symbol */}
      <span
        className="text-4xl font-black text-white animate-pulse select-none"
        aria-hidden="true"
      >
        ⚠
      </span>

      <div className="flex-1">
        <p className="text-2xl font-black tracking-widest uppercase text-white leading-none">
          FAULT DETECTED
        </p>
        <p className="text-red-200 text-base mt-1 font-semibold">
          {faultNames.join("  ·  ")}
        </p>
      </div>

      {/* Pulse bar — visual heartbeat indicating alert is live */}
      <div className="hidden sm:flex gap-1 items-center h-10">
        {[0.4, 0.7, 1, 0.7, 0.4].map((h, i) => (
          <div
            key={i}
            className="w-1.5 bg-red-300 rounded-full animate-pulse"
            style={{ height: `${h * 100}%`, animationDelay: `${i * 0.1}s` }}
          />
        ))}
      </div>
    </div>
  );
}
