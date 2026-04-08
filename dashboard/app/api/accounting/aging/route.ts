import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

async function getUserInfo(userId: string) {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const role =
      ((user.publicMetadata as Record<string, unknown>)?.role as string) ||
      "operator";
    return { role };
  } catch {
    return { role: "operator" };
  }
}

interface AgingBucket {
  current: number;
  days_30: number;
  days_60: number;
  days_90: number;
  days_120_plus: number;
  total: number;
}

interface AgingRow {
  entity_id: string;
  entity_name: string;
  current: number;
  days_30: number;
  days_60: number;
  days_90: number;
  days_120_plus: number;
  total: number;
}

function bucketAge(dueDate: string, asOf: string): keyof AgingBucket {
  const due = new Date(dueDate + "T00:00:00");
  const ref = new Date(asOf + "T00:00:00");
  const daysOverdue = Math.floor((ref.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));

  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "days_30";
  if (daysOverdue <= 60) return "days_60";
  if (daysOverdue <= 90) return "days_90";
  return "days_120_plus";
}

/**
 * GET /api/accounting/aging
 * AR/AP Aging Report.
 *
 * Query params:
 *   type — "ar" (default) or "ap"
 *   as_of — date (YYYY-MM-DD, defaults to today)
 *
 * Returns per-customer/vendor aging in 30/60/90/120+ day buckets.
 * Manager/developer only.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = request.nextUrl.searchParams;
  const type = params.get("type") || "ar";
  const asOf = params.get("as_of") || new Date().toISOString().split("T")[0];

  try {
    const sb = getSupabase();

    if (type === "ar") {
      // Get all non-voided, non-draft invoices with outstanding balances
      const { data: invoices, error: invErr } = await sb
        .from("invoices")
        .select("id, customer_id, invoice_number, due_date, balance_due, total, status, customers(company_name)")
        .in("status", ["sent", "partial", "overdue"])
        .gt("balance_due", 0)
        .lte("invoice_date", asOf);

      if (invErr) throw invErr;

      // Group by customer
      const byCustomer = new Map<string, AgingRow>();
      const totals: AgingBucket = { current: 0, days_30: 0, days_60: 0, days_90: 0, days_120_plus: 0, total: 0 };

      for (const inv of invoices ?? []) {
        const custId = inv.customer_id as string;
        const cust = inv.customers as unknown as { company_name: string } | null;
        const custName = cust?.company_name || "Unknown";
        const balance = Number(inv.balance_due);
        const bucket = bucketAge(inv.due_date, asOf);

        if (!byCustomer.has(custId)) {
          byCustomer.set(custId, {
            entity_id: custId,
            entity_name: custName,
            current: 0, days_30: 0, days_60: 0, days_90: 0, days_120_plus: 0, total: 0,
          });
        }

        const row = byCustomer.get(custId)!;
        row[bucket] = Math.round((row[bucket] + balance) * 100) / 100;
        row.total = Math.round((row.total + balance) * 100) / 100;
        totals[bucket] = Math.round((totals[bucket] + balance) * 100) / 100;
        totals.total = Math.round((totals.total + balance) * 100) / 100;
      }

      return NextResponse.json({
        type: "ar",
        as_of: asOf,
        rows: [...byCustomer.values()].sort((a, b) => b.total - a.total),
        totals,
      });

    } else {
      // AP aging — same logic but for bills/vendors
      const { data: bills, error: billErr } = await sb
        .from("bills")
        .select("id, vendor_id, bill_number, due_date, balance_due, total, status, vendors(company_name)")
        .in("status", ["open", "partial"])
        .gt("balance_due", 0)
        .lte("bill_date", asOf);

      if (billErr) throw billErr;

      const byVendor = new Map<string, AgingRow>();
      const totals: AgingBucket = { current: 0, days_30: 0, days_60: 0, days_90: 0, days_120_plus: 0, total: 0 };

      for (const bill of bills ?? []) {
        const vendId = bill.vendor_id as string;
        const vend = bill.vendors as unknown as { company_name: string } | null;
        const vendName = vend?.company_name || "Unknown";
        const balance = Number(bill.balance_due);
        const bucket = bucketAge(bill.due_date, asOf);

        if (!byVendor.has(vendId)) {
          byVendor.set(vendId, {
            entity_id: vendId,
            entity_name: vendName,
            current: 0, days_30: 0, days_60: 0, days_90: 0, days_120_plus: 0, total: 0,
          });
        }

        const row = byVendor.get(vendId)!;
        row[bucket] = Math.round((row[bucket] + balance) * 100) / 100;
        row.total = Math.round((row.total + balance) * 100) / 100;
        totals[bucket] = Math.round((totals[bucket] + balance) * 100) / 100;
        totals.total = Math.round((totals.total + balance) * 100) / 100;
      }

      return NextResponse.json({
        type: "ap",
        as_of: asOf,
        rows: [...byVendor.values()].sort((a, b) => b.total - a.total),
        totals,
      });
    }
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/aging GET", err);
    return NextResponse.json({ error: "Failed to generate aging report" }, { status: 502 });
  }
}
