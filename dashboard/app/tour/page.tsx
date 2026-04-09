"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Tour Stop Data
// ---------------------------------------------------------------------------
interface TourStop {
  title: string;
  message: string;       // Andrew's voice — casual, direct, specific to Corey
  value: string;         // The "so what" — why this matters for ops
  tryIt?: {
    label: string;
    href: string;
  };
  highlight?: string;    // What to look for
}

const STOPS: TourStop[] = [
  {
    title: "Welcome",
    message:
      "Hey Corey — I know I'm not there today but I really need you to see this. " +
      "I've been building something on my own time that I think could change how we run operations. " +
      "It's called IronSight. Take an hour and click through this — I'll walk you through it step by step.",
    value:
      "This is a complete operating system for B&B. Fleet monitoring, timesheets, work orders, " +
      "team chat, training compliance, accounting — all in one place. Everything below is live and functional.",
    tryIt: {
      label: "Step 1: Create Your Account",
      href: "/sign-up",
    },
    highlight:
      "Here's what to do:\n" +
      "1. Click the purple button above — it opens the sign-up page in a new tab.\n" +
      "2. Use your real name and email. Takes 30 seconds.\n" +
      "3. Come back to THIS tab when you're done.\n" +
      "4. Click \"Next\" below to start the tour.\n\n" +
      "Your place is saved automatically — you can close this and come back anytime.",
  },
  {
    title: "Your Command Center",
    message:
      "This is where you'd start every day. One screen that shows everything that needs your attention — " +
      "pending timesheets, PTO requests, blocked work orders, expiring certifications, fleet status. " +
      "No clicking through 8 different screens. It's all right here.",
    value:
      "Monday morning, you open this instead of checking your email, texts, and a stack of paper. " +
      "If something needs your approval, you see it. If a truck is down or someone's cert is expired, you know immediately. " +
      "It auto-refreshes every 60 seconds so it stays current all day.",
    tryIt: {
      label: "Open Command Center",
      href: "/manager",
    },
    highlight:
      "Look at the action cards across the top — each one is a count of items that need your attention. " +
      "Below that, you'll see the details: who submitted what, which work orders are blocked and why, " +
      "whose certs are expiring. Everything links to the actual page where you take action.",
  },
  {
    title: "Live Truck Dashboard",
    message:
      "This is what it looks like when a truck is running. Every sensor reading from the PLC, " +
      "updated every 2 seconds. Engine diagnostics, TPS production data, camera status, eject counts — " +
      "all streaming from a Raspberry Pi mounted on the truck.",
    value:
      "Instead of calling the operator to ask how the truck is running, you open this. " +
      "If something goes wrong, you know before they call you.",
    tryIt: {
      label: "Open Demo Truck Dashboard",
      href: "/?truck_id=00",
    },
    highlight:
      "Scroll down to see the gauge grid, diagnostic panels, and fault history. " +
      "This demo uses simulated data — on a real truck, it's live sensor readings.",
  },
  {
    title: "AI Mechanic — Built Into Every Screen",
    message:
      "There's an AI diagnostic system wired into the platform. It reads the live sensor data from a truck " +
      "and helps your mechanics figure out what's wrong — like having a master tech on call 24/7. " +
      "It doesn't guess. It looks at the actual readings: coolant temp, boost pressure, DPF soot load, " +
      "transmission temps, trouble codes — and tells you what could be causing the problem.",
    value:
      "Your mechanic is staring at a Check Engine light and three DTCs. Instead of Googling fault codes, " +
      "he opens the truck dashboard, clicks the AI chat, and asks \"what's going on with this truck?\" " +
      "The AI sees the live data, reads the codes, and walks him through the most likely causes. " +
      "It asks follow-up questions — \"has the DPF been regenerated recently?\" \"when was the fuel filter changed?\" " +
      "It's a diagnostic partner, not a magic answer machine.",
    tryIt: {
      label: "Open Demo Truck (scroll to AI Chat)",
      href: "/?truck_id=00",
    },
    highlight:
      "On the truck dashboard, look for the AI Chat panel at the bottom. Type a question about the truck — " +
      "the AI sees every sensor reading in real time. There's also a \"Full Diagnosis\" button that generates " +
      "a complete analysis in one shot. The AI also powers shift reports, work order suggestions, " +
      "receipt scanning in accounting, and the @ai command in team chat.",
  },
  {
    title: "Fleet Overview",
    message:
      "Every truck in the fleet, one screen. Which ones are running, which are idle, " +
      "which have active trouble codes. You can drill into any truck from here.",
    value:
      "Monday morning, you open this instead of making 10 phone calls. " +
      "When a truck goes down in the field, you see it here before anyone calls the shop.",
    tryIt: {
      label: "Open Fleet Overview",
      href: "/fleet",
    },
    highlight: "Each truck card shows connection status, last reading time, and active faults.",
  },
  {
    title: "Timesheets",
    message:
      "This is the one I think you'll care about most. Our guys fill this out on their phone or laptop " +
      "instead of paper. It already knows our vehicle numbers — #4, #6, T-16, T-17, all of them. " +
      "It knows our railroads — CSX, Norfolk Southern, BNSF, Union Pacific. " +
      "Every field matches exactly what we track now.",
    value:
      "No more chasing paper timesheets. No more deciphering handwriting. " +
      "The system calculates hours automatically, tracks IFTA odometer readings, " +
      "Norfolk Southern job codes, lunch breaks, travel miles — everything. " +
      "Managers approve or reject with one click. The data feeds directly into payroll.",
    tryIt: {
      label: "Open a Blank Timesheet",
      href: "/timesheets/new",
    },
    highlight:
      "Look at the railroad dropdown — those are our railroads. " +
      "Look at the vehicle checkboxes — those are our actual trucks. " +
      "Try filling in a day. Start time, end time — hours calculate automatically.",
  },
  {
    title: "Work Orders",
    message:
      "Drag-and-drop work board. Create a task, assign it to someone, track it from open to done. " +
      "Link it to a specific truck. The AI can even suggest troubleshooting steps based on the description.",
    value:
      "When you tell Mike to check the coolant leak on Truck 12, it doesn't live in a text message anymore. " +
      "It's tracked. You can see what's open, what's in progress, what's blocked, and what's done.",
    tryIt: {
      label: "Open Work Board",
      href: "/work",
    },
    highlight:
      "Click on a work order card to expand it. You'll see subtasks, assignments, " +
      "linked trucks, and a chat thread attached to that specific job.",
  },
  {
    title: "Team Chat",
    message:
      "This isn't just messaging — every conversation is anchored to something. " +
      "A truck, a work order, a DTC. When you're talking about Truck 12's coolant issue, " +
      "the chat thread is attached to Truck 12. You can even type @ai and the AI diagnostic system " +
      "will jump in with analysis based on live sensor data.",
    value:
      "No more scrolling through group texts trying to find what Mike said about the DPF regen last Tuesday. " +
      "Every conversation has context. Every message is searchable. Sensor snapshots are attached automatically.",
    tryIt: {
      label: "Open Team Chat",
      href: "/chat",
    },
    highlight: "Look at how threads are organized by type — Trucks, Work Orders, DTCs, Direct Messages.",
  },
  {
    title: "Shift Reports",
    message:
      "End of shift, pick a truck and a time range, hit generate. " +
      "Full production summary — plates placed, distance traveled, " +
      "engine vitals, trip timeline, active DTCs during the shift.",
    value:
      "The railroad wants to know what happened on a shift? It's one click. " +
      "No more writing reports by hand. The data comes from the sensors that were running all day.",
    tryIt: {
      label: "Open Shift Reports",
      href: "/shift-report",
    },
    highlight: "Try the preset time range buttons — Full Day, Morning, Afternoon. The report generates from actual sensor history.",
  },
  {
    title: "Training & Compliance",
    message:
      "Every employee's certifications, training records, and expiration dates. " +
      "The system tracks who's current, who's expiring in 30 days, and who's overdue. " +
      "Managers see the full compliance matrix across the whole team.",
    value:
      "When the railroad auditor asks if everyone's current on their certs, " +
      "you don't have to dig through a filing cabinet. You pull up this screen.",
    tryIt: {
      label: "Open Training",
      href: "/training",
    },
    highlight: "Each training requirement shows a status badge — current (green), expiring soon (yellow), expired (red), missing (gray).",
  },
  {
    title: "PTO & Time Off",
    message:
      "Employees request time off, managers approve or reject. " +
      "Balances are tracked automatically — vacation, sick, personal. " +
      "No more spreadsheets, no more guessing how many days someone has left.",
    value:
      "Guys can request PTO from their phone. You approve it from yours. " +
      "The balance updates automatically. Everyone can see their own remaining hours.",
    tryIt: {
      label: "Open Time Off",
      href: "/pto",
    },
  },
  {
    title: "Accounting & Finance",
    message:
      "This is the part that replaces QuickBooks. Chart of accounts, journal entries, " +
      "invoicing, bills, bank reconciliation, payroll processing, budgets, fixed assets, " +
      "estimates, expense tracking, sales tax, even receipt scanning with AI. " +
      "I know that's a lot — but it's all there.",
    value:
      "One system for operations AND finances. When a timesheet is approved, " +
      "it automatically generates the journal entry. When an invoice is sent, " +
      "accounts receivable updates. Payroll calculates federal, state, FICA, and FUTA automatically. " +
      "Everything stays in sync because it's all in one place.",
    tryIt: {
      label: "Open Accounting",
      href: "/accounting",
    },
    highlight:
      "Start with the Chart of Accounts tab to see the account structure. " +
      "Then check the sidebar — Invoices, Bills, Bank, Payroll, Reports. " +
      "Each one is a full module.",
  },
  {
    title: "The Big Picture",
    message:
      "Corey — this is one platform that handles everything we do. " +
      "Fleet monitoring, timesheets, work orders, team communication, " +
      "training compliance, time off, and full accounting. " +
      "Every piece talks to every other piece. " +
      "Approve a timesheet, and payroll knows. Create a work order on a truck, " +
      "and the chat thread is already there. A sensor triggers a fault, and you see it in real time.\n\n" +
      "I built this because I saw how much time we spend on stuff that should be automatic. " +
      "I want to talk about it when I'm back. Take your time looking around.",
    value:
      "This replaces: QuickBooks, paper timesheets, text message dispatch, " +
      "spreadsheet training tracking, manual shift reports, and guessing whether a truck is running. " +
      "All of it, in one place, from any device.",
    tryIt: {
      label: "Back to Home Screen",
      href: "/",
    },
  },
];

