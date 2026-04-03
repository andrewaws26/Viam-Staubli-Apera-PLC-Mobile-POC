/**
 * AI Historical Data Summary
 *
 * Fetches truck history directly via the shared Viam Data API client,
 * computes 24h trends with direction, peak events, activity estimates,
 * DTC history, and 7-day baseline comparison.
 * Returns a compact text block for injection into Claude prompts.
 *
 * Cached for 5 minutes to avoid repeated Viam queries on rapid AI chat.
 */

import { fetchTruckData, buildTruckSummary } from "@/lib/truck-data";

// ── Types ──────────────────────────────────────────────────────────

interface TruckHistoryData {
  totalPoints: number;
  hours: number;
  periodStart: string;
  periodEnd: string;
  totalMinutes: number;
  summary: Record<string, Record<string, number>>;
  dtcEvents: { timestamp: string; code: string }[];
  timeSeries: TSPoint[];
}

interface TSPoint {
  t: string;
  rpm: number;
  coolant_f: number;
  speed_mph: number;
  battery_v: number;
  fuel_pct: number;
  oil_psi: number;
  oil_f: number;
  boost_psi: number;
  fuel_rate: number;
  load_pct: number;
  intake_f: number;
  dpf_soot: number;
  def_pct: number;
  scr_eff: number;
  def_dose: number;
  throttle_pct: number;
  short_trim: number;
  long_trim: number;
  dtc_count: number;
}

export interface AiHistorySummary {
  text: string;
  hasData: boolean;
  fetchedAt: number;
  debug?: {
    totalPoints: number;
    periodStart: string | null;
    periodEnd: string | null;
    points24h: number;
    cacheAgeSeconds: number;
  };
}

// ── Metric definitions ─────────────────────────────────────────────

interface MetricDef {
  key: keyof TSPoint;
  label: string;
  unit: string;
  normalMin: number;
  normalMax: number;
  precision: number;
  showTrend: boolean; // false for instantaneous metrics (RPM, speed)
}

const METRICS: MetricDef[] = [
  { key: "coolant_f",    label: "Coolant",          unit: "°F",  normalMin: 160, normalMax: 220,  precision: 0, showTrend: true },
  { key: "oil_f",        label: "Oil Temp",         unit: "°F",  normalMin: 170, normalMax: 240,  precision: 0, showTrend: true },
  { key: "battery_v",    label: "Battery",          unit: "V",   normalMin: 12.4, normalMax: 14.8, precision: 1, showTrend: true },
  { key: "oil_psi",      label: "Oil Press",        unit: "psi", normalMin: 25,  normalMax: 80,   precision: 0, showTrend: true },
  { key: "rpm",          label: "RPM",              unit: "",    normalMin: 0,   normalMax: 2500, precision: 0, showTrend: false },
  { key: "speed_mph",    label: "Speed",            unit: "mph", normalMin: 0,   normalMax: 70,   precision: 0, showTrend: false },
  { key: "boost_psi",    label: "Boost",            unit: "psi", normalMin: 0,   normalMax: 35,   precision: 0, showTrend: true },
  { key: "load_pct",     label: "Load",             unit: "%",   normalMin: 0,   normalMax: 90,   precision: 0, showTrend: false },
  { key: "intake_f",     label: "Intake",           unit: "°F",  normalMin: 20,  normalMax: 160,  precision: 0, showTrend: true },
  { key: "fuel_pct",     label: "Fuel",             unit: "%",   normalMin: 10,  normalMax: 100,  precision: 0, showTrend: true },
  { key: "dpf_soot",     label: "DPF Soot",         unit: "%",   normalMin: 0,   normalMax: 80,   precision: 0, showTrend: true },
  { key: "def_pct",      label: "DEF",              unit: "%",   normalMin: 10,  normalMax: 100,  precision: 0, showTrend: true },
  { key: "scr_eff",      label: "SCR Efficiency",   unit: "%",   normalMin: 50,  normalMax: 100,  precision: 0, showTrend: true },
  { key: "def_dose",     label: "DEF Dose Rate",    unit: "g/s", normalMin: 0,   normalMax: 50,   precision: 1, showTrend: true },
  { key: "short_trim",   label: "Short Fuel Trim",  unit: "%",   normalMin: -10, normalMax: 10,   precision: 1, showTrend: true },
  { key: "long_trim",    label: "Long Fuel Trim",   unit: "%",   normalMin: -10, normalMax: 10,   precision: 1, showTrend: true },
  { key: "throttle_pct", label: "Throttle",         unit: "%",   normalMin: 0,   normalMax: 90,   precision: 0, showTrend: false },
];

