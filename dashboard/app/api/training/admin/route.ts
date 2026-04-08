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
 * Returns the Clerk user's role. Defaults to "operator" if unavailable.
 */
async function getUserRole(userId: string): Promise<string> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return ((user.publicMetadata as Record<string, unknown>)?.role as string) || "operator";
  } catch {
    return "operator";
  }
}

/** Compliance status thresholds */
const EXPIRING_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

type ComplianceStatus = "current" | "expiring" | "expired" | "missing";

/**
 * Computes compliance status for a training record based on its expiry date.
 */
function computeCompliance(expiryDate: string | null): Exclude<ComplianceStatus, "missing"> {
  if (!expiryDate) return "current"; // No expiry = perpetually valid

  const expiry = new Date(expiryDate);
  const now = new Date();

  if (expiry < now) return "expired";
  if (expiry.getTime() - now.getTime() < EXPIRING_THRESHOLD_MS) return "expiring";
  return "current";
}

/**
 * GET /api/training/admin
 * Manager/developer only. Returns a comprehensive training compliance overview:
 *
 * 1. All users' training records with compliance status
 * 2. A compliance matrix: for each user x required training, whether they have
 *    a current record, an expiring record, an expired record, or are missing it entirely
 * 3. Summary counts: current, expiring, expired, missing
 *
 * This powers the training compliance dashboard where managers can see at a
 * glance who needs what training.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getUserRole(userId);
  if (role !== "developer" && role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const sb = getSupabase();

    // Fetch all active training requirements
    const { data: requirements, error: reqErr } = await sb
      .from("training_requirements")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (reqErr) throw reqErr;

    // Fetch all training records with requirement info
    const { data: records, error: recErr } = await sb
      .from("training_records")
      .select("*, training_requirements(name, description, frequency_months, is_required)")
      .order("completed_date", { ascending: false });

    if (recErr) throw recErr;

    // Fetch all profiles for the user list
    const { data: profiles, error: profErr } = await sb
      .from("profiles")
      .select("user_id, display_name, email, role")
      .order("display_name", { ascending: true });

    if (profErr) throw profErr;

    const allRequirements = requirements ?? [];
    const allRecords = records ?? [];
    const allProfiles = profiles ?? [];

    // --- Build compliance matrix ---
    // For each user, for each required training, find the most recent record
    // and compute compliance status. If no record exists, status = "missing".

    const complianceMatrix: Array<{
      user_id: string;
      user_name: string;
      requirements: Array<{
        requirement_id: string;
        requirement_name: string;
        status: ComplianceStatus;
        completed_date: string | null;
        expiry_date: string | null;
        record_id: string | null;
      }>;
    }> = [];

    // Index records by user_id -> requirement_id (most recent first, already sorted)
    const recordsByUserReq: Record<string, Record<string, Record<string, unknown>>> = {};

    for (const record of allRecords) {
      const uid = record.user_id as string;
      const reqId = record.requirement_id as string;

      if (!recordsByUserReq[uid]) recordsByUserReq[uid] = {};
      // Keep only the most recent record per user/requirement pair
      if (!recordsByUserReq[uid][reqId]) {
        recordsByUserReq[uid][reqId] = record;
      }
    }

    // Summary counters
    let totalCurrent = 0;
    let totalExpiring = 0;
    let totalExpired = 0;
    let totalMissing = 0;

    for (const profile of allProfiles) {
      const uid = profile.user_id as string;
      const userRequirements: (typeof complianceMatrix)[number]["requirements"] = [];

      for (const req of allRequirements) {
        const reqId = req.id as string;
        const record = recordsByUserReq[uid]?.[reqId];

        if (record) {
          const status = computeCompliance(record.expiry_date as string | null);
          userRequirements.push({
            requirement_id: reqId,
            requirement_name: req.name as string,
            status,
            completed_date: record.completed_date as string | null,
            expiry_date: record.expiry_date as string | null,
            record_id: record.id as string,
          });

          if (status === "current") totalCurrent++;
          else if (status === "expiring") totalExpiring++;
          else if (status === "expired") totalExpired++;
        } else {
          // No record at all for this required training
          userRequirements.push({
            requirement_id: reqId,
            requirement_name: req.name as string,
            status: "missing",
            completed_date: null,
            expiry_date: null,
            record_id: null,
          });
          totalMissing++;
        }
      }

      complianceMatrix.push({
        user_id: uid,
        user_name: profile.display_name as string,
        requirements: userRequirements,
      });
    }

    // Annotate each record with compliance_status for the flat list
    const annotatedRecords = allRecords.map((record) => ({
      ...record,
      compliance_status: computeCompliance(record.expiry_date as string | null),
    }));

    return NextResponse.json({
      records: annotatedRecords,
      requirements: allRequirements,
      compliance_matrix: complianceMatrix,
      summary: {
        total_users: allProfiles.length,
        total_requirements: allRequirements.length,
        current: totalCurrent,
        expiring: totalExpiring,
        expired: totalExpired,
        missing: totalMissing,
      },
    });
  } catch (err) {
    console.error("[API-ERROR]", "/api/training/admin GET", err);
    return NextResponse.json(
      { error: "Failed to fetch training admin overview" },
      { status: 502 },
    );
  }
}

/**
 * POST /api/training/admin
 * Manager/developer only. Creates a new training record for a user.
 * Auto-computes expiry_date from the requirement's frequency_months.
 *
 * Required body fields:
 *   - user_id        (string, Clerk user ID)
 *   - requirement_id (string, UUID of the training requirement)
 *   - completed_date (string, YYYY-MM-DD)
 *
 * Optional: notes (string), certificate_url (string)
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  const isManager = userInfo.role === "developer" || userInfo.role === "manager";

  if (!isManager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    user_id: targetUserId,
    requirement_id,
    completed_date,
    notes,
    certificate_url,
  } = body as Record<string, unknown>;

  // --- Validation ---

  if (!targetUserId || typeof targetUserId !== "string") {
    return NextResponse.json({ error: "Missing user_id" }, { status: 400 });
  }

  if (!requirement_id || typeof requirement_id !== "string") {
    return NextResponse.json({ error: "Missing requirement_id" }, { status: 400 });
  }

  if (!completed_date || typeof completed_date !== "string") {
    return NextResponse.json({ error: "Missing completed_date" }, { status: 400 });
  }

  try {
    const sb = getSupabase();

    // Fetch the requirement to get frequency_months for expiry computation
    const { data: requirement, error: reqErr } = await sb
      .from("training_requirements")
      .select("id, name, frequency_months")
      .eq("id", requirement_id)
      .single();

    if (reqErr || !requirement) {
      return NextResponse.json({ error: "Training requirement not found" }, { status: 404 });
    }

    // Auto-compute expiry date from completed_date + frequency_months
    let expiryDate: string | null = null;
    const frequencyMonths = Number(requirement.frequency_months);

    if (frequencyMonths && frequencyMonths > 0) {
      const completed = new Date(completed_date as string);
      completed.setMonth(completed.getMonth() + frequencyMonths);
      expiryDate = completed.toISOString().split("T")[0];
    }

    // Look up the target user's name for the record
    const targetInfo = await getUserInfo(targetUserId as string);

    const { data, error } = await sb
      .from("training_records")
      .insert({
        user_id: targetUserId,
        user_name: targetInfo.name,
        requirement_id,
        completed_date,
        expiry_date: expiryDate,
        recorded_by: userId,
        recorded_by_name: userInfo.name,
        notes: notes || null,
        certificate_url: certificate_url || null,
      })
      .select("*, training_requirements(name, description, frequency_months, is_required)")
      .single();

    if (error) throw error;

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "training_recorded",
      details: {
        record_id: data.id,
        target_user_id: targetUserId as string,
        target_user_name: targetInfo.name,
        requirement_name: requirement.name,
        completed_date: completed_date as string,
        expiry_date: expiryDate,
      },
    });

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/training/admin POST", err);
    return NextResponse.json(
      { error: "Failed to create training record" },
      { status: 502 },
    );
  }
}

/**
 * DELETE /api/training/admin
 * Manager/developer only. Deletes a training record by ID.
 * Requires ?record_id= query param.
 */
export async function DELETE(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  const isManager = userInfo.role === "developer" || userInfo.role === "manager";

  if (!isManager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const recordId = request.nextUrl.searchParams.get("record_id");
  if (!recordId) {
    return NextResponse.json({ error: "Missing record_id query param" }, { status: 400 });
  }

  try {
    const sb = getSupabase();

    // Fetch the record first for audit logging
    const { data: existing } = await sb
      .from("training_records")
      .select("id, user_id, user_name, requirement_id, training_requirements(name)")
      .eq("id", recordId)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "Training record not found" }, { status: 404 });
    }

    const { error } = await sb
      .from("training_records")
      .delete()
      .eq("id", recordId);

    if (error) throw error;

    // Supabase join returns an object (or null) for singular FK relationships
    const reqInfo = existing.training_requirements as unknown as Record<string, unknown> | null;

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "training_deleted",
      details: {
        record_id: recordId,
        target_user_id: existing.user_id,
        target_user_name: existing.user_name,
        requirement_name: reqInfo?.name ?? "Unknown",
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[API-ERROR]", "/api/training/admin DELETE", err);
    return NextResponse.json(
      { error: "Failed to delete training record" },
      { status: 502 },
    );
  }
}
