import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

/**
 * Generic CRUD route for all timesheet sub-sections (migration_007).
 *
 * Usage:
 *   GET    /api/timesheets/[id]/sections?section=expenses
 *   POST   /api/timesheets/[id]/sections?section=expenses   (body = entry data)
 *   DELETE  /api/timesheets/[id]/sections?section=expenses&entry_id=xxx
 *
 * The `section` query param maps to one of the 10 sub-section tables.
 * Auth: user must own the timesheet OR be a manager/developer.
 */

// Map short section names (matching TypeScript interface keys) to DB table names
const SECTION_TABLES: Record<string, string> = {
  railroad_timecards: "timesheet_railroad_timecards",
  inspections: "timesheet_inspections",
  ifta_entries: "timesheet_ifta_entries",
  expenses: "timesheet_expenses",
  maintenance_time: "timesheet_maintenance_time",
  shop_time: "timesheet_shop_time",
  mileage_pay: "timesheet_mileage_pay",
  flight_pay: "timesheet_flight_pay",
  holiday_pay: "timesheet_holiday_pay",
  vacation_pay: "timesheet_vacation_pay",
};

const VALID_SECTIONS = Object.keys(SECTION_TABLES);

async function getUserRole(userId: string): Promise<string> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return (
      ((user.publicMetadata as Record<string, unknown>)?.role as string) ||
      "operator"
    );
  } catch {
    return "operator";
  }
}

/**
 * Verify the user owns this timesheet or is a manager/developer.
 * Returns the timesheet row if authorized, or a NextResponse error.
 */
async function authorizeTimesheetAccess(
  userId: string,
  timesheetId: string,
): Promise<{ data: Record<string, unknown> } | NextResponse> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("timesheets")
    .select("id, user_id, status")
    .eq("id", timesheetId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Timesheet not found" }, { status: 404 });
  }

  const role = await getUserRole(userId);
  const isManager = role === "developer" || role === "manager";
  const isOwner = data.user_id === userId;

  if (!isOwner && !isManager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return { data: data as Record<string, unknown> };
}

/**
 * Validate the ?section= query param. Returns the table name or an error response.
 */
function resolveSection(
  request: NextRequest,
): { table: string; section: string } | NextResponse {
  const section = request.nextUrl.searchParams.get("section");
  if (!section || !SECTION_TABLES[section]) {
    return NextResponse.json(
      {
        error: `Invalid or missing section. Valid sections: ${VALID_SECTIONS.join(", ")}`,
      },
      { status: 400 },
    );
  }
  return { table: SECTION_TABLES[section], section };
}

/**
 * GET /api/timesheets/[id]/sections?section=expenses
 * Returns all entries for the given section of this timesheet.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const sectionResult = resolveSection(request);
  if (sectionResult instanceof NextResponse) return sectionResult;
  const { table } = sectionResult;

  const authResult = await authorizeTimesheetAccess(userId, id);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from(table)
      .select("*")
      .eq("timesheet_id", id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", `/api/timesheets/${id}/sections GET`, err);
    return NextResponse.json(
      { error: "Failed to fetch section entries" },
      { status: 502 },
    );
  }
}

/**
 * POST /api/timesheets/[id]/sections?section=expenses
 * Create a new entry in the given section. The timesheet_id is set automatically.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const sectionResult = resolveSection(request);
  if (sectionResult instanceof NextResponse) return sectionResult;
  const { table } = sectionResult;

  const authResult = await authorizeTimesheetAccess(userId, id);
  if (authResult instanceof NextResponse) return authResult;

  // Only allow edits on draft timesheets (managers can edit any status)
  const ts = (authResult as { data: Record<string, unknown> }).data;
  const role = await getUserRole(userId);
  const isManager = role === "developer" || role === "manager";
  if (ts.status !== "draft" && !isManager) {
    return NextResponse.json(
      { error: "Cannot add entries to a non-draft timesheet" },
      { status: 400 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const sb = getSupabase();

    // Inject timesheet_id automatically; strip any client-provided id/timesheet_id
    // to prevent spoofing
    const { id: _stripId, timesheet_id: _stripTsId, ...rest } = body;
    const row = { ...rest, timesheet_id: id };

    const { data, error } = await sb
      .from(table)
      .insert(row)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", `/api/timesheets/${id}/sections POST`, err);
    return NextResponse.json(
      { error: "Failed to create section entry" },
      { status: 502 },
    );
  }
}

/**
 * DELETE /api/timesheets/[id]/sections?section=expenses&entry_id=xxx
 * Delete a specific entry. Verifies the entry belongs to this timesheet.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const sectionResult = resolveSection(request);
  if (sectionResult instanceof NextResponse) return sectionResult;
  const { table } = sectionResult;

  const entryId = request.nextUrl.searchParams.get("entry_id");
  if (!entryId) {
    return NextResponse.json(
      { error: "Missing entry_id query parameter" },
      { status: 400 },
    );
  }

  const authResult = await authorizeTimesheetAccess(userId, id);
  if (authResult instanceof NextResponse) return authResult;

  // Only allow edits on draft timesheets (managers can edit any status)
  const ts = (authResult as { data: Record<string, unknown> }).data;
  const role = await getUserRole(userId);
  const isManager = role === "developer" || role === "manager";
  if (ts.status !== "draft" && !isManager) {
    return NextResponse.json(
      { error: "Cannot delete entries from a non-draft timesheet" },
      { status: 400 },
    );
  }

  try {
    const sb = getSupabase();

    // Verify the entry exists and belongs to this timesheet before deleting
    const { data: entry, error: fetchErr } = await sb
      .from(table)
      .select("id, timesheet_id")
      .eq("id", entryId)
      .single();

    if (fetchErr || !entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    if (entry.timesheet_id !== id) {
      return NextResponse.json(
        { error: "Entry does not belong to this timesheet" },
        { status: 403 },
      );
    }

    const { error } = await sb.from(table).delete().eq("id", entryId);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[API-ERROR]", `/api/timesheets/${id}/sections DELETE`, err);
    return NextResponse.json(
      { error: "Failed to delete section entry" },
      { status: 502 },
    );
  }
}
