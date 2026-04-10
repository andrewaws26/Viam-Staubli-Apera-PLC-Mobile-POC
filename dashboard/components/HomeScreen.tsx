"use client";

/**
 * HomeScreen — IronSight OS launcher.
 *
 * OS-style homepage with module cards organized by category.
 * Each card links to its module. Role-based visibility.
 */

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import TopNav from "./nav/TopNav";

interface ModuleCard {
  href: string;
  label: string;
  desc: string;
  color: string; // tailwind border/text accent color
  bgGlow: string; // subtle glow background
  icon: React.ReactNode;
  adminOnly?: boolean;
  devOnly?: boolean;
}

const MANAGER_MODULES: ModuleCard[] = [
  {
    href: "/manager",
    label: "Command Center",
    desc: "Everything that needs your attention",
    color: "violet",
    bgGlow: "from-violet-600/10 to-transparent",
    adminOnly: true,
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor">
        <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
      </svg>
    ),
  },
];

const FLEET_MODULES: ModuleCard[] = [
  {
    href: "/fleet",
    label: "Fleet",
    desc: "All trucks at a glance",
    color: "violet",
    bgGlow: "from-violet-600/10 to-transparent",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor">
        <path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" />
      </svg>
    ),
  },
  {
    href: "/snapshots",
    label: "Snapshots",
    desc: "Digital twin captures",
    color: "cyan",
    bgGlow: "from-cyan-600/10 to-transparent",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: "/shift-report",
    label: "Shift Report",
    desc: "Production summaries",
    color: "green",
    bgGlow: "from-green-600/10 to-transparent",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm2 10a1 1 0 10-2 0v3a1 1 0 102 0v-3zm2-3a1 1 0 011 1v5a1 1 0 11-2 0v-5a1 1 0 011-1zm4 2a1 1 0 10-2 0v3a1 1 0 102 0v-3z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: "/vision",
    label: "Vision",
    desc: "IronSight product roadmap",
    color: "pink",
    bgGlow: "from-pink-600/10 to-transparent",
    devOnly: true,
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor">
        <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
        <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
      </svg>
    ),
  },
];

const OPS_MODULES: ModuleCard[] = [
  {
    href: "/work",
    label: "Work Orders",
    desc: "Tasks & assignments",
    color: "amber",
    bgGlow: "from-amber-600/10 to-transparent",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor">
        <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
        <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: "/chat",
    label: "Team Chat",
    desc: "Contextual messaging",
    color: "cyan",
    bgGlow: "from-cyan-600/10 to-transparent",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
      </svg>
    ),
  },
];

const HR_MODULES: ModuleCard[] = [
  {
    href: "/timesheets",
    label: "Timesheets",
    desc: "Weekly time tracking",
    color: "indigo",
    bgGlow: "from-indigo-600/10 to-transparent",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.828a1 1 0 101.415-1.414L11 9.586V6z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: "/pto",
    label: "Time Off",
    desc: "PTO requests & balances",
    color: "rose",
    bgGlow: "from-rose-600/10 to-transparent",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: "/training",
    label: "Training",
    desc: "Compliance tracking",
    color: "teal",
    bgGlow: "from-teal-600/10 to-transparent",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor">
        <path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0z" />
      </svg>
    ),
  },
  {
    href: "/profile",
    label: "My Profile",
    desc: "Employee details & HR",
    color: "violet",
    bgGlow: "from-violet-600/10 to-transparent",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
      </svg>
    ),
  },
];

const FINANCE_MODULES: ModuleCard[] = [
  {
    href: "/accounting",
    label: "Accounting",
    desc: "Chart of accounts & journals",
    color: "lime",
    bgGlow: "from-lime-600/10 to-transparent",
    adminOnly: true,
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: "/payroll",
    label: "Payroll",
    desc: "Export & manage pay",
    color: "emerald",
    bgGlow: "from-emerald-600/10 to-transparent",
    adminOnly: true,
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor">
        <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
        <path fillRule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: "/inventory",
    label: "Inventory",
    desc: "Parts & supplies tracking",
    color: "orange",
    bgGlow: "from-orange-600/10 to-transparent",
    adminOnly: true,
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor">
        <path d="M4 3a2 2 0 100 4h12a2 2 0 100-4H4z" />
        <path fillRule="evenodd" d="M3 8h14v7a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm5 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" clipRule="evenodd" />
      </svg>
    ),
  },
];

