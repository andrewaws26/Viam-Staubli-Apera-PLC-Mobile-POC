"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import DevStatusBar from "../../components/DevStatusBar";
import DevTruckPanel from "../../components/DevTruckPanel";
import DevTPSPanel from "../../components/DevTPSPanel";
import DevApiTester from "../../components/DevApiTester";

// ---------------------------------------------------------------------------
// Environment guard — production requires explicit opt-in
// ---------------------------------------------------------------------------
const DEV_PAGE_ALLOWED =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_ENABLE_DEV_PAGE === "true";

// ---------------------------------------------------------------------------
// Known env vars to check (names only — never expose values)
// ---------------------------------------------------------------------------
const ENV_VARS = [
  { name: "VIAM_API_KEY", scope: "server" },
  { name: "VIAM_API_KEY_ID", scope: "server" },
  { name: "VIAM_MACHINE_ADDRESS", scope: "server" },
  { name: "VIAM_PART_ID", scope: "server" },
  { name: "TRUCK_VIAM_MACHINE_ADDRESS", scope: "server" },
  { name: "TRUCK_VIAM_API_KEY", scope: "server" },
  { name: "TRUCK_VIAM_API_KEY_ID", scope: "server" },
  { name: "TRUCK_VIAM_PART_ID", scope: "server" },
  { name: "ANTHROPIC_API_KEY", scope: "server" },
  { name: "SUPABASE_URL", scope: "server" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", scope: "server" },
  { name: "FLEET_TRUCKS", scope: "server" },
  { name: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", scope: "public" },
  { name: "CLERK_SECRET_KEY", scope: "server" },
  { name: "NEXT_PUBLIC_ENABLE_DEV_PAGE", scope: "public" },
];

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function DevPage() {
  const router = useRouter();

  // Redirect in production unless explicitly enabled
  useEffect(() => {
    if (!DEV_PAGE_ALLOWED) {
      router.push("/");
    }
  }, [router]);

  // AI Debug state
  const [aiDebug, setAiDebug] = useState<{
    loaded: boolean;
    error: string | null;
    data: Record<string, unknown> | null;
  }>({ loaded: false, error: null, data: null });
  const [aiDebugExpanded, setAiDebugExpanded] = useState(false);

  // Work orders quick stats
  const [woStats, setWoStats] = useState<{
    loaded: boolean;
    open: number;
    in_progress: number;
    blocked: number;
    done: number;
    total: number;
  }>({ loaded: false, open: 0, in_progress: 0, blocked: 0, done: 0, total: 0 });
  const [woExpanded, setWoExpanded] = useState(false);

  // Env check state
  const [envCheck, setEnvCheck] = useState<{
    loaded: boolean;
    vars: { name: string; set: boolean; scope: string }[];
    fleet: { id: string; name: string }[];
  }>({ loaded: false, vars: [], fleet: [] });
  const [envExpanded, setEnvExpanded] = useState(false);

  // -----------------------------------------------------------------------
  // AI Debug — fetch once when expanded
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!aiDebugExpanded || aiDebug.loaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ai-chat?debug=1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "debug" }],
            readings: {},
          }),
        });
        const json = await res.json();
        if (!cancelled) {
          setAiDebug({ loaded: true, error: null, data: json });
        }
      } catch (err) {
        if (!cancelled) {
          setAiDebug({
            loaded: true,
            error: err instanceof Error ? err.message : String(err),
            data: null,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [aiDebugExpanded, aiDebug.loaded]);

  // -----------------------------------------------------------------------
  // Work order stats — fetch once when expanded
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!woExpanded || woStats.loaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/work-orders");
        if (!res.ok) throw new Error("Failed");
        const data = await res.json();
        const counts = { open: 0, in_progress: 0, blocked: 0, done: 0, total: data.length };
        for (const wo of data) {
          if (wo.status in counts) counts[wo.status as keyof typeof counts]++;
        }
        if (!cancelled) setWoStats({ loaded: true, ...counts });
      } catch {
        if (!cancelled) setWoStats((prev) => ({ ...prev, loaded: true }));
      }
    })();
    return () => { cancelled = true; };
  }, [woExpanded, woStats.loaded]);

  // -----------------------------------------------------------------------
  // Env check — fetch once when expanded
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!envExpanded || envCheck.loaded) return;
    let cancelled = false;
    (async () => {
      try {
        // Check which env vars are available by hitting an API that reports them
        // We can't check server env vars from client, but we can check fleet config
        const fleetRes = await fetch("/api/fleet/trucks");
        const fleet = fleetRes.ok ? await fleetRes.json() : [];

        // For server env vars, we infer from API behavior
        const checks = ENV_VARS.map((v) => ({
          name: v.name,
          scope: v.scope,
          // Public vars we can check directly
          set:
            v.scope === "public"
              ? !!process.env[`NEXT_PUBLIC_${v.name.replace("NEXT_PUBLIC_", "")}`] ||
                v.name === "NEXT_PUBLIC_ENABLE_DEV_PAGE"
                ? process.env.NEXT_PUBLIC_ENABLE_DEV_PAGE !== undefined
                : false
              : true, // Server vars — assume set (can't verify from client)
        }));

        if (!cancelled) {
          setEnvCheck({ loaded: true, vars: checks, fleet });
        }
      } catch {
        if (!cancelled) {
          setEnvCheck({ loaded: true, vars: [], fleet: [] });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [envExpanded, envCheck.loaded]);

  // Don't render anything while redirecting
  if (!DEV_PAGE_ALLOWED) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* ================================================================== */}
      {/* Section 1: System Status Bar (sticky)                              */}
      {/* ================================================================== */}
      <DevStatusBar />

      {/* Page header */}
      <header className="px-3 sm:px-6 pt-4 pb-2">
        <h1 className="text-lg sm:text-2xl font-black tracking-widest uppercase text-gray-100 leading-none">
          IronSight Dev Mode
        </h1>
        <p className="text-[10px] sm:text-xs text-gray-600 mt-0.5 tracking-wide">
          Engineering cockpit &mdash; system diagnostics, testing, calibration
        </p>
      </header>

      <main className="px-3 sm:px-6 pb-6 space-y-4">
        {/* ================================================================ */}
        {/* Sections 2 & 3: Two-column Pi panels                             */}
        {/* ================================================================ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: Pi Zero — Truck Diagnostics */}
          <DevTruckPanel />
          {/* Right: Pi 5 — TPS/PLC */}
          <DevTPSPanel />
        </div>

        {/* ================================================================ */}
        {/* Section 4: AI Diagnostics Debug                                   */}
        {/* ================================================================ */}
        <section className="border border-gray-800 rounded-2xl overflow-hidden">
          <button
            onClick={() => setAiDebugExpanded((e) => !e)}
            className="w-full p-4 sm:p-5 flex items-center justify-between gap-3 text-left hover:bg-gray-900/30 transition-colors"
          >
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400">
              AI Diagnostics Debug
            </h2>
            <span className="text-gray-600 text-xs shrink-0">
              {aiDebugExpanded ? "\u25B2" : "\u25BC"}
            </span>
          </button>

          {aiDebugExpanded && (
            <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-4">
              <p className="text-[10px] text-gray-600">
                Shows the system prompt and historical data context the AI sees
                when answering diagnostic questions. Fetched via{" "}
                <code className="bg-gray-900 px-1 py-0.5 rounded text-gray-400">
                  /api/ai-chat?debug=1
                </code>
              </p>

              {!aiDebug.loaded && (
                <p className="text-xs text-gray-500 animate-pulse">
                  Loading AI debug data&hellip;
                </p>
              )}

              {aiDebug.error && (
                <div className="p-3 bg-red-950/30 border border-red-900/50 rounded-lg text-xs text-red-400">
                  {aiDebug.error}
                </div>
              )}

              {aiDebug.data && (
                <div className="space-y-4">
                  {/* History status */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <KV
                      label="Has History Data"
                      value={aiDebug.data.historyHasData ? "Yes" : "No"}
                    />
                    {aiDebug.data.historyDebug ? (
                      <>
                        <KV
                          label="Total Points"
                          value={String(
                            (aiDebug.data.historyDebug as Record<string, unknown>)
                              .totalPoints || 0
                          )}
                        />
                        <KV
                          label="24h Points"
                          value={String(
                            (aiDebug.data.historyDebug as Record<string, unknown>)
                              .points24h || 0
                          )}
                        />
                        <KV
                          label="Cache Age"
                          value={`${(aiDebug.data.historyDebug as Record<string, unknown>).cacheAgeMinutes || "?"} min`}
                        />
                      </>
                    ) : null}
                  </div>

                  {/* System prompt */}
                  {aiDebug.data.systemPrompt ? (
                    <div>
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-2">
                        System Prompt (what the AI sees)
                      </h3>
                      <pre className="bg-gray-900/50 border border-gray-800 rounded-lg p-3 text-[10px] sm:text-xs text-gray-400 font-mono overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
                        {String(aiDebug.data.systemPrompt)}
                      </pre>
                    </div>
                  ) : null}

                  {/* Full debug JSON */}
                  <details>
                    <summary className="text-[10px] font-bold uppercase tracking-widest text-gray-600 cursor-pointer hover:text-gray-400">
                      Full Debug JSON
                    </summary>
                    <pre className="mt-2 bg-gray-900/50 border border-gray-800 rounded-lg p-3 text-[10px] text-gray-500 font-mono overflow-x-auto max-h-64 overflow-y-auto">
                      {JSON.stringify(aiDebug.data, null, 2)}
                    </pre>
                  </details>

                  {/* Refresh button */}
                  <button
                    onClick={() => {
                      setAiDebug({ loaded: false, error: null, data: null });
                    }}
                    className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs font-bold uppercase tracking-wider rounded-lg transition-colors"
                  >
                    Refresh
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ================================================================ */}
        {/* Section 5: API Route Tester                                      */}
        {/* ================================================================ */}
        <DevApiTester />

        {/* ================================================================ */}
        {/* Section 6: Work Order Stats                                       */}
        {/* ================================================================ */}
        <section className="border border-gray-800 rounded-2xl overflow-hidden">
          <button
            onClick={() => setWoExpanded((e) => !e)}
            className="w-full p-4 sm:p-5 flex items-center justify-between gap-3 text-left hover:bg-gray-900/30 transition-colors"
          >
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400">
              Work Orders
            </h2>
            <span className="text-gray-600 text-xs shrink-0">
              {woExpanded ? "\u25B2" : "\u25BC"}
            </span>
          </button>

          {woExpanded && (
            <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-4">
              {woStats.loaded ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <div className="bg-gray-900 rounded-lg p-3 text-center">
                      <span className="text-2xl font-bold text-gray-100">{woStats.total}</span>
                      <p className="text-[10px] text-gray-500 mt-1 uppercase tracking-wider">Total</p>
                    </div>
                    <div className="bg-gray-900 rounded-lg p-3 text-center">
                      <span className="text-2xl font-bold text-gray-400">{woStats.open}</span>
                      <p className="text-[10px] text-gray-500 mt-1 uppercase tracking-wider">Open</p>
                    </div>
                    <div className="bg-gray-900 rounded-lg p-3 text-center">
                      <span className="text-2xl font-bold text-amber-400">{woStats.in_progress}</span>
                      <p className="text-[10px] text-gray-500 mt-1 uppercase tracking-wider">In Progress</p>
                    </div>
                    <div className="bg-gray-900 rounded-lg p-3 text-center">
                      <span className="text-2xl font-bold text-red-400">{woStats.blocked}</span>
                      <p className="text-[10px] text-gray-500 mt-1 uppercase tracking-wider">Blocked</p>
                    </div>
                    <div className="bg-gray-900 rounded-lg p-3 text-center">
                      <span className="text-2xl font-bold text-green-400">{woStats.done}</span>
                      <p className="text-[10px] text-gray-500 mt-1 uppercase tracking-wider">Done</p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <a
                      href="/work"
                      className="text-xs px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold uppercase tracking-wider rounded-lg transition-colors"
                    >
                      Open Work Board
                    </a>
                    <button
                      onClick={() => setWoStats((prev) => ({ ...prev, loaded: false }))}
                      className="text-xs px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 font-bold uppercase tracking-wider rounded-lg transition-colors"
                    >
                      Refresh
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-500 animate-pulse">Loading work order stats&hellip;</p>
              )}
            </div>
          )}
        </section>

        {/* ================================================================ */}
        {/* Section 7: Environment & Config                                   */}
        {/* ================================================================ */}
        <section className="border border-gray-800 rounded-2xl overflow-hidden">
          <button
            onClick={() => setEnvExpanded((e) => !e)}
            className="w-full p-4 sm:p-5 flex items-center justify-between gap-3 text-left hover:bg-gray-900/30 transition-colors"
          >
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400">
              Environment &amp; Config
            </h2>
            <span className="text-gray-600 text-xs shrink-0">
              {envExpanded ? "\u25B2" : "\u25BC"}
            </span>
          </button>

          {envExpanded && (
            <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-4">
              {/* Dashboard info */}
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
                  Dashboard
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                  <KV
                    label="Environment"
                    value={
                      process.env.NODE_ENV === "production" ? "Production" : "Development"
                    }
                  />
                  <KV label="Framework" value="Next.js 14" />
                  <KV label="Host" value="Vercel" />
                  <KV
                    label="Dev Page"
                    value={DEV_PAGE_ALLOWED ? "Enabled" : "Disabled"}
                  />
                </div>
              </div>

              {/* Env vars */}
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
                  Environment Variables (names only)
                </h3>
                <div className="space-y-1">
                  {ENV_VARS.map((v) => (
                    <div
                      key={v.name}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          v.scope === "server"
                            ? "bg-gray-600"
                            : "bg-blue-600"
                        }`}
                      />
                      <span className="font-mono text-gray-400">{v.name}</span>
                      <span className="text-[10px] text-gray-700">
                        ({v.scope})
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-gray-700 mt-2">
                  Server-side vars cannot be verified from the browser. Check
                  Vercel dashboard for actual values.
                </p>
              </div>

              {/* Fleet config */}
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
                  Fleet Config
                </h3>
                {envCheck.loaded ? (
                  envCheck.fleet.length > 0 ? (
                    <div className="space-y-1">
                      {envCheck.fleet.map(
                        (t: { id: string; name: string }, i: number) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 text-xs"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-green-600 shrink-0" />
                            <span className="font-mono text-gray-400">
                              {t.id}
                            </span>
                            <span className="text-gray-600">{t.name}</span>
                          </div>
                        )
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-600">
                      Single-truck mode (no FLEET_TRUCKS configured)
                    </p>
                  )
                ) : (
                  <p className="text-xs text-gray-700 animate-pulse">
                    Loading&hellip;
                  </p>
                )}
              </div>

              {/* Viam Part IDs */}
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-2 border-b border-gray-800/50 pb-1">
                  Viam Part IDs (defaults)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <KV
                    label="Pi 5 (TPS)"
                    value="7c24d42f-1d66-4cae-81a4-97e3ff9404b4"
                    mono
                  />
                  <KV
                    label="Pi Zero (Truck)"
                    value="ca039781-665c-47e3-9bc5-35f603f3baf1"
                    mono
                  />
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 px-3 sm:px-6 py-2 sm:py-3 text-[10px] sm:text-xs text-gray-700 flex items-center justify-between">
        <span>IronSight Dev Mode</span>
        <span>
          {new Date().getFullYear()}
        </span>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KV({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-[10px] text-gray-600 uppercase tracking-wide truncate">
        {label}
      </span>
      <span
        className={`text-xs sm:text-sm text-gray-300 truncate ${mono ? "font-mono" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
