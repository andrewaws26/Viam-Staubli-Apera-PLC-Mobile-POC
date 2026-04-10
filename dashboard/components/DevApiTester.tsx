"use client";

import { useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Known API routes
// ---------------------------------------------------------------------------
interface ApiRoute {
  label: string;
  path: string;
  method: "GET" | "POST";
  defaultParams?: string;
  defaultBody?: string;
}

const API_ROUTES: ApiRoute[] = [
  // Telemetry
  { label: "Sensor Readings (TPS)", path: "/api/sensor-readings", method: "GET", defaultParams: "component=plc-monitor" },
  { label: "Truck Readings", path: "/api/truck-readings", method: "GET", defaultParams: "component=truck-engine" },
  { label: "Sensor History", path: "/api/sensor-history", method: "GET", defaultParams: "type=summary&hours=24" },
  { label: "Truck History", path: "/api/truck-history", method: "GET", defaultParams: "hours=24" },
  { label: "DTC History", path: "/api/dtc-history", method: "GET", defaultParams: "hours=24" },
  // Fleet
  { label: "Fleet Status", path: "/api/fleet/status", method: "GET" },
  { label: "Fleet Trucks", path: "/api/fleet/trucks", method: "GET" },
  { label: "Truck Assignments", path: "/api/truck-assignments", method: "GET" },
  { label: "Team Members", path: "/api/team-members", method: "GET" },
  // Health
  { label: "Pi Health (TPS)", path: "/api/pi-health", method: "GET", defaultParams: "host=tps" },
  { label: "Pi Health (Truck)", path: "/api/pi-health", method: "GET", defaultParams: "host=truck" },
  // Work Orders
  { label: "Work Orders", path: "/api/work-orders", method: "GET" },
  { label: "Maintenance", path: "/api/maintenance", method: "GET" },
  // AI
  { label: "AI Chat (Debug)", path: "/api/ai-chat", method: "POST", defaultParams: "debug=1", defaultBody: '{"messages":[{"role":"user","content":"test"}],"readings":{}}' },
  { label: "AI Diagnose", path: "/api/ai-diagnose", method: "POST", defaultBody: '{"readings":{}}' },
  { label: "AI Report Summary", path: "/api/ai-report-summary", method: "POST", defaultBody: '{"report":"test summary"}' },
  { label: "AI Suggest Steps", path: "/api/ai-suggest-steps", method: "POST", defaultBody: '{"title":"DPF regen keeps aborting"}' },
  // Commands
  { label: "Truck Command", path: "/api/truck-command", method: "POST", defaultBody: '{"command":"get_bus_stats"}' },
  { label: "PLC Command", path: "/api/plc-command", method: "POST", defaultBody: '{"action":"reset_counters"}' },
  // Reports
  { label: "Shift Report", path: "/api/shift-report", method: "GET", defaultParams: "hours=8" },
  // Admin
  { label: "Audit Log", path: "/api/audit-log", method: "GET", defaultParams: "limit=20" },
  { label: "Truck Notes", path: "/api/truck-notes", method: "GET" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DevApiTester() {
  const [expanded, setExpanded] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [params, setParams] = useState(API_ROUTES[0].defaultParams || "");
  const [body, setBody] = useState(API_ROUTES[0].defaultBody || "");
  const [response, setResponse] = useState<{
    status: number;
    statusText: string;
    time: number;
    data: unknown;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const route = API_ROUTES[selectedIdx];

  const onRouteChange = useCallback(
    (idx: number) => {
      setSelectedIdx(idx);
      setParams(API_ROUTES[idx].defaultParams || "");
      setBody(API_ROUTES[idx].defaultBody || "");
      setResponse(null);
    },
    []
  );

  const send = useCallback(async () => {
    setLoading(true);
    setResponse(null);
    const start = performance.now();
    try {
      const url = params ? `${route.path}?${params}` : route.path;
      const opts: RequestInit = { method: route.method };
      if (route.method === "POST" && body) {
        opts.headers = { "Content-Type": "application/json" };
        opts.body = body;
      }
      const res = await fetch(url, opts);
      const elapsed = Math.round(performance.now() - start);
      let data: unknown;
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("json")) {
        data = await res.json();
      } else {
        data = await res.text();
      }
      setResponse({ status: res.status, statusText: res.statusText, time: elapsed, data });
    } catch (err) {
      const elapsed = Math.round(performance.now() - start);
      setResponse({
        status: 0,
        statusText: "Network Error",
        time: elapsed,
        data: { error: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      setLoading(false);
    }
  }, [route, params, body]);

  const statusColor =
    response === null
      ? ""
      : response.status >= 200 && response.status < 300
        ? "text-green-400"
        : response.status >= 400
          ? "text-red-400"
          : "text-yellow-400";

  return (
    <section className="border border-gray-800 rounded-2xl overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full p-4 sm:p-5 flex items-center justify-between gap-3 text-left hover:bg-gray-800/50 transition-colors"
      >
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400">
          API Route Tester
        </h2>
        <span className="text-gray-500 text-xs shrink-0">
          {expanded ? "\u25B2" : "\u25BC"}
        </span>
      </button>

      {expanded && (
        <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-4">
          {/* Route selector */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-500 uppercase tracking-wide block mb-1">
                Route
              </label>
              <select
                value={selectedIdx}
                onChange={(e) => onRouteChange(Number(e.target.value))}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 focus:border-blue-500 focus:outline-none"
              >
                {API_ROUTES.map((r, i) => (
                  <option key={i} value={i}>
                    {r.method} {r.path} — {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={send}
                disabled={loading}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs font-bold uppercase tracking-wider rounded-lg transition-colors whitespace-nowrap"
              >
                {loading ? "Sending\u2026" : "Send"}
              </button>
            </div>
          </div>

          {/* Query params */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wide block mb-1">
              Query Parameters
            </label>
            <input
              type="text"
              value={params}
              onChange={(e) => setParams(e.target.value)}
              placeholder="e.g. hours=24&truck_id=truck-01"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs font-mono text-gray-200 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* Request body (POST only) */}
          {route.method === "POST" && (
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide block mb-1">
                Request Body (JSON)
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs font-mono text-gray-200 focus:border-blue-500 focus:outline-none resize-y"
              />
            </div>
          )}

          {/* Response */}
          {response && (
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-xs">
                <span className={`font-bold font-mono ${statusColor}`}>
                  {response.status} {response.statusText}
                </span>
                <span className="text-gray-500 font-mono">
                  {response.time}ms
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(
                      typeof response.data === "string"
                        ? response.data
                        : JSON.stringify(response.data, null, 2)
                    );
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="ml-auto px-2 py-1 bg-gray-800 hover:bg-gray-800/50 text-gray-400 text-xs rounded transition-colors"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <pre className="bg-gray-900/50 border border-gray-800 rounded-lg p-3 text-xs sm:text-xs text-gray-400 font-mono overflow-x-auto max-h-96 overflow-y-auto">
                {typeof response.data === "string"
                  ? response.data
                  : JSON.stringify(response.data, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