// ── Cache ──────────────────────────────────────────────────────────

let _cache: AiHistorySummary | null = null;
const CACHE_TTL = 5 * 60 * 1000;

// ── Main export ────────────────────────────────────────────────────

export async function getAiHistorySummary(): Promise<AiHistorySummary> {
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL) {
    return {
      ..._cache,
      debug: _cache.debug
        ? { ..._cache.debug, cacheAgeSeconds: Math.round((Date.now() - _cache.fetchedAt) / 1000) }
        : undefined,
    };
  }

  try {
    console.log("[AI-HISTORY] Fetching truck data from Viam Data API...");
    const points = await fetchTruckData(168);
    const raw = buildTruckSummary(points, 168);

    if (!raw.totalPoints || !raw.timeSeries?.length) return noData("No data points");
    console.log("[AI-CHAT-LOG] History fetch status: OK,", raw.totalPoints, "points");

    // Map to typed format for AI processing (safe — totalPoints > 0 guarantees non-null fields)
    const hist: TruckHistoryData = {
      totalPoints: raw.totalPoints,
      hours: raw.hours,
      periodStart: raw.periodStart as string,
      periodEnd: raw.periodEnd as string,
      totalMinutes: raw.totalMinutes,
      summary: raw.summary as Record<string, Record<string, number>>,
      dtcEvents: raw.dtcEvents,
      timeSeries: raw.timeSeries as TSPoint[],
    };

    const summary = buildSummary(hist);
    _cache = summary;
    console.log("[AI-HISTORY] Summary built:", summary.debug?.points24h, "pts in 24h,", hist.totalPoints, "total");
    return summary;
  } catch (err) {
    console.log("[AI-HISTORY] Fetch failed:", err instanceof Error ? err.message : err);
    return noData(err instanceof Error ? err.message : "fetch failed");
  }
}

function noData(reason: string): AiHistorySummary {
  return {
    text: `Historical data unavailable (${reason}). Analysis limited to live readings only.`,
    hasData: false,
    fetchedAt: Date.now(),
  };
}

// ── Build structured summary ───────────────────────────────────────

function buildSummary(hist: TruckHistoryData): AiHistorySummary {
  const now = Date.now();
  const ts = hist.timeSeries;

  const cut24 = now - 24 * 3600000;
  const cut48 = now - 48 * 3600000;
  const pts24 = ts.filter(p => new Date(p.t).getTime() >= cut24);
  const pts7d = ts;

  const trends = computeTrends(pts24, pts7d);
  const peaks = findPeaks(pts24);
  const activity = estimateActivity(ts);
  const dtcs48 = hist.dtcEvents.filter(e => new Date(e.timestamp).getTime() >= cut48);

  const text = formatAll(trends, peaks, activity, dtcs48, hist, pts24.length);

  return {
    text,
    hasData: true,
    fetchedAt: now,
    debug: {
      totalPoints: hist.totalPoints,
      periodStart: hist.periodStart,
      periodEnd: hist.periodEnd,
      points24h: pts24.length,
      cacheAgeSeconds: 0,
    },
  };
}

// ── Trend computation ──────────────────────────────────────────────

interface TrendRow {
  def: MetricDef;
  last: number;
  avg24: number;
  min24: number;
  max24: number;
  avg7d: number;
  trend: string;
  status: string;
}

