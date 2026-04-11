/**
 * Audit log helper — awaitable writes to the audit_log table with retry.
 * Import and call `await logAudit()` from any async API route handler.
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
  | "inventory_updated"
  | "fleet_truck_created"
  | "fleet_truck_updated"
  | "fleet_truck_decommissioned"
  | "accounting_period_close"
  | "accounting_period_lock"
  | "accounting_period_reopen"
  | "year_end_close"
  | "recurring_entry_created"
  | "recurring_entries_generated"
  | "recurring_entry_deleted"
  | "invoice_created"
  | "invoice_sent"
  | "invoice_payment_recorded"
  | "invoice_voided"
  | "bill_created"
  | "bill_payment_recorded"
  | "bill_voided"
  | "estimate_created"
  | "estimate_sent"
  | "estimate_accepted"
  | "estimate_rejected"
  | "estimate_expired"
  | "estimate_converted"
  | "estimate_deleted"
  | "estimate_voided"
  | "fixed_asset_created"
  | "fixed_asset_updated"
  | "fixed_asset_disposed"
  | "depreciation_run"
  | "expense_rule_created"
  | "expense_rule_updated"
  | "expense_rule_deleted"
  | "cc_transactions_imported"
  | "cc_transactions_categorized"
  | "cc_transactions_posted"
  | "report_generated"
  | "report_saved"
  | "report_updated"
  | "report_deleted"
  | "report_run"
  | "help_query"
  | "snapshot_captured"
  | "snapshot_deleted"
  | "import_completed"
  | "import_rolled_back"
  | "bank_reconciliation_completed";

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
 * Awaitable with one retry on failure (500ms delay).
 * If both attempts fail, logs to console (hits Vercel logs).
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  const user = await getAuditUser();
  if (!user) return;

  const sb = getSupabase();
  const row = {
    user_id: user.userId,
    user_name: user.userName,
    user_role: user.userRole,
    action: entry.action,
    truck_id: entry.truckId ?? null,
    details: entry.details ?? {},
  };

  const { error } = await sb.from("audit_log").insert(row);
  if (!error) return;

  // Retry once after 500ms
  await new Promise((r) => setTimeout(r, 500));
  const { error: retryError } = await sb.from("audit_log").insert(row);
  if (retryError) {
    console.error("[AUDIT] Failed after retry:", retryError.message);
  }
}

/**
 * Write an audit log entry with explicit user info (when you already have it).
 * Awaitable with one retry on failure (500ms delay).
 */
export async function logAuditDirect(
  userId: string,
  userName: string,
  userRole: string,
  entry: AuditEntry,
): Promise<void> {
  const sb = getSupabase();
  const row = {
    user_id: userId,
    user_name: userName,
    user_role: userRole,
    action: entry.action,
    truck_id: entry.truckId ?? null,
    details: entry.details ?? {},
  };

  const { error } = await sb.from("audit_log").insert(row);
  if (!error) return;

  await new Promise((r) => setTimeout(r, 500));
  const { error: retryError } = await sb.from("audit_log").insert(row);
  if (retryError) {
    console.error("[AUDIT] Failed after retry:", retryError.message);
  }
}
