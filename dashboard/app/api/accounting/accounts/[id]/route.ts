import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { logAuditDirect } from "@/lib/audit";

/**
 * Fetches display name, email, and role from Clerk for the given user ID.
 * Falls back to safe defaults if Clerk is unreachable.
 */
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

/**
 * GET /api/accounting/accounts/[id]
 * Returns a single account by ID.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("chart_of_accounts")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("[API-ERROR]", `/api/accounting/accounts/${id} GET`, err);
    return NextResponse.json(
      { error: "Failed to fetch account" },
      { status: 502 },
    );
  }
}

/**
 * PATCH /api/accounting/accounts/[id]
 * Update account fields: name, description, is_active, parent_id.
 * Cannot modify account_type or account_number on system accounts.
 * Manager/developer only.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const userInfo = await getUserInfo(userId);
  const isManager = userInfo.role === "developer" || userInfo.role === "manager";
  if (!isManager)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const sb = getSupabase();

    // Fetch existing account
    const { data: existing, error: fetchErr } = await sb
      .from("chart_of_accounts")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Block modifying protected fields on system accounts
    if (existing.is_system) {
      if (body.account_type !== undefined || body.account_number !== undefined) {
        return NextResponse.json(
          { error: "Cannot modify account_type or account_number on system accounts" },
          { status: 400 },
        );
      }
    }

    // Build update payload from allowed fields
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.name !== undefined) update.name = body.name;
    if (body.description !== undefined) update.description = body.description;
    if (body.is_active !== undefined) update.is_active = body.is_active;
    if (body.parent_id !== undefined) update.parent_id = body.parent_id;

    const { data, error } = await sb
      .from("chart_of_accounts")
      .update(update)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "account_updated",
      details: {
        account_id: id,
        account_number: existing.account_number,
        changes: Object.keys(update).filter((k) => k !== "updated_at"),
      },
    });

    return NextResponse.json(data);
  } catch (err) {
    console.error("[API-ERROR]", `/api/accounting/accounts/${id} PATCH`, err);
    return NextResponse.json(
      { error: "Failed to update account" },
      { status: 502 },
    );
  }
}

/**
 * DELETE /api/accounting/accounts/[id]
 * Soft-delete: sets is_active=false.
 * Cannot delete system accounts.
 * Checks that no posted journal entries reference this account before deactivating.
 * Manager/developer only.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const userInfo = await getUserInfo(userId);
  const isManager = userInfo.role === "developer" || userInfo.role === "manager";
  if (!isManager)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const sb = getSupabase();

    // Fetch existing account
    const { data: existing, error: fetchErr } = await sb
      .from("chart_of_accounts")
      .select("id, account_number, name, is_system, is_active")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (existing.is_system) {
      return NextResponse.json(
        { error: "Cannot delete system accounts" },
        { status: 400 },
      );
    }

    if (!existing.is_active) {
      return NextResponse.json(
        { error: "Account is already inactive" },
        { status: 400 },
      );
    }

    // Check for posted journal entries referencing this account
    const { data: postedLines } = await sb
      .from("journal_entry_lines")
      .select("id, journal_entry_id")
      .eq("account_id", id)
      .limit(1);

    if (postedLines && postedLines.length > 0) {
      // Verify at least one is from a posted entry
      const lineEntryIds = postedLines.map((l) => l.journal_entry_id);
      const { data: postedEntries } = await sb
        .from("journal_entries")
        .select("id")
        .in("id", lineEntryIds)
        .eq("status", "posted")
        .limit(1);

      if (postedEntries && postedEntries.length > 0) {
        return NextResponse.json(
          {
            error:
              "Cannot deactivate account with posted journal entries. Void the entries first.",
          },
          { status: 409 },
        );
      }
    }

    // Soft-delete: set is_active = false
    const { data, error } = await sb
      .from("chart_of_accounts")
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "account_deactivated",
      details: {
        account_id: id,
        account_number: existing.account_number,
        name: existing.name,
      },
    });

    return NextResponse.json(data);
  } catch (err) {
    console.error("[API-ERROR]", `/api/accounting/accounts/${id} DELETE`, err);
    return NextResponse.json(
      { error: "Failed to deactivate account" },
      { status: 502 },
    );
  }
}