const ADMIN_MODULES: ModuleCard[] = [
  {
    href: "/admin",
    label: "Admin",
    desc: "System settings",
    color: "gray",
    bgGlow: "from-gray-600/10 to-transparent",
    adminOnly: true,
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: "/dev",
    label: "Dev Tools",
    desc: "Diagnostics & testing",
    color: "orange",
    bgGlow: "from-orange-600/10 to-transparent",
    devOnly: true,
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: "/dev-portal",
    label: "Dev Portal",
    desc: "Orchestration & automation",
    color: "cyan",
    bgGlow: "from-cyan-600/10 to-transparent",
    devOnly: true,
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3.293 1.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L7.586 10 5.293 7.707a1 1 0 010-1.414zM11 12a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
      </svg>
    ),
  },
];

// Color class map — Tailwind can't generate dynamic classes
const COLOR_MAP: Record<string, { border: string; text: string; hoverBorder: string }> = {
  violet:  { border: "border-violet-800/40", text: "text-violet-400", hoverBorder: "hover:border-violet-600/60" },
  green:   { border: "border-green-800/40", text: "text-green-400", hoverBorder: "hover:border-green-600/60" },
  pink:    { border: "border-pink-800/40", text: "text-pink-400", hoverBorder: "hover:border-pink-600/60" },
  amber:   { border: "border-amber-800/40", text: "text-amber-400", hoverBorder: "hover:border-amber-600/60" },
  cyan:    { border: "border-cyan-800/40", text: "text-cyan-400", hoverBorder: "hover:border-cyan-600/60" },
  indigo:  { border: "border-indigo-800/40", text: "text-indigo-400", hoverBorder: "hover:border-indigo-600/60" },
  rose:    { border: "border-rose-800/40", text: "text-rose-400", hoverBorder: "hover:border-rose-600/60" },
  teal:    { border: "border-teal-800/40", text: "text-teal-400", hoverBorder: "hover:border-teal-600/60" },
  lime:    { border: "border-lime-800/40", text: "text-lime-400", hoverBorder: "hover:border-lime-600/60" },
  emerald: { border: "border-emerald-800/40", text: "text-emerald-400", hoverBorder: "hover:border-emerald-600/60" },
  orange:  { border: "border-orange-800/40", text: "text-orange-400", hoverBorder: "hover:border-orange-600/60" },
  gray:    { border: "border-gray-700/40", text: "text-gray-400", hoverBorder: "hover:border-gray-500/60" },
};

