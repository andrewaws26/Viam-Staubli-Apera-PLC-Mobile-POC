import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";
import type {
  UserTrainingStatus,
  TrainingComplianceDetail,
  TrainingComplianceStatus,
  TrainingRequirement,
  TrainingRecord,
} from "@ironsight/shared";

async function getUserName(userId: string): Promise<string> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return user.firstName
      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
      : user.emailAddresses?.[0]?.emailAddress ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

/**
 * GET /api/training/status
 * Returns aggregated training compliance status for the current user.
 * Shape: UserTrainingStatus (current/expiring/expired/missing counts + details)
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const sb = getSupabase();

    // Fetch all active requirements and user's training records in parallel
    const [reqResult, recResult, userName] = await Promise.all([
      sb
        .from("training_requirements")
        .select("*")
        .eq("is_active", true)
        .order("name", { ascending: true }),
      sb
        .from("training_records")
        .select("*")
        .eq("user_id", userId)
        .order("completed_date", { ascending: false }),
      getUserName(userId),
    ]);

    if (reqResult.error) throw reqResult.error;
    if (recResult.error) throw recResult.error;

    const requirements: TrainingRequirement[] = reqResult.data ?? [];
    const records: TrainingRecord[] = recResult.data ?? [];

    const now = new Date();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    // Group records by requirement_id — keep only the latest per requirement
    const latestByReq = new Map<string, TrainingRecord>();
    for (const rec of records) {
      if (!latestByReq.has(rec.requirement_id)) {
        latestByReq.set(rec.requirement_id, rec);
      }
    }

    // Build compliance detail for each requirement
    const details: TrainingComplianceDetail[] = requirements.map((req) => {
      const latest = latestByReq.get(req.id) ?? null;

      let status: TrainingComplianceStatus = "missing";
      let days_until_expiry: number | null = null;

      if (latest) {
        if (!latest.expiry_date) {
          // One-time training with no expiry — always current
          status = "current";
          days_until_expiry = null;
        } else {
          const expiry = new Date(latest.expiry_date);
          const diffMs = expiry.getTime() - now.getTime();
          days_until_expiry = Math.ceil(diffMs / (24 * 60 * 60 * 1000));

          if (diffMs < 0) {
            status = "expired";
          } else if (diffMs < thirtyDaysMs) {
            status = "expiring_soon";
          } else {
            status = "current";
          }
        }
      }

      return {
        requirement: req,
        latest_record: latest,
        status,
        days_until_expiry,
      };
    });

    // Count only required trainings for compliance metrics
    const requiredDetails = details.filter((d) => d.requirement.is_required);
    const currentCount = requiredDetails.filter((d) => d.status === "current").length;
    const expiringSoonCount = requiredDetails.filter((d) => d.status === "expiring_soon").length;
    const expiredCount = requiredDetails.filter((d) => d.status === "expired").length;
    const missingCount = requiredDetails.filter((d) => d.status === "missing").length;

    const result: UserTrainingStatus = {
      user_id: userId,
      user_name: userName,
      total_required: requiredDetails.length,
      completed: requiredDetails.filter((d) => d.latest_record !== null).length,
      current: currentCount,
      expiring_soon: expiringSoonCount,
      expired: expiredCount,
      missing: missingCount,
      is_compliant: expiredCount === 0 && missingCount === 0,
      details,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("[API-ERROR]", "/api/training/status GET", err);
    return NextResponse.json(
      { error: "Failed to compute training status" },
      { status: 502 },
    );
  }
}
