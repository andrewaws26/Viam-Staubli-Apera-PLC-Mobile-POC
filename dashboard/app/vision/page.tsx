"use client";

import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import AppNav from "@/components/AppNav";

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
      <AppNav pageTitle="Vision" />

      {/* ------------------------------------------------------------------ */}
      {/* Hero                                                                */}
      {/* ------------------------------------------------------------------ */}
      <header className="relative overflow-hidden">
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
            Company OS for B&B Metals
          </p>
          <p className="mt-6 text-gray-500 text-sm max-w-xl mx-auto leading-relaxed">
            One platform replacing QuickBooks, paper timesheets, and a dozen spreadsheets for a 34-truck
            railroad contractor. Fleet diagnostics, workforce management, financials, compliance, and
            AI-powered insights — connected end to end.
          </p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-16 space-y-24">
        {/* ---------------------------------------------------------------- */}
        {/* Section 0: B&B Metals — Who We Are                                */}
        {/* ---------------------------------------------------------------- */}
        <section>
          <SectionHeading
            title="B&B Metals, Inc."
            subtitle="Founded 1989. Shepherdsville, KY. The largest mechanized tie plate distribution fleet in the United States."
            accent="amber"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gradient-to-br from-amber-950/30 to-gray-900 rounded-xl p-6 border border-amber-500/20">
              <h3 className="text-lg font-bold text-white mb-3">The Company</h3>
              <p className="text-gray-400 text-sm leading-relaxed mb-4">
                Bill Coots started B&B Metals in 1989 with a torch, a tractor, and one employee.
                Today we operate <span className="text-amber-400 font-bold">34 registered trucks</span>, employ 20+ people,
                and hold contracts with Norfolk Southern and other Class I railroads.
              </p>
              <p className="text-gray-400 text-sm leading-relaxed">
                B&B pioneered mechanized tie plate distribution in the 1990s — the first company to
                replace hand-placed plates with a synchronized conveyor system. We now own the largest
                TPS fleet in the country.
              </p>
            </div>
            <div className="bg-gradient-to-br from-amber-950/30 to-gray-900 rounded-xl p-6 border border-amber-500/20">
              <h3 className="text-lg font-bold text-white mb-3">The Problem</h3>
              <div className="space-y-3 text-sm">
                <p className="text-gray-300 font-semibold italic">
                  &quot;What&apos;s our profit margin on the Norfolk Southern contract?&quot;
                </p>
                <p className="text-gray-500">
                  Today, answering this requires pulling from QuickBooks + paper timesheets + fuel receipts
                  + per diem spreadsheets + parts invoices + maintenance logs. Five systems, three people,
                  two days.
                </p>
                <p className="text-gray-400">
                  IronSight answers it in <span className="text-amber-400 font-bold">one query</span> because
                  every piece of data — from the PLC counting tie plates to the journal entry that bills
                  the railroad — lives in one connected system.
                </p>
              </div>
            </div>
          </div>

          {/* What B&B uses today vs IronSight */}
          <div className="mt-8 bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl border border-gray-700/50 overflow-hidden">
            <div className="grid grid-cols-2 divide-x divide-gray-800">
              <div className="p-5">
                <p className="text-xs text-red-400 uppercase tracking-wider font-bold mb-3">Today (Fragmented)</p>
                <ul className="space-y-2 text-sm text-gray-400">
                  <li>QuickBooks — accounting</li>
                  <li>Paper forms — timesheets</li>
                  <li>Excel — IFTA tracking</li>
                  <li>Whiteboard — fleet maintenance</li>
                  <li>Filing cabinet — training certs</li>
                  <li>Spreadsheet — per diem calc</li>
                  <li>Paper — PTO requests</li>
                  <li>Nothing — truck diagnostics</li>
                  <li>Nothing — TPS production data</li>
                </ul>
              </div>
              <div className="p-5">
                <p className="text-xs text-emerald-400 uppercase tracking-wider font-bold mb-3">IronSight (One System)</p>
                <ul className="space-y-2 text-sm text-gray-300">
                  <li>Double-entry accounting</li>
                  <li>12-section digital timesheets</li>
                  <li>IFTA auto-captured from timesheets</li>
                  <li>Fleet diagnostics + maintenance</li>
                  <li>Training compliance tracking</li>
                  <li>Per diem auto-calculated</li>
                  <li>PTO workflow + balances</li>
                  <li>Real-time J1939 CAN bus data</li>
                  <li>Live TPS plate count + speed</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

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
              <h3 className="text-lg font-bold text-white mb-3">For the Crew</h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                One app replaces paper timesheets, PTO request forms, and phone calls to the shop.
                Jake can submit his timesheet from the NS Corbin yard, check Truck 01&apos;s engine
                codes, and request vacation — all from his phone.
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
                See every truck, every crew, every dollar in real time. Approve timesheets that
                auto-generate journal entries. Track NS contract costs without touching QuickBooks.
                Get alerted when a training cert expires 30 days before the NS audit.
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
                Replace QuickBooks ($250/mo + add-ons), paper timesheets, and 5 spreadsheets with
                one system at ~$20/mo. B&B becomes the most technologically advanced railroad
                contractor in the country — and IronSight becomes a product to sell to others.
              </p>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Section 3: The Competitive Moat                                   */}
        {/* ---------------------------------------------------------------- */}
        <section>
          <SectionHeading
            title="Why Nobody Else Can Do This"
            subtitle="B&B's trucks aren't just trucks. Each one is a TPS conveyor + Click PLC + Staubli robot + Apera vision + J1939 CAN bus. No single vendor monitors all of that."
            accent="rose"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-6 border border-rose-500/20">
              <h3 className="text-white font-bold mb-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                TPS Production Data (Unique Moat)
              </h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                IronSight reads encoder counts, plate counts, plates per minute, and detector
                offsets directly from the Click PLC at 1 Hz. No other system in the world connects
                tie plate production telemetry to the truck that carried the plates, the crew that
                ran the machine, the timesheet that billed it, and the invoice that collected payment.
              </p>
            </div>
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-6 border border-rose-500/20">
              <h3 className="text-white font-bold mb-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                Full Vertical Integration
              </h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                CAN bus data tells us the engine is running. PLC data tells us plates are being laid.
                The timesheet records who ran the job. The journal entry posts the expense. The
                invoice bills the railroad. One system, zero re-entry — from sensor to spreadsheet.
              </p>
            </div>
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-6 border border-rose-500/20">
              <h3 className="text-white font-bold mb-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                AI-Native Diagnostics
              </h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                Truck 01 throws a DTC on a job site 400 miles from Shepherdsville. Today: driver
                calls shop, describes the warning light, mechanic guesses. With IronSight: real-time
                J1939 data, Claude-powered AI diagnosis, work order created before the call ends.
              </p>
            </div>
            <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-6 border border-rose-500/20">
              <h3 className="text-white font-bold mb-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                NS Compliance Built In
              </h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                Norfolk Southern requires Roadway Worker Protection training, insurance certs, Right
                of Entry Agreements, OSHA compliance, and PPE records for every crew member on track.
                IronSight tracks all of it — expiry alerts 30 days out, compliance dashboard for audits.
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
            <RoadmapCard status="built" title="Expense Management with Receipt Capture" />
            <RoadmapCard
              status="built"
              title="Financial Module (QuickBooks Replacement)"
              details={[
                "Chart of accounts (32 seeded), double-entry journal entries",
                "Auto-journal entries from timesheet approval (per diem + expenses)",
                "Trial balance, P&L reports, account balance tracking",
              ]}
            />
            <RoadmapCard
              status="built"
              title="Payroll Export"
              details={[
                "Direct feed from approved timesheets",
                "Hours, per diem, mileage, expenses — CSV & JSON export",
              ]}
            />
            <RoadmapCard
              status="built"
              title="Inventory & Parts Tracking"
              details={[
                "22 seeded heavy-duty truck parts with stock levels",
                "Usage logging linked to trucks and maintenance",
                "Low-stock alerts with reorder suggestions",
              ]}
            />
            <RoadmapCard
              status="built"
              title="Fleet Truck Management"
              details={[
                "Add/edit/decommission trucks from admin panel",
                "VIN, year/make/model, Viam Part ID, capabilities",
                "Status tracking: active, inactive, maintenance",
              ]}
            />
            <RoadmapCard
              status="in-progress"
              title="Accounts Receivable & Invoicing"
              details={[
                "Customer management (Norfolk Southern, CSX, etc.)",
                "Invoice generation from work completed",
                "Payment recording and aging reports",
              ]}
            />
            <RoadmapCard
              status="in-progress"
              title="Accounts Payable"
              details={[
                "Vendor bill tracking and payment scheduling",
                "Purchase orders for parts and supplies",
                "Aging reports for cash flow management",
              ]}
            />
            <RoadmapCard
              status="planned"
              title="DOT/FMCSA Compliance Center"
              details={[
                "IFTA quarterly filing (already capturing odometer data)",
                "CDL driver qualifications and medical cards",
                "Vehicle inspection records, CSA score tracking",
              ]}
            />
            <RoadmapCard
              status="planned"
              title="NS Contractor Compliance"
              details={[
                "Roadway Worker Protection training tracking",
                "Insurance cert management with expiry alerts",
                "Right of Entry Agreement tracking per job site",
              ]}
            />
            <RoadmapCard
              status="planned"
              title="Payroll Independence"
              details={[
                "Tax calculation (federal, state, FICA, FUTA)",
                "Direct deposit / ACH file generation",
                "W-2 and 1099 generation, quarterly tax filings",
              ]}
            />
            <RoadmapCard
              status="planned"
              title="Bank Integration & Reconciliation"
              details={[
                "Plaid bank feed for automatic transaction import",
                "Bank reconciliation workflow",
                "Balance Sheet and Cash Flow Statement reports",
              ]}
            />
            <RoadmapCard
              status="planned"
              title="Advanced Analytics & AI"
              details={[
                "\"What's our margin on the NS contract?\" — one query",
                "Predictive maintenance from fleet + TPS data",
                "Natural language reporting across all company data",
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
            title="Replacing QuickBooks"
            subtitle="The highest-value module. Detailed roadmap: docs/quickbooks-replacement-roadmap.md"
            accent="purple"
          />
          <div className="bg-gradient-to-br from-purple-950/30 to-gray-900 rounded-xl p-6 sm:p-8 border border-purple-500/20">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div>
                <p className="text-3xl font-black text-white">$250+/mo</p>
                <p className="text-gray-400 text-sm mt-1">
                  Current QuickBooks cost with add-ons. IronSight runs on ~$20/mo infrastructure.
                </p>
              </div>
              <div>
                <p className="text-3xl font-black text-white">34 trucks</p>
                <p className="text-gray-400 text-sm mt-1">
                  FMCSA-registered fleet. Each truck generates maintenance, fuel, IFTA, and payroll data daily.
                </p>
              </div>
              <div>
                <p className="text-3xl font-black text-white">0 re-entry</p>
                <p className="text-gray-400 text-sm mt-1">
                  Approve a timesheet — per diem, expenses, and journal entries post automatically.
                </p>
              </div>
            </div>
            <div className="mt-8 space-y-4">
              <div className="flex items-start gap-3">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                <p className="text-gray-300 text-sm leading-relaxed">
                  <span className="text-emerald-400 font-bold">Already built:</span> Double-entry bookkeeping,
                  chart of accounts (32 accounts), journal entries, trial balance, P&L report, auto-JE from
                  timesheet approval, payroll export, inventory tracking.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                <p className="text-gray-300 text-sm leading-relaxed">
                  <span className="text-amber-400 font-bold">Next up:</span> Accounts Receivable (invoicing NS),
                  Accounts Payable (vendor bills), bank reconciliation, Balance Sheet report, General Ledger report.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                <p className="text-gray-300 text-sm leading-relaxed">
                  <span className="text-blue-400 font-bold">Phase 2:</span> Tax calculation, direct deposit, W-2/1099
                  generation, bank feed integration via Plaid. Full payroll independence.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0" />
                <p className="text-gray-300 text-sm leading-relaxed">
                  <span className="text-purple-400 font-bold">The lock-in:</span> Once financials are connected
                  to timesheets, inventory, and fleet data, switching back is unthinkable. Every module feeds
                  into and depends on the financial core.
                </p>
              </div>
            </div>
          </div>
        </section>
        {/* ---------------------------------------------------------------- */}
        {/* Section 7: The Bigger Play                                        */}
        {/* ---------------------------------------------------------------- */}
        <section>
          <SectionHeading
            title="Beyond B&B"
            subtitle="B&B is customer zero. The platform is industry-agnostic."
            accent="indigo"
          />
          <div className="bg-gradient-to-br from-indigo-950/30 to-gray-900 rounded-xl p-6 sm:p-8 border border-indigo-500/20">
            <div className="space-y-4">
              <p className="text-gray-300 text-sm leading-relaxed">
                Every railroad contractor running TPS trucks has the same fragmented tooling problem.
                Every industrial fleet operator — concrete, logging, mining, construction — manages
                trucks + crews + timesheets + compliance with the same disconnected mess.
              </p>
              <p className="text-gray-300 text-sm leading-relaxed">
                IronSight starts as B&B&apos;s internal operating system. But the architecture is already
                multi-tenant capable: fleet registry per org, role-based access, Clerk RBAC, Supabase
                row-level security.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
                <div className="text-center p-4 rounded-lg bg-gray-900/50 border border-gray-800">
                  <p className="text-2xl font-black text-indigo-400">Year 1</p>
                  <p className="text-gray-500 text-xs mt-1">B&B internal — prove the platform</p>
                </div>
                <div className="text-center p-4 rounded-lg bg-gray-900/50 border border-gray-800">
                  <p className="text-2xl font-black text-indigo-400">Year 2</p>
                  <p className="text-gray-500 text-xs mt-1">Sell to 3-5 railroad contractors</p>
                </div>
                <div className="text-center p-4 rounded-lg bg-gray-900/50 border border-gray-800">
                  <p className="text-2xl font-black text-indigo-400">Year 3</p>
                  <p className="text-gray-500 text-xs mt-1">Expand to industrial fleets broadly</p>
                </div>
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
          IronSight — B&B Metals, Inc. — Shepherdsville, KY — Confidential
        </p>
      </footer>
    </div>
  );
}
