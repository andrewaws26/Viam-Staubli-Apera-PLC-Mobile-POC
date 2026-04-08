import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

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
 * GET /api/per-diem
 * Returns per diem entries for the current user, ordered by date descending.
 *
 * Query params:
 *   ?start=YYYY-MM-DD  — filter entries on or after this date
 *   ?end=YYYY-MM-DD    — filter entries on or before this date
 *   ?all=true           — managers see all employees' entries
 *   ?summary=true       — return aggregated summary instead of raw entries
 *
 * Per diem entries are derived from approved timesheets (nights_out, layovers)
 * joined with the per_diem_rates table. This route reads from the
 * per_diem_entries table which is populated when timesheets are approved.
 *
 * If ?summary=true, returns:
 *   { by_employee: [...], totals: { entries, total_amount } }
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const showAll = params.get("all") === "true";
  const startDate = params.get("start");
  const endDate = params.get("end");
  const wantSummary = params.get("summary") === "true";

  const userInfo = await getUserInfo(userId);
  const isManager = userInfo.role === "developer" || userInfo.role === "manager";

  try {
    const sb = getSupabase();

    let query = sb
      .from("per_diem_entries")
      .select("*, per_diem_rates(name, daily_rate)")
      .order("entry_date", { ascending: false })
      .limit(500);

    // Only managers can see all per diem entries
    if (!showAll || !isManager) {
      query = query.eq("user_id", userId);
    }

    if (startDate) query = query.gte("entry_date", startDate);
    if (endDate) query = query.lte("entry_date", endDate);

    const { data, error } = await query;
    if (error) throw error;

    const entries = data ?? [];

    // --- Summary mode: aggregate by employee ---
    if (wantSummary) {
      const byEmployee: Record<
        string,
        {
          name: string;
          entries: number;
          total_amount: number;
          nights_out: number;
          layovers: number;
        }
      > = {};

      let grandTotal = 0;

      for (const entry of entries) {
        const uid = entry.user_id as string;
        if (!byEmployee[uid]) {
          byEmployee[uid] = {
            name: entry.user_name as string,
            entries: 0,
            total_amount: 0,
            nights_out: 0,
            layovers: 0,
          };
        }
        byEmployee[uid].entries++;
        const amount = Number(entry.amount) || 0;
        byEmployee[uid].total_amount += amount;
        grandTotal += amount;

        if (entry.entry_type === "night_out") byEmployee[uid].nights_out++;
        if (entry.entry_type === "layover") byEmployee[uid].layovers++;
      }

      return NextResponse.json({
        by_employee: Object.entries(byEmployee).map(([id, info]) => ({
          user_id: id,
          ...info,
        })),
        totals: {
          entries: entries.length,
          total_amount: grandTotal,
        },
      });
    }

    return NextResponse.json(entries);
  } catch (err) {
    console.error("[API-ERROR]", "/api/per-diem GET", err);
    return NextResponse.json(
      { error: "Failed to fetch per diem entries" },
      { status: 502 },
    );
  }
}
