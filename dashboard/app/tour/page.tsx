"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Role = "manager" | "mechanic" | "operator" | "admin";

interface BeforeAfter {
  before: string[];
  after: string[];
}

interface Scenario {
  id: number;
  title: string;
  pain: string;
  solution: string;
  comparison: BeforeAfter;
  timeSaved: string;
  link: { label: string; href: string };
  highlight: string;
  replaces: string; // What legacy tool/process this replaces
}

// ---------------------------------------------------------------------------
// Role ordering — all scenarios shown, just reordered by relevance
// ---------------------------------------------------------------------------
const ROLE_ORDER: Record<Role, number[]> = {
  manager: [1, 2, 4, 3, 5, 6],
  mechanic: [3, 1, 4, 2, 5, 6],
  operator: [2, 1, 3, 4, 5, 6],
  admin: [6, 2, 5, 4, 1, 3],
};

// ---------------------------------------------------------------------------
// Scenario Data (stops 1-6)
// ---------------------------------------------------------------------------
const SCENARIOS: Record<number, Scenario> = {
  1: {
    id: 1,
    title: "The robot stopped. What happened?",
    pain:
      "It's 2 PM. Your phone rings -- the robot stopped on Truck 3. Nobody knows why. " +
      "You drive 30 minutes to the truck, open panels, check fuses, guess.",
    solution:
      "IronSight already knows. Before anyone calls, the Command Center shows: " +
      "'VISION FUSE F6 BLOWN -- 0V on vision rail. Replace blue 15A, right panel row 1.' " +
      "You call the crew with the exact fix.",
    comparison: {
      before: [
        "Drive to truck (30 min)",
        "Open panels",
        "Check fuses one by one",
        "Find the problem (20 min)",
        "Fix it",
        "No record of what happened",
      ],
      after: [
        "Phone buzzes (instant)",
        "Dashboard shows exact problem",
        "Call crew with fix instruction",
        "Full event timeline logged",
      ],
    },
    timeSaved: "~45 minutes per incident",
    link: { label: "See the Command Center", href: "/?truck_id=00&sim=true" },
    highlight:
      "Look at the Command Center at the top -- the big status circle. Below it, " +
      "the active issues with plain English descriptions. In the Electrical Systems section " +
      "further down, you can see the blown fuse and auto-diagnosis.",
    replaces: "Driving to trucks to diagnose",
  },
  2: {
    id: 2,
    title: "Where are my timesheets?",
    pain:
      "End of the week. You need 30 timesheets. Half are late, three are illegible, " +
      "one guy forgot his lunch break, and nobody tracked IFTA readings. " +
      "You spend Friday afternoon chasing paper.",
    solution:
      "Operators log time on their phone in 30 seconds. Hours, job code, done. " +
      "The system auto-fills truck, date, and location. Managers approve with one tap. " +
      "Per diem calculates automatically from nights out. IFTA odometer readings are built in.",
    comparison: {
      before: [
        "Paper forms",
        "Chase late submissions",
        "Decipher handwriting",
        "Manual hours calculation",
        "Manual per diem calculation",
        "Re-entry into QuickBooks",
      ],
      after: [
        "Operator taps 'Log Time' on phone",
        "Hours + job code",
        "Submit",
        "Manager approves",
        "Payroll ready",
        "Journal entries auto-posted",
      ],
    },
    timeSaved: "~3 hours/week for the manager, ~10 min/day per operator",
    link: { label: "Open Timesheet Admin View", href: "/timesheets/admin" },
    highlight:
      "This is the manager view -- every submitted timesheet in one place. " +
      "Approve or reject with one click. Hours, per diem, and travel are auto-calculated.",
    replaces: "Paper timesheets",
  },
  3: {
    id: 3,
    title: "The mechanic can't figure out what's wrong",
    pain:
      "Your mechanic is staring at 3 DTCs and a check engine light. He Googles the codes, " +
      "gets 50 forum posts with conflicting advice. He tries things, replaces parts that " +
      "weren't broken, and the truck sits in the shop for 2 days.",
    solution:
      "He opens the truck dashboard, taps AI Chat, and asks 'what's going on with this truck?' " +
      "The AI sees every sensor reading in real time -- coolant 225F, oil pressure dropping, " +
      "DPF at 82% soot -- and walks him through the most likely causes in order. " +
      "It's not guessing. It's reading the data.",
    comparison: {
      before: [
        "Read codes",
        "Google forums",
        "Guess",
        "Replace parts",
        "Maybe fixed, maybe not",
        "1-2 days in shop",
      ],
      after: [
        "Open dashboard",
        "AI sees live data + codes",
        "Ranked diagnosis with reasoning",
        "Mechanic verifies",
        "Right fix, first try",
        "2 hours",
      ],
    },
    timeSaved: "~1 day per complex diagnosis",
    link: {
      label: "Try the AI Mechanic (Demo Truck)",
      href: "/?truck_id=00&sim=true",
    },
    highlight:
      "Scroll down to the Truck Diagnostics section. Look for the AI Chat panel -- " +
      "type 'what's wrong with this truck?' and watch it analyze the live sensor data. " +
      "There's also the Truck Health panel above it showing every metric against its real baseline.",
    replaces: "Guessing what's wrong",
  },
  4: {
    id: 4,
    title: "I don't know what anyone's working on",
    pain:
      "You assign Mike to check the coolant leak on Truck 12. A week later, you ask -- " +
      "turns out he fixed it Tuesday but forgot to tell you, and now there's a new problem " +
      "nobody mentioned. Communication lives in text messages, memory, and hallway conversations.",
    solution:
      "Every job is a work order on a drag-and-drop board. Every truck has a chat thread. " +
      "When Mike fixes the coolant leak, he drags the card to 'Done' and drops a note in the " +
      "truck's chat -- with a sensor snapshot attached showing the fix worked. " +
      "You see it all from one screen.",
    comparison: {
      before: [
        "Assign via text",
        "Forget",
        "Ask a week later",
        "'Oh I did that Tuesday'",
        "New problem nobody mentioned",
        "More texts",
      ],
      after: [
        "Create work order",
        "Assigned + tracked",
        "Mike updates status",
        "Chat thread has full context",
        "You see the board",
        "Nothing falls through",
      ],
    },
    timeSaved: "~5 hours/week in follow-up and coordination",
    link: { label: "Open Work Board", href: "/work" },
    highlight:
      "Drag cards between columns. Click a card to see subtasks, assignments, " +
      "and the attached chat thread. Every conversation about a job stays with that job.",
    replaces: "Group texts for dispatch",
  },
  5: {
    id: 5,
    title: "The railroad wants documentation",
    pain:
      "Auditor shows up. Wants shift reports, training records, inspection logs for the last " +
      "6 months. You spend a day digging through filing cabinets, email, and asking people " +
      "'do you remember when we did that safety training?'",
    solution:
      "Shift reports generate from actual sensor data -- one click, PDF ready. " +
      "Training compliance shows every cert, every person, color-coded: green (current), " +
      "yellow (expiring), red (expired). Inspection records with photos and sensor snapshots. " +
      "All searchable, all exportable.",
    comparison: {
      before: [
        "Auditor arrives",
        "Panic",
        "Dig through files",
        "Ask around",
        "Compile manually",
        "Hope nothing's missing",
        "Full day",
      ],
      after: [
        "Auditor arrives",
        "Pull up training matrix",
        "Export shift reports",
        "Show inspection history",
        "Done in 20 minutes",
      ],
    },
    timeSaved: "~6 hours per audit",
    link: { label: "Open Training Compliance", href: "/training" },
    highlight:
      "Each person shows their certifications with status badges. The admin view shows " +
      "the full matrix across all employees. The shift report page generates production " +
      "summaries from actual truck sensor data.",
    replaces: "Spreadsheet tracking + filing cabinets",
  },
  6: {
    id: 6,
    title: "We're paying for 5 different tools and nothing talks to each other",
    pain:
      "QuickBooks for accounting, paper for timesheets, texts for communication, " +
      "spreadsheets for training, a filing cabinet for shift reports. When you approve a " +
      "timesheet, someone has to manually enter it into QuickBooks. When you invoice a " +
      "railroad, someone has to manually update AR. Nothing connects.",
    solution:
      "One system. Approve a timesheet and payroll calculates taxes and journal entries post " +
      "automatically. Send an invoice and AR updates. Complete a work order and labor costs " +
      "flow to job costing. Training expires and you see it on the dashboard. Everything " +
      "connects because it's all one platform.",
    comparison: {
      before: [
        "QuickBooks ($50/mo)",
        "Paper timesheets (free but costly in time)",
        "Group texts (chaotic)",
        "Spreadsheets (fragile)",
        "Filing cabinets (unsearchable)",
      ],
      after: [
        "IronSight (one platform)",
        "Timesheets -> payroll",
        "Payroll -> accounting",
        "Invoicing -> AR",
        "Job costing -> P&L",
        "All connected, all searchable, all from any device",
      ],
    },
    timeSaved: "~10 hours/week in duplicate data entry and reconciliation",
    link: { label: "Open Accounting", href: "/accounting" },
    highlight:
      "Check the sidebar -- Chart of Accounts, Journal Entries, Invoicing, Bills, " +
      "Bank Reconciliation, Payroll, Reports. Each one is a full module. The magic is " +
      "the connections: timesheets -> payroll -> journal entries -> P&L, all automatic.",
    replaces: "QuickBooks + manual data entry",
  },
};

