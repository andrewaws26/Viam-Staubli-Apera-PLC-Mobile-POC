import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

async function getUserInfo(userId: string) {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const role =
      ((user.publicMetadata as Record<string, unknown>)?.role as string) || "operator";
    return { role };
  } catch {
    return { role: "operator" };
  }
}

interface VendorRow {
  id: string;
  company_name: string;
  contact_name: string | null;
  tax_id: string | null;
  address: string | null;
}

interface BillRow {
  id: string;
  vendor_id: string;
}

interface PaymentRow {
  amount: number;
  payment_date: string;
  bill_id: string;
  bills: BillRow | BillRow[] | null;
}

interface Vendor1099Result {
  vendor_id: string;
  company_name: string;
  contact_name: string | null;
  tax_id: string | null;
  address: string | null;
  ytd_payments: number;
  threshold_met: boolean;
  needs_1099: boolean;
  missing_tax_id: boolean;
}

/**
 * GET /api/accounting/vendor-1099
 * Aggregate payments to 1099-eligible vendors for a fiscal year.
 * Shows who needs a 1099-NEC at year end.
 * Query params: ?fiscal_year=2026 (defaults to current year)
 * Manager/developer only.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = request.nextUrl.searchParams;
  const fiscalYear = parseInt(params.get("fiscal_year") || String(new Date().getFullYear()), 10);

  if (isNaN(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100)
    return NextResponse.json({ error: "Invalid fiscal_year" }, { status: 400 });

  const yearStart = `${fiscalYear}-01-01`;
  const yearEnd = `${fiscalYear}-12-31`;

  try {
    const sb = getSupabase();

    // 1. Fetch all 1099-eligible vendors
    const { data: vendors, error: vendorErr } = await sb
      .from("vendors")
      .select("id, company_name, contact_name, tax_id, address")
      .eq("is_1099_vendor", true)
      .eq("is_active", true);

    if (vendorErr) throw vendorErr;
    if (!vendors || vendors.length === 0) {
      return NextResponse.json({
        vendors: [],
        summary: {
          fiscal_year: fiscalYear,
          total_vendors: 0,
          threshold_met_count: 0,
          missing_tax_id_count: 0,
          total_1099_amount: 0,
        },
      });
    }

    const vendorIds = vendors.map((v: VendorRow) => v.id);

    // 2. Fetch all bill_payments for the fiscal year, joined to bills for vendor_id
    const { data: payments, error: payErr } = await sb
      .from("bill_payments")
      .select("amount, payment_date, bill_id, bills!inner(id, vendor_id)")
      .gte("payment_date", yearStart)
      .lte("payment_date", yearEnd)
      .in("bills.vendor_id", vendorIds);

    if (payErr) throw payErr;

    // 3. Aggregate payments by vendor
    const vendorTotals = new Map<string, number>();

    for (const p of (payments || []) as PaymentRow[]) {
      // Supabase returns the joined relation as an object (inner join, single FK)
      const bill = Array.isArray(p.bills) ? p.bills[0] : p.bills;
      if (!bill) continue;
      const vid = (bill as BillRow).vendor_id;
      vendorTotals.set(vid, (vendorTotals.get(vid) || 0) + Number(p.amount));
    }

    // 4. Build result array
    const results: Vendor1099Result[] = vendors.map((v: VendorRow) => {
      const ytd = Math.round((vendorTotals.get(v.id) || 0) * 100) / 100;
      const thresholdMet = ytd >= 600;
      const hasTaxId = !!v.tax_id && v.tax_id.trim().length > 0;

      return {
        vendor_id: v.id,
        company_name: v.company_name,
        contact_name: v.contact_name,
        tax_id: v.tax_id,
        address: v.address,
        ytd_payments: ytd,
        threshold_met: thresholdMet,
        needs_1099: thresholdMet && hasTaxId,
        missing_tax_id: thresholdMet && !hasTaxId,
      };
    });

    // 5. Sort by ytd_payments descending
    results.sort((a, b) => b.ytd_payments - a.ytd_payments);

    // 6. Build summary
    const thresholdMetCount = results.filter((r) => r.threshold_met).length;
    const missingTaxIdCount = results.filter((r) => r.missing_tax_id).length;
    const total1099Amount = results
      .filter((r) => r.needs_1099)
      .reduce((sum, r) => sum + r.ytd_payments, 0);

    return NextResponse.json({
      vendors: results,
      summary: {
        fiscal_year: fiscalYear,
        total_vendors: results.length,
        threshold_met_count: thresholdMetCount,
        missing_tax_id_count: missingTaxIdCount,
        total_1099_amount: Math.round(total1099Amount * 100) / 100,
      },
    });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/vendor-1099 GET", err);
    return NextResponse.json({ error: "Failed to fetch 1099 vendor data" }, { status: 502 });
  }
}
