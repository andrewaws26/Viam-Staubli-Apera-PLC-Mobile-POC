"use client";

import { useState, useEffect, useCallback, Fragment } from "react";


// -- Types ------------------------------------------------------------------

interface BenefitEnrollment {
  benefit_plan_id: string;
  plan_name: string;
  plan_type: string;
  employee_amount: number;
  employer_amount: number;
}

interface WorkersCompAssignment {
  ncci_code: string;
  description: string;
  rate_per_100: number;
}

interface EmployeeTaxProfile {
  id: string;
  user_id: string;
  employee_name: string;
  filing_status: "single" | "married_filing_jointly" | "head_of_household";
  multiple_jobs: boolean;
  dependents_credit: number;
  other_income: number;
  deductions: number;
  extra_withholding: number;
  state: string;
  state_withholding: number;
  pay_frequency: "weekly" | "biweekly" | "semimonthly" | "monthly";
  hourly_rate: number | null;
  salary_annual: number | null;
  pay_type: "hourly" | "salary";
  ytd_gross_pay: number;
  ytd_federal_wh: number;
  ytd_state_wh: number;
  ytd_ss_employee: number;
  ytd_medicare_employee: number;
  is_active: boolean;
  benefits: BenefitEnrollment[];
  workers_comp: WorkersCompAssignment | null;
}

interface BenefitPlan {
  id: string;
  plan_name: string;
  plan_type: string;
  employee_amount: number;
  employer_amount: number;
}

interface WorkersCompClass {
  ncci_code: string;
  description: string;
  rate_per_100: number;
}

// -- Helpers ----------------------------------------------------------------

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);
}

function fmtRate(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);
}

function fmtPct(n: number): string {
  return (n * 100).toFixed(2) + "%";
}

const FILING_STATUS_LABELS: Record<string, string> = {
  single: "Single",
  married_filing_jointly: "Married Filing Jointly",
  head_of_household: "Head of Household",
};

const PAY_FREQ_LABELS: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  semimonthly: "Semi-Monthly",
  monthly: "Monthly",
};

// -- Page -------------------------------------------------------------------

