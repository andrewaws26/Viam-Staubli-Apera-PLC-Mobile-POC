import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { logAuditDirect } from "@/lib/audit";
import {
  AccountType,
  ACCOUNT_TYPE_NORMAL_BALANCE,
} from "@ironsight/shared/accounting";

// ── Helpers ────────────────────────────────────────────────────────────

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

// ── QBO type → IronSight account_type mapping ──────────────────────────

const QBO_TYPE_MAP: Record<string, AccountType> = {
  bank: "asset",
  "accounts receivable": "asset",
  "other current asset": "asset",
  "fixed asset": "asset",
  "other asset": "asset",
  "accounts payable": "liability",
  "credit card": "liability",
  "other current liability": "liability",
  "long term liability": "liability",
  "other liability": "liability",
  income: "revenue",
  "other income": "revenue",
  "cost of goods sold": "expense",
  expense: "expense",
  "other expense": "expense",
  equity: "equity",
};

function resolveAccountType(row: Record<string, string>): AccountType | null {
  const raw = (row["Type"] || row["Detail Type"] || row["Account Type"] || "")
    .trim()
    .toLowerCase();
  return QBO_TYPE_MAP[raw] ?? null;
}

// ── CSV column resolution helpers ──────────────────────────────────────

function pick(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const val = row[k]?.trim();
    if (val) return val;
  }
  return "";
}

// ── POST — Import data ─────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { import_type: string; file_name: string; rows: Record<string, string>[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { import_type, file_name, rows } = body;

  if (!import_type || !rows || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json(
      { error: "import_type and non-empty rows array are required" },
      { status: 400 },
    );
  }

  const validTypes = ["chart_of_accounts", "customers", "vendors"];
  if (!validTypes.includes(import_type)) {
    return NextResponse.json(
      { error: `import_type must be one of: ${validTypes.join(", ")}` },
      { status: 400 },
    );
  }

  const sb = getSupabase();

  try {
    // Create import batch record
    const { data: batch, error: batchErr } = await sb
      .from("import_batches")
      .insert({
        import_type,
        file_name: file_name || "upload.csv",
        row_count: rows.length,
        status: "processing",
        created_by: userId,
        created_by_name: userInfo.name,
      })
      .select()
      .single();

    if (batchErr) throw batchErr;

    const batchId = batch.id;
    let imported = 0;
    let skipped = 0;
    let errorCount = 0;
    const errors: { row: number; name: string; reason: string }[] = [];

    // ── Chart of Accounts ──────────────────────────────────────────────
    if (import_type === "chart_of_accounts") {
      // Get highest existing account_number to auto-assign from 1500+
      const { data: existingAccounts } = await sb
        .from("chart_of_accounts")
        .select("account_number, name")
        .order("account_number", { ascending: false });

      const existingNames = new Set(
        (existingAccounts ?? []).map((a: { name: string }) => a.name.toLowerCase()),
      );

      // Find the max numeric account_number >= 1500 to continue from
      let nextNumber = 1500;
      for (const acc of existingAccounts ?? []) {
        const num = parseInt(acc.account_number, 10);
        if (!isNaN(num) && num >= nextNumber) {
          nextNumber = num + 1;
        }
      }

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const name = pick(row, "Name", "Account Name", "name");
        if (!name) {
          errors.push({ row: i + 1, name: "(empty)", reason: "Missing Name" });
          errorCount++;
          continue;
        }

        // Dedup by name
        if (existingNames.has(name.toLowerCase())) {
          skipped++;
          continue;
        }

        const accountType = resolveAccountType(row);
        if (!accountType) {
          errors.push({
            row: i + 1,
            name,
            reason: `Unknown account type: "${row["Type"] || row["Detail Type"] || ""}"`,
          });
          errorCount++;
          continue;
        }

        const normalBalance = ACCOUNT_TYPE_NORMAL_BALANCE[accountType];
        const description = pick(row, "Description", "description", "Desc");
        const balanceStr = pick(row, "Balance", "balance", "Current Balance");
        const balance = balanceStr ? parseFloat(balanceStr.replace(/[,$]/g, "")) : 0;

        const accountNumber = String(nextNumber);
        nextNumber++;

        const { error: insertErr } = await sb.from("chart_of_accounts").insert({
          account_number: accountNumber,
          name,
          account_type: accountType,
          normal_balance: normalBalance,
          description: description || null,
          current_balance: isNaN(balance) ? 0 : balance,
          import_batch_id: batchId,
        });

        if (insertErr) {
          errors.push({ row: i + 1, name, reason: insertErr.message });
          errorCount++;
        } else {
          imported++;
          existingNames.add(name.toLowerCase());
        }
      }
    }

    // ── Customers ──────────────────────────────────────────────────────
    if (import_type === "customers") {
      const { data: existingCustomers } = await sb
        .from("customers")
        .select("company_name");

      const existingNames = new Set(
        (existingCustomers ?? []).map((c: { company_name: string }) =>
          c.company_name.toLowerCase(),
        ),
      );

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const name = pick(row, "Name", "Company", "Company Name", "company_name", "Customer");
        if (!name) {
          errors.push({ row: i + 1, name: "(empty)", reason: "Missing Name" });
          errorCount++;
          continue;
        }

        if (existingNames.has(name.toLowerCase())) {
          skipped++;
          continue;
        }

        const email = pick(row, "Email", "email", "E-mail", "Email Address");
        const phone = pick(row, "Phone", "phone", "Phone Number", "Telephone");
        const address = pick(
          row,
          "Address",
          "Billing Address",
          "billing_address",
          "Street",
          "Mailing Address",
        );
        const terms = pick(row, "Payment Terms", "Terms", "payment_terms");

        const { error: insertErr } = await sb.from("customers").insert({
          company_name: name,
          email: email || null,
          phone: phone || null,
          billing_address: address || null,
          payment_terms: terms || "Net 30",
          import_batch_id: batchId,
        });

        if (insertErr) {
          errors.push({ row: i + 1, name, reason: insertErr.message });
          errorCount++;
        } else {
          imported++;
          existingNames.add(name.toLowerCase());
        }
      }
    }

    // ── Vendors ────────────────────────────────────────────────────────
    if (import_type === "vendors") {
      const { data: existingVendors } = await sb
        .from("vendors")
        .select("company_name");

      const existingNames = new Set(
        (existingVendors ?? []).map((v: { company_name: string }) =>
          v.company_name.toLowerCase(),
        ),
      );

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const name = pick(row, "Name", "Company", "Company Name", "company_name", "Vendor");
        if (!name) {
          errors.push({ row: i + 1, name: "(empty)", reason: "Missing Name" });
          errorCount++;
          continue;
        }

        if (existingNames.has(name.toLowerCase())) {
          skipped++;
          continue;
        }

        const email = pick(row, "Email", "email", "E-mail", "Email Address");
        const phone = pick(row, "Phone", "phone", "Phone Number", "Telephone");
        const address = pick(row, "Address", "address", "Street", "Mailing Address");
        const terms = pick(row, "Payment Terms", "Terms", "payment_terms");
        const taxId = pick(row, "Tax ID", "tax_id", "TIN", "EIN", "SSN");

        const { error: insertErr } = await sb.from("vendors").insert({
          company_name: name,
          email: email || null,
          phone: phone || null,
          address: address || null,
          payment_terms: terms || "Net 30",
          tax_id: taxId || null,
          import_batch_id: batchId,
        });

        if (insertErr) {
          errors.push({ row: i + 1, name, reason: insertErr.message });
          errorCount++;
        } else {
          imported++;
          existingNames.add(name.toLowerCase());
        }
      }
    }

    // ── Finalize batch ─────────────────────────────────────────────────
    const finalStatus = errorCount > 0 && imported === 0 ? "failed" : "completed";

    await sb
      .from("import_batches")
      .update({
        imported_count: imported,
        skipped_count: skipped,
        error_count: errorCount,
        errors: errors.length > 0 ? errors : [],
        status: finalStatus,
        completed_at: new Date().toISOString(),
      })
      .eq("id", batchId);

    await logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "import_completed",
      details: {
        batch_id: batchId,
        import_type,
        file_name,
        imported_count: imported,
        skipped_count: skipped,
        error_count: errorCount,
      },
    });

    return NextResponse.json(
      {
        batch_id: batchId,
        import_type,
        file_name,
        status: finalStatus,
        row_count: rows.length,
        imported_count: imported,
        skipped_count: skipped,
        error_count: errorCount,
        errors,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/import POST", err);
    return NextResponse.json(
      { error: "Import failed — see server logs" },
      { status: 502 },
    );
  }
}

