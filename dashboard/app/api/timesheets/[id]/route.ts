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

/**
 * GET /api/timesheets/[id]
 * Fetch a single timesheet with daily logs.
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
      .from("timesheets")
      .select("*, timesheet_daily_logs(*)")
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Only the owner or managers can view
    if (data.user_id !== userId && !isManager) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const logs = (data.timesheet_daily_logs as Record<string, unknown>[]) ?? [];
    let totalHours = 0;
    let totalTravel = 0;
    for (const log of logs) {
      totalHours += Number(log.hours_worked) || 0;
      totalTravel += Number(log.travel_hours) || 0;
    }

    return NextResponse.json({
      ...data,
      daily_logs: logs.sort(
        (a, b) => (a.sort_order as number) - (b.sort_order as number),
      ),
      timesheet_daily_logs: undefined,
      total_hours: totalHours,
      total_travel_hours: totalTravel,
    });
  } catch (err) {
    console.error("[API-ERROR]", `/api/timesheets/${id} GET`, err);
    return NextResponse.json({ error: "Failed to fetch timesheet" }, { status: 502 });
  }
}

/**
 * PATCH /api/timesheets/[id]
 * Update timesheet fields, daily logs, or status (submit/approve/reject).
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

  try {
    const sb = getSupabase();

    // Fetch existing
    const { data: existing, error: fetchErr } = await sb
      .from("timesheets")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Only owner can edit draft timesheets; managers can approve/reject
    const isOwner = existing.user_id === userId;
    if (!isOwner && !isManager) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    // Status transitions
    if (body.status) {
      const newStatus = body.status as string;
      const currentStatus = existing.status as string;

      // Owner can: draft -> submitted, submitted -> draft (withdraw)
      if (isOwner && !isManager) {
        if (newStatus === "submitted" && currentStatus === "draft") {
          update.status = "submitted";
          update.submitted_at = new Date().toISOString();
        } else if (newStatus === "draft" && currentStatus === "submitted") {
          update.status = "draft";
          update.submitted_at = null;
        } else {
          return NextResponse.json(
            { error: `Cannot transition from ${currentStatus} to ${newStatus}` },
            { status: 400 },
          );
        }
      }

      // Managers can: submitted -> approved/rejected, rejected -> approved
      if (isManager) {
        if (newStatus === "approved" && (currentStatus === "submitted" || currentStatus === "rejected")) {
          update.status = "approved";
          update.approved_by = userId;
          update.approved_by_name = userInfo.name;
          update.approved_at = new Date().toISOString();
          update.rejection_reason = null;
        } else if (newStatus === "rejected" && currentStatus === "submitted") {
          update.status = "rejected";
          update.rejection_reason = (body.rejection_reason as string) || null;
          update.approved_by = null;
          update.approved_by_name = null;
          update.approved_at = null;
        } else if (newStatus === "submitted" || newStatus === "draft") {
          // Managers can also submit/withdraw on behalf
          update.status = newStatus;
          if (newStatus === "submitted") update.submitted_at = new Date().toISOString();
          if (newStatus === "draft") {
            update.submitted_at = null;
            update.approved_by = null;
            update.approved_by_name = null;
            update.approved_at = null;
            update.rejection_reason = null;
          }
        } else {
          return NextResponse.json(
            { error: `Cannot transition from ${currentStatus} to ${newStatus}` },
            { status: 400 },
          );
        }
      }
    }

    // Only allow field edits on draft timesheets (or by managers)
    if (existing.status === "draft" || isManager) {
      const editableFields = [
        "week_ending", "railroad_working_on", "chase_vehicles", "semi_trucks",
        "work_location", "nights_out", "layovers", "coworkers", "notes",
      ];
      for (const field of editableFields) {
        if (field in body) update[field] = body[field];
      }
    }

    const { data, error } = await sb
      .from("timesheets")
      .update(update)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // Replace daily logs if provided (only on drafts or by managers)
    if (Array.isArray(body.daily_logs) && (existing.status === "draft" || isManager)) {
      // Delete existing logs
      await sb.from("timesheet_daily_logs").delete().eq("timesheet_id", id);

      // Insert new logs
      const logRows = (body.daily_logs as Record<string, unknown>[]).map((log, i) => ({
        timesheet_id: id,
        log_date: log.log_date,
        start_time: log.start_time || null,
        end_time: log.end_time || null,
        hours_worked: log.hours_worked ?? 0,
        travel_hours: log.travel_hours ?? 0,
        description: log.description || null,
        sort_order: i,
      }));

      if (logRows.length > 0) {
        await sb.from("timesheet_daily_logs").insert(logRows);
      }
    }

    // Audit log
    const action = body.status === "submitted" ? "timesheet_submitted"
      : body.status === "approved" ? "timesheet_approved"
      : body.status === "rejected" ? "timesheet_rejected"
      : "timesheet_updated";

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action,
      details: {
        timesheet_id: id,
        week_ending: data.week_ending,
        owner: existing.user_name,
        changes: Object.keys(update).filter((k) => k !== "updated_at"),
      },
    });

    return NextResponse.json(data);
  } catch (err) {
    console.error("[API-ERROR]", `/api/timesheets/${id} PATCH`, err);
    return NextResponse.json({ error: "Failed to update timesheet" }, { status: 502 });
  }
}

/**
 * DELETE /api/timesheets/[id]
 * Only owner (draft only) or managers can delete.
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
      .from("timesheets")
      .select("user_id, status, user_name, week_ending")
      .eq("id", id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Only owner can delete drafts; managers can delete anything
    if (!isManager && (existing.user_id !== userId || existing.status !== "draft")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error } = await sb.from("timesheets").delete().eq("id", id);
    if (error) throw error;

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "timesheet_updated",
      details: { timesheet_id: id, action: "deleted", week_ending: existing.week_ending },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[API-ERROR]", `/api/timesheets/${id} DELETE`, err);
    return NextResponse.json({ error: "Failed to delete timesheet" }, { status: 502 });
  }
}
