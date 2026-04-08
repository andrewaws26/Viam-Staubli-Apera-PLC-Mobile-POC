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
    return { name, email, role, firstName: user.firstName, lastName: user.lastName };
  } catch {
    return { name: "Unknown", email: "", role: "operator", firstName: null, lastName: null };
  }
}

/**
 * GET /api/profiles
 * Returns the current user's profile. If no profile row exists yet,
 * auto-creates one seeded from the user's Clerk account data.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);

  try {
    const sb = getSupabase();

    // Attempt to fetch existing profile
    const { data: profile, error: fetchErr } = await sb
      .from("employee_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;

    // If profile exists, return it
    if (profile) {
      return NextResponse.json(profile);
    }

    // Auto-create a profile from Clerk data for first-time access.
    // Use upsert to handle race conditions where concurrent requests
    // both pass the maybeSingle() check above.
    const { data: created, error: createErr } = await sb
      .from("employee_profiles")
      .upsert(
        {
          user_id: userId,
          user_name: userInfo.name,
          user_email: userInfo.email,
        },
        { onConflict: "user_id", ignoreDuplicates: true },
      )
      .select()
      .single();

    if (createErr) throw createErr;

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("[API-ERROR]", "/api/profiles GET", err);
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 502 },
    );
  }
}

/**
 * PATCH /api/profiles
 * Updates the current user's profile fields. Managers/developers can update
 * any user's profile by passing ?user_id=<clerk_id> as a query param.
 *
 * Editable fields: display_name, first_name, last_name, phone, job_title,
 * department, emergency_contact_name, emergency_contact_phone, profile_picture_url.
 */
export async function PATCH(request: NextRequest) {
  const { userId } = await auth();
  if (!userId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userInfo = await getUserInfo(userId);
  const isManager = userInfo.role === "developer" || userInfo.role === "manager";

  // Determine whose profile to update
  const targetUserId = request.nextUrl.searchParams.get("user_id") || userId;

  // Only managers can update other users' profiles
  if (targetUserId !== userId && !isManager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Whitelist of fields that can be updated
  const editableFields = [
    "user_name",
    "user_email",
    "phone",
    "job_title",
    "department",
    "emergency_contact_name",
    "emergency_contact_phone",
    "hire_date",
    "profile_picture_url",
  ];

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const changedFields: string[] = [];

  for (const field of editableFields) {
    if (field in body) {
      update[field] = body[field];
      changedFields.push(field);
    }
  }

  if (changedFields.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  try {
    const sb = getSupabase();

    // Verify the target profile exists
    const { data: existing } = await sb
      .from("employee_profiles")
      .select("id")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const { data, error } = await sb
      .from("employee_profiles")
      .update(update)
      .eq("user_id", targetUserId)
      .select()
      .single();

    if (error) throw error;

    logAuditDirect(userId, userInfo.name, userInfo.role, {
      action: "profile_updated",
      details: {
        target_user_id: targetUserId,
        changed_fields: changedFields,
      },
    });

    return NextResponse.json(data);
  } catch (err) {
    console.error("[API-ERROR]", "/api/profiles PATCH", err);
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 502 },
    );
  }
}
