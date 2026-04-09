"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";

// ── Constants ─────────────────────────────────────────────────────

const STEPS = ["Welcome", "Company", "System Check", "Launch"];

const US_STATES: [string, string][] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
  ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
  ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"],
  ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"],
  ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
  ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"],
  ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"],
  ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"],
  ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"],
  ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
  ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
];

const INDUSTRIES = [
  "Railroad Contracting",
  "Heavy Construction",
  "Transportation & Trucking",
  "Manufacturing",
  "Mining & Extraction",
  "Oil & Gas",
  "Utilities",
  "Government / Municipal",
  "Agriculture",
  "Other",
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ── Types ─────────────────────────────────────────────────────────

interface CompanyData {
  company_name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  website: string;
  ein: string;
  industry: string;
  fiscal_year_start_month: number;
  accounting_method: string;
}

interface SystemCheck {
  key: string;
  label: string;
  description: string;
  count: number;
  threshold: number;
  href: string;
}

// ── Shared Styles ─────────────────────────────────────────────────

const inputCls =
  "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500 transition-colors";
const selectCls = inputCls;
const labelCls = "block text-xs font-medium text-gray-400 mb-1.5";
const btnPrimary =
  "px-6 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 hover:from-violet-500 hover:to-violet-400 text-white font-semibold text-sm transition-all shadow-lg shadow-violet-500/20 disabled:opacity-50 disabled:cursor-not-allowed";
const btnSecondary =
  "px-6 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium text-sm border border-gray-700 transition-colors";

// ── StepBar ───────────────────────────────────────────────────────

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center">
          {i > 0 && (
            <div
              className={`h-px w-10 sm:w-16 transition-colors ${
                i <= current ? "bg-violet-500" : "bg-gray-800"
              }`}
            />
          )}
          <div className="flex flex-col items-center gap-1.5">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                i < current
                  ? "bg-violet-500 text-white"
                  : i === current
                  ? "bg-gray-900 border-2 border-violet-500 text-violet-400"
                  : "bg-gray-900 border border-gray-700 text-gray-600"
              }`}
            >
              {i < current ? (
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span
              className={`text-[10px] font-medium whitespace-nowrap ${
                i <= current ? "text-gray-300" : "text-gray-600"
              }`}
            >
              {label}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Step 1: Welcome ───────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center max-w-lg mx-auto py-8 sm:py-12">
      <div className="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center mb-8 shadow-lg shadow-violet-500/20">
        <svg
          className="w-10 h-10 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      </div>

      <h1 className="text-3xl sm:text-4xl font-black text-white mb-3">
        Welcome to IronSight
      </h1>
      <p className="text-base sm:text-lg text-gray-400 mb-10">
        Your Company Operating System
      </p>

      <div className="text-left bg-gray-900/60 border border-gray-800 rounded-xl p-5 sm:p-6 mb-10">
        <p className="text-sm text-gray-300 mb-4 font-medium">
          This wizard will configure your system in a few minutes:
        </p>
        <ul className="space-y-3 text-sm text-gray-400">
          <li className="flex items-start gap-3">
            <span className="mt-0.5 w-5 h-5 rounded-full bg-violet-500/20 flex items-center justify-center text-violet-400 text-[10px] font-bold shrink-0">
              1
            </span>
            <span>Company profile, address, and tax ID</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-0.5 w-5 h-5 rounded-full bg-violet-500/20 flex items-center justify-center text-violet-400 text-[10px] font-bold shrink-0">
              2
            </span>
            <span>Fiscal year and accounting method</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="mt-0.5 w-5 h-5 rounded-full bg-violet-500/20 flex items-center justify-center text-violet-400 text-[10px] font-bold shrink-0">
              3
            </span>
            <span>
              System readiness check — verify all modules are configured
            </span>
          </li>
        </ul>
      </div>

      <button onClick={onNext} className={btnPrimary + " px-10 py-3"}>
        Get Started
      </button>
    </div>
  );
}

// ── Step 2: Company Profile ───────────────────────────────────────

function CompanyStep({
  data,
  onChange,
  error,
  saving,
  onBack,
  onNext,
}: {
  data: CompanyData;
  onChange: (d: CompanyData) => void;
  error: string;
  saving: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const set = (field: keyof CompanyData, value: string | number) =>
    onChange({ ...data, [field]: value });

  return (
    <div className="max-w-xl mx-auto py-6">
      <h2 className="text-xl font-bold text-white mb-1">Company Profile</h2>
      <p className="text-sm text-gray-500 mb-6">
        Tell us about your company. Only the name is required — fill in the rest
        now or later.
      </p>

      <div className="space-y-5">
        {/* Company Name */}
        <div>
          <label className={labelCls}>
            Company Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            className={inputCls}
            placeholder="e.g. B&B Metals LLC"
            value={data.company_name}
            onChange={(e) => set("company_name", e.target.value)}
            autoFocus
          />
        </div>

        {/* Address */}
        <div>
          <label className={labelCls}>Address</label>
          <input
            type="text"
            className={inputCls + " mb-2"}
            placeholder="Street address"
            value={data.address_line1}
            onChange={(e) => set("address_line1", e.target.value)}
          />
          <input
            type="text"
            className={inputCls}
            placeholder="Suite, unit, building (optional)"
            value={data.address_line2}
            onChange={(e) => set("address_line2", e.target.value)}
          />
        </div>

        {/* City / State / Zip */}
        <div className="grid grid-cols-5 gap-3">
          <div className="col-span-2">
            <label className={labelCls}>City</label>
            <input
              type="text"
              className={inputCls}
              placeholder="City"
              value={data.city}
              onChange={(e) => set("city", e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>State</label>
            <select
              className={selectCls}
              value={data.state}
              onChange={(e) => set("state", e.target.value)}
            >
              <option value="">Select...</option>
              {US_STATES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>ZIP</label>
            <input
              type="text"
              className={inputCls}
              placeholder="40165"
              value={data.zip}
              onChange={(e) => set("zip", e.target.value)}
            />
          </div>
        </div>

        {/* Phone / Email */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Phone</label>
            <input
              type="tel"
              className={inputCls}
              placeholder="(502) 555-0100"
              value={data.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input
              type="email"
              className={inputCls}
              placeholder="office@company.com"
              value={data.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </div>
        </div>

        {/* EIN / Industry */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Federal EIN</label>
            <input
              type="text"
              className={inputCls}
              placeholder="XX-XXXXXXX"
              value={data.ein}
              onChange={(e) => set("ein", e.target.value)}
            />
            <p className="text-[10px] text-gray-600 mt-1">
              Employer Identification Number (for payroll/tax)
            </p>
          </div>
          <div>
            <label className={labelCls}>Industry</label>
            <select
              className={selectCls}
              value={data.industry}
              onChange={(e) => set("industry", e.target.value)}
            >
              <option value="">Select...</option>
              {INDUSTRIES.map((ind) => (
                <option key={ind} value={ind}>
                  {ind}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Accounting Settings */}
        <div className="border-t border-gray-800 pt-5">
          <h3 className="text-sm font-bold text-gray-300 mb-4">
            Accounting Settings
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Fiscal Year Starts</label>
              <select
                className={selectCls}
                value={data.fiscal_year_start_month}
                onChange={(e) =>
                  set("fiscal_year_start_month", parseInt(e.target.value))
                }
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Accounting Method</label>
              <div className="flex gap-4 pt-2.5">
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input
                    type="radio"
                    name="method"
                    checked={data.accounting_method === "accrual"}
                    onChange={() => set("accounting_method", "accrual")}
                    className="accent-violet-500"
                  />
                  Accrual
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input
                    type="radio"
                    name="method"
                    checked={data.accounting_method === "cash"}
                    onChange={() => set("accounting_method", "cash")}
                    className="accent-violet-500"
                  />
                  Cash
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-900/30 border border-red-800/50 rounded-lg px-4 py-2.5 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-between pt-2">
          <button onClick={onBack} className={btnSecondary}>
            Back
          </button>
          <button onClick={onNext} disabled={saving} className={btnPrimary}>
            {saving ? "Saving..." : "Save & Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Step 3: System Readiness ──────────────────────────────────────

function ChecklistStep({
  checks,
  loading,
  onBack,
  onNext,
}: {
  checks: SystemCheck[];
  loading: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const ready = checks.filter(
    (c) => c.count >= c.threshold && c.threshold > 0,
  ).length;
  const required = checks.filter((c) => c.threshold > 0).length;

  return (
    <div className="max-w-xl mx-auto py-6">
      <h2 className="text-xl font-bold text-white mb-1">System Readiness</h2>
      <p className="text-sm text-gray-500 mb-6">
        Checking that your modules are configured. Items marked optional can be
        set up later.
      </p>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-gray-700 border-t-violet-500 animate-spin" />
          <p className="text-sm text-gray-500">Running system checks...</p>
        </div>
      ) : (
        <>
          {/* Progress */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-300">
                {ready} of {required} required modules ready
              </span>
              <span
                className={`text-sm font-bold ${
                  ready === required ? "text-emerald-400" : "text-amber-400"
                }`}
              >
                {required > 0 ? Math.round((ready / required) * 100) : 0}%
              </span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ease-out ${
                  ready === required ? "bg-emerald-500" : "bg-violet-500"
                }`}
                style={{
                  width: `${required > 0 ? (ready / required) * 100 : 0}%`,
                }}
              />
            </div>
          </div>

          {/* Check cards */}
          <div className="space-y-2">
            {checks.map((check) => {
              const ok = check.count >= check.threshold && check.threshold > 0;
              const optional = check.threshold === 0;
              return (
                <div
                  key={check.key}
                  className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                    ok
                      ? "border-emerald-800/30 bg-emerald-900/10"
                      : optional
                      ? "border-gray-800/50 bg-gray-900/30"
                      : "border-amber-800/30 bg-amber-900/10"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                        ok
                          ? "bg-emerald-500/20 text-emerald-400"
                          : optional
                          ? "bg-gray-800 text-gray-600"
                          : "bg-amber-500/20 text-amber-400"
                      }`}
                    >
                      {ok ? (
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      ) : optional ? (
                        <span className="text-[10px] font-medium">OPT</span>
                      ) : (
                        <span className="text-xs font-bold">!</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-200 truncate">
                        {check.label}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {check.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <span
                      className={`text-xs font-mono tabular-nums ${
                        ok
                          ? "text-emerald-400"
                          : optional
                          ? "text-gray-600"
                          : "text-amber-400"
                      }`}
                    >
                      {check.count}
                    </span>
                    <a
                      href={check.href}
                      className="text-xs text-violet-400 hover:text-violet-300 whitespace-nowrap"
                    >
                      {ok ? "View" : "Set up"} &rarr;
                    </a>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex justify-between pt-8">
            <button onClick={onBack} className={btnSecondary}>
              Back
            </button>
            <button onClick={onNext} className={btnPrimary}>
              {ready === required ? "Finish Setup" : "Continue Anyway"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Step 4: Complete ──────────────────────────────────────────────

function CompleteStep({
  companyName,
  saving,
  onLaunch,
}: {
  companyName: string;
  saving: boolean;
  onLaunch: () => void;
}) {
  const links = [
    { href: "/accounting", label: "Accounting", desc: "Manage finances" },
    { href: "/timesheets", label: "Timesheets", desc: "Track team hours" },
    { href: "/fleet", label: "Fleet", desc: "Monitor trucks" },
    {
      href: "/accounting/payroll-run",
      label: "Run Payroll",
      desc: "Process payroll",
    },
    {
      href: "/accounting/import",
      label: "Import Data",
      desc: "Migrate from QB",
    },
    { href: "/team", label: "Team Roster", desc: "Manage employees" },
  ];

  return (
    <div className="text-center max-w-lg mx-auto py-8 sm:py-12">
      <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mb-6">
        <svg
          className="w-8 h-8 text-emerald-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>

      <h2 className="text-2xl font-black text-white mb-2">
        You&apos;re All Set!
      </h2>
      <p className="text-gray-400 mb-10">
        {companyName || "Your company"} is configured and ready to use.
      </p>

      <div className="grid grid-cols-2 gap-3 mb-10 text-left">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="p-3 rounded-lg border border-gray-800 bg-gray-900/50 hover:bg-gray-900 hover:border-gray-700 transition-colors group"
          >
            <p className="text-sm font-medium text-gray-200 group-hover:text-white">
              {link.label}
            </p>
            <p className="text-xs text-gray-500">{link.desc}</p>
          </a>
        ))}
      </div>

      <button
        onClick={onLaunch}
        disabled={saving}
        className="px-10 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold text-sm transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50"
      >
        {saving ? "Finishing..." : "Launch IronSight"}
      </button>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────

const EMPTY_COMPANY: CompanyData = {
  company_name: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  zip: "",
  phone: "",
  email: "",
  website: "",
  ein: "",
  industry: "",
  fiscal_year_start_month: 1,
  accounting_method: "accrual",
};

export default function SetupPage() {
  const { isLoaded } = useUser();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [company, setCompany] = useState<CompanyData>(EMPTY_COMPANY);
  const [checks, setChecks] = useState<SystemCheck[]>([]);
  const [checksLoading, setChecksLoading] = useState(false);

  // Load existing settings on mount
  useEffect(() => {
    fetch("/api/setup")
      .then((r) => r.json())
      .then((data) => {
        if (data.company_name) {
          setCompany((prev) => ({ ...prev, ...data }));
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Load system checks when reaching step 2
  useEffect(() => {
    if (step === 2) {
      setChecksLoading(true);
      fetch("/api/setup/status")
        .then((r) => r.json())
        .then((data) => {
          setChecks(data.checks || []);
          setChecksLoading(false);
        })
        .catch(() => setChecksLoading(false));
    }
  }, [step]);

  async function saveCompany() {
    if (!company.company_name.trim()) {
      setError("Company name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(company),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to save");
      }
      setStep(2);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function completeSetup() {
    setSaving(true);
    try {
      await fetch("/api/setup", { method: "PATCH" });
    } catch {
      // Still redirect even if marking complete fails
    }
    router.push("/");
  }

  if (!isLoaded || loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-8 h-8 rounded-full border-2 border-gray-700 border-t-violet-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <StepBar current={step} />
      <div className="mt-8">
        {step === 0 && <WelcomeStep onNext={() => setStep(1)} />}
        {step === 1 && (
          <CompanyStep
            data={company}
            onChange={setCompany}
            error={error}
            saving={saving}
            onBack={() => setStep(0)}
            onNext={saveCompany}
          />
        )}
        {step === 2 && (
          <ChecklistStep
            checks={checks}
            loading={checksLoading}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <CompleteStep
            companyName={company.company_name}
            saving={saving}
            onLaunch={completeSetup}
          />
        )}
      </div>
    </div>
  );
}
