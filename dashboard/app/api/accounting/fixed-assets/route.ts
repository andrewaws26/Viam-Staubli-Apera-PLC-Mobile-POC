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
    const role =
      ((user.publicMetadata as Record<string, unknown>)?.role as string) ||
      "operator";
    return { name, role };
  } catch {
    return { name: "Unknown", role: "operator" };
  }
}

/** Round to 2 decimal places */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * GET /api/accounting/fixed-assets
 * - No params: list all fixed assets ordered by name, include depreciation_entries count
 * - ?id=uuid: single asset with all depreciation_entries ordered by period_date
 * - ?summary=true: summary stats (totals, by-category counts)
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
  const id = params.get("id");
  const summary = params.get("summary");

  try {
    const sb = getSupabase();

    // --- Single asset with depreciation history ---
    if (id) {
      const { data: asset, error: assetErr } = await sb
        .from("fixed_assets")
        .select("*")
        .eq("id", id)
        .single();

      if (assetErr || !asset)
        return NextResponse.json({ error: "Asset not found" }, { status: 404 });

      const { data: entries, error: entriesErr } = await sb
        .from("depreciation_entries")
        .select("*")
        .eq("fixed_asset_id", id)
        .order("period_date", { ascending: true });

      if (entriesErr) throw entriesErr;

      return NextResponse.json({ ...asset, depreciation_entries: entries ?? [] });
    }

    // --- Summary stats ---
    if (summary === "true") {
      const { data: assets, error } = await sb
        .from("fixed_assets")
        .select("category, purchase_cost, book_value, accumulated_depreciation, status");

      if (error) throw error;

      const all = assets ?? [];
      const total_assets = all.length;
      const total_cost = r2(all.reduce((s, a) => s + Number(a.purchase_cost), 0));
      const total_book_value = r2(all.reduce((s, a) => s + Number(a.book_value), 0));
      const total_accumulated_depr = r2(all.reduce((s, a) => s + Number(a.accumulated_depreciation), 0));

      const by_category: Record<string, number> = {};
      for (const a of all) {
        by_category[a.category] = (by_category[a.category] || 0) + 1;
      }

      const by_status: Record<string, number> = {};
      for (const a of all) {
        by_status[a.status] = (by_status[a.status] || 0) + 1;
      }

      return NextResponse.json({
        total_assets,
        total_cost,
        total_book_value,
        total_accumulated_depr,
        by_category,
        by_status,
      });
    }

    // --- List all assets ---
    const { data, error } = await sb
      .from("fixed_assets")
      .select("*, depreciation_entries(count)")
      .order("name", { ascending: true });

    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/fixed-assets GET", err);
    return NextResponse.json(
      { error: "Failed to fetch fixed assets" },
      { status: 502 },
    );
  }
}