// ── GET — List import batches ──────────────────────────────────────────

export async function GET() {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("import_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/import GET", err);
    return NextResponse.json(
      { error: "Failed to fetch import batches" },
      { status: 502 },
    );
  }
}

// ── DELETE — Rollback an import batch ──────────────────────────────────

export async function DELETE(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  if (userInfo.role !== "developer" && userInfo.role !== "manager")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { batch_id: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.batch_id) {
    return NextResponse.json({ error: "batch_id is required" }, { status: 400 });
  }

  const sb = getSupabase();

  try {
    // Fetch the batch to know its type
    const { data: batch, error: fetchErr } = await sb
      .from("import_batches")
      .select("*")
      .eq("id", body.batch_id)
      .single();

    if (fetchErr || !batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    if (batch.status === "rolled_back") {
      return NextResponse.json(
        { error: "Batch has already been rolled back" },
        { status: 400 },
      );
    }

    // Delete records belonging to this batch
    const tableMap: Record<string, string> = {
      chart_of_accounts: "chart_of_accounts",
      customers: "customers",
      vendors: "vendors",
    };

    const table = tableMap[batch.import_type];
    if (table) {
      const { error: delErr } = await sb
        .from(table)
        .delete()
        .eq("import_batch_id", body.batch_id);

      if (delErr) throw delErr;
    }

    // Mark batch as rolled back
    const { error: updateErr } = await sb
      .from("import_batches")
      .update({
        status: "rolled_back",
        rolled_back_at: new Date().toISOString(),
        rolled_back_by: userId,
      })
      .eq("id", body.batch_id);

    if (updateErr) throw updateErr;

    await logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "import_rolled_back",
      details: {
        batch_id: body.batch_id,
        import_type: batch.import_type,
        records_removed: batch.imported_count,
      },
    });

    return NextResponse.json({
      success: true,
      batch_id: body.batch_id,
      records_removed: batch.imported_count,
    });
  } catch (err) {
    console.error("[API-ERROR]", "/api/accounting/import DELETE", err);
    return NextResponse.json(
      { error: "Rollback failed — see server logs" },
      { status: 502 },
    );
  }
}