function ModuleCardComponent({ card }: { card: ModuleCard }) {
  const c = COLOR_MAP[card.color] || COLOR_MAP.gray;
  return (
    <a
      href={card.href}
      className={`group relative overflow-hidden rounded-2xl border ${c.border} ${c.hoverBorder} bg-gray-900/40 hover:bg-gray-900/70 transition-all duration-200 p-5 flex flex-col gap-3`}
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${card.bgGlow} opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none`} />
      <div className={`relative ${c.text}`}>{card.icon}</div>
      <div className="relative">
        <h3 className="text-sm font-bold text-gray-100 group-hover:text-white transition-colors">
          {card.label}
        </h3>
        <p className="text-xs text-gray-400 mt-0.5">{card.desc}</p>
      </div>
    </a>
  );
}

function ModuleSection({
  title,
  modules,
  role,
}: {
  title: string;
  modules: ModuleCard[];
  role: string;
}) {
  const isAdmin = role === "developer" || role === "manager";
  const isDev = role === "developer";
  const visible = modules.filter((m) => {
    if (m.adminOnly && !isAdmin) return false;
    if (m.devOnly && !isDev) return false;
    return true;
  });
  if (visible.length === 0) return null;

  return (
    <div>
      <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500 mb-3 px-1">
        {title}
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {visible.map((m) => (
          <ModuleCardComponent key={m.href} card={m} />
        ))}
      </div>
    </div>
  );
}

export default function HomeScreen() {
  const { user, isLoaded } = useUser();
  const [setupNeeded, setSetupNeeded] = useState(false);

  const role =
    ((user?.publicMetadata as Record<string, unknown>)?.role as string) || "operator";
  const isAdmin = role === "developer" || role === "manager";

  // Check setup status for admins
  useEffect(() => {
    if (!isLoaded || !isAdmin) return;
    fetch("/api/setup")
      .then((r) => r.json())
      .then((data) => {
        if (!data.setup_completed) setSetupNeeded(true);
      })
      .catch(() => {});
  }, [isLoaded, isAdmin]);

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      </div>
    );
  }

  const firstName = user?.firstName || "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <TopNav />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Hero */}
        <div className="mb-10 sm:mb-14">
          <h1 className="text-2xl sm:text-4xl font-black tracking-tight text-gray-100">
            {greeting}, {firstName}.
          </h1>
          <p className="text-sm sm:text-base text-gray-500 mt-2">
            IronSight Company OS — B&B Metals
          </p>
        </div>

        {/* Setup banner */}
        {setupNeeded && (
          <a
            href="/setup"
            className="group mb-8 flex items-center gap-4 rounded-2xl border border-amber-800/40 hover:border-amber-600/60 bg-gradient-to-r from-amber-900/20 to-orange-900/10 hover:from-amber-900/30 hover:to-orange-900/20 p-4 sm:p-5 transition-all duration-200"
          >
            <div className="shrink-0 w-10 h-10 rounded-xl bg-amber-600/20 flex items-center justify-center text-amber-400 group-hover:bg-amber-600/30 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-gray-100 group-hover:text-white transition-colors">
                Complete Your Setup
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Run the setup wizard to configure company profile and verify system readiness
              </p>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-gray-500 group-hover:text-amber-400 transition-colors shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </a>
        )}

        {/* Tour banner */}
        <a
          href="/tour"
          className="group mb-10 sm:mb-14 flex items-center gap-4 rounded-2xl border border-violet-800/40 hover:border-violet-600/60 bg-gradient-to-r from-violet-900/20 to-purple-900/10 hover:from-violet-900/30 hover:to-purple-900/20 p-4 sm:p-5 transition-all duration-200"
        >
          <div className="shrink-0 w-10 h-10 rounded-xl bg-violet-600/20 flex items-center justify-center text-violet-400 group-hover:bg-violet-600/30 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-gray-100 group-hover:text-white transition-colors">
              Take the IronSight Tour
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Interactive walkthrough of every feature — 10 minutes, self-guided
            </p>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-gray-500 group-hover:text-violet-400 transition-colors shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
        </a>

        {/* Module grid */}
        <div className="space-y-8">
          <ModuleSection title="Management" modules={MANAGER_MODULES} role={role} />
          <ModuleSection title="Fleet & Monitoring" modules={FLEET_MODULES} role={role} />
          <ModuleSection title="Operations" modules={OPS_MODULES} role={role} />
          <ModuleSection title="People & HR" modules={HR_MODULES} role={role} />
          <ModuleSection title="Finance" modules={FINANCE_MODULES} role={role} />
          <ModuleSection title="System" modules={ADMIN_MODULES} role={role} />
        </div>

        {/* Footer */}
        <div className="mt-16 pt-6 border-t border-gray-800/50 text-center">
          <p className="text-xs text-gray-700 uppercase tracking-widest">
            IronSight v1.0 — B&B Metals Fleet Intelligence
          </p>
        </div>
      </main>
    </div>
  );
}
