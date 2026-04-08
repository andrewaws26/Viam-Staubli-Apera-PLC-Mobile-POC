"use client";

import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

function StatusBadge({ status }: { status: "built" | "in-progress" | "planned" }) {
  const styles = {
    built: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    "in-progress": "bg-amber-500/20 text-amber-400 border-amber-500/30",
    planned: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  };
  const labels = {
    built: "Built",
    "in-progress": "In Progress",
    planned: "Planned",
  };
  return (
    <span
      className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider border ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

function SectionHeading({
  title,
  subtitle,
  accent = "purple",
}: {
  title: string;
  subtitle?: string;
  accent?: string;
}) {
  const barColors: Record<string, string> = {
    purple: "from-purple-500 to-violet-500",
    emerald: "from-emerald-500 to-teal-500",
    amber: "from-amber-500 to-orange-500",
    blue: "from-blue-500 to-cyan-500",
    rose: "from-rose-500 to-pink-500",
    indigo: "from-indigo-500 to-blue-500",
  };
  return (
    <div className="mb-8">
      <div className={`h-1 w-16 rounded-full bg-gradient-to-r ${barColors[accent] || barColors.purple} mb-4`} />
      <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">{title}</h2>
      {subtitle && <p className="text-gray-400 mt-2 text-sm sm:text-base max-w-2xl">{subtitle}</p>}
    </div>
  );
}

function Card({
  title,
  description,
  accent = "gray",
}: {
  title: string;
  description: string;
  accent?: string;
}) {
  const borderColors: Record<string, string> = {
    gray: "border-gray-700/50",
    purple: "border-purple-500/30",
    emerald: "border-emerald-500/30",
    amber: "border-amber-500/30",
    blue: "border-blue-500/30",
    rose: "border-rose-500/30",
    indigo: "border-indigo-500/30",
    teal: "border-teal-500/30",
    cyan: "border-cyan-500/30",
    violet: "border-violet-500/30",
  };
  return (
    <div
      className={`bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-5 border ${borderColors[accent] || borderColors.gray} hover:border-gray-600 transition-colors`}
    >
      <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300 mb-2">{title}</h3>
      <p className="text-gray-400 text-sm leading-relaxed">{description}</p>
    </div>
  );
}

function RoadmapCard({
  title,
  status,
  details,
}: {
  title: string;
  status: "built" | "in-progress" | "planned";
  details?: string[];
}) {
  const bgByStatus = {
    built: "from-emerald-950/40 to-gray-900",
    "in-progress": "from-amber-950/40 to-gray-900",
    planned: "from-blue-950/40 to-gray-900",
  };
  const borderByStatus = {
    built: "border-emerald-500/20",
    "in-progress": "border-amber-500/20",
    planned: "border-blue-500/20",
  };
  return (
    <div
      className={`bg-gradient-to-br ${bgByStatus[status]} rounded-xl p-5 border ${borderByStatus[status]}`}
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        <h3 className="text-white font-bold text-sm sm:text-base">{title}</h3>
        <StatusBadge status={status} />
      </div>
      {details && details.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {details.map((d, i) => (
            <li key={i} className="text-gray-400 text-sm flex items-start gap-2">
              <span className="text-gray-600 mt-0.5">-</span>
              <span>{d}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function VisionPage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const role =
    ((user?.publicMetadata as Record<string, unknown>)?.role as string) ||
    "operator";
  const isDeveloper = role === "developer";

  useEffect(() => {
    if (isLoaded && !isDeveloper) {
      router.replace("/");
    }
  }, [isLoaded, isDeveloper, router]);

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
      </div>
    );
  }

  if (!isDeveloper) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-300">Access Denied</h1>
          <p className="text-gray-500 mt-2">Developer role required.</p>
          <a
            href="/"
            className="inline-block mt-4 text-sm text-purple-400 hover:text-purple-300 underline"
          >
            Back to Dashboard
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* ------------------------------------------------------------------ */}
      {/* Header                                                              */}
      {/* ------------------------------------------------------------------ */}
      <header className="relative overflow-hidden border-b border-gray-800">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-950/50 via-gray-950 to-indigo-950/30" />
        <div className="relative max-w-6xl mx-auto px-6 py-16 sm:py-24 text-center">
          <div className="inline-flex items-center gap-2 mb-6 px-4 py-1.5 rounded-full bg-red-500/10 border border-red-500/30">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-red-400 text-xs font-bold uppercase tracking-widest">
              Internal — Developer Eyes Only
            </span>
          </div>
          <h1 className="text-5xl sm:text-7xl font-black tracking-tight">
            <span className="bg-gradient-to-r from-purple-400 via-violet-400 to-indigo-400 bg-clip-text text-transparent">
              IronSight
            </span>
          </h1>
          <p className="mt-3 text-xl sm:text-2xl font-light text-gray-400 tracking-wide">
            Company OS
          </p>
          <p className="mt-6 text-gray-500 text-sm max-w-xl mx-auto leading-relaxed">
            One platform for every piece of data in a field operations company — fleet diagnostics,
            workforce management, financials, compliance, and AI-powered insights.
          </p>
          <div className="mt-8 flex justify-center">
            <a
              href="/"
              className="px-5 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-white text-sm font-bold uppercase tracking-wider transition-colors"
            >
              Back to Dashboard
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-16 space-y-24">
        {/* ---------------------------------------------------------------- */}
        {/* Section 1: What IronSight Is Today                                */}
        {/* ---------------------------------------------------------------- */}
        <section>
          <SectionHeading
            title="What IronSight Is Today"
            subtitle="A fully operational platform already running in production at B&B Metals."
            accent="emerald"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card
              accent="emerald"
              title="Fleet Diagnostics"
              description="Real-time J1939 truck monitoring, DTC tracking, and AI-powered diagnosis from live CAN bus data."
            />
            <Card
              accent="amber"
              title="Work Orders"
              description="Kanban board with assignment, priority tracking, and cross-linked chat threads."
            />
            <Card
              accent="blue"
              title="Team Chat"
              description="Entity-anchored conversations tied to trucks, work orders, and DTCs with @AI mention support."
            />
            <Card
              accent="indigo"
              title="Timesheets"
              description="Full weekly work reports with 12 sections — railroad time, expenses, IFTA, maintenance, layovers, and more."
            />
            <Card
              accent="rose"
              title="PTO Management"
              description="Request workflow, balance tracking, and manager approval with full audit trail."
            />
            <Card
              accent="violet"
              title="Employee Profiles"
              description="HR data, training compliance, profile pictures, and role-based access control."
            />
            <Card
              accent="teal"
              title="Training Compliance"
              description="Certification tracking, expiry monitoring, and admin management for safety requirements."
            />
            <Card
              accent="cyan"
              title="Per Diem"
              description="Auto-calculated from timesheet data — nights out, layovers, and travel days feed directly into compensation."
            />
            <Card
              accent="purple"
              title="Mobile App"
              description="iOS native experience built with Expo SDK 54. Android ready. Full fleet diagnostics and work orders on the go."
            />
            <Card
              accent="gray"
              title="Audit Trail"
              description="Full action logging across all modules — every submit, approve, reject, and edit is recorded."
            />
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Section 2: The Value Proposition                                  */}
        {/* ---------------------------------------------------------------- */}
        <section>
          <SectionHeading
            title="The Value Proposition"
            subtitle="Different value for every level of the organization."
            accent="amber"
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gradient-to-br from-emerald-950/30 to-gray-900 rounded-xl p-6 border border-emerald-500/20">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-white mb-3">For Employees</h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                One app for everything — timesheets, PTO, training, work orders, fleet data.
                No more paper forms or disconnected systems. Submit a timesheet, check truck
                diagnostics, and request PTO from the same screen.
              </p>
            </div>
            <div className="bg-gradient-to-br from-amber-950/30 to-gray-900 rounded-xl p-6 border border-amber-500/20">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                  <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-white mb-3">For Management</h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                Complete visibility into operations, compliance, and costs. Real-time dashboards,
                approval workflows, and audit trails. Know exactly where every truck is, what every
                employee worked on, and what every project costs.
              </p>
            </div>
            <div className="bg-gradient-to-br from-purple-950/30 to-gray-900 rounded-xl p-6 border border-purple-500/20">
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-purple-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-white mb-3">For the Business</h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                Eliminate QuickBooks, paper timesheets, and spreadsheet tracking. Reduce admin
                overhead by 80%. Cross-domain insights that no collection of separate tools can
                provide — because every piece of data lives in one connected system.
              </p>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Section 3: The Competitive Moat                                   */}
        {/* ---------------------------------------------------------------- */}
        <section>
          <SectionHeading
            title="The Competitive Moat"
            subtitle="Why this can't be easily replicated."
            accent="rose"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-6 border border-rose-500/20">
              <h3 className="text-white font-bold mb-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                Vertical Integration
              </h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                From CAN bus sensor data to financial reporting in one system. No other platform
                connects a truck&apos;s engine telemetry to the work order that fixed it to the
                timesheet that billed it to the invoice that collected payment.
              </p>
            </div>
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-6 border border-rose-500/20">
              <h3 className="text-white font-bold mb-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                Data Connectivity
              </h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                Every piece of data in the company is linked and queryable. A truck&apos;s DTC
                history, the mechanic who fixed it, the parts used, the hours billed, the training
                certifications — all in one graph.
              </p>
            </div>
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-6 border border-rose-500/20">
              <h3 className="text-white font-bold mb-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                AI-Native
              </h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                Claude-powered diagnostics, smart receipt scanning, and natural language reporting
                built into the core — not bolted on. The AI has full context because it can access
                every domain in the system.
              </p>
            </div>
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-6 border border-rose-500/20">
              <h3 className="text-white font-bold mb-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                Industry-Specific
              </h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                Built for railroad and industrial field operations, not generic SaaS. IFTA tracking,
                DOT compliance, per diem rules, chase vehicle logs — domain knowledge baked into
                every feature.
              </p>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Section 4: What IronSight Will Become                             */}
        {/* ---------------------------------------------------------------- */}
        <section>
          <SectionHeading
            title="What IronSight Will Become"
            subtitle="The full Company OS — every operational function in one platform."
            accent="blue"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <RoadmapCard status="built" title="Fleet Diagnostics & Monitoring" />
            <RoadmapCard status="built" title="Work Order Management" />
            <RoadmapCard status="built" title="Team Chat" />
            <RoadmapCard status="built" title="Weekly Timesheets (12 sections)" />
            <RoadmapCard status="built" title="PTO / Time Off Management" />
            <RoadmapCard status="built" title="Employee Profiles & Training" />
            <RoadmapCard status="built" title="Per Diem Auto-Calculation" />
            <RoadmapCard
              status="in-progress"
              title="Expense Management with Receipt Capture"
            />
            <RoadmapCard
              status="planned"
              title="Financial Module (QuickBooks Replacement)"
              details={[
                "Chart of accounts, invoicing, AP/AR",
                "Automated data import from QuickBooks",
                "Connected to timesheets, expenses, per diem",
              ]}
            />
            <RoadmapCard
              status="planned"
              title="Documentation Management"
              details={[
                "Contracts, SOPs, safety manuals",
                "Version control, signatures",
              ]}
            />
            <RoadmapCard
              status="planned"
              title="Payroll Integration"
              details={[
                "Direct feed from timesheets",
                "Hours, per diem, mileage, flight/holiday/vacation pay",
              ]}
            />
            <RoadmapCard
              status="planned"
              title="Inventory & Parts Tracking"
              details={[
                "Linked to maintenance time entries",
                "Automatic reorder points",
              ]}
            />
            <RoadmapCard
              status="planned"
              title="DOT/OSHA Compliance Center"
              details={[
                "IFTA quarterly filing (already capturing data)",
                "Training certification management (already built)",
                "Inspection records",
              ]}
            />
            <RoadmapCard
              status="planned"
              title="Client Portal"
              details={[
                "Railroad customers can view work reports",
                "Billing integration",
              ]}
            />
            <RoadmapCard
              status="planned"
              title="Advanced Analytics & AI"
              details={[
                "Natural language queries across all company data",
                "Predictive maintenance from fleet data",
                "Cost optimization recommendations",
              ]}
            />
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Section 5: Technical Foundation                                   */}
        {/* ---------------------------------------------------------------- */}
        <section>
          <SectionHeading
            title="Technical Foundation"
            subtitle="Production-grade infrastructure, startup-friendly cost."
            accent="indigo"
          />
          <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl border border-indigo-500/20 overflow-hidden">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-gray-800">
              {[
                { label: "Database", value: "Supabase PostgreSQL", detail: "37+ tables, cross-domain linking" },
                { label: "Dashboard", value: "Next.js 14 on Vercel", detail: "SSR + API routes" },
                { label: "Mobile", value: "Expo SDK 54", detail: "iOS + Android" },
                { label: "Auth", value: "Clerk RBAC", detail: "developer, manager, mechanic, operator" },
                { label: "IoT", value: "Viam Cloud", detail: "Real-time sensor data at 1 Hz" },
                { label: "Monthly Cost", value: "~$20", detail: "At current scale" },
              ].map((item) => (
                <div key={item.label} className="p-5">
                  <p className="text-xs text-gray-500 uppercase tracking-wider font-bold mb-1">{item.label}</p>
                  <p className="text-white font-bold">{item.value}</p>
                  <p className="text-gray-500 text-xs mt-0.5">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Section 6: The QuickBooks Opportunity                             */}
        {/* ---------------------------------------------------------------- */}
        <section>
          <SectionHeading
            title="The QuickBooks Opportunity"
            subtitle="The highest-value module on the roadmap. A dedicated analysis exists separately."
            accent="purple"
          />
          <div className="bg-gradient-to-br from-purple-950/30 to-gray-900 rounded-xl p-6 sm:p-8 border border-purple-500/20">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <p className="text-3xl font-black text-white">6M+</p>
                <p className="text-gray-400 text-sm mt-1">
                  Small businesses use QuickBooks. Most hate it but feel locked in.
                </p>
              </div>
              <div>
                <p className="text-3xl font-black text-white">80%</p>
                <p className="text-gray-400 text-sm mt-1">
                  Reduction in admin overhead when financials connect to timesheets, expenses, and per diem automatically.
                </p>
              </div>
            </div>
            <div className="mt-8 space-y-4">
              <div className="flex items-start gap-3">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0" />
                <p className="text-gray-300 text-sm leading-relaxed">
                  IronSight can offer a seamlessly integrated alternative — financials that already
                  know about every hour worked, every per diem earned, every part ordered.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0" />
                <p className="text-gray-300 text-sm leading-relaxed">
                  Data migration automation makes switching painless. Import historical data from
                  QuickBooks on day one.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0" />
                <p className="text-gray-300 text-sm leading-relaxed">
                  Once financials are in, customer churn approaches zero. Every other module feeds
                  into and depends on the financial core.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ------------------------------------------------------------------ */}
      {/* Footer                                                              */}
      {/* ------------------------------------------------------------------ */}
      <footer className="border-t border-gray-800 py-8 text-center">
        <p className="text-gray-600 text-xs uppercase tracking-widest">
          IronSight — B&B Metals — Confidential
        </p>
      </footer>
    </div>
  );
}