// ---------------------------------------------------------------------------
// Tour Page Component
// ---------------------------------------------------------------------------
export default function TourPage() {
  const [currentStop, setCurrentStop] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("ironsight-tour-stop");
      return saved ? Math.min(parseInt(saved, 10), STOPS.length - 1) : 0;
    }
    return 0;
  });
  const router = useRouter();
  const stop = STOPS[currentStop];

  // Persist progress so Corey doesn't lose his place
  const goTo = (index: number) => {
    setCurrentStop(index);
    if (typeof window !== "undefined") {
      localStorage.setItem("ironsight-tour-stop", String(index));
    }
  };
  const isFirst = currentStop === 0;
  const isLast = currentStop === STOPS.length - 1;
  const progress = ((currentStop + 1) / STOPS.length) * 100;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
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
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-white" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
              <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <span className="text-sm font-bold text-gray-100 tracking-wide">IronSight Tour</span>
            <span className="text-xs text-gray-600 ml-2">
              {currentStop + 1} of {STOPS.length}
            </span>
          </div>
        </div>
        <a href="/" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
          Exit Tour
        </a>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
        {/* Stop title */}
        <div className="mb-8">
          {!isFirst && (
            <p className="text-xs text-violet-400/70 uppercase tracking-[0.2em] font-bold mb-2">
              Stop {currentStop} of {STOPS.length - 1}
            </p>
          )}
          <h1 className="text-2xl sm:text-4xl font-black tracking-tight text-gray-100">
            {stop.title}
          </h1>
        </div>

        {/* Andrew's message */}
        <div className="relative mb-8">
          <div className="absolute -left-3 top-0 bottom-0 w-1 rounded-full bg-gradient-to-b from-violet-500 to-purple-600" />
          <div className="pl-6">
            {stop.message.split("\n\n").map((paragraph, i) => (
              <p key={i} className="text-base sm:text-lg text-gray-300 leading-relaxed mb-4 last:mb-0">
                {paragraph}
              </p>
            ))}
          </div>
        </div>

        {/* Value proposition */}
        <div className="bg-gray-900/50 border border-gray-800/50 rounded-xl p-5 sm:p-6 mb-8">
          <div className="flex items-start gap-3">
            <div className="shrink-0 mt-0.5">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            </div>
            <p className="text-sm sm:text-base text-gray-400 leading-relaxed">
              {stop.value}
            </p>
          </div>
        </div>

        {/* What to look for */}
        {stop.highlight && (
          <div className="bg-amber-900/10 border border-amber-800/30 rounded-xl p-5 mb-8">
            <div className="flex items-start gap-3">
              <div className="shrink-0 mt-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                  <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-1">What to look for</p>
                <div className="text-sm text-amber-200/70 leading-relaxed whitespace-pre-line">{stop.highlight}</div>
              </div>
            </div>
          </div>
        )}

        {/* Try it button */}
        {stop.tryIt && (
          <a
            href={stop.tryIt.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-sm transition-colors mb-8"
          >
            {stop.tryIt.label}
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
              <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
            </svg>
          </a>
        )}

        {/* Tip */}
        {!isFirst && (
          <p className="text-xs text-gray-600 mb-6">
            Your progress is saved. You can close this tab and come back anytime — you&apos;ll pick up right where you left off.
          </p>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between pt-8 border-t border-gray-800/50">
          <button
            onClick={() => goTo(Math.max(0, currentStop - 1))}
            disabled={isFirst}
            className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-colors ${
              isFirst
                ? "text-gray-700 cursor-not-allowed"
                : "text-gray-400 hover:text-white hover:bg-gray-800"
            }`}
          >
            Back
          </button>

          {/* Stop dots */}
          <div className="flex gap-1.5">
            {STOPS.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                className={`w-2 h-2 rounded-full transition-all ${
                  i === currentStop
                    ? "bg-violet-500 w-6"
                    : i < currentStop
                    ? "bg-violet-800"
                    : "bg-gray-700"
                }`}
              />
            ))}
          </div>

          <button
            onClick={() => {
              if (isLast) {
                localStorage.removeItem("ironsight-tour-stop");
                router.push("/");
              } else {
                goTo(currentStop + 1);
              }
            }}
            className="px-5 py-2.5 rounded-lg text-sm font-bold bg-violet-600 hover:bg-violet-500 text-white transition-colors"
          >
            {isLast ? "Explore IronSight" : "Next"}
          </button>
        </div>
      </main>
    </div>
  );
}
