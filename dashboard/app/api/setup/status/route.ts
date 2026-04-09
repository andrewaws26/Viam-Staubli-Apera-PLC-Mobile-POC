import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

interface SystemCheck {
  key: string;
  label: string;
  description: string;
  count: number;
  threshold: number;
  href: string;
}

/** GET — run system readiness checks across all modules */
export async function GET() {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const sb = getSupabase();

    // Run all counts in parallel
    const results = await Promise.allSettled([
      sb.from("chart_of_accounts").select("*", { count: "exact", head: true }),
      sb.from("accounting_periods").select("*", { count: "exact", head: true }),
      sb.from("tax_rate_tables").select("*", { count: "exact", head: true }),
      sb.from("state_tax_configs").select("*", { count: "exact", head: true }),
      sb.from("employee_profiles").select("*", { count: "exact", head: true }),
      sb.from("company_vehicles").select("*", { count: "exact", head: true }),
      sb.from("bank_accounts").select("*", { count: "exact", head: true }),
      sb.from("training_requirements").select("*", { count: "exact", head: true }),
      sb.from("benefit_plans").select("*", { count: "exact", head: true }),
      sb.from("per_diem_rates").select("*", { count: "exact", head: true }),
      sb.from("customers").select("*", { count: "exact", head: true }),
      sb.from("vendors").select("*", { count: "exact", head: true }),
    ]);

    function cnt(idx: number): number {
      const r = results[idx];
      if (r.status === "fulfilled" && r.value.count != null) return r.value.count;
      return 0;
    }

    const checks: SystemCheck[] = [
      { key: "chart_of_accounts", label: "Chart of Accounts", description: "GL accounts for bookkeeping", count: cnt(0), threshold: 10, href: "/accounting" },
      { key: "accounting_periods", label: "Accounting Periods", description: "Fiscal year periods defined", count: cnt(1), threshold: 1, href: "/accounting/periods" },
      { key: "tax_rates", label: "Federal Tax Tables", description: "Payroll withholding rates", count: cnt(2), threshold: 1, href: "/accounting/employee-tax" },
      { key: "state_tax", label: "State Tax Config", description: "State withholding rules", count: cnt(3), threshold: 1, href: "/accounting/tax-reports" },
      { key: "employees", label: "Employee Profiles", description: "Team member records", count: cnt(4), threshold: 1, href: "/team" },
      { key: "vehicles", label: "Fleet Vehicles", description: "Trucks and equipment", count: cnt(5), threshold: 1, href: "/admin/vehicles" },
      { key: "bank_accounts", label: "Bank Accounts", description: "Connected bank accounts", count: cnt(6), threshold: 1, href: "/accounting/bank" },
      { key: "training", label: "Training Requirements", description: "Safety & compliance certs", count: cnt(7), threshold: 1, href: "/training/admin" },
      { key: "benefits", label: "Benefit Plans", description: "Health, dental, 401k plans", count: cnt(8), threshold: 0, href: "/accounting/employee-tax" },
      { key: "per_diem", label: "Per Diem Rates", description: "Daily & layover rates", count: cnt(9), threshold: 1, href: "/accounting/payment-reminders" },
      { key: "customers", label: "Customers", description: "AR customer records", count: cnt(10), threshold: 0, href: "/accounting/customers" },
      { key: "vendors", label: "Vendors", description: "AP vendor records", count: cnt(11), threshold: 0, href: "/accounting/customers" },
    ];

    const ready = checks.filter((c) => c.count >= c.threshold && c.threshold > 0).length;
    const total = checks.filter((c) => c.threshold > 0).length;

    return NextResponse.json({ checks, ready, total });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[SETUP-STATUS] error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
