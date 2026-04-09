export const dynamic = "force-dynamic";

import { auth } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * GET /api/manager/dashboard
 *
 * Server-side aggregation API for the Manager Command Center.
 * Queries Supabase directly (no HTTP calls to other routes) and assembles
 * a single response with everything a manager needs: pending approvals,
 * work order status, training compliance, recent activity, and fleet health.
 *
 * Requires developer or manager role.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const role = ((user.publicMetadata as Record<string, unknown>)?.role as string) || "operator";
  if (role !== "developer" && role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sb = getSupabase();
  const now = new Date();

  // --- Run all queries in parallel; each wrapped in try/catch so one failure
  //     doesn't kill the whole response. Failed sections return safe defaults. ---

  const [
    timesheetsResult,
    ptoResult,
    workOrdersResult,
    trainingResult,
    activityResult,
    fleetResult,
  ] = await Promise.all([
    // 1. Pending timesheets
    (async () => {
      try {
        const { data, error } = await sb
          .from("timesheets")
          .select("id, user_name, week_ending, submitted_at")
          .eq("status", "submitted")
          .order("submitted_at", { ascending: false });
        if (error) throw error;
        const pending = data ?? [];
        return { pendingCount: pending.length, pending };
      } catch (err) {
        console.error("[MANAGER-DASH] timesheets query failed:", err);
        return { pendingCount: 0, pending: [] };
      }
    })(),

    // 2. Pending PTO requests
    (async () => {
      try {
        const { data, error } = await sb
          .from("pto_requests")
          .select("id, user_name, request_type, start_date, end_date, hours_requested, created_at")
          .eq("status", "pending")
          .order("created_at", { ascending: false });
        if (error) throw error;
        const pending = data ?? [];
        return { pendingCount: pending.length, pending };
      } catch (err) {
        console.error("[MANAGER-DASH] pto query failed:", err);
        return { pendingCount: 0, pending: [] };
      }
    })(),

    // 3. Work orders by status
    (async () => {
      try {
        const { data, error } = await sb
          .from("work_orders")
          .select("id, title, status, priority, assigned_to_name, blocker_reason")
          .order("created_at", { ascending: false });
        if (error) throw error;

        const rows = data ?? [];
        let open = 0;
        let inProgress = 0;
        let blocked = 0;
        let done = 0;
        let urgentOpen = 0;
        const blockedItems: Array<{
          id: string;
          title: string;
          assigned_to_name: string | null;
          blocker_reason: string | null;
          priority: string | null;
        }> = [];

        for (const wo of rows) {
          switch (wo.status) {
            case "open":
              open++;
              break;
            case "in_progress":
              inProgress++;
              break;
            case "blocked":
              blocked++;
              blockedItems.push({
                id: wo.id as string,
                title: wo.title as string,
                assigned_to_name: (wo.assigned_to_name as string) ?? null,
                blocker_reason: (wo.blocker_reason as string) ?? null,
                priority: (wo.priority as string) ?? null,
              });
              break;
            case "done":
              done++;
              break;
          }

          // Count urgent items that aren't done
          if (wo.priority === "urgent" && wo.status !== "done") {
            urgentOpen++;
          }
        }

        return { open, inProgress, blocked, done, urgentOpen, blockedItems };
      } catch (err) {
        console.error("[MANAGER-DASH] work_orders query failed:", err);
        return { open: 0, inProgress: 0, blocked: 0, done: 0, urgentOpen: 0, blockedItems: [] };
      }
    })(),

    // 4. Training compliance
    (async () => {
      try {
        const { data, error } = await sb
          .from("training_records")
          .select("user_name, expiry_date, training_requirements!inner(name, is_active, is_required)")
          .eq("training_requirements.is_active", true)
          .eq("training_requirements.is_required", true);
        if (error) throw error;

        const records = data ?? [];
        let expiredCount = 0;
        let expiringSoonCount = 0;
        const alerts: Array<{
          user_name: string;
          requirement_name: string;
          expiry_date: string | null;
          status: "expired" | "expiring_soon";
        }> = [];

        for (const record of records) {
          const expiryDate = record.expiry_date as string | null;
          if (!expiryDate) continue; // No expiry = perpetually valid

          const expiry = new Date(expiryDate);

          // Supabase !inner join returns an object for singular FK
          const req = record.training_requirements as unknown as {
            name: string;
            is_active: boolean;
            is_required: boolean;
          };

          if (expiry < now) {
            expiredCount++;
            alerts.push({
              user_name: record.user_name as string,
              requirement_name: req.name,
              expiry_date: expiryDate,
              status: "expired",
            });
          } else if (expiry.getTime() - now.getTime() < THIRTY_DAYS_MS) {
            expiringSoonCount++;
            alerts.push({
              user_name: record.user_name as string,
              requirement_name: req.name,
              expiry_date: expiryDate,
              status: "expiring_soon",
            });
          }
        }

        return { expiredCount, expiringSoonCount, alerts };
      } catch (err) {
        console.error("[MANAGER-DASH] training query failed:", err);
        return { expiredCount: 0, expiringSoonCount: 0, alerts: [] };
      }
    })(),

    // 5. Recent activity
    (async () => {
      try {
        const { data, error } = await sb
          .from("audit_log")
          .select("id, user_name, action, truck_id, details, created_at")
          .order("created_at", { ascending: false })
          .limit(15);
        if (error) throw error;
        return data ?? [];
      } catch (err) {
        console.error("[MANAGER-DASH] audit_log query failed:", err);
        return [];
      }
    })(),

    // 6. Fleet snapshot (lightweight proxy for fleet health)
    (async () => {
      try {
        // Get the latest snapshot per truck by ordering by captured_at desc
        // and using a post-filter to deduplicate by truck_id.
        const { data, error } = await sb
          .from("truck_snapshots")
          .select("truck_id, captured_at")
          .order("captured_at", { ascending: false });
        if (error) throw error;

        const rows = data ?? [];

        // Deduplicate: keep only the most recent snapshot per truck_id
        const latestByTruck = new Map<string, string>();
        for (const row of rows) {
          const truckId = row.truck_id as string;
          if (!latestByTruck.has(truckId)) {
            latestByTruck.set(truckId, row.captured_at as string);
          }
        }

        const totalTrucks = latestByTruck.size;
        const staleThreshold = new Date(now.getTime() - FIVE_MINUTES_MS);
        let staleTrucks = 0;

        for (const capturedAt of latestByTruck.values()) {
          if (new Date(capturedAt) < staleThreshold) {
            staleTrucks++;
          }
        }

        return { totalTrucks, staleTrucks };
      } catch (err) {
        console.error("[MANAGER-DASH] fleet snapshot query failed:", err);
        return { totalTrucks: 0, staleTrucks: 0 };
      }
    })(),
  ]);

  return NextResponse.json({
    timesheets: timesheetsResult,
    pto: ptoResult,
    workOrders: workOrdersResult,
    training: trainingResult,
    compliance: trainingResult,
    activity: activityResult,
    recentActivity: activityResult,
    fleet: fleetResult,
    generatedAt: now.toISOString(),
  });
}
