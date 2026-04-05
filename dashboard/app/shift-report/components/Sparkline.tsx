// ---------------------------------------------------------------------------
// SVG Sparkline Chart (lightweight, no dependencies)
// ---------------------------------------------------------------------------

import { fmtTime } from "../utils/timezone";

export function Sparkline({
  data,
  color,
  label,
  unit,
  width = 600,
  height = 200,
}: {
  data: { t: string; v: number }[];
  color: string;
  label: string;
  unit: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return null;

  const values = data.map((d) => d.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const padL = 4;
  const padR = 16;
  const padY = 4;
  const labelH = 24;
  const plotW = width - padL - padR;
  const plotH = height - padY * 2 - labelH;

  const points = data
    .map((d, i) => {
      const x = padL + (i / (data.length - 1)) * plotW;
      const y = padY + plotH - ((d.v - min) / range) * plotH;
      return `${x},${y}`;
    })
    .join(" ");

  const firstTime = fmtTime(data[0].t);
  const lastTime = fmtTime(data[data.length - 1].t);

  return (
    <div className="print-chart">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs text-gray-400 font-medium">{label}</span>
        <span className="text-xs text-gray-500">
          {Math.round(min)}{unit} — {Math.round(max)}{unit}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full print-hide-svg"
        preserveAspectRatio="xMidYMid meet"
        style={{ height: height, maxHeight: height }}
      >
        {/* Horizontal grid lines */}
        {[0.25, 0.5, 0.75].map((frac) => {
          const y = padY + plotH - frac * plotH;
          return <line key={frac} x1={padL} y1={y} x2={padL + plotW} y2={y} stroke="#374151" strokeWidth="0.5" />;
        })}
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points}
        />
        {/* Time labels */}
        <text x={padL} y={height - 4} fontSize="11" fill="#6b7280">{firstTime}</text>
        <text x={padL + plotW} y={height - 4} fontSize="11" fill="#6b7280" textAnchor="end">{lastTime}</text>
      </svg>
    </div>
  );
}