function computeTrends(pts24: TSPoint[], pts7d: TSPoint[]): TrendRow[] {
  const rows: TrendRow[] = [];

  for (const def of METRICS) {
    const vals24 = pts24.map(p => Number(p[def.key])).filter(v => !isNaN(v));
    const vals7d = pts7d.map(p => Number(p[def.key])).filter(v => !isNaN(v));

    if (vals24.length === 0 && vals7d.length === 0) continue;
    if (vals24.every(v => v === 0) && vals7d.every(v => v === 0)) continue;

    const last = vals24.length > 0 ? vals24[vals24.length - 1] : 0;
    const avg24 = vals24.length > 0 ? vals24.reduce((a, b) => a + b, 0) / vals24.length : 0;
    const min24 = vals24.length > 0 ? Math.min(...vals24) : 0;
    const max24 = vals24.length > 0 ? Math.max(...vals24) : 0;
    const avg7d = vals7d.length > 0 ? vals7d.reduce((a, b) => a + b, 0) / vals7d.length : avg24;

    // Trend direction: compare first-half vs second-half of 24h window
    let trend = "--";
    if (def.showTrend && vals24.length >= 4) {
      const mid = Math.floor(vals24.length / 2);
      const avgA = vals24.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
      const avgB = vals24.slice(mid).reduce((a, b) => a + b, 0) / (vals24.length - mid);
      const base = Math.abs(avgA) > 0.01 ? Math.abs(avgA) : 1;
      const pct = (avgB - avgA) / base;
      if (pct > 0.05) trend = "rising";
      else if (pct < -0.05) trend = "falling";
      else trend = "stable";
    }

    // Status: current vs normal range and 7d baseline
    let status = "normal";
    if (last < def.normalMin || last > def.normalMax) {
      status = "ALERT";
    } else if (avg7d !== 0 && Math.abs((last - avg7d) / avg7d) > 0.15) {
      status = "watch";
    }

    rows.push({
      def,
      last: rd(last, def.precision),
      avg24: rd(avg24, def.precision),
      min24: rd(min24, def.precision),
      max24: rd(max24, def.precision),
      avg7d: rd(avg7d, def.precision),
      trend,
      status,
    });
  }

  return rows;
}

// ── Peak events ────────────────────────────────────────────────────

interface PeakEvent {
  label: string;
  value: string;
  time: string;
  note: string;
}

function findPeaks(pts24: TSPoint[]): PeakEvent[] {
  if (pts24.length < 2) return [];
  const peaks: PeakEvent[] = [];

  // Highest coolant temp
  const maxCoolant = findMax(pts24, "coolant_f");
  if (maxCoolant && maxCoolant.val > 0) {
    peaks.push({
      label: "Peak coolant",
      value: `${Math.round(maxCoolant.val)}°F`,
      time: fmtTime(maxCoolant.t),
      note: maxCoolant.val > 220 ? "OVER THRESHOLD" : maxCoolant.val > 200 ? "elevated" : "",
    });
  }

  // Highest oil temp
  const maxOil = findMax(pts24, "oil_f");
  if (maxOil && maxOil.val > 0) {
    peaks.push({
      label: "Peak oil temp",
      value: `${Math.round(maxOil.val)}°F`,
      time: fmtTime(maxOil.t),
      note: maxOil.val > 240 ? "OVER THRESHOLD" : maxOil.val > 220 ? "elevated" : "",
    });
  }

  // Lowest battery voltage (engine running only — ignore parked/off readings)
  const running = pts24.filter(p => p.rpm > 300);
  if (running.length > 0) {
    const minBat = findMin(running, "battery_v");
    if (minBat && minBat.val > 0 && minBat.val < 14.0) {
      peaks.push({
        label: "Min battery (running)",
        value: `${rd(minBat.val, 1)}V`,
        time: fmtTime(minBat.t),
        note: minBat.val < 12.5 ? "LOW — check alternator" : minBat.val < 13.5 ? "below optimal" : "",
      });
    }
  }

  // High DPF soot load
  const maxDpf = findMax(pts24, "dpf_soot");
  if (maxDpf && maxDpf.val > 50) {
    peaks.push({
      label: "Peak DPF soot",
      value: `${Math.round(maxDpf.val)}%`,
      time: fmtTime(maxDpf.t),
      note: maxDpf.val > 80 ? "REGEN NEEDED" : "monitor",
    });
  }

  // Low DEF level
  const defPts = pts24.filter(p => p.def_pct > 0);
  if (defPts.length > 0) {
    const minDef = findMin(defPts, "def_pct");
    if (minDef && minDef.val < 20) {
      peaks.push({
        label: "Low DEF level",
        value: `${Math.round(minDef.val)}%`,
        time: fmtTime(minDef.t),
        note: minDef.val < 10 ? "CRITICAL — derate risk" : "refill soon",
      });
    }
  }

  return peaks;
}

