"use client";

// PRIVACY CONSTRAINT: This panel displays machine and component state only.
// No fields identifying operators, shift times, or personnel may be displayed.

interface HistoryEvent {
  timestamp: string;
  type: string;
  message: string;
}

interface ShiftSummary {
  periodStart: string;
  periodEnd: string;
  totalHours: number;
  totalPoints: number;
  totalDistance_ft: number;
  totalPlatesDropped: number;
  avgSpeed_ftpm: number;
  maxSpeed_ftpm: number;
  avgPlateRate: number;
  maxPlateRate: number;
  tpsPowerOnMinutes: number;
  tpsPowerOffMinutes: number;
  tpsPowerOnPct: number;
  detectorEjectCount: number;
  encoderEjectCount: number;
  cameraActiveMinutes: number;
  cameraActivePct: number;
  backupAlarmMinutes: number;
  backupAlarmTriggered: boolean;
  events: HistoryEvent[];
}

interface Props {
  summary: ShiftSummary | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDuration(minutes: number): string {
  if (minutes < 1) return "<1 min";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

const EVENT_ICONS: Record<string, string> = {
  power_on: "+",
  power_off: "-",
  backup_alarm_start: "!",
  backup_alarm_end: "*",
  camera_lost: "x",
  camera_restored: "+",
};

const EVENT_COLORS: Record<string, string> = {
  power_on: "text-green-400",
  power_off: "text-red-400",
  backup_alarm_start: "text-red-400",
  backup_alarm_end: "text-green-400",
  camera_lost: "text-yellow-400",
  camera_restored: "text-green-400",
};

export default function HistoryPanel({ summary, loading, error, onRefresh }: Props) {
  // -------------------------------------------------------------------------
  // Error / empty states
  // -------------------------------------------------------------------------
  if (error) {
    return (
      <div className="border border-gray-800 rounded-2xl p-4 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500">
            Production History
          </h3>
          <button
            onClick={onRefresh}
            className="text-[10px] sm:text-xs text-gray-600 hover:text-gray-400 uppercase tracking-wide px-2 py-1 border border-gray-800 rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
        <p className="text-sm text-gray-600">
          Historical data unavailable — {error}
        </p>
      </div>
    );
  }

  if (loading && !summary) {
    return (
      <div className="border border-gray-800 rounded-2xl p-4 sm:p-6">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">
          Production History
        </h3>
        <p className="text-sm text-gray-600 animate-pulse">
          Loading historical data...
        </p>
      </div>
    );
  }

  if (!summary) return null;

  const noData = summary.totalPoints === 0;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <details className="border border-gray-800 rounded-2xl" open={!noData}>
      <summary className="p-3 sm:p-4 cursor-pointer select-none flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-gray-400">
          Production History ({summary.totalHours}h)
          {loading && <span className="ml-2 text-gray-700 normal-case">refreshing...</span>}
        </span>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRefresh();
          }}
          disabled={loading}
          className="text-[10px] sm:text-xs text-gray-600 hover:text-gray-400 disabled:text-gray-800 uppercase tracking-wide px-2 py-1 border border-gray-800 rounded-lg transition-colors shrink-0"
        >
          Refresh
        </button>
      </summary>

