"use client";

import { useState, useEffect, useCallback } from "react";

interface HealthStatus {
  source: string;
  status: "healthy" | "degraded" | "down" | "unknown";
  responseMs: number | null;
  checkedAt: string;
}

interface Deployment {
  id: string;
  target: string;
  status: string;
  commitSha: string | null;
  branch: string | null;
  startedAt: string;
}

interface TestRun {
  id: string;
  suite: string;
  status: string;
  totalTests: number | null;
  passed: number | null;
  failed: number | null;
  durationMs: number | null;
  startedAt: string;
}

interface Session {
  id: string;
  sessionType: string;
  status: string;
  title: string | null;
  startedAt: string;
}

const STATUS_COLORS: Record<string, { dot: string; bg: string; text: string }> = {
  healthy:   { dot: "bg-green-400",  bg: "bg-green-500/10",  text: "text-green-400" },
  degraded:  { dot: "bg-amber-400",  bg: "bg-amber-500/10",  text: "text-amber-400" },
  down:      { dot: "bg-red-400",    bg: "bg-red-500/10",    text: "text-red-400" },
  unknown:   { dot: "bg-gray-500",   bg: "bg-gray-500/10",   text: "text-gray-500" },
  success:   { dot: "bg-green-400",  bg: "bg-green-500/10",  text: "text-green-400" },
  passed:    { dot: "bg-green-400",  bg: "bg-green-500/10",  text: "text-green-400" },
  failed:    { dot: "bg-red-400",    bg: "bg-red-500/10",    text: "text-red-400" },
  running:   { dot: "bg-blue-400",   bg: "bg-blue-500/10",   text: "text-blue-400" },
  deploying: { dot: "bg-blue-400",   bg: "bg-blue-500/10",   text: "text-blue-400" },
  completed: { dot: "bg-green-400",  bg: "bg-green-500/10",  text: "text-green-400" },
};

