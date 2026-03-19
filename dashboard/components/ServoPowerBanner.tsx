interface Props {
  isEnergized: boolean;
}

export default function ServoPowerBanner({ isEnergized }: Props) {
  const bgClass = isEnergized
    ? "bg-green-900 border-b-4 border-green-600"
    : "bg-gray-800 border-b-4 border-gray-600";

  const title = isEnergized ? "SERVO ENERGIZED" : "SERVO IDLE";
  const subtitle = isEnergized
    ? "Servo power is active — drives enabled"
    : "Servo power is off — drives idle";
  const symbol = isEnergized ? "⚡" : "⏸";
  const barColor = isEnergized ? "bg-green-500" : "bg-gray-500";
  const subtitleColor = isEnergized ? "text-green-200" : "text-gray-400";

  return (
    <div
      role="status"
      className={`flex items-center gap-4 ${bgClass} px-6 py-5`}
      style={{ animation: "bannerIn 0.2s ease-out" }}
    >
      {/* Status symbol */}
      <span
        className={`text-4xl font-black text-white select-none${isEnergized ? " animate-pulse" : ""}`}
        aria-hidden="true"
      >
        {symbol}
      </span>

      <div className="flex-1">
        <p className="text-2xl font-black tracking-widest uppercase text-white leading-none">
          {title}
        </p>
        <p className={`${subtitleColor} text-base mt-1 font-semibold`}>
          {subtitle}
        </p>
      </div>

      {/* Pulse bar — matches AlertBanner style */}
      <div className="hidden sm:flex gap-1 items-center h-10">
        {[0.4, 0.7, 1, 0.7, 0.4].map((h, i) => (
          <div
            key={i}
            className={`w-1.5 ${barColor} rounded-full${isEnergized ? " animate-pulse" : ""}`}
            style={{ height: `${h * 100}%`, animationDelay: `${i * 0.1}s` }}
          />
        ))}
      </div>
    </div>
  );
}