      <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-4 sm:space-y-6">
        {noData ? (
          <p className="text-sm text-gray-600">
            No data captured in the last {summary.totalHours} hours.
          </p>
        ) : (
          <>
            {/* -------------------------------------------------------------- */}
            {/* Shift Summary Card                                             */}
            {/* -------------------------------------------------------------- */}
            <div>
              <h4 className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-gray-600 mb-3">
                Period Summary
              </h4>
              <div className="text-[10px] text-gray-700 mb-3">
                {formatTime(summary.periodStart)} — {formatTime(summary.periodEnd)}
                <span className="ml-2">({summary.totalPoints.toLocaleString()} samples)</span>
              </div>

              {/* Big 3 metrics */}
              <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-4">
                <div className="flex flex-col items-center p-2 sm:p-3 bg-gray-900/50 rounded-xl">
                  <span className="text-[10px] sm:text-xs text-gray-600 uppercase tracking-wide">
                    Distance
                  </span>
                  <span className="font-mono font-bold text-lg sm:text-xl text-blue-400">
                    {summary.totalDistance_ft.toLocaleString()}
                    <span className="text-gray-600 font-normal text-xs ml-0.5">ft</span>
                  </span>
                  <span className="text-[10px] text-gray-700">
                    {(summary.totalDistance_ft / 5280).toFixed(2)} mi
                  </span>
                </div>
                <div className="flex flex-col items-center p-2 sm:p-3 bg-gray-900/50 rounded-xl">
                  <span className="text-[10px] sm:text-xs text-gray-600 uppercase tracking-wide">
                    Plates
                  </span>
                  <span className="font-mono font-bold text-lg sm:text-xl text-green-400">
                    {summary.totalPlatesDropped.toLocaleString()}
                  </span>
                  <span className="text-[10px] text-gray-700">
                    avg {summary.avgPlateRate}/min
                  </span>
                </div>
                <div className="flex flex-col items-center p-2 sm:p-3 bg-gray-900/50 rounded-xl">
                  <span className="text-[10px] sm:text-xs text-gray-600 uppercase tracking-wide">
                    TPS Active
                  </span>
                  <span className="font-mono font-bold text-lg sm:text-xl text-gray-200">
                    {summary.tpsPowerOnPct}
                    <span className="text-gray-600 font-normal text-xs ml-0.5">%</span>
                  </span>
                  <span className="text-[10px] text-gray-700">
                    {formatDuration(summary.tpsPowerOnMinutes)}
                  </span>
                </div>
              </div>

              {/* Detail grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2">
                <StatItem
                  label="Avg Speed"
                  value={`${summary.avgSpeed_ftpm} ft/min`}
                />
                <StatItem
                  label="Max Speed"
                  value={`${summary.maxSpeed_ftpm} ft/min`}
                />
                <StatItem
                  label="Max Plate Rate"
                  value={`${summary.maxPlateRate}/min`}
                />
                <StatItem
                  label="Detector Ejects"
                  value={String(summary.detectorEjectCount)}
                />
                <StatItem
                  label="Encoder Ejects"
                  value={String(summary.encoderEjectCount)}
                />
                <StatItem
                  label="Camera Active"
                  value={`${summary.cameraActivePct}%`}
                  warn={summary.cameraActivePct < 50 && summary.tpsPowerOnPct > 10}
                />
                <StatItem
                  label="TPS Off Time"
                  value={formatDuration(summary.tpsPowerOffMinutes)}
                />
                {summary.backupAlarmTriggered && (
                  <StatItem
                    label="Backup Alarm"
                    value={formatDuration(summary.backupAlarmMinutes)}
                    warn={true}
                  />
                )}
              </div>
            </div>

            {/* -------------------------------------------------------------- */}
            {/* Events Timeline                                                */}
            {/* -------------------------------------------------------------- */}
            {summary.events.length > 0 && (
              <div>
                <h4 className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-gray-600 mb-2">
                  Events
                </h4>
                <div className="space-y-0.5 max-h-48 overflow-y-auto">
                  {/* Show most recent first */}
                  {[...summary.events].reverse().map((ev, i) => (
                    <div
                      key={`${ev.timestamp}-${i}`}
                      className="flex items-center gap-2 py-1 px-2 rounded text-xs"
                    >
                      <span
                        className={`shrink-0 font-bold w-3 text-center ${
                          EVENT_COLORS[ev.type] || "text-gray-500"
                        }`}
                      >
                        {EVENT_ICONS[ev.type] || "-"}
                      </span>
                      <span className="text-gray-700 font-mono shrink-0">
                        {formatTime(ev.timestamp)}
                      </span>
                      <span className={EVENT_COLORS[ev.type] || "text-gray-500"}>
                        {ev.message}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {summary.events.length === 0 && (
              <div>
                <h4 className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-gray-600 mb-2">
                  Events
                </h4>
                <p className="text-xs text-gray-700 px-2">
                  No state changes detected during this period.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Stat item sub-component
// ---------------------------------------------------------------------------
function StatItem({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-[10px] sm:text-xs text-gray-600 uppercase tracking-wide truncate">
        {label}
      </span>
      <span
        className={`font-mono text-xs sm:text-sm font-bold ${
          warn ? "text-yellow-400" : "text-gray-300"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