// ---------------------------------------------------------------------------
// "What This Replaces" checklist items
// ---------------------------------------------------------------------------
const REPLACEMENT_ITEMS: { label: string; replacement: string; scenarioId: number }[] = [
  { label: "QuickBooks", replacement: "Accounting module", scenarioId: 6 },
  { label: "Paper timesheets", replacement: "Digital timesheets + mobile app", scenarioId: 2 },
  { label: "Group texts", replacement: "Team Chat anchored to trucks/jobs", scenarioId: 4 },
  { label: "Spreadsheet tracking", replacement: "Training compliance + fleet dashboard", scenarioId: 5 },
  { label: "Manual shift reports", replacement: "Auto-generated from sensor data", scenarioId: 5 },
  { label: "Driving to trucks", replacement: "Real-time monitoring from anywhere", scenarioId: 1 },
  { label: "Guessing what's wrong", replacement: "AI-powered diagnostics with live data", scenarioId: 3 },
  { label: "Phone calls for status", replacement: "Fleet overview, one screen", scenarioId: 4 },
];

// ---------------------------------------------------------------------------
// Tour Page Component
// ---------------------------------------------------------------------------
export default function TourPage() {
  const router = useRouter();

  // Stop index: 0 = welcome, 1-6 = scenarios, 7 = closing
  const [currentStop, setCurrentStop] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("ironsight-tour-stop-v2");
      return saved ? Math.min(parseInt(saved, 10), 7) : 0;
    }
    return 0;
  });

  const [selectedRole, setSelectedRole] = useState<Role | null>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("ironsight-tour-role");
      return saved as Role | null;
    }
    return null;
  });

  const [visitedScenarios, setVisitedScenarios] = useState<Set<number>>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("ironsight-tour-visited");
      return saved ? new Set(JSON.parse(saved) as number[]) : new Set<number>();
    }
    return new Set<number>();
  });

  // Ordered scenario IDs based on role
  const orderedIds = useMemo(() => {
    return selectedRole ? ROLE_ORDER[selectedRole] : [1, 2, 3, 4, 5, 6];
  }, [selectedRole]);

  // Mark scenario as visited when viewing
  useEffect(() => {
    if (currentStop >= 1 && currentStop <= 6) {
      const scenarioId = orderedIds[currentStop - 1];
      setVisitedScenarios((prev) => {
        const next = new Set(prev);
        next.add(scenarioId);
        if (typeof window !== "undefined") {
          localStorage.setItem("ironsight-tour-visited", JSON.stringify([...next]));
        }
        return next;
      });
    }
  }, [currentStop, orderedIds]);

  // Persist progress
  const goTo = useCallback(
    (index: number) => {
      setCurrentStop(index);
      if (typeof window !== "undefined") {
        localStorage.setItem("ironsight-tour-stop-v2", String(index));
      }
    },
    []
  );

  const handleRoleSelect = useCallback(
    (role: Role) => {
      setSelectedRole(role);
      if (typeof window !== "undefined") {
        localStorage.setItem("ironsight-tour-role", role);
      }
    },
    []
  );

  const totalStops = 8; // 0 welcome + 6 scenarios + 1 closing
  const isFirst = currentStop === 0;
  const isLast = currentStop === totalStops - 1;
  const progress = ((currentStop + 1) / totalStops) * 100;

  const currentScenario =
    currentStop >= 1 && currentStop <= 6
      ? SCENARIOS[orderedIds[currentStop - 1]]
      : null;

  // Copy link handler
  const handleCopyLink = useCallback(() => {
    if (typeof navigator !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
    }
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-32">
      {/* Progress bar */}
      <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-gray-800">
        <div
          className="h-full bg-gradient-to-r from-violet-600 to-purple-500 transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Header */}
      <header className="border-b border-gray-800/50 px-4 sm:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-purple-700 flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-4 h-4 text-white"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
              <path
                fillRule="evenodd"
                d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div>
            <span className="text-sm font-bold text-gray-100 tracking-wide">
              IronSight Tour
            </span>
            <span className="text-xs text-gray-500 ml-2">
              {currentStop + 1} of {totalStops}
            </span>
          </div>
        </div>
        <a
          href="/"
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Exit Tour
        </a>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* ============================================================= */}
        {/* STOP 0: Welcome + Role Selector */}
        {/* ============================================================= */}
        {currentStop === 0 && (
          <div>
            <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-gray-100 mb-8">
              Welcome to IronSight
            </h1>

            {/* Andrew's message */}
            <div className="relative mb-10">
              <div className="absolute -left-3 top-0 bottom-0 w-1 rounded-full bg-gradient-to-b from-violet-500 to-purple-600" />
              <div className="pl-6">
                <p className="text-base sm:text-lg text-gray-300 leading-relaxed">
                  Hey Corey -- I built something that I think changes how we run
                  operations. Instead of walking you through features, I&apos;m
                  going to show you real problems we deal with every week and how
                  this solves them. Pick your role to see what matters most to
                  you first -- but you&apos;ll see everything either way.
                </p>
              </div>
            </div>

            {/* Role selector */}
            <div className="mb-8">
              <p className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
                Pick your role
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(
                  [
                    {
                      role: "manager" as Role,
                      label: "Manager",
                      desc: "Fleet status, approvals, reports",
                      icon: (
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
                        </svg>
                      ),
                    },
                    {
                      role: "mechanic" as Role,
                      label: "Mechanic",
                      desc: "Diagnostics, DTCs, AI troubleshooting",
                      icon: (
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.384 5.384a2.025 2.025 0 01-2.864-2.864l5.384-5.384m2.864 2.864L18 7.5l-1.5-1.5-5.58 5.58m2.864 2.864l-2.864-2.864M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      ),
                    },
                    {
                      role: "operator" as Role,
                      label: "Operator",
                      desc: "Log time, report issues, check robot",
                      icon: (
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
                        </svg>
                      ),
                    },
                    {
                      role: "admin" as Role,
                      label: "Admin",
                      desc: "Accounting, payroll, compliance",
                      icon: (
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 15.75V18m-7.5-6.75h.008v.008H8.25v-.008zm0 2.25h.008v.008H8.25V13.5zm0 2.25h.008v.008H8.25v-.008zm0 2.25h.008v.008H8.25V18zm2.498-6.75h.007v.008h-.007v-.008zm0 2.25h.007v.008h-.007V13.5zm0 2.25h.007v.008h-.007v-.008zm0 2.25h.007v.008h-.007V18zm2.504-6.75h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V13.5zm0 2.25h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V18zm2.498-6.75h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V13.5zM8.25 6h7.5v2.25h-7.5V6zM12 2.25c-1.892 0-3.758.11-5.593.322C5.307 2.7 4.5 3.65 4.5 4.757V19.5a2.25 2.25 0 002.25 2.25h10.5a2.25 2.25 0 002.25-2.25V4.757c0-1.108-.806-2.057-1.907-2.185A48.507 48.507 0 0012 2.25z" />
                        </svg>
                      ),
                    },
                  ] as const
                ).map(({ role, label, desc, icon }) => (
                  <button
                    key={role}
                    onClick={() => handleRoleSelect(role)}
                    className={`flex items-center gap-4 p-4 sm:p-5 rounded-xl border-2 text-left transition-all ${
                      selectedRole === role
                        ? "border-violet-500 bg-violet-500/10"
                        : "border-gray-800 bg-gray-900/40 hover:border-gray-600 hover:bg-gray-900/70"
                    }`}
                  >
                    <div
                      className={`shrink-0 w-12 h-12 rounded-lg flex items-center justify-center ${
                        selectedRole === role
                          ? "bg-violet-600 text-white"
                          : "bg-gray-800 text-gray-400"
                      }`}
                    >
                      {icon}
                    </div>
                    <div>
                      <p className="font-bold text-gray-100 text-base">{label}</p>
                      <p className="text-sm text-gray-500">{desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {!selectedRole && (
              <p className="text-sm text-gray-600 mb-6">
                Select a role above, then hit Next. Your tour order will be
                customized to what matters most for that role.
              </p>
            )}
          </div>
        )}

        {/* ============================================================= */}
        {/* STOPS 1-6: Scenarios */}
        {/* ============================================================= */}
        {currentScenario && (
          <div>
            <p className="text-xs text-violet-400/70 uppercase tracking-[0.2em] font-bold mb-2">
              Scenario {currentStop} of 6
            </p>
            <h1 className="text-2xl sm:text-4xl font-black tracking-tight text-gray-100 mb-2">
              &ldquo;{currentScenario.title}&rdquo;
            </h1>

            {/* Time savings badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-900/30 border border-emerald-700/40 mb-8">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-4 h-4 text-emerald-400"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="text-sm font-bold text-emerald-300">
                Saves {currentScenario.timeSaved}
              </span>
            </div>

            {/* The Pain */}
            <div className="relative mb-6">
              <div className="absolute -left-3 top-0 bottom-0 w-1 rounded-full bg-red-500/40" />
              <div className="pl-6">
                <p className="text-xs font-bold text-red-400/70 uppercase tracking-wider mb-2">
                  The Problem
                </p>
                <p className="text-base sm:text-lg text-gray-300 leading-relaxed">
                  {currentScenario.pain}
                </p>
              </div>
            </div>

            {/* The Solution */}
            <div className="relative mb-8">
              <div className="absolute -left-3 top-0 bottom-0 w-1 rounded-full bg-emerald-500/40" />
              <div className="pl-6">
                <p className="text-xs font-bold text-emerald-400/70 uppercase tracking-wider mb-2">
                  The Solution
                </p>
                <p className="text-base sm:text-lg text-gray-300 leading-relaxed">
                  {currentScenario.solution}
                </p>
              </div>
            </div>

            {/* Before / After comparison cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
              {/* WITHOUT */}
              <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-6 h-6 rounded-full bg-red-900/50 flex items-center justify-center">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-3.5 h-3.5 text-red-400"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <p className="text-xs font-bold text-red-400 uppercase tracking-wider">
                    Without IronSight
                  </p>
                </div>
                <ol className="space-y-2">
                  {currentScenario.comparison.before.map((step, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm text-red-200/60"
                    >
                      <span className="shrink-0 text-red-500/50 font-mono text-xs mt-0.5">
                        {i + 1}.
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>

              {/* WITH */}
              <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-6 h-6 rounded-full bg-emerald-900/50 flex items-center justify-center">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-3.5 h-3.5 text-emerald-400"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                    With IronSight
                  </p>
                </div>
                <ol className="space-y-2">
                  {currentScenario.comparison.after.map((step, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm text-emerald-200/60"
                    >
                      <span className="shrink-0 text-emerald-500/50 font-mono text-xs mt-0.5">
                        {i + 1}.
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            {/* What to look for */}
            <div className="bg-amber-900/10 border border-amber-800/30 rounded-xl p-5 mb-8">
              <div className="flex items-start gap-3">
                <div className="shrink-0 mt-0.5">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-5 h-5 text-amber-400"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                    <path
                      fillRule="evenodd"
                      d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-1">
                    What to look for
                  </p>
                  <p className="text-sm text-amber-200/70 leading-relaxed">
                    {currentScenario.highlight}
                  </p>
                </div>
              </div>
            </div>

            {/* Try it link */}
            <a
              href={currentScenario.link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-sm transition-colors mb-6"
            >
              {currentScenario.link.label}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-4 h-4"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
              </svg>
            </a>

            <p className="text-xs text-gray-600">
              Your progress is saved. Close this tab and come back anytime.
            </p>
          </div>
        )}

        {/* ============================================================= */}
        {/* STOP 7: Closing — "The Big Picture" */}
        {/* ============================================================= */}
        {currentStop === 7 && (
          <div>
            <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-gray-100 mb-8">
              The Big Picture
            </h1>

            {/* "What This Replaces" checklist — full version */}
            <div className="mb-10">
              <p className="text-xs font-bold text-violet-400/70 uppercase tracking-wider mb-4">
                What This Replaces
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {REPLACEMENT_ITEMS.map((item) => {
                  const checked = visitedScenarios.has(item.scenarioId);
                  return (
                    <div
                      key={item.label}
                      className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                        checked
                          ? "border-emerald-800/40 bg-emerald-950/20"
                          : "border-gray-800/40 bg-gray-900/30"
                      }`}
                    >
                      <div
                        className={`shrink-0 w-5 h-5 mt-0.5 rounded flex items-center justify-center ${
                          checked ? "bg-emerald-600" : "bg-gray-800"
                        }`}
                      >
                        {checked && (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="w-3 h-3 text-white"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p
                          className={`text-sm font-medium ${
                            checked
                              ? "text-gray-400 line-through"
                              : "text-gray-300"
                          }`}
                        >
                          {item.label}
                        </p>
                        <p className="text-xs text-gray-500">
                          {item.replacement}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Total time savings */}
            <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-xl p-6 mb-10 text-center">
              <p className="text-xs font-bold text-emerald-400/70 uppercase tracking-wider mb-2">
                Estimated Total Savings
              </p>
              <p className="text-3xl sm:text-4xl font-black text-emerald-300">
                25+ hours/week
              </p>
              <p className="text-sm text-emerald-400/50 mt-1">
                across the team
              </p>
            </div>

            {/* Andrew's closing message */}
            <div className="relative mb-10">
              <div className="absolute -left-3 top-0 bottom-0 w-1 rounded-full bg-gradient-to-b from-violet-500 to-purple-600" />
              <div className="pl-6">
                <p className="text-base sm:text-lg text-gray-300 leading-relaxed">
                  I built this because I saw us spending more time managing
                  information than doing actual work. IronSight gives operators
                  autonomy to log their own time and report issues. It makes the
                  shop self-sufficient with AI diagnostics. It takes admin off
                  your plate with automated workflows. And it gives you
                  visibility into everything without making a single phone call.
                </p>
              </div>
            </div>

            {/* CTA buttons */}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => {
                  localStorage.removeItem("ironsight-tour-stop-v2");
                  router.push("/");
                }}
                className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-sm transition-colors"
              >
                Explore IronSight
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-4 h-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              <button
                onClick={() => router.push("/demo")}
                className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl border border-violet-700 hover:border-violet-500 text-violet-300 hover:text-white font-bold text-sm transition-colors"
              >
                Watch Live Demo
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-4 h-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              <button
                onClick={handleCopyLink}
                className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl border border-gray-700 hover:border-gray-500 text-gray-300 hover:text-white font-bold text-sm transition-colors"
              >
                Share With Someone
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-4 h-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* "What This Replaces" Progress Tracker (persistent, stops 1-7) */}
        {/* ============================================================= */}
        {currentStop >= 1 && currentStop <= 6 && (
          <div className="mt-10 pt-6 border-t border-gray-800/50">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">
              What This Replaces ({visitedScenarios.size} of 8 discovered)
            </p>
            <div className="flex flex-wrap gap-2">
              {REPLACEMENT_ITEMS.map((item) => {
                const checked = visitedScenarios.has(item.scenarioId);
                return (
                  <span
                    key={item.label}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      checked
                        ? "bg-emerald-900/30 text-emerald-400 border border-emerald-800/40"
                        : "bg-gray-900/40 text-gray-600 border border-gray-800/40"
                    }`}
                  >
                    {checked ? (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="w-3 h-3"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    ) : (
                      <span className="w-3 h-3 rounded-full border border-gray-700 inline-block" />
                    )}
                    {item.label}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* Navigation — always visible */}
        {/* ============================================================= */}
        <div className="flex items-center justify-between pt-8 mt-8 border-t border-gray-800/50">
          <button
            onClick={() => goTo(Math.max(0, currentStop - 1))}
            disabled={isFirst}
            className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-colors ${
              isFirst
                ? "text-gray-700 cursor-not-allowed"
                : "text-gray-400 hover:text-white hover:bg-gray-800/50"
            }`}
          >
            Back
          </button>

          {/* Stop dots */}
          <div className="flex gap-1.5 items-center">
            {Array.from({ length: totalStops }).map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                className={`h-2 rounded-full transition-all ${
                  i === currentStop
                    ? "bg-violet-500 w-6"
                    : i < currentStop
                    ? "bg-violet-800 w-2"
                    : "bg-gray-700 w-2"
                }`}
              />
            ))}
          </div>

          {currentStop === 7 ? (
            /* Already handled by the CTA buttons on the closing slide */
            <div className="w-[88px]" />
          ) : (
            <button
              onClick={() => goTo(currentStop + 1)}
              disabled={currentStop === 0 && !selectedRole}
              className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-colors ${
                currentStop === 0 && !selectedRole
                  ? "bg-gray-800 text-gray-600 cursor-not-allowed"
                  : "bg-violet-600 hover:bg-violet-500 text-white"
              }`}
            >
              Next
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
