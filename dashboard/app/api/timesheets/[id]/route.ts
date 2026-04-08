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
    // Join ALL sub-section tables so the single-timesheet response includes
    // every section (migration_007 added 10 new sub-section tables).
    const { data, error } = await sb
      .from("timesheets")
      .select(
        "*, timesheet_daily_logs(*), timesheet_railroad_timecards(*), " +
        "timesheet_inspections(*), timesheet_ifta_entries(*), timesheet_expenses(*), " +
        "timesheet_maintenance_time(*), timesheet_shop_time(*), timesheet_mileage_pay(*), " +
        "timesheet_flight_pay(*), timesheet_holiday_pay(*), timesheet_vacation_pay(*)"
      )
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Cast to Record — Supabase can't infer joined sub-section table types
    // from the expanded select string, so the SDK returns a generic error type.
    const ts = data as unknown as Record<string, unknown>;

    // Only the owner or managers can view
    if (ts.user_id !== userId && !isManager) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const logs = (ts.timesheet_daily_logs as Record<string, unknown>[]) ?? [];
    let totalHours = 0;
    let totalTravel = 0;
    for (const log of logs) {
      totalHours += Number(log.hours_worked) || 0;
      totalTravel += Number(log.travel_hours) || 0;
    }

    return NextResponse.json({
      ...ts,
      // Rename daily_logs from Supabase join key to TS-friendly name
      daily_logs: logs.sort(
        (a, b) => (a.sort_order as number) - (b.sort_order as number),
      ),
      timesheet_daily_logs: undefined,
      // Rename all sub-section join keys to match TypeScript interface names
      railroad_timecards: ts.timesheet_railroad_timecards ?? [],
      timesheet_railroad_timecards: undefined,
      inspections: ts.timesheet_inspections ?? [],
      timesheet_inspections: undefined,
      ifta_entries: ts.timesheet_ifta_entries ?? [],
      timesheet_ifta_entries: undefined,
      expenses: ts.timesheet_expenses ?? [],
      timesheet_expenses: undefined,
      maintenance_time: ts.timesheet_maintenance_time ?? [],
      timesheet_maintenance_time: undefined,
      shop_time: ts.timesheet_shop_time ?? [],
      timesheet_shop_time: undefined,
      mileage_pay: ts.timesheet_mileage_pay ?? [],
      timesheet_mileage_pay: undefined,
      flight_pay: ts.timesheet_flight_pay ?? [],
      timesheet_flight_pay: undefined,
      holiday_pay: ts.timesheet_holiday_pay ?? [],
      timesheet_holiday_pay: undefined,
      vacation_pay: ts.timesheet_vacation_pay ?? [],
      timesheet_vacation_pay: undefined,
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

    // Only allow field edits on draft timesheets (or by managers).
    // Includes new migration_007 fields: norfolk_southern_job_code,
    // ifta_odometer_start, ifta_odometer_end.
    if (existing.status === "draft" || isManager) {
      const editableFields = [
        "week_ending", "railroad_working_on", "norfolk_southern_job_code",
        "chase_vehicles", "semi_trucks", "work_location", "nights_out",
        "layovers", "coworkers", "ifta_odometer_start", "ifta_odometer_end",
        "notes",
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

      // Insert new logs — includes new migration_007 per-day fields:
      // lunch_minutes, semi_truck_travel, traveling_from, destination, travel_miles
      const logRows = (body.daily_logs as Record<string, unknown>[]).map((log, i) => ({
        timesheet_id: id,
        log_date: log.log_date,
        start_time: log.start_time || null,
        end_time: log.end_time || null,
        hours_worked: log.hours_worked ?? 0,
        travel_hours: log.travel_hours ?? 0,
        lunch_minutes: log.lunch_minutes ?? 0,
        description: log.description || null,
        semi_truck_travel: log.semi_truck_travel ?? false,
        traveling_from: log.traveling_from || null,
        destination: log.destination || null,
        travel_miles: log.travel_miles ?? null,
        sort_order: i,
      }));

      if (logRows.length > 0) {
        await sb.from("timesheet_daily_logs").insert(logRows);
      }
    }

    // Auto-generate per diem entries when a timesheet is approved.
    // Uses the active per_diem_rate to compute amounts from nights_out + layovers.
    if (update.status === "approved") {
      const nightsOut = Number(body.nights_out ?? existing.nights_out) || 0;
      const layoversCount = Number(body.layovers ?? existing.layovers) || 0;
      let perDiemTotal = 0;

      if (nightsOut > 0 || layoversCount > 0) {
        // Get the active per diem rate
        const { data: rate } = await sb
          .from("per_diem_rates")
          .select("id, daily_rate, layover_rate")
          .eq("is_active", true)
          .order("effective_date", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (rate) {
          const nightsAmount = nightsOut * Number(rate.daily_rate);
          const layoverAmount = layoversCount * Number(rate.layover_rate);
          perDiemTotal = nightsAmount + layoverAmount;

          // Upsert — one per diem entry per timesheet (UNIQUE constraint)
          await sb.from("per_diem_entries").upsert(
            {
              timesheet_id: id,
              user_id: existing.user_id,
              user_name: existing.user_name,
              rate_id: rate.id,
              nights_count: nightsOut,
              layover_count: layoversCount,
              nights_amount: nightsAmount,
              layover_amount: layoverAmount,
              total_amount: perDiemTotal,
              week_ending: existing.week_ending,
              entry_date: existing.week_ending,
            },
            { onConflict: "timesheet_id" },
          );
        }
      }

      // ── Auto-generate journal entry for per diem ────────────────────
      // DR 5100 Per Diem Expense / CR 2110 Per Diem Payable
      if (perDiemTotal > 0) {
        try {
          const { data: expenseAcct } = await sb
            .from("chart_of_accounts")
            .select("id")
            .eq("account_number", "5100")
            .single();
          const { data: payableAcct } = await sb
            .from("chart_of_accounts")
            .select("id")
            .eq("account_number", "2110")
            .single();

          if (expenseAcct && payableAcct) {
            // Remove any existing journal entry for this timesheet's per diem
            const { data: oldJe } = await sb
              .from("journal_entries")
              .select("id")
              .eq("source", "per_diem")
              .eq("source_id", id)
              .neq("status", "voided")
              .maybeSingle();

            if (oldJe) {
              await sb.from("journal_entry_lines").delete().eq("journal_entry_id", oldJe.id);
              await sb.from("journal_entries").delete().eq("id", oldJe.id);
            }

            // Create and auto-post the journal entry
            const { data: je } = await sb
              .from("journal_entries")
              .insert({
                entry_date: existing.week_ending,
                description: `Per diem — ${existing.user_name} (${existing.week_ending})`,
                reference: `TS-${id.slice(0, 8)}`,
                source: "per_diem",
                source_id: id,
                status: "posted",
                total_amount: perDiemTotal,
                created_by: userId,
                created_by_name: userInfo.name,
                posted_at: new Date().toISOString(),
              })
              .select("id")
              .single();

            if (je) {
              await sb.from("journal_entry_lines").insert([
                {
                  journal_entry_id: je.id,
                  account_id: expenseAcct.id,
                  debit: perDiemTotal,
                  credit: 0,
                  description: `Per diem: ${nightsOut} nights, ${layoversCount} layovers`,
                  line_order: 0,
                },
                {
                  journal_entry_id: je.id,
                  account_id: payableAcct.id,
                  debit: 0,
                  credit: perDiemTotal,
                  description: `Per diem payable — ${existing.user_name}`,
                  line_order: 1,
                },
              ]);

              // Update account balances (expense = debit normal, liability = credit normal)
              const { data: expBal } = await sb
                .from("chart_of_accounts")
                .select("current_balance")
                .eq("id", expenseAcct.id)
                .single();
              const { data: payBal } = await sb
                .from("chart_of_accounts")
                .select("current_balance")
                .eq("id", payableAcct.id)
                .single();

              if (expBal) {
                await sb
                  .from("chart_of_accounts")
                  .update({ current_balance: Number(expBal.current_balance) + perDiemTotal })
                  .eq("id", expenseAcct.id);
              }
              if (payBal) {
                await sb
                  .from("chart_of_accounts")
                  .update({ current_balance: Number(payBal.current_balance) + perDiemTotal })
                  .eq("id", payableAcct.id);
              }
            }
          }
        } catch (jeErr) {
          // Journal entry generation is best-effort; don't block timesheet approval
          console.error("[JOURNAL-ENTRY]", "Failed to auto-generate per diem JE", jeErr);
        }
      }
    }

    // If un-approved (back to draft), remove per diem entry and void journal entries
    if (update.status === "draft" || update.status === "rejected") {
      await sb.from("per_diem_entries").delete().eq("timesheet_id", id);

      // Void any auto-generated journal entries for this timesheet
      try {
        const { data: autoJournals } = await sb
          .from("journal_entries")
          .select("id, status, total_amount, journal_entry_lines(id, account_id, debit, credit)")
          .or(`source_id.eq.${id}`)
          .eq("status", "posted");

        if (autoJournals) {
          for (const je of autoJournals as Record<string, unknown>[]) {
            // Reverse balance changes
            const lines = (je.journal_entry_lines as { id: string; account_id: string; debit: number; credit: number }[]) ?? [];
            for (const line of lines) {
              const { data: acct } = await sb
                .from("chart_of_accounts")
                .select("current_balance, normal_balance")
                .eq("id", line.account_id)
                .single();

              if (acct) {
                const reversal = acct.normal_balance === "debit"
                  ? -(Number(line.debit) - Number(line.credit))
                  : -(Number(line.credit) - Number(line.debit));
                await sb
                  .from("chart_of_accounts")
                  .update({ current_balance: Number(acct.current_balance) + reversal })
                  .eq("id", line.account_id);
              }
            }

            // Mark as voided
            await sb
              .from("journal_entries")
              .update({
                status: "voided",
                voided_at: new Date().toISOString(),
                voided_by: userId,
                voided_reason: `Timesheet ${update.status === "draft" ? "withdrawn" : "rejected"}`,
              })
              .eq("id", je.id as string);
          }
        }
      } catch (jeErr) {
        console.error("[JOURNAL-ENTRY]", "Failed to void auto JEs on un-approval", jeErr);
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
