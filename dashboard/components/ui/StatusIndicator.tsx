type Status = "connected" | "disconnected" | "idle" | "warning" | "error";

const CONFIG: Record<Status, { bg: string; icon: string; label: string }> = {
  connected: {
    bg: "bg-green-500",
    icon: "M5 13l4 4L19 7",
    label: "Connected",
  },
  disconnected: {
    bg: "bg-red-500",
    icon: "M6 18L18 6M6 6l12 12",
    label: "Disconnected",
  },
  idle: {
    bg: "bg-gray-500",
    icon: "M20 12H4",
    label: "Idle",
  },
  warning: {
    bg: "bg-amber-500",
    icon: "M12 9v4m0 4h.01",
    label: "Warning",
  },
  error: {
    bg: "bg-red-500",
    icon: "M12 9v4m0 4h.01",
    label: "Error",
  },
};

interface Props {
  status: Status;
  showLabel?: boolean;
  size?: "sm" | "md";
}

export default function StatusIndicator({ status, showLabel = false, size = "sm" }: Props) {
  const { bg, icon, label } = CONFIG[status];
  const dotSize = size === "sm" ? "w-3 h-3" : "w-4 h-4";
  const iconSize = size === "sm" ? "w-2 h-2" : "w-2.5 h-2.5";

  return (
    <span className="inline-flex items-center gap-1.5" aria-label={label}>
      <span className={`${dotSize} rounded-full ${bg} flex items-center justify-center shrink-0`}>
        <svg
          className={`${iconSize} text-white`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
        </svg>
      </span>
      {showLabel && (
        <span className="text-xs text-gray-400">{label}</span>
      )}
    </span>
  );
}