function findMax(pts: TSPoint[], key: keyof TSPoint): { val: number; t: string } | null {
  if (pts.length === 0) return null;
  let best = { val: Number(pts[0][key]), t: pts[0].t };
  for (let i = 1; i < pts.length; i++) {
    const v = Number(pts[i][key]);
    if (v > best.val) best = { val: v, t: pts[i].t };
  }
  return best;
}

function findMin(pts: TSPoint[], key: keyof TSPoint): { val: number; t: string } | null {
  if (pts.length === 0) return null;
  let best = { val: Number(pts[0][key]), t: pts[0].t };
  for (let i = 1; i < pts.length; i++) {
    const v = Number(pts[i][key]);
    if (v > 0 && v < best.val) best = { val: v, t: pts[i].t };
  }
  return best;
}

// ── Activity estimation ────────────────────────────────────────────

interface TripDetail {
  start: string;
  end: string;
  durationMin: number;
  maxSpeed: number;
  avgSpeed: number;
  estMiles: number;
}

interface Activity {
  trips: number;
  tripDetails: TripDetail[];
  engineHrs: number;
  idleHrs: number;
  idlePct: number;
  estMiles: number;
  maxSpeed: number;
}

function estimateActivity(pts: TSPoint[]): Activity {
  const empty: Activity = { trips: 0, tripDetails: [], engineHrs: 0, idleHrs: 0, idlePct: 0, estMiles: 0, maxSpeed: 0 };
  if (pts.length < 2) return empty;

  const tripDetails: TripDetail[] = [];
  let enginePts = 0, idlePts = 0, wasRunning = false;
  let tripStartIdx = -1;
  let maxSpeed = 0;
  let totalDistMi = 0;

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const isRunning = p.rpm > 300;

    if (isRunning && !wasRunning) tripStartIdx = i;
    if (!isRunning && wasRunning && tripStartIdx >= 0) {
      tripDetails.push(buildTrip(pts, tripStartIdx, i - 1));
      tripStartIdx = -1;
    }
    if (isRunning) {
      enginePts++;
      if (p.speed_mph < 2) idlePts++;
      if (p.speed_mph > maxSpeed) maxSpeed = p.speed_mph;
    }

    // Integrate distance: trapezoidal rule between consecutive points
    if (i > 0) {
      const dtHrs = (new Date(pts[i].t).getTime() - new Date(pts[i - 1].t).getTime()) / 3600000;
      const avgSpd = (pts[i].speed_mph + pts[i - 1].speed_mph) / 2;
      totalDistMi += avgSpd * dtHrs;
    }

    wasRunning = isRunning;
  }

  // Close open trip at end of data
  if (wasRunning && tripStartIdx >= 0) {
    tripDetails.push(buildTrip(pts, tripStartIdx, pts.length - 1));
  }

  const spanMs = new Date(pts[pts.length - 1].t).getTime() - new Date(pts[0].t).getTime();
  const hrsPerPt = spanMs / (pts.length * 3600000);
  const engineHrs = rd(enginePts * hrsPerPt, 1);
  const idleHrs = rd(idlePts * hrsPerPt, 1);
  const idlePct = enginePts > 0 ? Math.round((idlePts / enginePts) * 100) : 0;

  return {
    trips: tripDetails.length,
    tripDetails: tripDetails.slice(-5),
    engineHrs,
    idleHrs,
    idlePct,
    estMiles: rd(totalDistMi, 1),
    maxSpeed: rd(maxSpeed, 0),
  };
}

