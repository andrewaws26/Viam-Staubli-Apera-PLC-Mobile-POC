import { ComponentState } from "../lib/types";

interface Props {
  component: ComponentState;
}

export default function StatusCard({ component }: Props) {
  const { status, label, icon, faultMessage, lastUpdated } = component;

  const isHealthy = status === "healthy";
  const isFault = status === "fault" || status === "error";
  const isLoading = status === "loading";
  const isPending = status === "pending";

  return (
    <div
      className={[
        "rounded-2xl border flex flex-col items-center gap-2 sm:gap-3 p-3 sm:p-6 transition-colors duration-300 tap-target",
        isHealthy ? "border-green-800 bg-gray-900" : "",
        isFault ? "border-red-700 bg-red-950/40" : "",
        isPending ? "border-yellow-800/50 bg-gray-900/60" : "",
        isLoading ? "border-gray-800 bg-gray-900" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Status circle */}
      <div className="relative flex items-center justify-center w-16 h-16 sm:w-36 sm:h-36">
        {isFault && (
          <span className="absolute inset-0 rounded-full bg-red-500 opacity-25 animate-ping" />
        )}
        <div
          className={[
            "w-16 h-16 sm:w-36 sm:h-36 rounded-full flex flex-col items-center justify-center shadow-lg select-none",
            isHealthy ? "bg-green-500 shadow-green-900/60" : "",
            isFault ? "bg-red-600 shadow-red-900/60 animate-pulse" : "",
            isPending ? "bg-yellow-700/40 shadow-yellow-900/30" : "",
            isLoading ? "bg-gray-700" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {isLoading ? (
            <span className="text-gray-400 text-xl sm:text-3xl">...</span>
          ) : isPending ? (
            <>
              <span className="text-xl sm:text-4xl opacity-40">{icon}</span>
              <span className="text-yellow-400 font-bold text-xs sm:text-xs mt-0.5 sm:mt-1 uppercase tracking-wider">
                Pending
              </span>
            </>
          ) : (
            <>
              <span className="text-xl sm:text-4xl">{icon}</span>
              <span className="text-white font-black text-base sm:text-xl mt-0.5 sm:mt-1">
                {isHealthy ? "OK" : "FAULT"}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Label */}
      <h2 className="text-sm sm:text-lg font-bold tracking-widest uppercase text-center text-gray-100">
        {label}
      </h2>

      {/* Fault message or pending note */}
      {isFault && faultMessage && (
        <p className="text-xs sm:text-sm text-red-300 text-center leading-snug font-medium">
          {faultMessage}
        </p>
      )}
      {isPending && (
        <p className="text-xs sm:text-sm text-yellow-500/70 text-center leading-snug">
          Not configured in Viam yet
        </p>
      )}

      {/* Last updated */}
      <p className="text-xs sm:text-xs text-gray-500 mt-auto font-mono">
        {lastUpdated
          ? lastUpdated.toLocaleTimeString()
          : isLoading
          ? "connecting..."
          : "---"}
      </p>
    </div>
  );
}