function StatusDot({ status }: { status: string }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.unknown;
  return (
    <span className="relative flex h-2.5 w-2.5">
      {(status === "running" || status === "deploying") && (
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${c.dot} opacity-75`} />
      )}
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${c.dot}`} />
    </span>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ControlPlanePage() {
  const [health, setHealth] = useState<HealthStatus[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [hRes, dRes, tRes] = await Promise.all([
        fetch("/api/dev-portal/health"),
        fetch("/api/dev-portal/deployments?limit=5"),
        fetch("/api/dev-portal/tests?limit=5"),
      ]);
      if (hRes.ok) {
        const hData = await hRes.json();
        setHealth(hData.services || []);
        setSessions(hData.activeSessions || []);
      }
      if (dRes.ok) setDeployments((await dRes.json()).deployments || []);
      if (tRes.ok) setTestRuns((await tRes.json()).testRuns || []);
    } catch {
      // silently fail — UI shows empty states
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const overallStatus = health.length === 0
    ? "unknown"
    : health.every((h) => h.status === "healthy")
      ? "healthy"
      : health.some((h) => h.status === "down")
        ? "down"
        : "degraded";

  const overallColors = STATUS_COLORS[overallStatus] || STATUS_COLORS.unknown;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
            Control Plane
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            IronSight development orchestration
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {lastRefresh.toLocaleTimeString()}
          </span>
          <button
            onClick={fetchAll}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-700 hover:border-gray-600 bg-gray-800/50 hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Overall Status Banner */}
      <div className={`rounded-xl border border-gray-800 ${overallColors.bg} p-4 flex items-center gap-3`}>
        <StatusDot status={overallStatus} />
        <span className={`text-sm font-semibold ${overallColors.text}`}>
          {overallStatus === "healthy" ? "All Systems Operational" :
           overallStatus === "down" ? "System Outage Detected" :
           overallStatus === "degraded" ? "Degraded Performance" :
           "Checking Systems..."}
        </span>
        <span className="text-xs text-gray-500 ml-auto">
          {health.length} services monitored
        </span>
      </div>

      {/* Health Grid */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">
          Service Health
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {(health.length > 0 ? health : [
            { source: "Vercel", status: "unknown" as const, responseMs: null, checkedAt: new Date().toISOString() },
            { source: "Supabase", status: "unknown" as const, responseMs: null, checkedAt: new Date().toISOString() },
            { source: "Viam", status: "unknown" as const, responseMs: null, checkedAt: new Date().toISOString() },
            { source: "Clerk", status: "unknown" as const, responseMs: null, checkedAt: new Date().toISOString() },
            { source: "GitHub", status: "unknown" as const, responseMs: null, checkedAt: new Date().toISOString() },
            { source: "Pi 5", status: "unknown" as const, responseMs: null, checkedAt: new Date().toISOString() },
          ]).map((s) => {
            const c = STATUS_COLORS[s.status] || STATUS_COLORS.unknown;
            return (
              <div
                key={s.source}
                className={`rounded-xl border border-gray-800 bg-gray-900/40 p-4 flex flex-col gap-2`}
              >
                <div className="flex items-center gap-2">
                  <StatusDot status={s.status} />
                  <span className="text-sm font-semibold text-gray-200 truncate">
                    {s.source}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className={`text-xs capitalize ${c.text}`}>
                    {s.status}
                  </span>
                  {s.responseMs !== null && (
                    <span className="text-xs text-gray-500">
                      {s.responseMs}ms
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Deployments */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500">
              Recent Deployments
            </h2>
            <a href="/dev-portal/deployments" className="text-xs text-cyan-500 hover:text-cyan-400">
              View All
            </a>
          </div>
          <div className="space-y-2">
            {deployments.length === 0 ? (
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-6 text-center">
                <p className="text-sm text-gray-500">No deployments recorded yet</p>
                <p className="text-xs text-gray-700 mt-1">
                  Deployments will appear here as they happen
                </p>
              </div>
            ) : (
              deployments.map((d) => (
                <div
                  key={d.id}
                  className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 flex items-center gap-3"
                >
                  <StatusDot status={d.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-200">
                        {d.target}
                      </span>
                      {d.branch && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 font-mono">
                          {d.branch}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {d.commitSha && (
                        <span className="text-xs text-gray-500 font-mono">
                          {d.commitSha.slice(0, 7)}
                        </span>
                      )}
                      <span className="text-xs text-gray-700">
                        {timeAgo(d.startedAt)}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Test Runs */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500">
              Recent Test Runs
            </h2>
            <a href="/dev-portal/tests" className="text-xs text-cyan-500 hover:text-cyan-400">
              View All
            </a>
          </div>
          <div className="space-y-2">
            {testRuns.length === 0 ? (
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-6 text-center">
                <p className="text-sm text-gray-500">No test runs recorded yet</p>
                <p className="text-xs text-gray-700 mt-1">
                  Run tests to see results here
                </p>
              </div>
            ) : (
              testRuns.map((t) => (
                <div
                  key={t.id}
                  className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 flex items-center gap-3"
                >
                  <StatusDot status={t.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-200">
                        {t.suite}
                      </span>
                      {t.totalTests !== null && (
                        <span className="text-xs text-gray-500">
                          {t.passed}/{t.totalTests} passed
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {t.durationMs !== null && (
                        <span className="text-xs text-gray-500">
                          {(t.durationMs / 1000).toFixed(1)}s
                        </span>
                      )}
                      <span className="text-xs text-gray-700">
                        {timeAgo(t.startedAt)}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Active Sessions */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">
          Active AI Sessions
        </h2>
        {sessions.length === 0 ? (
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-6 text-center">
            <p className="text-sm text-gray-500">No active sessions</p>
            <p className="text-xs text-gray-700 mt-1">
              Sessions appear here when Claude Code or automated workflows are running
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 flex items-center gap-3"
              >
                <StatusDot status={s.status} />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-200">
                    {s.title || s.sessionType}
                  </span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                      {s.sessionType}
                    </span>
                    <span className="text-xs text-gray-700">
                      {timeAgo(s.startedAt)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