function buildTrip(pts: TSPoint[], startIdx: number, endIdx: number): TripDetail {
  let maxSpeed = 0, speedSum = 0, speedCount = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    if (pts[i].speed_mph > maxSpeed) maxSpeed = pts[i].speed_mph;
    speedSum += pts[i].speed_mph;
    speedCount++;
  }
  const durationMs = new Date(pts[endIdx].t).getTime() - new Date(pts[startIdx].t).getTime();
  const avgSpeed = speedCount > 0 ? speedSum / speedCount : 0;
  const estMiles = avgSpeed * (durationMs / 3600000);
  return {
    start: pts[startIdx].t,
    end: pts[endIdx].t,
    durationMin: Math.round(durationMs / 60000),
    maxSpeed: rd(maxSpeed, 0),
    avgSpeed: rd(avgSpeed, 0),
    estMiles: rd(estMiles, 1),
  };
}

// ── Format into prompt text ────────────────────────────────────────

function formatAll(
  trends: TrendRow[],
  peaks: PeakEvent[],
  activity: Activity,
  dtcs: { timestamp: string; code: string }[],
  hist: TruckHistoryData,
  pts24Count: number,
): string {
  const out: string[] = [];

  out.push(`HISTORICAL ANALYSIS (${hist.totalPoints} total readings over ${Math.round(hist.totalMinutes / 60)}h, ${pts24Count} in last 24h):`);
  out.push("");

  // Trend table
  if (trends.length > 0) {
    out.push("24h TRENDS:");
    out.push("Metric | Recent | 24h Avg | 24h Min–Max | 7d Avg | Trend | Flag");
    for (const r of trends) {
      out.push(
        `${r.def.label} | ${r.last}${r.def.unit} | ${r.avg24} | ${r.min24}–${r.max24} | ${r.avg7d} | ${r.trend} | ${r.status}`
      );
    }
  }

  // Activity
  if (activity.trips > 0 || activity.engineHrs > 0) {
    out.push("");
    out.push(`ACTIVITY (7d est.): ${activity.trips} trip${activity.trips !== 1 ? "s" : ""}, ~${activity.engineHrs}h engine, ~${activity.idleHrs}h idle (${activity.idlePct}% idle), ~${activity.estMiles} mi driven, max ${activity.maxSpeed} mph`);
    if (activity.tripDetails.length > 0) {
      out.push("RECENT TRIPS:");
      for (let i = 0; i < activity.tripDetails.length; i++) {
        const t = activity.tripDetails[i];
        const dur = t.durationMin >= 60
          ? `${Math.floor(t.durationMin / 60)}h ${t.durationMin % 60}m`
          : `${t.durationMin}m`;
        out.push(`- Trip ${i + 1}: ${fmtTime(t.start)} – ${fmtTime(t.end)} (${dur}), max ${t.maxSpeed} mph, avg ${t.avgSpeed} mph, ~${t.estMiles} mi`);
      }
    }
  }

  // Peak events
  if (peaks.length > 0) {
    out.push("");
    out.push("PEAK EVENTS (24h):");
    for (const p of peaks) {
      out.push(`- ${p.label}: ${p.value} at ${p.time}${p.note ? ` — ${p.note}` : ""}`);
    }
  }

  // DTC history
  out.push("");
  if (dtcs.length > 0) {
    out.push("DTC HISTORY (48h):");
    const seen = new Map<string, string>();
    for (const d of dtcs) { if (!seen.has(d.code)) seen.set(d.code, d.timestamp); }
    for (const [code, ts] of seen) {
      out.push(`- ${code} first seen ${fmtTime(ts)}`);
    }
  } else {
    out.push("DTC HISTORY (48h): No trouble codes recorded.");
  }

  // Baseline explanation
  if (hist.totalMinutes > 3 * 24 * 60) {
    out.push("");
    out.push("BASELINE: 7d averages above are from this truck's history. 'watch' = >15% deviation from baseline. 'ALERT' = outside normal operating range.");
  }

  return out.join("\n");
}

// ── Helpers ─────────────────────────────────────────────────────────

function rd(n: number, d: number): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function fmtTime(iso: string): string {
  if (!iso) return "unknown";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York",
    }).format(new Date(iso));
  } catch {
    return iso.substring(0, 16).replace("T", " ");
  }
}
