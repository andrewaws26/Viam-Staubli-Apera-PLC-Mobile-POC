"use client";

import { useUser } from "@clerk/nextjs";
import Link from "next/link";

const guides = [
  {
    title: "Fleet & Monitoring",
    description: "Truck monitoring, sensor data, DTC codes, shift reports, and fleet administration.",
    href: "/fleet/docs",
    icon: "M8.5 2C6.015 2 4 4.015 4 6.5V18l8-3.5L20 18V6.5C20 4.015 17.985 2 15.5 2h-7z",
  },
  {
    title: "AI Diagnostics",
    description: "AI-powered vehicle analysis, aftertreatment guide, diagnostic rules engine.",
    href: "/fleet/ai-docs",
    icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
  },
  {
    title: "Operations",
    description: "Work orders, team chat, @ai mentions, sensor snapshots, and coordination.",
    href: "/work/docs",
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
  },
  {
    title: "People & HR",
    description: "Timesheets (12 sections), PTO, training compliance, profiles, per diem.",
    href: "/timesheets/docs",
    icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z",
  },
  {
    title: "Finance & Accounting",
    description: "Full accounting system — invoices, payroll, tax reports, fixed assets, and more.",
    href: "/accounting/docs",
    icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    roles: ["developer", "manager"],
  },
  {
    title: "System & Admin",
    description: "Roles, permissions, fleet admin, inventory, architecture, troubleshooting.",
    href: "/admin/docs",
    icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  },
];

export default function DocsIndexPage() {
  const { user } = useUser();
  const role = (user?.publicMetadata as Record<string, unknown>)?.role as string || "operator";

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
        <div className="mb-10">
          <h1 className="text-3xl font-black tracking-tight">IronSight Documentation</h1>
          <p className="text-gray-400 mt-2">
            Everything you need to know about the IronSight Company OS. Select a guide below.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {guides
            .filter((g) => !g.roles || g.roles.includes(role))
            .map((guide) => (
              <Link
                key={guide.href}
                href={guide.href}
                className="group block rounded-xl bg-gray-900 border border-gray-800 p-5 hover:border-violet-500/50 hover:bg-gray-900/80 transition-all"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-violet-600/20 flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={guide.icon} />
                    </svg>
                  </div>
                  <h2 className="text-base font-bold text-gray-100 group-hover:text-violet-300 transition-colors">
                    {guide.title}
                  </h2>
                </div>
                <p className="text-sm text-gray-500 leading-relaxed">
                  {guide.description}
                </p>
              </Link>
            ))}
        </div>

        <div className="mt-12 pt-8 border-t border-gray-800">
          <h2 className="text-lg font-bold text-gray-200 mb-4">Quick Links</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Link
              href="/admin/docs#roles"
              className="px-4 py-3 rounded-lg bg-gray-900 border border-gray-800 text-sm text-gray-400 hover:text-violet-300 hover:border-violet-500/30 transition-colors"
            >
              Role Permissions — What each role can access
            </Link>
            <Link
              href="/admin/docs#troubleshooting"
              className="px-4 py-3 rounded-lg bg-gray-900 border border-gray-800 text-sm text-gray-400 hover:text-violet-300 hover:border-violet-500/30 transition-colors"
            >
              Troubleshooting — Common issues and solutions
            </Link>
            <Link
              href="/fleet/docs#glossary"
              className="px-4 py-3 rounded-lg bg-gray-900 border border-gray-800 text-sm text-gray-400 hover:text-violet-300 hover:border-violet-500/30 transition-colors"
            >
              Glossary — TPS, PLC, J1939, DTC, and more
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
