import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { logAuditDirect } from "@/lib/audit";

async function getUserInfo(userId: string) {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const name = user.firstName
      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
      : user.emailAddresses?.[0]?.emailAddress ?? "Unknown";
    const email = user.emailAddresses?.[0]?.emailAddress ?? "";
    const role =
      ((user.publicMetadata as Record<string, unknown>)?.role as string) ||
      "operator";
    return { name, email, role };
  } catch {
    return { name: "Unknown", email: "", role: "operator" };
  }
}

// ---------------------------------------------------------------------------
// GET  /api/accounting/sales-tax
// ---------------------------------------------------------------------------
// Query params:
//   section    — "rates" (default), "exemptions", "collected", "filing"
//   active_only — "true" to filter active only (rates / exemptions)
//   period     — "YYYY-MM" for filing report
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = request.nextUrl.searchParams;
  const section = params.get("section") || "rates";
  const activeOnly = params.get("active_only") === "true";

  try {
    const sb = getSupabase();

    // --- Tax Rates ---
    if (section === "rates") {
      let query = sb
        .from("sales_tax_rates")
        .select("*")
        .order("effective_date", { ascending: false });

      if (activeOnly) query = query.eq("is_active", true);

      const { data, error } = await query;
      if (error) throw error;
      return NextResponse.json(data ?? []);
    }

    // --- Exemptions (with customer names) ---
    if (section === "exemptions") {
      let query = sb
        .from("sales_tax_exemptions")
        .select("*, customers(id, company_name)")
        .order("created_at", { ascending: false });

      if (activeOnly) query = query.eq("is_active", true);

      const { data, error } = await query;
      if (error) throw error;
      return NextResponse.json(data ?? []);
    }

    // --- Tax Collected Summary ---
    if (section === "collected") {
      const { data, error } = await sb
        .from("sales_tax_collected")
        .select("*, sales_tax_rates(name, jurisdiction, rate)")
        .order("period_date", { ascending: false });

      if (error) throw error;

      // Group by period and compute totals
      const byPeriod: Record<
        string,
        {
          period_date: string;
          total_taxable: number;
          total_tax: number;
          entries: typeof data;
        }
      > = {};

      for (const row of data ?? []) {
        const key = row.period_date;
        if (!byPeriod[key]) {
          byPeriod[key] = {
            period_date: key,
            total_taxable: 0,
            total_tax: 0,
            entries: [],
          };
        }
        byPeriod[key].total_taxable += Number(row.taxable_amount);
        byPeriod[key].total_tax += Number(row.tax_amount);
        byPeriod[key].entries.push(row);
      }

      return NextResponse.json(Object.values(byPeriod));
    }

    // --- Filing Report for specific month ---
    if (section === "filing") {
      const period = params.get("period");
      if (!period || !/^\d{4}-\d{2}$/.test(period))
        return NextResponse.json(
          { error: "period param required in YYYY-MM format" },
          { status: 400 },
        );

      const periodStart = `${period}-01`;

      const { data, error } = await sb
        .from("sales_tax_collected")
        .select("*, sales_tax_rates(name, jurisdiction, rate)")
        .eq("period_date", periodStart);

      if (error) throw error;

      // Summary by rate
      const byRate: Record<
        string,
        {
          rate_id: string;
          rate_name: string;
          jurisdiction: string;
          rate_pct: number;
          taxable_amount: number;
          tax_amount: number;
          count: number;
        }
      > = {};

      let totalTaxable = 0;
      let totalTax = 0;

      for (const row of data ?? []) {
        const rateId = row.tax_rate_id;
        const rateInfo = row.sales_tax_rates as {
          name: string;
          jurisdiction: string;
          rate: number;
        } | null;

        if (!byRate[rateId]) {
          byRate[rateId] = {
            rate_id: rateId,
            rate_name: rateInfo?.name ?? "Unknown",
            jurisdiction: rateInfo?.jurisdiction ?? "",
            rate_pct: Number(rateInfo?.rate ?? 0) * 100,
            taxable_amount: 0,
            tax_amount: 0,
            count: 0,
          };
        }

        byRate[rateId].taxable_amount += Number(row.taxable_amount);
        byRate[rateId].tax_amount += Number(row.tax_amount);
        byRate[rateId].count += 1;
        totalTaxable += Number(row.taxable_amount);
        totalTax += Number(row.tax_amount);
      }

      // Determine filing status (all collected, all filed, all remitted, or mixed)
      const statuses = (data ?? []).map((r) => r.status);
      const allSameStatus =
        statuses.length > 0 && statuses.every((s) => s === statuses[0]);
      const filingStatus =
        statuses.length === 0
          ? "no_data"
          : allSameStatus
            ? statuses[0]
            : "mixed";

      return NextResponse.json({
        period,
        total_taxable: Math.round(totalTaxable * 100) / 100,
        total_tax: Math.round(totalTax * 100) / 100,
        filing_status: filingStatus,
        by_rate: Object.values(byRate),
        entry_count: (data ?? []).length,
      });
    }

    // --- Customers (for dropdowns) ---
    if (section === "customers") {
      const { data, error } = await sb
        .from("customers")
        .select("id, company_name")
        .eq("is_active", true)
        .order("company_name");

      if (error) throw error;
      return NextResponse.json(data ?? []);
    }

    return NextResponse.json({ error: "Invalid section" }, { status: 400 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/sales-tax GET", err);
    return NextResponse.json(
      { error: "Failed to fetch sales tax data" },
      { status: 502 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST  /api/accounting/sales-tax
// ---------------------------------------------------------------------------
// Actions:
//   create_rate      — create a new tax rate
//   create_exemption — create exemption for a customer
//   check_customer   — check if customer has active exemptions
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action as string;

  try {
    const sb = getSupabase();

    // ── Create Rate ───────────────────────────────────────────────
    if (action === "create_rate") {
      const { name, jurisdiction, rate, tax_type, applies_to, effective_date, expiration_date } =
        body as {
          name?: string;
          jurisdiction?: string;
          rate?: number;
          tax_type?: string;
          applies_to?: string;
          effective_date?: string;
          expiration_date?: string;
        };

      if (!name || !jurisdiction || rate === undefined)
        return NextResponse.json(
          { error: "name, jurisdiction, and rate are required" },
          { status: 400 },
        );

      const validTypes = ["sales", "use", "excise", "other"];
      if (tax_type && !validTypes.includes(tax_type))
        return NextResponse.json(
          { error: `tax_type must be one of: ${validTypes.join(", ")}` },
          { status: 400 },
        );

      const validAppliesTo = ["all", "goods", "services", "specific"];
      if (applies_to && !validAppliesTo.includes(applies_to))
        return NextResponse.json(
          { error: `applies_to must be one of: ${validAppliesTo.join(", ")}` },
          { status: 400 },
        );

      const { data, error } = await sb
        .from("sales_tax_rates")
        .insert({
          name,
          jurisdiction,
          rate,
          tax_type: tax_type || "sales",
          applies_to: applies_to || "all",
          effective_date: effective_date || new Date().toISOString().split("T")[0],
          expiration_date: expiration_date || null,
        })
        .select()
        .single();

      if (error) throw error;

      await logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "account_created",
        details: { entity: "sales_tax_rate", rate_id: data.id, name, jurisdiction, rate },
      });

      return NextResponse.json(data, { status: 201 });
    }

    // ── Create Exemption ──────────────────────────────────────────
    if (action === "create_exemption") {
      const {
        customer_id,
        exemption_type,
        certificate_number,
        effective_date,
        expiration_date,
        notes,
      } = body as {
        customer_id?: string;
        exemption_type?: string;
        certificate_number?: string;
        effective_date?: string;
        expiration_date?: string;
        notes?: string;
      };

      if (!customer_id || !exemption_type)
        return NextResponse.json(
          { error: "customer_id and exemption_type are required" },
          { status: 400 },
        );

      const validExTypes = [
        "resale",
        "government",
        "nonprofit",
        "railroad",
        "manufacturing",
        "other",
      ];
      if (!validExTypes.includes(exemption_type))
        return NextResponse.json(
          { error: `exemption_type must be one of: ${validExTypes.join(", ")}` },
          { status: 400 },
        );

      const { data, error } = await sb
        .from("sales_tax_exemptions")
        .insert({
          customer_id,
          exemption_type,
          certificate_number: certificate_number || null,
          effective_date: effective_date || new Date().toISOString().split("T")[0],
          expiration_date: expiration_date || null,
          notes: notes || null,
        })
        .select("*, customers(id, company_name)")
        .single();

      if (error) throw error;

      await logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "account_created",
        details: {
          entity: "sales_tax_exemption",
          exemption_id: data.id,
          customer_id,
          exemption_type,
        },
      });

      return NextResponse.json(data, { status: 201 });
    }

    // ── Check Customer Exemptions ─────────────────────────────────
    if (action === "check_customer") {
      const customerId = body.customer_id as string;
      if (!customerId)
        return NextResponse.json(
          { error: "customer_id is required" },
          { status: 400 },
        );

      const today = new Date().toISOString().split("T")[0];

      const { data, error } = await sb
        .from("sales_tax_exemptions")
        .select("*, customers(id, company_name)")
        .eq("customer_id", customerId)
        .eq("is_active", true)
        .lte("effective_date", today);

      if (error) throw error;

      // Filter out expired exemptions
      const active = (data ?? []).filter(
        (ex) => !ex.expiration_date || ex.expiration_date >= today,
      );

      return NextResponse.json({
        customer_id: customerId,
        is_exempt: active.length > 0,
        exemptions: active,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/sales-tax POST", err);
    return NextResponse.json(
      { error: "Failed to process sales tax operation" },
      { status: 502 },
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH  /api/accounting/sales-tax
// ---------------------------------------------------------------------------
// Update a rate or exemption.
//   { id, section: "rate", ...fields }
//   { id, section: "exemption", ...fields }
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = body.id as string;
  if (!id)
    return NextResponse.json({ error: "id is required" }, { status: 400 });

  const section = (body.section as string) || "rate";

  try {
    const sb = getSupabase();

    if (section === "rate") {
      const updates: Record<string, unknown> = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.jurisdiction !== undefined) updates.jurisdiction = body.jurisdiction;
      if (body.rate !== undefined) updates.rate = body.rate;
      if (body.tax_type !== undefined) updates.tax_type = body.tax_type;
      if (body.applies_to !== undefined) updates.applies_to = body.applies_to;
      if (body.is_active !== undefined) updates.is_active = body.is_active;
      if (body.effective_date !== undefined) updates.effective_date = body.effective_date;
      if (body.expiration_date !== undefined)
        updates.expiration_date = body.expiration_date || null;

      if (Object.keys(updates).length === 0)
        return NextResponse.json({ error: "No fields to update" }, { status: 400 });

      const { data, error } = await sb
        .from("sales_tax_rates")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      await logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "account_updated",
        details: { entity: "sales_tax_rate", rate_id: id, updates },
      });

      return NextResponse.json(data);
    }

    if (section === "exemption") {
      const updates: Record<string, unknown> = {};
      if (body.exemption_type !== undefined) updates.exemption_type = body.exemption_type;
      if (body.certificate_number !== undefined)
        updates.certificate_number = body.certificate_number || null;
      if (body.effective_date !== undefined) updates.effective_date = body.effective_date;
      if (body.expiration_date !== undefined)
        updates.expiration_date = body.expiration_date || null;
      if (body.notes !== undefined) updates.notes = body.notes || null;
      if (body.is_active !== undefined) updates.is_active = body.is_active;

      if (Object.keys(updates).length === 0)
        return NextResponse.json({ error: "No fields to update" }, { status: 400 });

      const { data, error } = await sb
        .from("sales_tax_exemptions")
        .update(updates)
        .eq("id", id)
        .select("*, customers(id, company_name)")
        .single();

      if (error) throw error;

      await logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "account_updated",
        details: { entity: "sales_tax_exemption", exemption_id: id, updates },
      });

      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "Invalid section" }, { status: 400 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/sales-tax PATCH", err);
    return NextResponse.json(
      { error: "Failed to update" },
      { status: 502 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE  /api/accounting/sales-tax
// ---------------------------------------------------------------------------
// Soft-deactivate a rate or exemption.
//   { id, section: "rate" | "exemption" }
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = body.id as string;
  if (!id)
    return NextResponse.json({ error: "id is required" }, { status: 400 });

  const section = (body.section as string) || "rate";

  try {
    const sb = getSupabase();

    if (section === "rate") {
      const { data, error } = await sb
        .from("sales_tax_rates")
        .update({ is_active: false })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      await logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "account_deactivated",
        details: { entity: "sales_tax_rate", rate_id: id },
      });

      return NextResponse.json({ deactivated: true, data });
    }

    if (section === "exemption") {
      const { data, error } = await sb
        .from("sales_tax_exemptions")
        .update({ is_active: false })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      await logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "account_deactivated",
        details: { entity: "sales_tax_exemption", exemption_id: id },
      });

      return NextResponse.json({ deactivated: true, data });
    }

    return NextResponse.json({ error: "Invalid section" }, { status: 400 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/sales-tax DELETE", err);
    return NextResponse.json(
      { error: "Failed to deactivate" },
      { status: 502 },
    );
  }
}
