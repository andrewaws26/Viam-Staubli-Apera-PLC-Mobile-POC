/**
 * Accounting types for IronSight Company OS.
 *
 * Double-entry bookkeeping foundation:
 *   1. Chart of Accounts (COA) — categorized ledger accounts
 *   2. Journal Entries — debit/credit line items that always balance
 *   3. Auto-generated entries from timesheets, per diem, expenses
 *
 * Normal balance convention:
 *   - Assets & Expenses → DEBIT normal (increase with debits)
 *   - Liabilities, Equity, Revenue → CREDIT normal (increase with credits)
 *
 * Every transaction posts exactly balanced debit/credit lines.
 * The system never allows an unbalanced journal entry.
 */

// ── Account Types ────────────────────────────────────────────────────

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type NormalBalance = 'debit' | 'credit';
export type JournalEntryStatus = 'draft' | 'posted' | 'voided';

/**
 * Source that auto-generated a journal entry.
 * "manual" = user-created; others = system-generated from module events.
 */
export type JournalEntrySource =
  | 'manual'
  | 'timesheet_approved'
  | 'per_diem'
  | 'expense_approved'
  | 'payroll'
  | 'invoice'
  | 'adjustment';

// ── Chart of Accounts ────────────────────────────────────────────────

export interface Account {
  id: string;
  account_number: string;
  name: string;
  account_type: AccountType;
  normal_balance: NormalBalance;
  description: string | null;
  parent_id: string | null;
  is_active: boolean;
  is_system: boolean;
  current_balance: number;
  created_at: string;
  updated_at: string;
}

export interface CreateAccountPayload {
  account_number: string;
  name: string;
  account_type: AccountType;
  description?: string;
  parent_id?: string;
}

export interface UpdateAccountPayload {
  name?: string;
  description?: string;
  is_active?: boolean;
  parent_id?: string | null;
}

// ── Journal Entries ──────────────────────────────────────────────────

export interface JournalEntry {
  id: string;
  entry_date: string;
  description: string;
  reference: string | null;
  source: JournalEntrySource;
  source_id: string | null;
  status: JournalEntryStatus;
  total_amount: number;
  created_by: string;
  created_by_name: string;
  posted_at: string | null;
  voided_at: string | null;
  voided_by: string | null;
  voided_reason: string | null;
  lines: JournalEntryLine[];
  created_at: string;
  updated_at: string;
}

export interface JournalEntryLine {
  id: string;
  journal_entry_id: string;
  account_id: string;
  account_number?: string;
  account_name?: string;
  debit: number;
  credit: number;
  description: string | null;
  line_order: number;
}

export interface CreateJournalEntryPayload {
  entry_date: string;
  description: string;
  reference?: string;
  source?: JournalEntrySource;
  source_id?: string;
  lines: {
    account_id: string;
    debit: number;
    credit: number;
    description?: string;
  }[];
}

export interface VoidJournalEntryPayload {
  reason: string;
}

// ── Trial Balance & Reports ──────────────────────────────────────────

export interface TrialBalanceRow {
  account_id: string;
  account_number: string;
  account_name: string;
  account_type: AccountType;
  debit_total: number;
  credit_total: number;
  balance: number;
}

export interface TrialBalanceSummary {
  rows: TrialBalanceRow[];
  total_debits: number;
  total_credits: number;
  is_balanced: boolean;
  as_of_date: string;
}

// ── Constants ────────────────────────────────────────────────────────

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  revenue: 'Revenue',
  expense: 'Expense',
};

export const ACCOUNT_TYPE_NORMAL_BALANCE: Record<AccountType, NormalBalance> = {
  asset: 'debit',
  liability: 'credit',
  equity: 'credit',
  revenue: 'credit',
  expense: 'debit',
};

export const JOURNAL_STATUS_LABELS: Record<JournalEntryStatus, string> = {
  draft: 'Draft',
  posted: 'Posted',
  voided: 'Voided',
};

export const JOURNAL_SOURCE_LABELS: Record<JournalEntrySource, string> = {
  manual: 'Manual Entry',
  timesheet_approved: 'Timesheet Approved',
  per_diem: 'Per Diem',
  expense_approved: 'Expense Approved',
  payroll: 'Payroll',
  invoice: 'Invoice',
  adjustment: 'Adjustment',
};

/** Standard account number ranges by type. */
export const ACCOUNT_NUMBER_RANGES: Record<AccountType, { min: number; max: number; label: string }> = {
  asset: { min: 1000, max: 1999, label: '1000-1999' },
  liability: { min: 2000, max: 2999, label: '2000-2999' },
  equity: { min: 3000, max: 3999, label: '3000-3999' },
  revenue: { min: 4000, max: 4999, label: '4000-4999' },
  expense: { min: 5000, max: 9999, label: '5000-9999' },
};

export const ACCOUNT_TYPE_COLORS: Record<AccountType, string> = {
  asset: '#3b82f6',
  liability: '#f59e0b',
  equity: '#8b5cf6',
  revenue: '#22c55e',
  expense: '#ef4444',
};
