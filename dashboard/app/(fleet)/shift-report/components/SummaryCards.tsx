// ---------------------------------------------------------------------------
// Summary cards: SummaryCard, PeakCard, MiniStat
// ---------------------------------------------------------------------------

import { StatusColor } from "../types";
import { fmtTime } from "../utils/timezone";

export function SummaryCard({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit: string;
  color: StatusColor;
}) {
  const colorMap = {
    green: "text-green-400 border-green-800/50",
    yellow: "text-yellow-400 border-yellow-800/50",
    red: "text-red-400 border-red-800/50",
    gray: "text-gray-500 border-gray-800",
  };

  return (
    <div className={`bg-gray-900 rounded-xl border p-3 sm:p-4 print-kpi-cell ${colorMap[color]}`}>
      <p className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-widest">{label}</p>
      <p className={`text-2xl sm:text-4xl font-black mt-1 leading-none ${colorMap[color].split(" ")[0]}`}>
        {value}
        <span className="text-sm sm:text-lg font-normal ml-1 opacity-60">{unit}</span>
      </p>
    </div>
  );
}

export function PeakCard({
  label,
  value,
  time,
  color,
}: {
  label: string;
  value: string;
  time?: string;
  color: StatusColor;
}) {
  const bgMap = {
    green: "bg-green-900/20 border-green-800/50",
    yellow: "bg-yellow-900/20 border-yellow-800/50",
    red: "bg-red-900/20 border-red-800/50",
    gray: "bg-gray-900 border-gray-800",
  };
  const textMap = {
    green: "text-green-400",
    yellow: "text-yellow-400",
    red: "text-red-400",
    gray: "text-gray-500",
  };

  return (
    <div className={`rounded-xl border p-3 sm:p-4 ${bgMap[color]}`}>
      <p className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-widest">{label}</p>
      <p className={`text-xl sm:text-2xl font-bold mt-1 ${textMap[color]}`}>{value}</p>
      {time && <p className="text-[10px] text-gray-600 mt-0.5">at {fmtTime(time)}</p>}
    </div>
  );
}

export function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-gray-800/50 rounded-lg px-3 py-2">
      <p className="text-[10px] text-gray-500 uppercase tracking-widest">{label}</p>
      <p className="text-lg font-bold text-gray-200 mt-0.5">{value}</p>
      {sub && <p className="text-[9px] text-gray-600">{sub}</p>}
    </div>
  );
}