/**
 * POST /api/accounting/fixed-assets
 * Two actions:
 *   1. Create asset:  { action: "create", name, ... }
 *   2. Run depreciation: { action: "depreciate", period_date: "YYYY-MM-01" }
 * Manager/developer only.
 */
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
  if (!action)
    return NextResponse.json({ error: "Missing action" }, { status: 400 });

  try {
    const sb = getSupabase();

    // ================================================================
    // ACTION: create
    // ================================================================
    if (action === "create") {
      const {
        name,
        description,
        asset_tag,
        category,
        purchase_date,
        in_service_date,
        purchase_cost,
        salvage_value,
        useful_life_months,
        depreciation_method,
        linked_truck_id,
      } = body as {
        name?: string;
        description?: string;
        asset_tag?: string;
        category?: string;
        purchase_date?: string;
        in_service_date?: string;
        purchase_cost?: number;
        salvage_value?: number;
        useful_life_months?: number;
        depreciation_method?: string;
        linked_truck_id?: string;
      };

      if (!name || !category || !purchase_date || !in_service_date || purchase_cost == null || !useful_life_months)
        return NextResponse.json(
          { error: "Missing required fields: name, category, purchase_date, in_service_date, purchase_cost, useful_life_months" },
          { status: 400 },
        );

      // Lookup GL accounts
      const [assetAcctRes, deprAcctRes, accumAcctRes] = await Promise.all([
        sb.from("chart_of_accounts").select("id").eq("account_number", "1300").single(),
        sb.from("chart_of_accounts").select("id").eq("account_number", "6000").single(),
        sb.from("chart_of_accounts").select("id").eq("account_number", "1310").single(),
      ]);

      if (!assetAcctRes.data || !deprAcctRes.data || !accumAcctRes.data)
        return NextResponse.json(
          { error: "GL accounts 1300, 6000, or 1310 not found. Run migration 022 first." },
          { status: 400 },
        );

      const { data: asset, error: assetErr } = await sb
        .from("fixed_assets")
        .insert({
          name,
          description: description || null,
          asset_tag: asset_tag || null,
          category: category || "vehicle",
          purchase_date,
          in_service_date,
          purchase_cost: r2(purchase_cost),
          salvage_value: r2(salvage_value ?? 0),
          useful_life_months,
          depreciation_method: depreciation_method || "straight_line",
          book_value: r2(purchase_cost),
          linked_truck_id: linked_truck_id || null,
          gl_asset_account_id: assetAcctRes.data.id,
          gl_depreciation_account_id: deprAcctRes.data.id,
          gl_accum_depr_account_id: accumAcctRes.data.id,
          created_by: userId,
          created_by_name: userInfo.name,
        })
        .select()
        .single();

      if (assetErr) throw assetErr;

      logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "fixed_asset_created",
        details: { asset_id: asset.id, name, purchase_cost, category },
      });

      return NextResponse.json(asset, { status: 201 });
    }

    // ================================================================
    // ACTION: depreciate
    // ================================================================
    if (action === "depreciate") {
      const periodDate = body.period_date as string;
      if (!periodDate)
        return NextResponse.json(
          { error: "Missing period_date (YYYY-MM-01)" },
          { status: 400 },
        );

      // Fetch all active assets where in_service_date <= period_date
      const { data: assets, error: fetchErr } = await sb
        .from("fixed_assets")
        .select("*")
        .eq("status", "active")
        .lte("in_service_date", periodDate);

      if (fetchErr) throw fetchErr;
      if (!assets || assets.length === 0)
        return NextResponse.json({
          processed: 0,
          total_depreciation: 0,
          journal_entry_id: null,
          message: "No active assets eligible for depreciation this period",
        });

      // Check which assets already have an entry for this period
      const assetIds = assets.map((a) => a.id);
      const { data: existingEntries } = await sb
        .from("depreciation_entries")
        .select("fixed_asset_id")
        .in("fixed_asset_id", assetIds)
        .eq("period_date", periodDate);

      const alreadyProcessed = new Set(
        (existingEntries ?? []).map((e) => e.fixed_asset_id as string),
      );

      // Calculate depreciation for each asset
      interface DepreciationCalc {
        asset: typeof assets[0];
        amount: number;
        newAccumulated: number;
        newBookValue: number;
        fullyDepreciated: boolean;
      }

      const calcs: DepreciationCalc[] = [];

      for (const asset of assets) {
        if (alreadyProcessed.has(asset.id)) continue;

        const purchaseCost = Number(asset.purchase_cost);
        const salvageValue = Number(asset.salvage_value);
        const bookValue = Number(asset.book_value);
        const usefulLife = Number(asset.useful_life_months);
        const accumulated = Number(asset.accumulated_depreciation);

        // Skip if already at salvage value
        if (bookValue <= salvageValue) continue;

        let deprAmount = 0;

        if (asset.depreciation_method === "straight_line") {
          deprAmount = (purchaseCost - salvageValue) / usefulLife;
        } else if (asset.depreciation_method === "declining_balance") {
          deprAmount = (bookValue * 2) / usefulLife;
          // Cap so book_value does not go below salvage
          if (bookValue - deprAmount < salvageValue) {
            deprAmount = bookValue - salvageValue;
          }
        } else if (asset.depreciation_method === "sum_of_years") {
          // Months elapsed since in_service_date
          const inService = new Date(asset.in_service_date + "T00:00:00");
          const period = new Date(periodDate + "T00:00:00");
          const monthsElapsed =
            (period.getFullYear() - inService.getFullYear()) * 12 +
            (period.getMonth() - inService.getMonth());
          const remainingMonths = Math.max(usefulLife - monthsElapsed, 1);
          const sumDigits = (usefulLife * (usefulLife + 1)) / 2;
          deprAmount = ((remainingMonths / sumDigits) * (purchaseCost - salvageValue)) / 12;
        }

        deprAmount = r2(deprAmount);
        if (deprAmount <= 0) continue;

        // Final cap: do not depreciate below salvage
        if (bookValue - deprAmount < salvageValue) {
          deprAmount = r2(bookValue - salvageValue);
        }
        if (deprAmount <= 0) continue;

        const newAccumulated = r2(accumulated + deprAmount);
        const newBookValue = r2(purchaseCost - newAccumulated);

        calcs.push({
          asset,
          amount: deprAmount,
          newAccumulated,
          newBookValue,
          fullyDepreciated: newBookValue <= salvageValue,
        });
      }

      if (calcs.length === 0)
        return NextResponse.json({
          processed: 0,
          total_depreciation: 0,
          journal_entry_id: null,
          message: "All eligible assets already depreciated for this period or fully depreciated",
        });

      const totalDepreciation = r2(calcs.reduce((s, c) => s + c.amount, 0));

      // Look up GL accounts for the JE
      const [deprAcctRes, accumAcctRes] = await Promise.all([
        sb.from("chart_of_accounts").select("id").eq("account_number", "6000").single(),
        sb.from("chart_of_accounts").select("id").eq("account_number", "1310").single(),
      ]);

      if (!deprAcctRes.data || !accumAcctRes.data)
        return NextResponse.json(
          { error: "GL accounts 6000 or 1310 not found" },
          { status: 400 },
        );

      // Create ONE journal entry for all depreciation this period
      const { data: je, error: jeErr } = await sb
        .from("journal_entries")
        .insert({
          entry_date: periodDate,
          description: `Monthly depreciation — ${periodDate.substring(0, 7)}`,
          reference: `DEPR-${periodDate.substring(0, 7)}`,
          source: "adjustment",
          status: "posted",
          total_amount: totalDepreciation,
          created_by: userId,
          created_by_name: `Auto (${userInfo.name})`,
          posted_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (jeErr) throw jeErr;

      // JE lines: DR 6000 Depreciation Expense / CR 1310 Accumulated Depreciation
      await sb.from("journal_entry_lines").insert([
        {
          journal_entry_id: je.id,
          account_id: deprAcctRes.data.id,
          debit: totalDepreciation,
          credit: 0,
          description: `Depreciation expense — ${periodDate.substring(0, 7)} (${calcs.length} assets)`,
          line_order: 0,
        },
        {
          journal_entry_id: je.id,
          account_id: accumAcctRes.data.id,
          debit: 0,
          credit: totalDepreciation,
          description: `Accumulated depreciation — ${periodDate.substring(0, 7)} (${calcs.length} assets)`,
          line_order: 1,
        },
      ]);

      // Create depreciation_entries and update each asset
      for (const calc of calcs) {
        await sb.from("depreciation_entries").insert({
          fixed_asset_id: calc.asset.id,
          period_date: periodDate,
          depreciation_amount: calc.amount,
          accumulated_total: calc.newAccumulated,
          book_value_after: calc.newBookValue,
          journal_entry_id: je.id,
        });

        const updates: Record<string, unknown> = {
          accumulated_depreciation: calc.newAccumulated,
          book_value: calc.newBookValue,
          updated_at: new Date().toISOString(),
        };
        if (calc.fullyDepreciated) {
          updates.status = "fully_depreciated";
        }

        await sb.from("fixed_assets").update(updates).eq("id", calc.asset.id);
      }

      logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "depreciation_run",
        details: {
          period_date: periodDate,
          processed: calcs.length,
          total_depreciation: totalDepreciation,
          journal_entry_id: je.id,
        },
      });

      return NextResponse.json({
        processed: calcs.length,
        total_depreciation: totalDepreciation,
        journal_entry_id: je.id,
      });
    }

    return NextResponse.json({ error: "Invalid action — use 'create' or 'depreciate'" }, { status: 400 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/fixed-assets POST", err);
    return NextResponse.json(
      { error: "Failed to process fixed asset request" },
      { status: 502 },
    );
  }
}

