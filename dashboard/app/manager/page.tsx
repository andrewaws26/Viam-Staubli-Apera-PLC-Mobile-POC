"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import TopNav from "@/components/nav/TopNav";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface BlockedItem {
  id: string;
  title: string;
  assigned_to_name: string;
  blocker_reason: string;
  priority: "urgent" | "normal" | "low";
}

interface PendingTimesheet {
  id: string;
  user_name: string;
  week_ending: string;
  submitted_at: string;
}

interface PTORequest {
  id: string;
  user_name: string;
  request_type: "vacation" | "sick" | "personal" | "bereavement";
  start_date: string;
  end_date: string;
  hours_requested: number;
}

interface ComplianceAlert {
  user_name: string;
  requirement_name: string;
  expiry_date: string;
  status: "expired" | "expiring_soon";
}

interface AuditEntry {
  id: string;
  action: string;
  user_name: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

interface ManagerDashboardData {
  timesheets: {
    pendingCount: number;
    pending: PendingTimesheet[];
  };
  pto: {
    pendingCount: number;
    pending: PTORequest[];
  };
  workOrders: {
    open: number;
    inProgress: number;
    blocked: number;
    blockedItems: BlockedItem[];
  };
  compliance: {
    expiredCount: number;
    expiringSoonCount: number;
    alerts: ComplianceAlert[];
  };
  fleet: {
    totalTrucks: number;
    staleTrucks: number;
  };
  recentActivity: AuditEntry[];
}

/* ------------------------------------------------------------------ */
/*  Helper functions                                                   */
/* ------------------------------------------------------------------ */

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    timesheet_submitted: "submitted a timesheet",
    timesheet_approved: "approved a timesheet",
    timesheet_rejected: "rejected a timesheet",
    work_order_created: "created a work order",
    work_order_updated: "updated a work order",
    work_order_completed: "completed a work order",
    work_order_blocked: "blocked a work order",
    pto_requested: "requested time off",
    pto_approved: "approved time off",
    pto_rejected: "rejected time off",
    training_completed: "completed a training",
    training_expired: "has an expired certification",
    invoice_sent: "sent an invoice",
    bill_entered: "entered a bill",
    payroll_posted: "posted payroll",
    journal_entry_posted: "posted a journal entry",
    shift_report_generated: "generated a shift report",
    dtc_cleared: "cleared a DTC",
  };
  return labels[action] || action.replace(/_/g, " ");
}

