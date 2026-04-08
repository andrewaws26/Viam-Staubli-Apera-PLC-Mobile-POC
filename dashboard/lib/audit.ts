/**
 * Audit log helper — fire-and-forget writes to the audit_log table.
 * Import and call logAudit() from any API route.
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { getSupabase } from "./supabase";

export type AuditAction =
  | "dtc_clear"
  | "plc_command"
  | "role_change"
  | "ai_diagnosis"
  | "ai_chat"
  | "note_created"
  | "note_deleted"
  | "assignment_created"
  | "assignment_deleted"
  | "maintenance_logged"
  | "maintenance_deleted"
  | "work_order_created"
  | "work_order_updated"
  | "work_order_deleted"
  | "timesheet_created"
  | "timesheet_updated"
  | "timesheet_submitted"
  | "timesheet_approved"
  | "timesheet_rejected"
  | "profile_updated"
  | "profile_picture_uploaded"
  | "pto_requested"
  | "pto_approved"
  | "pto_rejected"
  | "pto_cancelled"
  | "training_recorded"
  | "training_deleted"
  | "per_diem_rate_updated"
  | "account_created"
  | "account_updated"
  | "account_deactivated"
  | "journal_entry_created"
  | "journal_entry_posted"
  | "journal_entry_voided"
  | "journal_entry_deleted"
  | "inventory_updated";

interface AuditEntry {
  action: AuditAction;
  truckId?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Get current user info from Clerk for audit logging.
 * Returns null if not authenticated.
 */
async function getAuditUser(): Promise<{
  userId: string;
  userName: string;
  userRole: string;
} | null> {
  try {
    const { userId } = await auth();
    if (!userId) return null;
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const name = user.firstName
      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
      : user.emailAddresses?.[0]?.emailAddress ?? "Unknown";
    const role = (user.publicMetadata as Record<string, unknown>)?.role as string || "operator";
    return { userId, userName: name, userRole: role };
  } catch {
    return null;
  }
}

/**
 * Write an audit log entry for the current authenticated user.
 * Non-blocking — errors are logged but never thrown.
 */
export function logAudit(entry: AuditEntry): void {
  getAuditUser().then((user) => {
    if (!user) return;
    const sb = getSupabase();
    sb.from("audit_log")
      .insert({
        user_id: user.userId,
        user_name: user.userName,
        user_role: user.userRole,
        action: entry.action,
        truck_id: entry.truckId ?? null,
        details: entry.details ?? {},
      })
      .then(({ error }) => {
        if (error) console.error("[AUDIT-ERROR]", error.message);
      });
  });
}

/**
 * Write an audit log entry with explicit user info (when you already have it).
 * Non-blocking — errors are logged but never thrown.
 */
export function logAuditDirect(
  userId: string,
  userName: string,
  userRole: string,
  entry: AuditEntry,
): void {
  const sb = getSupabase();
  sb.from("audit_log")
    .insert({
      user_id: userId,
      user_name: userName,
      user_role: userRole,
      action: entry.action,
      truck_id: entry.truckId ?? null,
      details: entry.details ?? {},
    })
    .then(({ error }) => {
      if (error) console.error("[AUDIT-ERROR]", error.message);
    });
}