/**
 * PATCH /api/accounting/fixed-assets
 * - { id, action: "dispose", disposal_date, disposal_amount, disposal_method }
 * - { id, action: "update", ...fields }
 * Manager/developer only.
 */
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
  const action = body.action as string;
  if (!id || !action)
    return NextResponse.json({ error: "Missing id or action" }, { status: 400 });

  try {
    const sb = getSupabase();

    // Fetch the asset
    const { data: asset, error: fetchErr } = await sb
      .from("fixed_assets")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !asset)
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });

    // ================================================================
    // ACTION: dispose
    // ================================================================
    if (action === "dispose") {
      if (asset.status === "disposed")
        return NextResponse.json({ error: "Asset is already disposed" }, { status: 400 });

      const disposalDate = body.disposal_date as string;
      const disposalAmount = Number(body.disposal_amount ?? 0);
      const disposalMethod = body.disposal_method as string;

      if (!disposalDate || !disposalMethod)
        return NextResponse.json(
          { error: "Missing disposal_date or disposal_method" },
          { status: 400 },
        );

      const bookValue = Number(asset.book_value);
      const purchaseCost = Number(asset.purchase_cost);
      const accumulated = Number(asset.accumulated_depreciation);
      const gainLoss = r2(disposalAmount - bookValue);

      // Look up GL accounts
      const [assetAcctRes, accumAcctRes, cashAcctRes, gainLossAcctRes] = await Promise.all([
        sb.from("chart_of_accounts").select("id").eq("account_number", "1300").single(),
        sb.from("chart_of_accounts").select("id").eq("account_number", "1310").single(),
        sb.from("chart_of_accounts").select("id").eq("account_number", "1000").single(),
        sb.from("chart_of_accounts").select("id").eq("account_number", "6010").single(),
      ]);

      if (!assetAcctRes.data || !accumAcctRes.data || !cashAcctRes.data || !gainLossAcctRes.data)
        return NextResponse.json(
          { error: "Required GL accounts (1000, 1300, 1310, 6010) not found" },
          { status: 400 },
        );

      // Build JE lines:
      // DR Cash (disposal_amount)
      // DR 1310 Accumulated Depreciation (accum)
      // CR 1300 Fixed Assets (purchase_cost)
      // DR or CR 6010 Gain/Loss
      const jeLines: { account_id: string; debit: number; credit: number; description: string; line_order: number }[] = [];
      let lineOrder = 0;

      // DR Cash
      if (disposalAmount > 0) {
        jeLines.push({
          account_id: cashAcctRes.data.id,
          debit: r2(disposalAmount),
          credit: 0,
          description: `Cash received — disposal of ${asset.name}`,
          line_order: lineOrder++,
        });
      }

      // DR Accumulated Depreciation (remove contra-asset)
      if (accumulated > 0) {
        jeLines.push({
          account_id: accumAcctRes.data.id,
          debit: r2(accumulated),
          credit: 0,
          description: `Remove accumulated depreciation — ${asset.name}`,
          line_order: lineOrder++,
        });
      }

      // CR Fixed Assets (remove asset at cost)
      jeLines.push({
        account_id: assetAcctRes.data.id,
        debit: 0,
        credit: r2(purchaseCost),
        description: `Remove fixed asset — ${asset.name}`,
        line_order: lineOrder++,
      });

      // Gain/Loss — if loss, DR 6010; if gain, CR 6010
      if (gainLoss < 0) {
        // Loss on disposal
        jeLines.push({
          account_id: gainLossAcctRes.data.id,
          debit: r2(Math.abs(gainLoss)),
          credit: 0,
          description: `Loss on disposal — ${asset.name}`,
          line_order: lineOrder++,
        });
      } else if (gainLoss > 0) {
        // Gain on disposal
        jeLines.push({
          account_id: gainLossAcctRes.data.id,
          debit: 0,
          credit: r2(gainLoss),
          description: `Gain on disposal — ${asset.name}`,
          line_order: lineOrder++,
        });
      }

      // Total for the JE header = max(total debits, total credits)
      const totalDebits = r2(jeLines.reduce((s, l) => s + l.debit, 0));

      const { data: je, error: jeErr } = await sb
        .from("journal_entries")
        .insert({
          entry_date: disposalDate,
          description: `Asset disposal — ${asset.name} (${disposalMethod})`,
          reference: `DISP-${asset.asset_tag || asset.id.substring(0, 8)}`,
          source: "adjustment",
          status: "posted",
          total_amount: totalDebits,
          created_by: userId,
          created_by_name: userInfo.name,
          posted_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (jeErr) throw jeErr;

      await sb.from("journal_entry_lines").insert(
        jeLines.map((l) => ({ ...l, journal_entry_id: je.id })),
      );

      // Update asset record
      const { data: updated, error: upErr } = await sb
        .from("fixed_assets")
        .update({
          status: "disposed",
          disposal_date: disposalDate,
          disposal_amount: r2(disposalAmount),
          disposal_method: disposalMethod,
          gain_loss: gainLoss,
          book_value: 0,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();

      if (upErr) throw upErr;

      logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "fixed_asset_disposed",
        details: {
          asset_id: id,
          name: asset.name,
          disposal_method: disposalMethod,
          disposal_amount: disposalAmount,
          gain_loss: gainLoss,
          journal_entry_id: je.id,
        },
      });

      return NextResponse.json(updated);
    }

    // ================================================================
    // ACTION: update (partial update of asset details)
    // ================================================================
    if (action === "update") {
      const allowedFields = [
        "name",
        "description",
        "asset_tag",
        "category",
        "purchase_date",
        "in_service_date",
        "purchase_cost",
        "salvage_value",
        "useful_life_months",
        "depreciation_method",
        "linked_truck_id",
      ];

      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      for (const field of allowedFields) {
        if (body[field] !== undefined) {
          updates[field] = body[field];
        }
      }

      // If purchase_cost changed, recalculate book_value
      if (updates.purchase_cost !== undefined) {
        const newCost = Number(updates.purchase_cost);
        const accum = Number(asset.accumulated_depreciation);
        updates.book_value = r2(newCost - accum);
      }

      const { data: updated, error: upErr } = await sb
        .from("fixed_assets")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (upErr) throw upErr;

      logAuditDirect(userId, userInfo.name, userInfo.role, {
        action: "fixed_asset_updated",
        details: { asset_id: id, fields: Object.keys(updates).filter((k) => k !== "updated_at") },
      });

      return NextResponse.json(updated);
    }

    return NextResponse.json({ error: "Invalid action — use 'dispose' or 'update'" }, { status: 400 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/fixed-assets PATCH", err);
    return NextResponse.json(
      { error: "Failed to update fixed asset" },
      { status: 502 },
    );
  }
}