function actionIcon(action: string): string {
  if (action.startsWith("timesheet")) return "\u23f0";
  if (action.startsWith("work_order")) return "\ud83d\udd27";
  if (action.startsWith("pto")) return "\ud83c\udfd6";
  if (action.startsWith("training")) return "\ud83c\udf93";
  if (action.startsWith("invoice") || action.startsWith("bill") || action.startsWith("payroll") || action.startsWith("journal")) return "\ud83d\udcb0";
  if (action.startsWith("shift")) return "\ud83d\udccb";
  if (action.startsWith("dtc")) return "\ud83d\ude9b";
  return "\u25cf";
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function SkeletonCard() {
  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5 animate-pulse">
      <div className="h-10 w-16 bg-gray-800 rounded mb-3" />
      <div className="h-4 w-28 bg-gray-800 rounded mb-2" />
      <div className="h-3 w-20 bg-gray-800/60 rounded" />
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const styles: Record<string, string> = {
    urgent: "bg-red-900/50 text-red-300 border-red-700/40",
    normal: "bg-gray-800/50 text-gray-400 border-gray-700/40",
    low: "bg-blue-900/50 text-blue-300 border-blue-700/40",
  };
  return (
    <span
      className={`inline-block text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
        styles[priority] || styles.normal
      }`}
    >
      {priority}
    </span>
  );
}

function RequestTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    vacation: "bg-blue-900/50 text-blue-300 border-blue-700/40",
    sick: "bg-yellow-900/50 text-yellow-300 border-yellow-700/40",
    personal: "bg-purple-900/50 text-purple-300 border-purple-700/40",
    bereavement: "bg-gray-800/50 text-gray-400 border-gray-700/40",
  };
  return (
    <span
      className={`inline-block text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
        styles[type] || styles.vacation
      }`}
    >
      {type}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function ManagerCommandCenter() {
  const router = useRouter();
  const [data, setData] = useState<ManagerDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number>(Date.now());
  const [secondsAgo, setSecondsAgo] = useState(0);

  /* ---------- fetch ------------------------------------------------ */
  async function fetchDashboard() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/manager/dashboard");
      if (res.status === 403) {
        setError("Manager access required.");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        throw new Error(`Failed to load dashboard (${res.status})`);
      }
      const json = await res.json();
      setData(json);
      setLastFetched(Date.now());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  /* ---------- mount + auto-refresh --------------------------------- */
  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 60_000);
    return () => clearInterval(interval);
  }, []);

  /* ---------- seconds-ago ticker ----------------------------------- */
  useEffect(() => {
    const tick = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - lastFetched) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, [lastFetched]);

  /* ---------- derived ------------------------------------------------ */
  const allClear =
    data &&
    data.timesheets.pendingCount === 0 &&
    data.pto.pendingCount === 0 &&
    data.compliance.expiredCount === 0 &&
    data.compliance.expiringSoonCount === 0 &&
    data.workOrders.blocked === 0;

  /* ================================================================== */
  /*  RENDER                                                             */
  /* ================================================================== */

  /* ---------- error state ------------------------------------------ */
  if (error && !data) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="text-4xl">!</div>
          <h1 className="text-xl font-bold text-gray-200">{error}</h1>
          {error !== "Manager access required." && (
            <button
              onClick={fetchDashboard}
              className="mt-2 px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors"
            >
              Retry
            </button>
          )}
          <div>
            <a
              href="/"
              className="inline-block mt-2 text-sm text-purple-400 hover:text-purple-300 underline"
            >
              Back to Home
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <TopNav />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-8">
        {/* ---------------------------------------------------------- */}
        {/*  HEADER                                                     */}
        {/* ---------------------------------------------------------- */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
              Command Center
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Everything that needs your attention
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-600">
              Updated {secondsAgo}s ago
            </span>
            <button
              onClick={fetchDashboard}
              disabled={loading}
              className="min-h-[36px] px-4 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-xs text-gray-300 font-semibold transition-colors disabled:opacity-40"
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        {/* ---------------------------------------------------------- */}
        {/*  SKELETON / LOADING                                         */}
        {/* ---------------------------------------------------------- */}
        {loading && !data && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <div className="lg:col-span-3 space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-32 bg-gray-900/30 rounded-xl border border-gray-800 animate-pulse"
                  />
                ))}
              </div>
              <div className="lg:col-span-2 space-y-4">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-40 bg-gray-900/30 rounded-xl border border-gray-800 animate-pulse"
                  />
                ))}
              </div>
            </div>
          </>
        )}

        {/* ---------------------------------------------------------- */}
        {/*  LOADED CONTENT                                              */}
        {/* ---------------------------------------------------------- */}
        {data && (
          <>
            {/* ------------------------------------------------------ */}
            {/*  All-clear celebration                                   */}
            {/* ------------------------------------------------------ */}
            {allClear && (
              <div className="rounded-xl border border-green-800/40 bg-green-950/20 px-6 py-5 text-center">
                <div className="text-3xl mb-2">&#10003;</div>
                <h2 className="text-lg font-bold text-green-300">
                  You&apos;re all caught up
                </h2>
                <p className="text-sm text-green-400/70 mt-1">
                  No pending items need your attention.
                </p>
              </div>
            )}

            {/* ------------------------------------------------------ */}
            {/*  ACTION CARDS ROW                                        */}
            {/* ------------------------------------------------------ */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
              {/* Timesheets */}
              <ActionCard
                href="/timesheets/admin"
                accent="amber"
                number={data.timesheets.pendingCount}
                label="Pending Timesheets"
                subtitle="Awaiting your approval"
                isAction
                router={router}
              />

              {/* PTO Requests */}
              <ActionCard
                href="/pto/admin"
                accent="rose"
                number={data.pto.pendingCount}
                label="PTO Requests"
                subtitle="Need review"
                isAction
                router={router}
              />

              {/* Work Orders */}
              <ActionCard
                href="/work"
                accent={data.workOrders.blocked > 0 ? "amber" : "blue"}
                number={
                  data.workOrders.open +
                  data.workOrders.inProgress +
                  data.workOrders.blocked
                }
                label="Active Work Orders"
                subtitle={
                  data.workOrders.blocked > 0
                    ? `${data.workOrders.blocked} blocked`
                    : undefined
                }
                isAction={false}
                router={router}
              />

              {/* Compliance */}
              <ActionCard
                href="/training/admin"
                accent={
                  data.compliance.expiredCount > 0
                    ? "red"
                    : data.compliance.expiringSoonCount > 0
                    ? "yellow"
                    : "green"
                }
                number={
                  data.compliance.expiredCount +
                  data.compliance.expiringSoonCount
                }
                label="Compliance Alerts"
                subtitle="Certs expired or expiring"
                isAction
                router={router}
              />

              {/* Fleet */}
              <ActionCard
                href="/fleet"
                accent={data.fleet.staleTrucks === 0 ? "green" : "yellow"}
                number={data.fleet.totalTrucks}
                label="Trucks Tracked"
                subtitle={
                  data.fleet.staleTrucks > 0
                    ? `${data.fleet.staleTrucks} offline/stale`
                    : "All reporting"
                }
                isAction={false}
                router={router}
              />
            </div>

            {/* ------------------------------------------------------ */}
            {/*  TWO-COLUMN DETAIL AREA                                  */}
            {/* ------------------------------------------------------ */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* ---------- LEFT COLUMN (60%) ----------------------- */}
              <div className="lg:col-span-3 space-y-6">
                {/* Blocked Work Orders */}
                {data.workOrders.blockedItems.length > 0 && (
                  <section className="rounded-xl border border-red-800/40 bg-red-950/10 overflow-hidden">
                    <div className="px-5 py-3 border-b border-red-800/30 bg-red-950/20">
                      <h2 className="text-sm font-bold text-red-300 uppercase tracking-wider">
                        Blocked Work Orders
                      </h2>
                    </div>
                    <div className="divide-y divide-gray-800/50">
                      {data.workOrders.blockedItems.map((wo) => (
                        <button
                          key={wo.id}
                          onClick={() => router.push("/work")}
                          className="w-full text-left px-5 py-3.5 hover:bg-red-950/20 transition-colors flex items-start gap-4"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-200 truncate">
                              {wo.title}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              Assigned to{" "}
                              <span className="text-gray-400">
                                {wo.assigned_to_name}
                              </span>
                            </p>
                            <p className="text-xs text-red-400/80 mt-1 italic">
                              {wo.blocker_reason}
                            </p>
                          </div>
                          <PriorityBadge priority={wo.priority} />
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {/* Pending Timesheets */}
                {data.timesheets.pending.length > 0 && (
                  <section className="rounded-xl border border-gray-800 bg-gray-900/30 overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
                      <h2 className="text-sm font-bold text-amber-300 uppercase tracking-wider">
                        Pending Timesheets
                      </h2>
                      <button
                        onClick={() => router.push("/timesheets/admin")}
                        className="text-xs text-purple-400 hover:text-purple-300 font-semibold transition-colors"
                      >
                        Review All
                      </button>
                    </div>
                    <div className="divide-y divide-gray-800/50">
                      {data.timesheets.pending.map((ts) => (
                        <button
                          key={ts.id}
                          onClick={() => router.push("/timesheets/admin")}
                          className="w-full text-left px-5 py-3 hover:bg-gray-800/30 transition-colors flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-200 truncate">
                              {ts.user_name}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              Week ending {formatDate(ts.week_ending)}
                            </p>
                          </div>
                          <span className="text-xs text-gray-600 whitespace-nowrap">
                            {timeAgo(ts.submitted_at)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {/* PTO Requests */}
                {data.pto.pending.length > 0 && (
                  <section className="rounded-xl border border-gray-800 bg-gray-900/30 overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-800">
                      <h2 className="text-sm font-bold text-rose-300 uppercase tracking-wider">
                        PTO Requests
                      </h2>
                    </div>
                    <div className="divide-y divide-gray-800/50">
                      {data.pto.pending.map((req) => (
                        <button
                          key={req.id}
                          onClick={() => router.push("/pto/admin")}
                          className="w-full text-left px-5 py-3 hover:bg-gray-800/30 transition-colors flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-200 truncate">
                                {req.user_name}
                              </p>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {formatDate(req.start_date)} &ndash;{" "}
                                {formatDate(req.end_date)}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <RequestTypeBadge type={req.request_type} />
                            <span className="text-xs text-gray-500 font-mono">
                              {req.hours_requested}h
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </div>

              {/* ---------- RIGHT COLUMN (40%) ---------------------- */}
              <div className="lg:col-span-2 space-y-6">
                {/* Compliance Alerts */}
                {data.compliance.alerts.length > 0 && (
                  <section className="rounded-xl border border-gray-800 bg-gray-900/30 overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-800">
                      <h2 className="text-sm font-bold text-yellow-300 uppercase tracking-wider">
                        Compliance Alerts
                      </h2>
                    </div>
                    <div className="divide-y divide-gray-800/50">
                      {data.compliance.alerts.map((alert, idx) => (
                        <button
                          key={`${alert.user_name}-${alert.requirement_name}-${idx}`}
                          onClick={() => router.push("/training/admin")}
                          className="w-full text-left px-5 py-3 hover:bg-gray-800/30 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-200 truncate">
                                {alert.user_name}
                              </p>
                              <p className="text-xs text-gray-500 mt-0.5 truncate">
                                {alert.requirement_name}
                              </p>
                              <p className="text-xs text-gray-600 mt-0.5">
                                {formatDate(alert.expiry_date)}
                              </p>
                            </div>
                            <span
                              className={`shrink-0 text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
                                alert.status === "expired"
                                  ? "bg-red-900/50 text-red-300 border-red-700/40"
                                  : "bg-yellow-900/50 text-yellow-300 border-yellow-700/40"
                              }`}
                            >
                              {alert.status === "expired"
                                ? "Expired"
                                : "Expiring Soon"}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="px-5 py-2.5 border-t border-gray-800">
                      <button
                        onClick={() => router.push("/training/admin")}
                        className="text-xs text-purple-400 hover:text-purple-300 font-semibold transition-colors"
                      >
                        View All Compliance
                      </button>
                    </div>
                  </section>
                )}

                {/* Recent Activity */}
                <section className="rounded-xl border border-gray-800 bg-gray-900/30 overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-800">
                    <h2 className="text-sm font-bold text-violet-300 uppercase tracking-wider">
                      Recent Activity
                    </h2>
                  </div>
                  {data.recentActivity.length === 0 ? (
                    <div className="px-5 py-8 text-center">
                      <p className="text-sm text-gray-600">
                        No recent activity.
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-800/30">
                      {data.recentActivity.slice(0, 15).map((entry) => (
                        <div
                          key={entry.id}
                          className="px-5 py-2.5 flex items-start gap-3"
                        >
                          <span className="text-sm mt-0.5 shrink-0 w-5 text-center leading-none">
                            {actionIcon(entry.action)}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-gray-300 leading-relaxed">
                              <span className="font-semibold text-gray-200">
                                {entry.user_name}
                              </span>{" "}
                              {actionLabel(entry.action)}
                            </p>
                          </div>
                          <span className="text-xs text-gray-600 whitespace-nowrap shrink-0 mt-0.5">
                            {timeAgo(entry.created_at)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ActionCard                                                         */
/* ------------------------------------------------------------------ */

const accentMap: Record<
  string,
  { border: string; text: string; bg: string }
> = {
  amber: {
    border: "border-l-amber-500",
    text: "text-amber-400",
    bg: "bg-amber-500/10",
  },
  rose: {
    border: "border-l-rose-500",
    text: "text-rose-400",
    bg: "bg-rose-500/10",
  },
  blue: {
    border: "border-l-blue-500",
    text: "text-blue-400",
    bg: "bg-blue-500/10",
  },
  red: {
    border: "border-l-red-500",
    text: "text-red-400",
    bg: "bg-red-500/10",
  },
  yellow: {
    border: "border-l-yellow-500",
    text: "text-yellow-400",
    bg: "bg-yellow-500/10",
  },
  green: {
    border: "border-l-green-500",
    text: "text-green-400",
    bg: "bg-green-500/10",
  },
};

interface ActionCardProps {
  href: string;
  accent: string;
  number: number;
  label: string;
  subtitle?: string;
  isAction: boolean;
  router: ReturnType<typeof useRouter>;
}

function ActionCard({
  href,
  accent,
  number,
  label,
  subtitle,
  isAction,
  router,
}: ActionCardProps) {
  const colors = accentMap[accent] || accentMap.blue;
  const showClear = isAction && number === 0;

  return (
    <button
      onClick={() => router.push(href)}
      className={`text-left rounded-xl border border-gray-800 border-l-4 ${colors.border} bg-gray-900/40 hover:bg-gray-800/50 transition-all duration-200 p-4 sm:p-5 group`}
    >
      {showClear ? (
        <div className="flex items-center gap-2 mb-2">
          <svg
            className="w-8 h-8 text-green-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
      ) : (
        <div
          className={`text-3xl sm:text-4xl font-black ${colors.text} transition-opacity duration-500`}
        >
          {number}
        </div>
      )}
      <p className="text-sm font-semibold text-gray-300 mt-1 leading-tight">
        {label}
      </p>
      <p className="text-xs text-gray-600 mt-0.5">
        {showClear ? "All clear" : subtitle}
      </p>
    </button>
  );
}
