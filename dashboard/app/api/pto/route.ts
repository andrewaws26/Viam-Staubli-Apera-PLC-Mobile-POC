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
 * GET /api/pto
 * Returns the current user's PTO requests, ordered by start date descending.
 * Managers/developers see all requests when ?all=true.
 * Optionally filter by ?status=pending|approved|rejected|cancelled.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const showAll = params.get("all") === "true";
  const status = params.get("status");

  const userInfo = await getUserInfo(userId);
  const isManager = userInfo.role === "developer" || userInfo.role === "manager";

  try {
    const sb = getSupabase();
    let query = sb
      .from("pto_requests")
      .select("*")
      .order("start_date", { ascending: false })
      .limit(200);

    // Only managers can see all PTO requests
    if (!showAll || !isManager) {
      query = query.eq("user_id", userId);
    }

    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[API-ERROR]", "/api/pto GET", err);
    return NextResponse.json(
      { error: "Failed to fetch PTO requests" },
      { status: 502 },
    );
  }
}

/**
 * POST /api/pto
 * Creates a new PTO request for the current user with status "pending".
 *
 * Required body fields:
 *   - start_date (string, YYYY-MM-DD)
 *   - end_date   (string, YYYY-MM-DD)
 *   - pto_type   ("vacation" | "sick" | "personal")
 *   - hours      (number, total hours requested)
 *
 * Optional: notes (string)
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { start_date, end_date, pto_type, hours, notes } = body as Record<string, unknown>;

  // --- Validation ---

  if (!start_date || !end_date) {
    return NextResponse.json({ error: "Missing start_date or end_date" }, { status: 400 });
  }

  if (!pto_type || !["vacation", "sick", "personal"].includes(pto_type as string)) {
    return NextResponse.json(
      { error: "pto_type must be one of: vacation, sick, personal" },
      { status: 400 },
    );
  }

  if (hours === undefined || hours === null || Number(hours) <= 0) {
    return NextResponse.json({ error: "hours must be a positive number" }, { status: 400 });
  }

  // Ensure end_date is not before start_date
  if (new Date(end_date as string) < new Date(start_date as string)) {
    return NextResponse.json(
      { error: "end_date cannot be before start_date" },
      { status: 400 },
    );
  }

  try {
    const sb = getSupabase();

    // Check for overlapping PTO requests (same user, overlapping dates, not cancelled)
    const { data: overlap } = await sb
      .from("pto_requests")
      .select("id")
      .eq("user_id", userId)
      .neq("status", "cancelled")
      .neq("status", "rejected")
      .lte("start_date", end_date as string)
      .gte("end_date", start_date as string)
      .limit(1);

    if (overlap && overlap.length > 0) {
      return NextResponse.json(
        { error: "Overlapping PTO request already exists", existing_id: overlap[0].id },
        { status: 409 },
      );
    }

    const { data, error } = await sb
      .from("pto_requests")
      .insert({
        user_id: userId,
        user_name: userInfo.name,
        user_email: userInfo.email,
        start_date,
        end_date,
        pto_type,
        hours: Number(hours),
        notes: notes || null,
        status: "pending",
      })
      .select()
      .single();

    if (error) throw error;

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "pto_requested",
      details: {
        pto_id: data.id,
        pto_type: pto_type as string,
        start_date: start_date as string,
        end_date: end_date as string,
        hours: Number(hours),
      },
    });

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/pto POST", err);
    return NextResponse.json(
      { error: "Failed to create PTO request" },
      { status: 502 },
    );
  }
}
