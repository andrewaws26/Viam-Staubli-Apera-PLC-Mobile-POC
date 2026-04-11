"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  DEMO_TIMELINE,
  getDemoSimData,
  getOverallStatus,
  getActiveIssues,
  getSubsystems,
  getDiagnosis,
  getShiftSummary,
  cToF,
  type DemoPhase,
  type DemoEvent,
  type OverallStatus,
  type ActiveIssue,
  type SubsystemStatus,
  type DiagnosisStep,
  type ShiftSummary,
} from "@/lib/demo-engine";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PHASE_ORDER: DemoPhase[] = [
  "intro", "normal", "temp_rising", "warning", "shutdown",
  "response", "recovery", "resolved", "shift_end", "complete",
];

const STORAGE_KEY = "ironsight-demo-progress";

// ---------------------------------------------------------------------------
// Helper: format seconds as m:ss
// ---------------------------------------------------------------------------
function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function DemoPage() {
  const router = useRouter();

  // --- State ---
  const [currentIdx, setCurrentIdx] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed < DEMO_TIMELINE.length) {
          return parsed;
        }
      }
    }
    return 0;
  });

  const [elapsed, setElapsed] = useState(() => DEMO_TIMELINE[0]?.time ?? 0);
  const [paused, setPaused] = useState(false);
  const [chatHistory, setChatHistory] = useState<
    { from: string; message: string; time: number }[]
  >([]);
  const [narrationVisible, setNarrationVisible] = useState(true);
  const [statusPulse, setStatusPulse] = useState(false);
  const [diagnosisVisible, setDiagnosisVisible] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentIdxRef = useRef(currentIdx);
  currentIdxRef.current = currentIdx;
  const prevPhaseRef = useRef<DemoPhase>("intro");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const event = DEMO_TIMELINE[currentIdx];
  const phase = event.phase;
  const status = getOverallStatus(phase);
  const issues = getActiveIssues(phase);
  const subsystems = getSubsystems(phase);
  const diagnosis = getDiagnosis(phase);
  const shiftSummary = getShiftSummary(phase);
  const simData = useMemo(() => getDemoSimData(phase), [phase]);

  const progress = ((currentIdx + 1) / DEMO_TIMELINE.length) * 100;
  const isComplete = phase === "complete";
  const isInteractive = event.interactive === true;
  const [waitingForTap, setWaitingForTap] = useState(false);

  // --- Persist progress ---
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, String(currentIdx));
    }
  }, [currentIdx]);

  // --- Phase change effects ---
  useEffect(() => {
    if (phase !== prevPhaseRef.current) {
      // Narration fade-in
      setNarrationVisible(false);
      const t = setTimeout(() => setNarrationVisible(true), 80);

      // Status pulse on color change
      const prevStatus = getOverallStatus(prevPhaseRef.current);
      const newStatus = getOverallStatus(phase);
      if (prevStatus !== newStatus) {
        setStatusPulse(true);
        setTimeout(() => setStatusPulse(false), 1200);
      }

      // Diagnosis visibility
      setDiagnosisVisible(phase === "shutdown" || phase === "response");

      // Chat messages
      if (event.chatMessage && event.chatFrom) {
        setChatHistory((prev) => {
          // Don't duplicate
          if (prev.some((m) => m.message === event.chatMessage)) return prev;
          return [
            ...prev,
            { from: event.chatFrom!, message: event.chatMessage!, time: event.time },
          ];
        });
      }

      prevPhaseRef.current = phase;
      return () => clearTimeout(t);
    }
  }, [phase, event]);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  // --- Interactive pause: set waitingForTap when reaching an interactive phase ---
  useEffect(() => {
    if (isInteractive) {
      setWaitingForTap(true);
    }
  }, [currentIdx, isInteractive]);

  // --- Auto-advance timer ---
  useEffect(() => {
    if (paused || isComplete || waitingForTap) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    timerRef.current = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 0.1;
        // Check if we should advance to next phase (use ref to avoid stale closure)
        const idx = currentIdxRef.current;
        const nextIdx = idx + 1;
        if (nextIdx < DEMO_TIMELINE.length) {
          const nextEvent = DEMO_TIMELINE[nextIdx];
          // Skip auto-advance for interactive phases (time=0 means wait for tap)
          if (nextEvent.time > 0 && next >= nextEvent.time) {
            setCurrentIdx(nextIdx);
          }
        }
        return next;
      });
    }, 100);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [paused, isComplete, waitingForTap, currentIdx]);

  // --- Navigation ---
  const goToPhase = useCallback((idx: number) => {
    if (idx < 0 || idx >= DEMO_TIMELINE.length) return;
    setCurrentIdx(idx);
    setWaitingForTap(false);
    setElapsed(DEMO_TIMELINE[idx].time);
    // Rebuild chat history up to this point
    const msgs: { from: string; message: string; time: number }[] = [];
    for (let i = 0; i <= idx; i++) {
      const e = DEMO_TIMELINE[i];
      if (e.chatMessage && e.chatFrom) {
        msgs.push({ from: e.chatFrom, message: e.chatMessage, time: e.time });
      }
    }
    setChatHistory(msgs);
  }, []);

  // Handle interactive tap — advance to next phase
  const handleInteractiveTap = useCallback(() => {
    setWaitingForTap(false);
    const next = Math.min(currentIdx + 1, DEMO_TIMELINE.length - 1);
    goToPhase(next);
  }, [currentIdx, goToPhase]);

  const skipNext = useCallback(() => {
    const next = Math.min(currentIdx + 1, DEMO_TIMELINE.length - 1);
    goToPhase(next);
  }, [currentIdx, goToPhase]);

  const restart = useCallback(() => {
    goToPhase(0);
    setChatHistory([]);
    setPaused(false);
  }, [goToPhase]);

  const handleCopyLink = useCallback(() => {
    if (typeof navigator !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  }, []);

  // Key temperature for display
  const dsiTempC = (simData.staubli_temp_dsi as number) ?? 39;
  const cpuTempC = (simData.staubli_temp_cpu as number) ?? 55;
  const robotConnected = (simData.staubli_connected as boolean) ?? true;
  const slaveCount = (simData.staubli_ioboard_slave_count as number) ?? 3;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-[#04060e] text-gray-100 selection:bg-violet-600/40">
      {/* Atmospheric background — subtle grid + radial gradient */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(124,58,237,0.06) 0%, transparent 70%), " +
            "linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), " +
            "linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)",
          backgroundSize: "100% 100%, 40px 40px, 40px 40px",
        }}
      />

      {/* ================================================================== */}
      {/* HEADER BAR — fixed top                                             */}
      {/* ================================================================== */}
      <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-[#04060e]/80 border-b border-white/[0.06]">
        {/* Progress rail */}
        <div className="h-[3px] bg-gray-900 relative overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 transition-all duration-700 ease-out"
            style={{
              width: `${progress}%`,
              background:
                status === "red"
                  ? "linear-gradient(90deg, #dc2626 0%, #ef4444 100%)"
                  : status === "orange"
                  ? "linear-gradient(90deg, #d97706 0%, #f59e0b 100%)"
                  : "linear-gradient(90deg, #7c3aed 0%, #a78bfa 100%)",
            }}
          />
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          {/* Logo + badge */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => router.push("/")}
              className="text-lg sm:text-xl font-black tracking-tight text-white shrink-0 hover:opacity-80 transition-opacity"
              style={{ fontFamily: "'SF Pro Display', 'Helvetica Neue', system-ui, sans-serif" }}
            >
              Iron<span className="text-violet-400">Sight</span>
            </button>
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-[0.15em] bg-violet-600/20 text-violet-300 border border-violet-500/20 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
              Live Demo
            </span>
          </div>

          {/* Phase dots — desktop */}
          <div className="hidden md:flex items-center gap-1.5">
            {DEMO_TIMELINE.map((ev, i) => {
              const isActive = i === currentIdx;
              const isPast = i < currentIdx;
              const phaseStatus = getOverallStatus(ev.phase);
              const dotColor =
                isActive && phaseStatus === "red"
                  ? "bg-red-500"
                  : isActive && phaseStatus === "orange"
                  ? "bg-amber-500"
                  : isActive
                  ? "bg-violet-400"
                  : isPast
                  ? "bg-gray-500"
                  : "bg-gray-700";

              return (
                <button
                  key={i}
                  onClick={() => goToPhase(i)}
                  className={`transition-all duration-300 rounded-full hover:scale-125 ${dotColor} ${
                    isActive ? "w-3 h-3 ring-2 ring-white/20" : "w-2 h-2"
                  }`}
                  title={ev.title}
                />
              );
            })}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-gray-500 font-mono tabular-nums hidden sm:block">
              {fmtTime(elapsed)}
            </span>

            {!isComplete && (
              <button
                onClick={() => setPaused((p) => !p)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                title={paused ? "Resume" : "Pause"}
              >
                {paused ? (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.344-5.891a1.5 1.5 0 000-2.538L6.3 2.841z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75A.75.75 0 007.25 3h-1.5zM12.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-1.5z" />
                  </svg>
                )}
              </button>
            )}

            {!isComplete && (
              <button
                onClick={skipNext}
                className="text-xs px-2.5 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                Skip
              </button>
            )}

            <button
              onClick={restart}
              className="text-xs px-2.5 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              Restart
            </button>
          </div>
        </div>
      </header>

      {/* ================================================================== */}
      {/* MAIN CONTENT                                                       */}
      {/* ================================================================== */}
      <main className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 pt-24 pb-32 space-y-6">

        {/* ---------------------------------------------------------------- */}
        {/* NARRATION PANEL                                                  */}
        {/* ---------------------------------------------------------------- */}
        <section
          className={`transition-all duration-500 ease-out ${
            narrationVisible
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-2"
          }`}
        >
          <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-gray-900/60 to-gray-950/80 p-6 sm:p-8">
            {/* Phase accent stripe */}
            <div
              className="absolute top-0 left-0 right-0 h-[2px] transition-colors duration-700"
              style={{
                background:
                  status === "red"
                    ? "linear-gradient(90deg, #dc2626, #ef4444, transparent)"
                    : status === "orange"
                    ? "linear-gradient(90deg, #d97706, #f59e0b, transparent)"
                    : "linear-gradient(90deg, #7c3aed, #a78bfa, transparent)",
              }}
            />

            {/* Phase number + title */}
            <div className="flex items-center gap-3 mb-4">
              <span className="flex items-center justify-center w-7 h-7 rounded-full bg-white/[0.06] text-xs font-bold text-gray-400 tabular-nums">
                {currentIdx + 1}
              </span>
              <h2
                className="text-lg sm:text-xl font-bold tracking-tight"
                style={{ fontFamily: "'SF Pro Display', 'Helvetica Neue', system-ui, sans-serif" }}
              >
                {event.title}
              </h2>
            </div>

            {/* Narration text */}
            <p className="text-base sm:text-lg leading-relaxed text-gray-300 max-w-[65ch] whitespace-pre-line">
              {event.narration}
            </p>

            {/* Phase image */}
            {event.image && (
              <div className="mt-4 rounded-xl overflow-hidden border border-white/[0.06]">
                <img
                  src={event.image}
                  alt={event.imageCaption || event.title}
                  className="w-full h-40 sm:h-56 object-cover"
                />
                {event.imageCaption && (
                  <div className="px-3 py-2 bg-black/40 text-xs text-gray-400 italic">
                    {event.imageCaption}
                  </div>
                )}
              </div>
            )}

            {/* Interactive tap CTA */}
            {waitingForTap && event.interactivePrompt && (
              <button
                onClick={handleInteractiveTap}
                className="mt-6 w-full sm:w-auto px-8 py-4 rounded-xl bg-violet-600 hover:bg-violet-500 active:scale-[0.98] text-white font-bold text-sm sm:text-base tracking-wide transition-all duration-200 animate-pulse hover:animate-none shadow-lg shadow-violet-900/30"
              >
                {event.interactivePrompt} &rarr;
              </button>
            )}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* CHAT MESSAGES                                                    */}
        {/* ---------------------------------------------------------------- */}
        {chatHistory.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-gray-500 px-1">
              Team Chat
            </h3>
            <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1 scrollbar-thin">
              {chatHistory.map((msg, i) => {
                const isBot = msg.from === "IronSight Bot";
                return (
                  <div
                    key={i}
                    className="animate-slideUp rounded-xl border border-white/[0.06] bg-gray-900/50 p-4 backdrop-blur-sm"
                    style={{ animationDelay: `${i * 80}ms` }}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      {/* Avatar dot */}
                      <span
                        className={`w-2 h-2 rounded-full ${
                          isBot ? "bg-violet-400" : "bg-emerald-400"
                        }`}
                      />
                      <span className="text-sm font-semibold text-gray-200">
                        {msg.from}
                      </span>
                      <span className="text-xs text-gray-600 ml-auto tabular-nums">
                        {fmtTime(msg.time)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-300 leading-relaxed pl-4">
                      {msg.message}
                    </p>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>
          </section>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* COMMAND CENTER (Simplified inline)                               */}
        {/* ---------------------------------------------------------------- */}
        <section className="space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-gray-500 px-1">
            Command Center
          </h3>

          <div className="rounded-2xl border border-white/[0.06] bg-gray-900/40 overflow-hidden">
            {/* Status header */}
            <div className="p-5 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4 border-b border-white/[0.04]">
              {/* Status circle */}
              <div className="relative shrink-0">
                <StatusCircle status={status} pulse={statusPulse} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="text-base font-bold text-white">RAIV 3</h4>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-white/[0.04] text-gray-400">
                    Truck 00
                  </span>
                </div>
                <p className="text-sm text-gray-400">
                  {issues.length === 0
                    ? "All systems operating normally"
                    : `${issues.length} active issue${issues.length > 1 ? "s" : ""}`}
                </p>
              </div>

              {/* Key metric */}
              <div className="text-right shrink-0">
                <div className="text-2xl font-bold tabular-nums text-white">
                  {cToF(dsiTempC)}<span className="text-sm text-gray-500">°F</span>
                </div>
                <div className="text-xs text-gray-500">DSI Temp</div>
              </div>
            </div>

            {/* Active issues */}
            {issues.length > 0 && (
              <div className="px-5 sm:px-6 py-4 border-b border-white/[0.04] space-y-2.5">
                {issues.map((issue, i) => (
                  <IssueCard key={i} issue={issue} />
                ))}
              </div>
            )}

            {/* Subsystem pills */}
            <div className="px-5 sm:px-6 py-4 flex flex-wrap gap-2">
              {subsystems.map((sub) => (
                <SubsystemPill key={sub.name} sub={sub} />
              ))}
            </div>

            {/* Quick sensor readouts */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/[0.03]">
              <SensorCell
                label="Robot"
                value={robotConnected ? "Connected" : "OFFLINE"}
                warn={!robotConnected}
              />
              <SensorCell
                label="Vision"
                value={`${(
                  (simData.apera_detection_confidence_avg as number) * 100
                ).toFixed(0)}%`}
                warn={false}
              />
              <SensorCell
                label="EtherCAT"
                value={`${slaveCount}/3 slaves`}
                warn={slaveCount < 3}
              />
              <SensorCell
                label="CPU"
                value={`${cToF(cpuTempC)}°F`}
                warn={cpuTempC > 70}
              />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* AUTO-DIAGNOSIS (shutdown/response only)                          */}
        {/* ---------------------------------------------------------------- */}
        {diagnosis && (
          <section
            className={`transition-all duration-600 ${
              diagnosisVisible
                ? "opacity-100 translate-y-0"
                : "opacity-0 translate-y-4"
            }`}
          >
            <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-gray-500 px-1 mb-3">
              Auto-Diagnosis
            </h3>
            <div className="rounded-2xl border border-red-900/30 bg-red-950/10 overflow-hidden">
              <div className="px-5 sm:px-6 py-4 border-b border-red-900/20 flex items-center gap-3">
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-red-900/30">
                  <svg
                    className="w-4 h-4 text-red-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                    />
                  </svg>
                </span>
                <div>
                  <h4 className="text-sm font-bold text-red-300">
                    URPS Thermal Protection Triggered
                  </h4>
                  <p className="text-xs text-red-400/70">
                    Automated root cause analysis
                  </p>
                </div>
              </div>

              <div className="px-5 sm:px-6 py-4 space-y-3">
                {diagnosis.map((step, i) => (
                  <DiagnosisRow key={i} step={step} index={i} />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* SHIFT SUMMARY (shift_end / complete)                             */}
        {/* ---------------------------------------------------------------- */}
        {shiftSummary && phase !== "complete" && (
          <section className="animate-fadeIn">
            <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-gray-500 px-1 mb-3">
              Shift Summary
            </h3>
            <div className="rounded-2xl border border-white/[0.06] bg-gray-900/40 overflow-hidden">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-white/[0.03]">
                <ShiftStat label="Uptime" value={shiftSummary.uptime} />
                <ShiftStat label="Plates Sorted" value={String(shiftSummary.platesSorted)} />
                <ShiftStat label="Downtime" value={shiftSummary.downtime} />
                <ShiftStat label="Thermal Events" value={String(shiftSummary.thermalEvents)} />
                <ShiftStat label="Hours Worked" value={String(shiftSummary.hoursWorked)} />
                <ShiftStat label="Job" value={shiftSummary.jobCode} />
              </div>
            </div>
          </section>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* END CTA (complete phase)                                         */}
        {/* ---------------------------------------------------------------- */}
        {isComplete && (
          <section className="animate-fadeIn pt-4">
            <div className="rounded-2xl border border-violet-800/30 bg-gradient-to-b from-violet-950/20 to-gray-950/40 p-6 sm:p-8 text-center space-y-6">
              <div className="space-y-2">
                <h3
                  className="text-2xl sm:text-3xl font-black tracking-tight text-white"
                  style={{ fontFamily: "'SF Pro Display', 'Helvetica Neue', system-ui, sans-serif" }}
                >
                  Ready to see more?
                </h3>
                <p className="text-sm text-gray-400 max-w-md mx-auto">
                  What you just watched happens on real trucks, with real sensors,
                  every single day.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  onClick={() => router.push("/")}
                  className="w-full sm:w-auto px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition-colors"
                >
                  Explore IronSight
                </button>
                <button
                  onClick={() => router.push("/tour")}
                  className="w-full sm:w-auto px-6 py-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-gray-200 font-semibold text-sm transition-colors border border-white/[0.08]"
                >
                  Take the Full Tour
                </button>
                <button
                  onClick={() => router.push("/?truck_id=00&sim=true")}
                  className="w-full sm:w-auto px-6 py-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-gray-200 font-semibold text-sm transition-colors border border-white/[0.08]"
                >
                  See the Live Dashboard
                </button>
              </div>

              <button
                onClick={handleCopyLink}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors underline underline-offset-2"
              >
                {linkCopied ? "Link copied!" : "Share this demo"}
              </button>
            </div>
          </section>
        )}

        {/* Bottom spacer for mobile nav */}
        <div className="h-8" />
      </main>

      {/* ================================================================== */}
      {/* MOBILE PHASE DOTS — bottom bar                                     */}
      {/* ================================================================== */}
      <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden backdrop-blur-xl bg-[#04060e]/80 border-t border-white/[0.06] px-4 py-3 safe-bottom">
        <div className="flex items-center justify-center gap-2">
          {DEMO_TIMELINE.map((ev, i) => {
            const isActive = i === currentIdx;
            const isPast = i < currentIdx;
            const phaseStatus = getOverallStatus(ev.phase);
            const dotColor =
              isActive && phaseStatus === "red"
                ? "bg-red-500"
                : isActive && phaseStatus === "orange"
                ? "bg-amber-500"
                : isActive
                ? "bg-violet-400"
                : isPast
                ? "bg-gray-500"
                : "bg-gray-700";

            return (
              <button
                key={i}
                onClick={() => goToPhase(i)}
                className={`transition-all duration-300 rounded-full ${dotColor} ${
                  isActive ? "w-3.5 h-3.5 ring-2 ring-white/20" : "w-2.5 h-2.5"
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* ================================================================== */}
      {/* GLOBAL STYLES (scoped via inline)                                  */}
      {/* ================================================================== */}
      <style jsx global>{`
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-slideUp {
          animation: slideUp 0.4s ease-out both;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-fadeIn {
          animation: fadeIn 0.6s ease-out both;
        }
        @keyframes pulseRing {
          0% { box-shadow: 0 0 0 0 currentColor; }
          70% { box-shadow: 0 0 0 10px transparent; }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
        .animate-pulseRing {
          animation: pulseRing 1.2s ease-out;
        }
        @keyframes diagIn {
          from {
            opacity: 0;
            transform: translateX(-8px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        .animate-diagIn {
          animation: diagIn 0.4s ease-out both;
        }
        .safe-bottom {
          padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
        }
        /* Scrollbar styling */
        .scrollbar-thin::-webkit-scrollbar {
          width: 4px;
        }
        .scrollbar-thin::-webkit-scrollbar-track {
          background: transparent;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.08);
          border-radius: 2px;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.15);
        }
      `}</style>
    </div>
  );
}

// ===========================================================================
// Sub-components (inline — self-contained, no external deps)
// ===========================================================================

function StatusCircle({ status, pulse }: { status: OverallStatus; pulse: boolean }) {
  const colorMap = {
    green: { outer: "#22c55e", inner: "#4ade80", glow: "rgba(34,197,94,0.25)" },
    orange: { outer: "#f59e0b", inner: "#fbbf24", glow: "rgba(245,158,11,0.25)" },
    red: { outer: "#ef4444", inner: "#f87171", glow: "rgba(239,68,68,0.3)" },
  };
  const c = colorMap[status];

  return (
    <div className={`relative ${pulse ? "animate-pulseRing" : ""}`} style={{ color: c.outer }}>
      {/* Glow */}
      <div
        className="absolute inset-0 rounded-full blur-xl transition-colors duration-700"
        style={{ background: c.glow, transform: "scale(1.8)" }}
      />
      {/* Outer ring */}
      <div
        className="relative w-16 h-16 rounded-full flex items-center justify-center transition-colors duration-700"
        style={{
          background: `radial-gradient(circle, ${c.glow} 0%, transparent 70%)`,
          border: `2px solid ${c.outer}`,
        }}
      >
        {/* Inner dot */}
        <div
          className="w-6 h-6 rounded-full transition-colors duration-700"
          style={{
            background: `radial-gradient(circle at 40% 35%, ${c.inner}, ${c.outer})`,
            boxShadow: `0 0 20px ${c.glow}`,
          }}
        />
      </div>
    </div>
  );
}

function IssueCard({ issue }: { issue: ActiveIssue }) {
  const isCrit = issue.severity === "critical";
  return (
    <div
      className={`rounded-lg px-4 py-3 border ${
        isCrit
          ? "bg-red-950/20 border-red-900/30"
          : "bg-amber-950/15 border-amber-900/25"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
            isCrit ? "bg-red-500" : "bg-amber-500"
          }`}
        />
        <div className="min-w-0">
          <h5
            className={`text-sm font-semibold ${
              isCrit ? "text-red-300" : "text-amber-300"
            }`}
          >
            {issue.title}
          </h5>
          <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
            {issue.detail}
          </p>
        </div>
      </div>
    </div>
  );
}

function SubsystemPill({ sub }: { sub: SubsystemStatus }) {
  const styles = {
    online: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    offline: "bg-red-500/10 text-red-400 border-red-500/20",
    recovering: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  };
  const dotStyles = {
    online: "bg-emerald-400",
    warning: "bg-amber-400",
    offline: "bg-red-400",
    recovering: "bg-blue-400 animate-pulse",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors duration-500 ${styles[sub.status]}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotStyles[sub.status]}`} />
      {sub.name}
    </span>
  );
}

function SensorCell({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn: boolean;
}) {
  return (
    <div className="bg-gray-950/60 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-0.5">
        {label}
      </div>
      <div
        className={`text-sm font-bold tabular-nums ${
          warn ? "text-red-400" : "text-gray-200"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function DiagnosisRow({ step, index }: { step: DiagnosisStep; index: number }) {
  const isRoot = step.status === "root_cause";
  return (
    <div
      className="animate-diagIn flex items-start gap-3"
      style={{ animationDelay: `${index * 120}ms` }}
    >
      {/* Timeline line + dot */}
      <div className="flex flex-col items-center shrink-0 pt-1">
        <span
          className={`w-3 h-3 rounded-full border-2 ${
            isRoot
              ? "bg-red-500 border-red-400"
              : "bg-transparent border-red-700"
          }`}
        />
        {index < 3 && (
          <div className="w-px h-8 bg-red-900/40 mt-1" />
        )}
      </div>
      <div className="pb-4 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-semibold ${
              isRoot ? "text-red-300" : "text-gray-300"
            }`}
          >
            {step.label}
          </span>
          {isRoot && (
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-900/40 text-red-400">
              Root Cause
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
          {step.detail}
        </p>
      </div>
    </div>
  );
}

function ShiftStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-950/60 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-0.5">
        {label}
      </div>
      <div className="text-base font-bold text-gray-200 tabular-nums">{value}</div>
    </div>
  );
}