export default function EmployeeTaxPage() {
  const [employees, setEmployees] = useState<EmployeeTaxProfile[]>([]);
  const [benefitPlans, setBenefitPlans] = useState<BenefitPlan[]>([]);
  const [wcClasses, setWcClasses] = useState<WorkersCompClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Edit modal
  const [editEmployee, setEditEmployee] = useState<EmployeeTaxProfile | null>(null);
  const [editForm, setEditForm] = useState({
    filing_status: "single" as string,
    multiple_jobs: false,
    dependents_credit: 0,
    other_income: 0,
    deductions: 0,
    extra_withholding: 0,
    pay_type: "hourly" as string,
    hourly_rate: 0,
    salary_annual: 0,
    pay_frequency: "weekly" as string,
    state: "KY",
    state_withholding: 0.04,
  });
  const [editBenefits, setEditBenefits] = useState<Record<string, boolean>>({});
  const [editWcCode, setEditWcCode] = useState("");

  // Add employee form
  const [showAdd, setShowAdd] = useState(false);
  const [addUserId, setAddUserId] = useState("");
  const [addName, setAddName] = useState("");

  // -- Data Loading ---------------------------------------------------------

  const loadData = useCallback(async () => {
    try {
      const [empRes, bpRes, wcRes] = await Promise.all([
        fetch("/api/accounting/employee-tax"),
        fetch("/api/accounting/employee-tax?benefit_plans=true"),
        fetch("/api/accounting/employee-tax?workers_comp_classes=true"),
      ]);
      if (empRes.ok) {
        const data = await empRes.json();
        setEmployees(Array.isArray(data) ? data : []);
      }
      if (bpRes.ok) {
        const data = await bpRes.json();
        setBenefitPlans(Array.isArray(data) ? data : []);
      }
      if (wcRes.ok) {
        const data = await wcRes.json();
        setWcClasses(Array.isArray(data) ? data : []);
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // -- Actions --------------------------------------------------------------

  function openEdit(emp: EmployeeTaxProfile) {
    setEditEmployee(emp);
    setEditForm({
      filing_status: emp.filing_status,
      multiple_jobs: emp.multiple_jobs,
      dependents_credit: emp.dependents_credit,
      other_income: emp.other_income,
      deductions: emp.deductions,
      extra_withholding: emp.extra_withholding,
      pay_type: emp.pay_type,
      hourly_rate: emp.hourly_rate ?? 0,
      salary_annual: emp.salary_annual ?? 0,
      pay_frequency: emp.pay_frequency,
      state: emp.state,
      state_withholding: emp.state_withholding,
    });

    // Build benefit enrollment map
    const bMap: Record<string, boolean> = {};
    benefitPlans.forEach((bp) => {
      bMap[bp.id] = emp.benefits.some((b) => b.benefit_plan_id === bp.id);
    });
    setEditBenefits(bMap);

    setEditWcCode(emp.workers_comp?.ncci_code ?? "");
    setError("");
  }

  async function handleSave() {
    if (!editEmployee) return;
    setSaving(true);
    setError("");

    try {
      // 1. Save tax profile (POST upsert)
      const profileRes = await fetch("/api/accounting/employee-tax", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: editEmployee.user_id,
          employee_name: editEmployee.employee_name,
          filing_status: editForm.filing_status,
          multiple_jobs: editForm.multiple_jobs,
          dependents_credit: editForm.dependents_credit,
          other_income: editForm.other_income,
          deductions: editForm.deductions,
          extra_withholding: editForm.extra_withholding,
          pay_type: editForm.pay_type,
          hourly_rate: editForm.pay_type === "hourly" ? editForm.hourly_rate : null,
          salary_annual: editForm.pay_type === "salary" ? editForm.salary_annual : null,
          pay_frequency: editForm.pay_frequency,
          state: editForm.state,
          state_withholding: editForm.state_withholding,
        }),
      });
      if (!profileRes.ok) {
        const d = await profileRes.json().catch(() => ({}));
        throw new Error(d.error || "Failed to save profile");
      }

      // 2. Process benefit changes (PATCH)
      const currentBenefitIds = new Set(editEmployee.benefits.map((b) => b.benefit_plan_id));
      for (const [planId, enrolled] of Object.entries(editBenefits)) {
        const wasEnrolled = currentBenefitIds.has(planId);
        if (enrolled && !wasEnrolled) {
          await fetch("/api/accounting/employee-tax", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "enroll_benefit",
              user_id: editEmployee.user_id,
              benefit_plan_id: planId,
            }),
          });
        } else if (!enrolled && wasEnrolled) {
          await fetch("/api/accounting/employee-tax", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "unenroll_benefit",
              user_id: editEmployee.user_id,
              benefit_plan_id: planId,
            }),
          });
        }
      }

      // 3. Workers comp assignment (PATCH)
      const currentWc = editEmployee.workers_comp?.ncci_code ?? "";
      if (editWcCode !== currentWc) {
        await fetch("/api/accounting/employee-tax", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "assign_workers_comp",
            user_id: editEmployee.user_id,
            ncci_code: editWcCode || null,
          }),
        });
      }

      setEditEmployee(null);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
    setSaving(false);
  }

  async function handleAddEmployee() {
    if (!addUserId.trim() || !addName.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/accounting/employee-tax", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: addUserId.trim(),
          employee_name: addName.trim(),
          filing_status: "single",
          multiple_jobs: false,
          dependents_credit: 0,
          other_income: 0,
          deductions: 0,
          extra_withholding: 0,
          pay_type: "hourly",
          hourly_rate: 0,
          salary_annual: null,
          pay_frequency: "weekly",
          state: "KY",
          state_withholding: 0.04,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to create profile");
      }
      setShowAdd(false);
      setAddUserId("");
      setAddName("");
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
    setSaving(false);
  }

  // -- Summary Stats --------------------------------------------------------

  const totalEmployees = employees.filter((e) => e.is_active).length;
  const hourlyCount = employees.filter((e) => e.is_active && e.pay_type === "hourly").length;
  const salaryCount = employees.filter((e) => e.is_active && e.pay_type === "salary").length;
  const benefitsEnrolled = new Set(
    employees.filter((e) => e.is_active && e.benefits.length > 0).map((e) => e.user_id)
  ).size;

  // -- Render ---------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      <main className="px-4 sm:px-6 py-6 max-w-7xl mx-auto">
        {/* Error Banner */}
        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-red-900/30 border border-red-800 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Total Employees", value: totalEmployees, color: "text-gray-200" },
            { label: "Hourly", value: hourlyCount, color: "text-blue-400" },
            { label: "Salary", value: salaryCount, color: "text-emerald-400" },
            { label: "Benefits Enrolled", value: benefitsEnrolled, color: "text-amber-400" },
          ].map((c) => (
            <div key={c.label} className="rounded-xl bg-gray-900/50 border border-gray-800 p-4">
              <p className="text-xs uppercase tracking-wider text-gray-600 font-medium">
                {c.label}
              </p>
              <p className={`text-xl font-black mt-1 ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>

        {/* Action Bar */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => {
              setShowAdd(true);
              setAddUserId("");
              setAddName("");
              setError("");
            }}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold uppercase tracking-wider transition-colors"
          >
            + Add Employee
          </button>
        </div>

        {/* Add Employee Form */}
        {showAdd && (
          <div className="mb-6 p-6 rounded-xl bg-gray-900/50 border border-gray-800 space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">
              New Employee Tax Profile
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">
                  Clerk User ID *
                </label>
                <input
                  value={addUserId}
                  onChange={(e) => setAddUserId(e.target.value)}
                  placeholder="user_2x..."
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white focus:outline-none focus:border-gray-600"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">
                  Employee Name *
                </label>
                <input
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="John Smith"
                  className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-white focus:outline-none focus:border-gray-600"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowAdd(false)}
                className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 text-sm font-bold uppercase tracking-wider transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddEmployee}
                disabled={saving || !addUserId.trim() || !addName.trim()}
                className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider transition-colors"
              >
                {saving ? "Creating..." : "Create Profile"}
              </button>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" />
          </div>
        ) : employees.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-600 text-sm">No employee tax profiles found</p>
          </div>
        ) : (
          /* Employee Table */
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[1000px]">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-gray-600 border-b border-gray-800">
                  <th className="text-left px-4 py-3 font-medium w-8" />
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Pay Type</th>
                  <th className="text-right px-4 py-3 font-medium">Rate</th>
                  <th className="text-left px-4 py-3 font-medium">Filing Status</th>
                  <th className="text-left px-4 py-3 font-medium">State</th>
                  <th className="text-left px-4 py-3 font-medium">W-4 Status</th>
                  <th className="text-right px-4 py-3 font-medium">YTD Gross</th>
                  <th className="text-right px-4 py-3 font-medium w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => {
                  const isExpanded = expandedId === emp.id;
                  const hasProfile =
                    emp.filing_status !== null && emp.pay_type !== null;

                  return (
                    <Fragment key={emp.id}>
                      <tr
                        className="border-t border-gray-800/50 hover:bg-gray-800/20 transition-colors cursor-pointer"
                        onClick={() =>
                          setExpandedId(isExpanded ? null : emp.id)
                        }
                      >
                        {/* Expand Chevron */}
                        <td className="px-4 py-3 text-gray-600">
                          <svg
                            className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path
                              fillRule="evenodd"
                              d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </td>

                        {/* Name */}
                        <td className="px-4 py-3 text-gray-200 font-medium">
                          {emp.employee_name}
                          {!emp.is_active && (
                            <span className="ml-2 px-2 py-0.5 rounded text-xs font-bold uppercase bg-gray-800 text-gray-500">
                              Inactive
                            </span>
                          )}
                        </td>

                        {/* Pay Type Badge */}
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${
                              emp.pay_type === "salary"
                                ? "bg-emerald-900/50 text-emerald-300"
                                : "bg-blue-900/50 text-blue-300"
                            }`}
                          >
                            {emp.pay_type}
                          </span>
                        </td>

                        {/* Rate */}
                        <td className="px-4 py-3 text-right text-gray-200 font-mono">
                          {emp.pay_type === "hourly"
                            ? emp.hourly_rate !== null
                              ? fmtRate(emp.hourly_rate) + "/hr"
                              : "--"
                            : emp.salary_annual !== null
                              ? fmt(emp.salary_annual) + "/yr"
                              : "--"}
                        </td>

                        {/* Filing Status */}
                        <td className="px-4 py-3 text-gray-400 text-xs">
                          {FILING_STATUS_LABELS[emp.filing_status] || emp.filing_status}
                        </td>

                        {/* State */}
                        <td className="px-4 py-3 text-gray-400 font-mono">
                          {emp.state}
                        </td>

                        {/* W-4 Status */}
                        <td className="px-4 py-3">
                          {hasProfile ? (
                            <span className="px-2 py-0.5 rounded text-xs font-bold uppercase bg-emerald-900/50 text-emerald-300">
                              Active
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-xs font-bold uppercase bg-gray-800 text-gray-400">
                              Not Set
                            </span>
                          )}
                        </td>

                        {/* YTD Gross */}
                        <td className="px-4 py-3 text-right text-gray-200 font-mono font-bold">
                          {fmt(emp.ytd_gross_pay)}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(emp);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-[11px] font-bold uppercase tracking-wider transition-colors"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>

                      {/* Expanded Detail */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={9} className="bg-gray-950/50 border-t border-gray-800/50">
                            <div className="px-8 py-5 space-y-5">
                              {/* W-4 Details */}
                              <div>
                                <p className="text-xs text-gray-600 uppercase tracking-wider mb-2">
                                  W-4 Details
                                </p>
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                                  {[
                                    { label: "Filing Status", value: FILING_STATUS_LABELS[emp.filing_status] || emp.filing_status },
                                    { label: "Multiple Jobs", value: emp.multiple_jobs ? "Yes" : "No" },
                                    { label: "Dependents Credit", value: fmt(emp.dependents_credit) },
                                    { label: "Other Income", value: fmt(emp.other_income) },
                                    { label: "Deductions", value: fmt(emp.deductions) },
                                    { label: "Extra Withholding", value: fmt(emp.extra_withholding) },
                                  ].map((item) => (
                                    <div key={item.label}>
                                      <p className="text-[9px] text-gray-600 uppercase tracking-wider">{item.label}</p>
                                      <p className="text-sm text-gray-300 font-medium mt-0.5">{item.value}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Benefits */}
                              <div>
                                <p className="text-xs text-gray-600 uppercase tracking-wider mb-2">
                                  Benefits Enrollment
                                </p>
                                {emp.benefits.length === 0 ? (
                                  <p className="text-sm text-gray-600">No benefits enrolled</p>
                                ) : (
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                      <thead>
                                        <tr className="text-[9px] uppercase tracking-wider text-gray-600">
                                          <th className="text-left py-1 font-medium">Plan</th>
                                          <th className="text-left py-1 font-medium">Type</th>
                                          <th className="text-right py-1 font-medium">Employee</th>
                                          <th className="text-right py-1 font-medium">Employer</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {emp.benefits.map((b) => (
                                          <tr key={b.benefit_plan_id} className="border-t border-gray-800/30">
                                            <td className="py-1.5 text-gray-300">{b.plan_name}</td>
                                            <td className="py-1.5 text-gray-400 text-xs">{b.plan_type}</td>
                                            <td className="py-1.5 text-right text-red-400/80 font-mono">{fmt(b.employee_amount)}</td>
                                            <td className="py-1.5 text-right text-emerald-400/80 font-mono">{fmt(b.employer_amount)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>

                              {/* Workers Comp */}
                              <div>
                                <p className="text-xs text-gray-600 uppercase tracking-wider mb-2">
                                  Workers Comp Class
                                </p>
                                {emp.workers_comp ? (
                                  <div className="flex items-center gap-4">
                                    <span className="px-2 py-0.5 rounded text-xs font-bold uppercase bg-amber-900/50 text-amber-300 font-mono">
                                      {emp.workers_comp.ncci_code}
                                    </span>
                                    <span className="text-sm text-gray-300">{emp.workers_comp.description}</span>
                                    <span className="text-sm text-gray-400 font-mono">{emp.workers_comp.rate_per_100}/100</span>
                                  </div>
                                ) : (
                                  <p className="text-sm text-gray-600">No class assigned</p>
                                )}
                              </div>

                              {/* YTD Summary */}
                              <div>
                                <p className="text-xs text-gray-600 uppercase tracking-wider mb-2">
                                  YTD Summary
                                </p>
                                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                                  {[
                                    { label: "Gross Pay", value: fmt(emp.ytd_gross_pay), color: "text-white" },
                                    { label: "Federal WH", value: fmt(emp.ytd_federal_wh), color: "text-red-400/80" },
                                    { label: "State WH", value: fmt(emp.ytd_state_wh), color: "text-red-400/80" },
                                    { label: "Social Security", value: fmt(emp.ytd_ss_employee), color: "text-red-400/80" },
                                    { label: "Medicare", value: fmt(emp.ytd_medicare_employee), color: "text-red-400/80" },
                                  ].map((item) => (
                                    <div key={item.label}>
                                      <p className="text-[9px] text-gray-600 uppercase tracking-wider">{item.label}</p>
                                      <p className={`text-sm font-mono font-bold mt-0.5 ${item.color}`}>{item.value}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Pay Info */}
                              <div className="flex items-center gap-4 text-xs text-gray-500">
                                <span>Pay Frequency: <span className="text-gray-400">{PAY_FREQ_LABELS[emp.pay_frequency] || emp.pay_frequency}</span></span>
                                <span>State WH Rate: <span className="text-gray-400">{fmtPct(emp.state_withholding)}</span></span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Edit Modal */}
        {editEmployee && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">
                  Edit &mdash; {editEmployee.employee_name}
                </h3>
                <button
                  onClick={() => setEditEmployee(null)}
                  className="text-gray-500 hover:text-gray-300 text-lg leading-none"
                >
                  &times;
                </button>
              </div>

              {/* W-4 Section */}
              <div>
                <p className="text-xs text-gray-600 uppercase tracking-wider mb-3">W-4 Information</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Filing Status</label>
                    <select
                      value={editForm.filing_status}
                      onChange={(e) => setEditForm({ ...editForm, filing_status: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white"
                    >
                      <option value="single">Single</option>
                      <option value="married_filing_jointly">Married Filing Jointly</option>
                      <option value="head_of_household">Head of Household</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-3 pt-5">
                    <input
                      type="checkbox"
                      checked={editForm.multiple_jobs}
                      onChange={(e) => setEditForm({ ...editForm, multiple_jobs: e.target.checked })}
                      className="w-4 h-4 rounded bg-gray-800 border-gray-700"
                    />
                    <label className="text-sm text-gray-300">Multiple Jobs (Step 2c)</label>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Dependents Credit</label>
                    <input
                      type="number"
                      value={editForm.dependents_credit}
                      onChange={(e) => setEditForm({ ...editForm, dependents_credit: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white"
                      min="0"
                      step="1"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Other Income</label>
                    <input
                      type="number"
                      value={editForm.other_income}
                      onChange={(e) => setEditForm({ ...editForm, other_income: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white"
                      min="0"
                      step="0.01"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Deductions</label>
                    <input
                      type="number"
                      value={editForm.deductions}
                      onChange={(e) => setEditForm({ ...editForm, deductions: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white"
                      min="0"
                      step="0.01"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Extra Withholding</label>
                    <input
                      type="number"
                      value={editForm.extra_withholding}
                      onChange={(e) => setEditForm({ ...editForm, extra_withholding: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white"
                      min="0"
                      step="0.01"
                    />
                  </div>
                </div>
              </div>

              {/* Pay Section */}
              <div>
                <p className="text-xs text-gray-600 uppercase tracking-wider mb-3">Pay Configuration</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Pay Type</label>
                    <select
                      value={editForm.pay_type}
                      onChange={(e) => setEditForm({ ...editForm, pay_type: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white"
                    >
                      <option value="hourly">Hourly</option>
                      <option value="salary">Salary</option>
                    </select>
                  </div>
                  {editForm.pay_type === "hourly" ? (
                    <div>
                      <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Hourly Rate</label>
                      <input
                        type="number"
                        value={editForm.hourly_rate}
                        onChange={(e) => setEditForm({ ...editForm, hourly_rate: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white"
                        min="0"
                        step="0.25"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Annual Salary</label>
                      <input
                        type="number"
                        value={editForm.salary_annual}
                        onChange={(e) => setEditForm({ ...editForm, salary_annual: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white"
                        min="0"
                        step="1000"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">Pay Frequency</label>
                    <select
                      value={editForm.pay_frequency}
                      onChange={(e) => setEditForm({ ...editForm, pay_frequency: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white"
                    >
                      <option value="weekly">Weekly</option>
                      <option value="biweekly">Biweekly</option>
                      <option value="semimonthly">Semi-Monthly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* State Section */}
              <div>
                <p className="text-xs text-gray-600 uppercase tracking-wider mb-3">State Withholding</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">State</label>
                    <input
                      value={editForm.state}
                      onChange={(e) => setEditForm({ ...editForm, state: e.target.value.toUpperCase() })}
                      className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white font-mono"
                      maxLength={2}
                      placeholder="KY"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 uppercase tracking-wider mb-1">State WH Rate (decimal)</label>
                    <input
                      type="number"
                      value={editForm.state_withholding}
                      onChange={(e) => setEditForm({ ...editForm, state_withholding: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white font-mono"
                      min="0"
                      max="1"
                      step="0.001"
                    />
                  </div>
                </div>
              </div>

              {/* Benefits Section */}
              <div>
                <p className="text-xs text-gray-600 uppercase tracking-wider mb-3">Benefits Enrollment</p>
                {benefitPlans.length === 0 ? (
                  <p className="text-sm text-gray-600">No benefit plans configured</p>
                ) : (
                  <div className="space-y-2">
                    {benefitPlans.map((plan) => (
                      <div
                        key={plan.id}
                        className={`flex items-center justify-between px-4 py-3 rounded-lg border transition-colors ${
                          editBenefits[plan.id]
                            ? "bg-emerald-900/20 border-emerald-800/50"
                            : "bg-gray-800/30 border-gray-800"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={editBenefits[plan.id] || false}
                            onChange={(e) =>
                              setEditBenefits({ ...editBenefits, [plan.id]: e.target.checked })
                            }
                            className="w-4 h-4 rounded bg-gray-800 border-gray-700"
                          />
                          <div>
                            <p className="text-sm text-gray-200 font-medium">{plan.plan_name}</p>
                            <p className="text-xs text-gray-500 uppercase">{plan.plan_type}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-xs font-mono">
                          <span className="text-red-400/80">EE: {fmt(plan.employee_amount)}</span>
                          <span className="text-emerald-400/80">ER: {fmt(plan.employer_amount)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Workers Comp Section */}
              <div>
                <p className="text-xs text-gray-600 uppercase tracking-wider mb-3">Workers Comp Class</p>
                <select
                  value={editWcCode}
                  onChange={(e) => setEditWcCode(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white"
                >
                  <option value="">No class assigned</option>
                  {wcClasses.map((wc) => (
                    <option key={wc.ncci_code} value={wc.ncci_code}>
                      {wc.ncci_code} &mdash; {wc.description} ({wc.rate_per_100}/100)
                    </option>
                  ))}
                </select>
              </div>

              {/* Modal Error */}
              {error && (
                <div className="px-4 py-3 rounded-xl bg-red-900/30 border border-red-800 text-sm text-red-300">
                  {error}
                </div>
              )}

              {/* Modal Actions */}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => {
                    setEditEmployee(null);
                    setError("");
                  }}
                  className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-500 text-gray-400 text-sm font-bold uppercase tracking-wider transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold uppercase tracking-wider transition-colors"
                >
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
