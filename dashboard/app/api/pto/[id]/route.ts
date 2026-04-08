import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import { logAuditDirect } from "@/lib/audit";

/**
 * Fetches display name and role from Clerk for the given user ID.
 * Falls back to safe defaults if Clerk is unreachable.
 */
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

/**
 * GET /api/pto/[id]
 * Returns a single PTO request by ID. Owner or manager/developer can view.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const userInfo = await getUserInfo(userId);
  const isManager = userInfo.role === "developer" || userInfo.role === "manager";

  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("pto_requests")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Only the owner or managers can view
    if (data.user_id !== userId && !isManager) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("[API-ERROR]", `/api/pto/${id} GET`, err);
    return NextResponse.json(
      { error: "Failed to fetch PTO request" },
      { status: 502 },
    );
  }
}

/**
 * PATCH /api/pto/[id]
 * Status transitions for PTO requests with balance deduction on approval.
 *
 * Valid transitions:
 *   - pending  -> approved   (manager/developer only — deducts from pto_balances)
 *   - pending  -> rejected   (manager/developer only — optional manager_notes)
 *   - pending  -> cancelled  (owner only — self-cancel)
 *
 * Body: { status: string, manager_notes?: string }
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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const newStatus = body.status as string | undefined;
  if (!newStatus) {
    return NextResponse.json({ error: "Missing status field" }, { status: 400 });
  }

  try {
    const sb = getSupabase();

    // Fetch the existing PTO request
    const { data: existing, error: fetchErr } = await sb
      .from("pto_requests")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const currentStatus = existing.status as string;
    const isOwner = existing.user_id === userId;

    // Build the update payload based on the requested transition
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    // --- Transition: pending -> approved (manager only) ---
    if (newStatus === "approved" && currentStatus === "pending") {
      if (!isManager) {
        return NextResponse.json({ error: "Only managers can approve PTO" }, { status: 403 });
      }
      update.status = "approved";
      update.reviewed_by = userId;
      update.reviewed_by_name = userInfo.name;
      update.reviewed_at = new Date().toISOString();
      if (body.manager_notes) update.manager_notes = body.manager_notes;

      // Deduct hours from the employee's PTO balance
      const year = new Date(existing.start_date as string).getFullYear();
      const ptoType = existing.pto_type as string;
      const hours = Number(existing.hours) || 0;

      // Map pto_type to the balance column name
      const balanceColumn = `${ptoType}_hours_used`;

      // Fetch current balance (or it may not exist yet — handled by balance route)
      const { data: balance } = await sb
        .from("pto_balances")
        .select("*")
        .eq("user_id", existing.user_id as string)
        .eq("year", year)
        .maybeSingle();

      if (balance) {
        const currentUsed = Number(balance[balanceColumn]) || 0;
        await sb
          .from("pto_balances")
          .update({
            [balanceColumn]: currentUsed + hours,
            updated_at: new Date().toISOString(),
          })
          .eq("id", balance.id);
      }
      // If no balance row exists, the balance route will create it on next access

    // --- Transition: pending -> rejected (manager only) ---
    } else if (newStatus === "rejected" && currentStatus === "pending") {
      if (!isManager) {
        return NextResponse.json({ error: "Only managers can reject PTO" }, { status: 403 });
      }
      update.status = "rejected";
      update.reviewed_by = userId;
      update.reviewed_by_name = userInfo.name;
      update.reviewed_at = new Date().toISOString();
      if (body.manager_notes) update.manager_notes = body.manager_notes;

    // --- Transition: pending -> cancelled (owner only) ---
    } else if (newStatus === "cancelled" && currentStatus === "pending") {
      if (!isOwner) {
        return NextResponse.json(
          { error: "Only the request owner can cancel a pending request" },
          { status: 403 },
        );
      }
      update.status = "cancelled";

    } else {
      return NextResponse.json(
        { error: `Invalid transition from '${currentStatus}' to '${newStatus}'` },
        { status: 400 },
      );
    }

    const { data, error } = await sb
      .from("pto_requests")
      .update(update)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // Audit log the transition
    const auditAction = newStatus === "approved"
      ? "pto_approved" as const
      : newStatus === "rejected"
        ? "pto_rejected" as const
        : "pto_cancelled" as const;

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: auditAction,
      details: {
        pto_id: id,
        owner: existing.user_name,
        pto_type: existing.pto_type,
        hours: existing.hours,
        transition: `${currentStatus} -> ${newStatus}`,
      },
    });

    return NextResponse.json(data);
  } catch (err) {
    console.error("[API-ERROR]", `/api/pto/${id} PATCH`, err);
    return NextResponse.json(
      { error: "Failed to update PTO request" },
      { status: 502 },
    );
  }
}

/**
 * DELETE /api/pto/[id]
 * Deletes a PTO request. Owner can only delete their own pending requests.
 * Managers/developers can delete any request.
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

  try {
    const sb = getSupabase();

    const { data: existing } = await sb
      .from("pto_requests")
      .select("user_id, status, user_name, pto_type, start_date, end_date")
      .eq("id", id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Owner can only delete pending requests; managers can delete anything
    if (!isManager && (existing.user_id !== userId || existing.status !== "pending")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error } = await sb.from("pto_requests").delete().eq("id", id);
    if (error) throw error;

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "pto_cancelled",
      details: {
        pto_id: id,
        action: "deleted",
        owner: existing.user_name,
        pto_type: existing.pto_type,
        start_date: existing.start_date,
        end_date: existing.end_date,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[API-ERROR]", `/api/pto/${id} DELETE`, err);
    return NextResponse.json(
      { error: "Failed to delete PTO request" },
      { status: 502 },
    );
  }
}
