"use client";

interface TrendPoint {
  time: number;
  value: number;
}

interface Props {
  label: string;
  data: TrendPoint[];
  unit?: string;
  color?: string;
  warnThreshold?: number;
  critThreshold?: number;
  inverted?: boolean;
  height?: number;
}

export default function TrendChart({
  label,
  data,
  unit = "",
  color = "#818cf8",
  warnThreshold,
  critThreshold,
  inverted = false,
  height = 60,
}: Props) {
  if (data.length < 2) {
    return (
      <div className="bg-gray-900/50 rounded-lg p-2">
        <span className="text-xs text-gray-600">{label}: collecting data...</span>
      </div>
    );
  }

  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const current = values[values.length - 1];
  const width = 200;
  const padding = 2;

  // Build SVG path
  const points = data.map((d, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y = padding + (1 - (d.value - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  });
  const pathD = `M ${points.join(" L ")}`;

  // Area fill
  const areaD = `${pathD} L ${width - padding},${height - padding} L ${padding},${height - padding} Z`;

  // Color based on current value vs thresholds
  let lineColor = color;
  if (critThreshold !== undefined && warnThreshold !== undefined) {
    if (inverted) {
      if (current <= critThreshold) lineColor = "#f87171";
      else if (current <= warnThreshold) lineColor = "#fbbf24";
    } else {
      if (current >= critThreshold) lineColor = "#f87171";
      else if (current >= warnThreshold) lineColor = "#fbbf24";
    }
  }

  // Delta from first to last
  const delta = current - values[0];
  const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
  const deltaColor = Math.abs(delta) < range * 0.05 ? "text-gray-600" : delta > 0 ? "text-red-400" : "text-blue-400";

  return (
    <div className="bg-gray-900/50 rounded-lg p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono ${deltaColor}`}>{deltaStr}{unit}</span>
          <span className="text-xs font-mono font-bold text-gray-200">
            {current.toFixed(1)}{unit}
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
        {/* Threshold lines */}
        {warnThreshold !== undefined && (
          <line
            x1={padding}
            y1={padding + (1 - (warnThreshold - min) / range) * (height - padding * 2)}
            x2={width - padding}
            y2={padding + (1 - (warnThreshold - min) / range) * (height - padding * 2)}
            stroke="#fbbf24"
            strokeWidth="0.5"
            strokeDasharray="3,3"
            opacity="0.4"
          />
        )}
        {critThreshold !== undefined && (
          <line
            x1={padding}
            y1={padding + (1 - (critThreshold - min) / range) * (height - padding * 2)}
            x2={width - padding}
            y2={padding + (1 - (critThreshold - min) / range) * (height - padding * 2)}
            stroke="#f87171"
            strokeWidth="0.5"
            strokeDasharray="3,3"
            opacity="0.4"
          />
        )}
        {/* Area fill */}
        <path d={areaD} fill={lineColor} opacity="0.1" />
        {/* Line */}
        <path d={pathD} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {/* Current value dot */}
        <circle
          cx={width - padding}
          cy={padding + (1 - (current - min) / range) * (height - padding * 2)}
          r="2.5"
          fill={lineColor}
        />
      </svg>
      <div className="flex justify-between text-[8px] text-gray-700 mt-0.5">
        <span>{Math.floor((Date.now() - data[0].time) / 1000)}s ago</span>
        <span>now</span>
      </div>
    </div>
  );
}
