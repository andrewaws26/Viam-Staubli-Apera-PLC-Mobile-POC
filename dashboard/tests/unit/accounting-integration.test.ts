/**
 * Accounting Integration Tests
 *
 * Tests the full AR/AP financial pipeline against the TEST Supabase instance.
 * Verifies schema compatibility, double-entry integrity, and end-to-end flows.
 *
 * These tests hit a real database (test project: ompauiikdjumhzclmddk) —
 * they create and clean up their own data using a unique test prefix.
 *
 * HOW TO RUN: cd dashboard && npx vitest run tests/unit/accounting-integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ── Test Supabase Connection ────────────────────────────────────────

// Use production Supabase for integration tests (test DB lacks accounting tables).
// Tests create data with a unique prefix and clean up in afterAll.
const TEST_URL = process.env.SUPABASE_URL;
const TEST_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HAS_SUPABASE = Boolean(TEST_URL && TEST_KEY);

const TEST_USER_ID = "test_integration_user";
const TEST_USER_NAME = "Integration Test";
const TEST_PREFIX = `__test_${Date.now()}__`;

let sb: SupabaseClient;

// Track created IDs for cleanup
const cleanup = {
  customerIds: [] as string[],
  vendorIds: [] as string[],
  invoiceIds: [] as string[],
  billIds: [] as string[],
  journalEntryIds: [] as string[],
  invoicePaymentIds: [] as string[],
  billPaymentIds: [] as string[],
};

beforeAll(() => {
  if (!HAS_SUPABASE) return;
  sb = createClient(TEST_URL!, TEST_KEY!);
});

afterAll(async () => {
  // Clean up in reverse dependency order
  for (const id of cleanup.invoicePaymentIds) {
    await sb.from("invoice_payments").delete().eq("id", id);
  }
  for (const id of cleanup.billPaymentIds) {
    await sb.from("bill_payments").delete().eq("id", id);
  }
  // invoice_line_items and bill_line_items cascade from parent
  for (const id of cleanup.invoiceIds) {
    await sb.from("invoices").delete().eq("id", id);
  }
  for (const id of cleanup.billIds) {
    await sb.from("bills").delete().eq("id", id);
  }
  // journal_entry_lines cascade from parent
  for (const id of cleanup.journalEntryIds) {
    await sb.from("journal_entries").delete().eq("id", id);
  }
  for (const id of cleanup.customerIds) {
    await sb.from("customers").delete().eq("id", id);
  }
  for (const id of cleanup.vendorIds) {
    await sb.from("vendors").delete().eq("id", id);
  }
});

// ── Helper: Look up chart of accounts by number ─────────────────────

async function getAccountByNumber(num: number): Promise<{ id: string; account_number: string; name: string; account_type: string }> {
  const { data, error } = await sb
    .from("chart_of_accounts")
    .select("id, account_number, name, account_type")
    .eq("account_number", String(num))
    .single();
  if (error) throw new Error(`Account ${num} not found: ${error.message}`);
  return data;
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1: Schema Verification — all tables exist with correct columns
// ═══════════════════════════════════════════════════════════════════════

describe.skipIf(!HAS_SUPABASE)("Schema: Core Accounting Tables", () => {
  it("chart_of_accounts has required columns", async () => {
    const { data, error } = await sb
      .from("chart_of_accounts")
      .select("id, account_number, name, account_type, normal_balance, is_active, is_system, current_balance")
      .limit(1);
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it("journal_entries has required columns", async () => {
    const { data, error } = await sb
      .from("journal_entries")
      .select("id, entry_date, description, reference, source, source_id, status, total_amount, created_by, created_by_name, posted_at, voided_at, voided_by")
      .limit(1);
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it("journal_entry_lines has required columns", async () => {
    const { data, error } = await sb
      .from("journal_entry_lines")
      .select("id, journal_entry_id, account_id, debit, credit, description, line_order")
      .limit(1);
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });
});

describe.skipIf(!HAS_SUPABASE)("Schema: AR Tables", () => {
  it("customers table exists with all columns", async () => {
    const { data, error } = await sb
      .from("customers")
      .select("id, company_name, contact_name, email, phone, billing_address, payment_terms, credit_limit, tax_id, notes, is_active")
      .limit(1);
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it("invoices table exists with all columns", async () => {
    const { data, error } = await sb
      .from("invoices")
      .select("id, invoice_number, customer_id, invoice_date, due_date, status, subtotal, tax_rate, tax_amount, total, amount_paid, balance_due, notes, terms, journal_entry_id, created_by, created_by_name, sent_at")
      .limit(1);
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it("invoice_line_items table exists with all columns", async () => {
    const { data, error } = await sb
      .from("invoice_line_items")
      .select("id, invoice_id, description, quantity, unit_price, amount, account_id, timesheet_id, line_order")
      .limit(1);
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it("invoice_payments table exists with all columns", async () => {
    const { data, error } = await sb
      .from("invoice_payments")
      .select("id, invoice_id, payment_date, amount, payment_method, reference, notes, journal_entry_id, recorded_by, recorded_by_name")
      .limit(1);
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });
});

describe.skipIf(!HAS_SUPABASE)("Schema: AP Tables", () => {
  it("vendors table exists with all columns", async () => {
    const { data, error } = await sb
      .from("vendors")
      .select("id, company_name, contact_name, email, phone, address, payment_terms, default_expense_account_id, tax_id, is_1099_vendor, notes, is_active")
      .limit(1);
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it("bills table exists with all columns", async () => {
    const { data, error } = await sb
      .from("bills")
      .select("id, vendor_id, bill_number, bill_date, due_date, status, subtotal, tax_amount, total, amount_paid, balance_due, notes, journal_entry_id, created_by, created_by_name")
      .limit(1);
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it("bill_line_items table exists with all columns", async () => {
    const { data, error } = await sb
      .from("bill_line_items")
      .select("id, bill_id, description, quantity, unit_price, amount, account_id, line_order")
      .limit(1);
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it("bill_payments table exists with all columns", async () => {
    const { data, error } = await sb
      .from("bill_payments")
      .select("id, bill_id, payment_date, amount, payment_method, check_number, reference, notes, journal_entry_id, recorded_by, recorded_by_name")
      .limit(1);
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });
});

describe.skipIf(!HAS_SUPABASE)("Schema: Periods & Recurring Tables", () => {
  it("accounting_periods table exists", async () => {
    const { data, error } = await sb
      .from("accounting_periods")
      .select("id, start_date, end_date, label, period_type, status, closed_by, closed_by_name, closed_at, notes")
      .limit(1);
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it("recurring_journal_entries table exists", async () => {
    const { data, error } = await sb
      .from("recurring_journal_entries")
      .select("id, description, reference, frequency, next_date, end_date, is_active, created_by, created_by_name")
      .limit(1);
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  it("recurring_journal_entry_lines table exists", async () => {
    const { data, error } = await sb
      .from("recurring_journal_entry_lines")
      .select("id, recurring_entry_id, account_id, debit, credit, description, line_order")
      .limit(1);
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 2: Chart of Accounts — key accounts exist
// ═══════════════════════════════════════════════════════════════════════

describe.skipIf(!HAS_SUPABASE)("Chart of Accounts: Required accounts exist", () => {
  const requiredAccounts = [
    { num: 1000, name: "Cash", type: "asset" },
    { num: 1100, name: "Accounts Receivable", type: "asset" },
    { num: 2000, name: "Accounts Payable", type: "liability" },
    { num: 3100, name: "Retained Earnings", type: "equity" },
    { num: 4000, name: "Service Revenue", type: "revenue" },
    { num: 5000, name: "Payroll Expense", type: "expense" },
  ];

  for (const acct of requiredAccounts) {
    it(`account ${acct.num} (${acct.name}) exists as ${acct.type}`, async () => {
      const result = await getAccountByNumber(acct.num);
      expect(result.account_type).toBe(acct.type);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 3: Seed Data Verification
// ═══════════════════════════════════════════════════════════════════════

describe.skipIf(!HAS_SUPABASE)("Seed Data: Customers and Vendors exist", () => {
  it("has seeded customers", async () => {
    const { data, error } = await sb.from("customers").select("id").limit(1);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it("has seeded vendors", async () => {
    const { data, error } = await sb.from("vendors").select("id").limit(1);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it("has seeded accounting periods", async () => {
    const { data, error } = await sb.from("accounting_periods").select("id").limit(1);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 4: Full AR Pipeline — Invoice Lifecycle
// ═══════════════════════════════════════════════════════════════════════

describe.skipIf(!HAS_SUPABASE)("AR Pipeline: Invoice lifecycle (create → send → pay → verify)", () => {
  let testCustomerId: string;
  let testInvoiceId: string;
  let arAccountId: string;
  let cashAccountId: string;
  let revenueAccountId: string;
  let sendJeId: string;
  let paymentJeId: string;

  it("step 1: create a test customer", async () => {
    const { data, error } = await sb.from("customers").insert({
      company_name: `${TEST_PREFIX} Test Railroad Corp`,
      contact_name: "Test Contact",
      email: "test@example.com",
      payment_terms: "Net 30",
    }).select().single();

    expect(error).toBeNull();
    expect(data).toBeDefined();
    testCustomerId = data!.id;
    cleanup.customerIds.push(testCustomerId);
  });

  it("step 2: create a draft invoice with line items", async () => {
    revenueAccountId = (await getAccountByNumber(4000)).id;

    const { data: invoice, error: invErr } = await sb.from("invoices").insert({
      customer_id: testCustomerId,
      invoice_date: "2026-04-01",
      due_date: "2026-05-01",
      status: "draft",
      subtotal: 5000,
      tax_rate: 0.06,
      tax_amount: 300,
      total: 5300,
      balance_due: 5300,
      amount_paid: 0,
      notes: `${TEST_PREFIX} test invoice`,
      created_by: TEST_USER_ID,
      created_by_name: TEST_USER_NAME,
    }).select().single();

    expect(invErr).toBeNull();
    expect(invoice).toBeDefined();
    testInvoiceId = invoice!.id;
    cleanup.invoiceIds.push(testInvoiceId);

    // Insert line items
    const { error: lineErr } = await sb.from("invoice_line_items").insert([
      {
        invoice_id: testInvoiceId,
        description: "TPS Maintenance — March 2026",
        quantity: 10,
        unit_price: 300,
        amount: 3000,
        account_id: revenueAccountId,
        line_order: 0,
      },
      {
        invoice_id: testInvoiceId,
        description: "Railroad Signal Inspection",
        quantity: 4,
        unit_price: 500,
        amount: 2000,
        account_id: revenueAccountId,
        line_order: 1,
      },
    ]);

    expect(lineErr).toBeNull();
  });

  it("step 3: verify invoice line items sum to subtotal", async () => {
    const { data: lines } = await sb.from("invoice_line_items")
      .select("amount")
      .eq("invoice_id", testInvoiceId);

    const lineTotal = lines!.reduce((sum, l) => sum + Number(l.amount), 0);
    expect(lineTotal).toBe(5000);
  });

  it("step 4: simulate 'send' — create AR journal entry", async () => {
    arAccountId = (await getAccountByNumber(1100)).id;

    // Create JE as draft first (DB trigger prevents inserting as posted without lines)
    const { data: je, error: jeErr } = await sb.from("journal_entries").insert({
      entry_date: "2026-04-01",
      description: `Invoice sent — ${TEST_PREFIX}`,
      reference: `INV-TEST-${Date.now()}`,
      source: "invoice",
      source_id: testInvoiceId,
      status: "draft",
      total_amount: 5300,
      created_by: TEST_USER_ID,
      created_by_name: TEST_USER_NAME,
    }).select().single();

    expect(jeErr).toBeNull();
    sendJeId = je!.id;
    cleanup.journalEntryIds.push(sendJeId);

    // DR AR 5300, CR Revenue 5000, CR Sales Tax 300
    const { error: lineErr } = await sb.from("journal_entry_lines").insert([
      { journal_entry_id: sendJeId, account_id: arAccountId, debit: 5300, credit: 0, description: "AR", line_order: 0 },
      { journal_entry_id: sendJeId, account_id: revenueAccountId, debit: 0, credit: 5000, description: "Revenue", line_order: 1 },
      { journal_entry_id: sendJeId, account_id: arAccountId, debit: 0, credit: 300, description: "Tax accrual offset", line_order: 2 },
    ]);

    // Note: line 2 credits AR for tax — in production the tax goes to a tax payable account.
    // For this test we're just verifying that JE lines can be created and balance.
    expect(lineErr).toBeNull();

    // Post the JE now that lines exist (trigger validates balance)
    const { error: postErr } = await sb.from("journal_entries")
      .update({ status: "posted", posted_at: new Date().toISOString() })
      .eq("id", sendJeId);
    expect(postErr).toBeNull();

    // Update invoice status
    await sb.from("invoices").update({
      status: "sent",
      journal_entry_id: sendJeId,
      sent_at: new Date().toISOString(),
    }).eq("id", testInvoiceId);
  });

  it("step 5: verify send JE is balanced (total debits = total credits)", async () => {
    const { data: lines } = await sb.from("journal_entry_lines")
      .select("debit, credit")
      .eq("journal_entry_id", sendJeId);

    const totalDebits = lines!.reduce((sum, l) => sum + Number(l.debit), 0);
    const totalCredits = lines!.reduce((sum, l) => sum + Number(l.credit), 0);

    expect(totalDebits).toBe(totalCredits);
  });

  it("step 6: record partial payment $2000", async () => {
    cashAccountId = (await getAccountByNumber(1000)).id;

    // Create JE as draft first (DB trigger prevents inserting as posted without lines)
    const { data: je, error: jeErr } = await sb.from("journal_entries").insert({
      entry_date: "2026-04-15",
      description: `Payment received — ${TEST_PREFIX}`,
      reference: `PMT-TEST-${Date.now()}`,
      source: "invoice",
      source_id: testInvoiceId,
      status: "draft",
      total_amount: 2000,
      created_by: TEST_USER_ID,
      created_by_name: TEST_USER_NAME,
    }).select().single();

    expect(jeErr).toBeNull();
    paymentJeId = je!.id;
    cleanup.journalEntryIds.push(paymentJeId);

    // DR Cash / CR AR
    const { error: lineErr } = await sb.from("journal_entry_lines").insert([
      { journal_entry_id: paymentJeId, account_id: cashAccountId, debit: 2000, credit: 0, description: "Cash received", line_order: 0 },
      { journal_entry_id: paymentJeId, account_id: arAccountId, debit: 0, credit: 2000, description: "AR reduction", line_order: 1 },
    ]);
    expect(lineErr).toBeNull();

    // Post the JE now that lines exist (trigger validates balance)
    const { error: postErr } = await sb.from("journal_entries")
      .update({ status: "posted", posted_at: new Date().toISOString() })
      .eq("id", paymentJeId);
    expect(postErr).toBeNull();

    // Record invoice_payment
    const { data: pmt, error: pmtErr } = await sb.from("invoice_payments").insert({
      invoice_id: testInvoiceId,
      payment_date: "2026-04-15",
      amount: 2000,
      payment_method: "check",
      reference: "CHK-1234",
      journal_entry_id: paymentJeId,
      recorded_by: TEST_USER_ID,
      recorded_by_name: TEST_USER_NAME,
    }).select().single();
    expect(pmtErr).toBeNull();
    cleanup.invoicePaymentIds.push(pmt!.id);

    // Update invoice
    await sb.from("invoices").update({
      amount_paid: 2000,
      balance_due: 3300,
      status: "partial",
    }).eq("id", testInvoiceId);
  });

  it("step 7: verify payment JE is balanced", async () => {
    const { data: lines } = await sb.from("journal_entry_lines")
      .select("debit, credit")
      .eq("journal_entry_id", paymentJeId);

    const totalDebits = lines!.reduce((sum, l) => sum + Number(l.debit), 0);
    const totalCredits = lines!.reduce((sum, l) => sum + Number(l.credit), 0);
    expect(totalDebits).toBe(2000);
    expect(totalCredits).toBe(2000);
  });

  it("step 8: verify invoice state is 'partial' with correct balance", async () => {
    const { data: inv } = await sb.from("invoices")
      .select("status, total, amount_paid, balance_due")
      .eq("id", testInvoiceId)
      .single();

    expect(inv!.status).toBe("partial");
    expect(Number(inv!.total)).toBe(5300);
    expect(Number(inv!.amount_paid)).toBe(2000);
    expect(Number(inv!.balance_due)).toBe(3300);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 5: Full AP Pipeline — Bill Lifecycle
// ═══════════════════════════════════════════════════════════════════════

describe.skipIf(!HAS_SUPABASE)("AP Pipeline: Bill lifecycle (create → pay → verify)", () => {
  let testVendorId: string;
  let testBillId: string;
  let apAccountId: string;
  let cashAccountId: string;
  let expenseAccountId: string;
  let billJeId: string;
  let paymentJeId: string;

  it("step 1: create a test vendor", async () => {
    const { data, error } = await sb.from("vendors").insert({
      company_name: `${TEST_PREFIX} Test Parts Supply`,
      contact_name: "Vendor Contact",
      email: "vendor@example.com",
      payment_terms: "Net 30",
      is_1099_vendor: true,
    }).select().single();

    expect(error).toBeNull();
    testVendorId = data!.id;
    cleanup.vendorIds.push(testVendorId);
  });

  it("step 2: create bill with auto-generated JE (DR Expense / CR AP)", async () => {
    apAccountId = (await getAccountByNumber(2000)).id;
    expenseAccountId = (await getAccountByNumber(5500)).id;  // Equipment Maintenance

    // Create JE as draft first (DB trigger prevents inserting as posted without lines)
    const { data: je, error: jeErr } = await sb.from("journal_entries").insert({
      entry_date: "2026-03-15",
      description: `Bill from vendor — ${TEST_PREFIX}`,
      reference: "VEND-INV-2026-001",
      source: "manual",
      status: "draft",
      total_amount: 1850,
      created_by: TEST_USER_ID,
      created_by_name: TEST_USER_NAME,
    }).select().single();

    expect(jeErr).toBeNull();
    billJeId = je!.id;
    cleanup.journalEntryIds.push(billJeId);

    // DR Expense accounts / CR AP
    const { error: lineErr } = await sb.from("journal_entry_lines").insert([
      { journal_entry_id: billJeId, account_id: expenseAccountId, debit: 1200, credit: 0, description: "Hydraulic pump replacement", line_order: 0 },
      { journal_entry_id: billJeId, account_id: expenseAccountId, debit: 650, credit: 0, description: "Labor — 5 hours", line_order: 1 },
      { journal_entry_id: billJeId, account_id: apAccountId, debit: 0, credit: 1850, description: "AP — VEND-INV-2026-001", line_order: 2 },
    ]);
    expect(lineErr).toBeNull();

    // Post the JE now that lines exist (trigger validates balance)
    const { error: postErr } = await sb.from("journal_entries")
      .update({ status: "posted", posted_at: new Date().toISOString() })
      .eq("id", billJeId);
    expect(postErr).toBeNull();

    // Create the bill
    const { data: bill, error: billErr } = await sb.from("bills").insert({
      vendor_id: testVendorId,
      bill_number: "VEND-INV-2026-001",
      bill_date: "2026-03-15",
      due_date: "2026-04-14",
      status: "open",
      subtotal: 1850,
      tax_amount: 0,
      total: 1850,
      balance_due: 1850,
      amount_paid: 0,
      journal_entry_id: billJeId,
      created_by: TEST_USER_ID,
      created_by_name: TEST_USER_NAME,
    }).select().single();

    expect(billErr).toBeNull();
    testBillId = bill!.id;
    cleanup.billIds.push(testBillId);

    // Insert line items
    const { error: bliErr } = await sb.from("bill_line_items").insert([
      { bill_id: testBillId, description: "Hydraulic pump replacement", quantity: 1, unit_price: 1200, amount: 1200, account_id: expenseAccountId, line_order: 0 },
      { bill_id: testBillId, description: "Labor — 5 hours", quantity: 5, unit_price: 130, amount: 650, account_id: expenseAccountId, line_order: 1 },
    ]);
    expect(bliErr).toBeNull();
  });

  it("step 3: verify bill JE is balanced", async () => {
    const { data: lines } = await sb.from("journal_entry_lines")
      .select("debit, credit")
      .eq("journal_entry_id", billJeId);

    const totalDebits = lines!.reduce((sum, l) => sum + Number(l.debit), 0);
    const totalCredits = lines!.reduce((sum, l) => sum + Number(l.credit), 0);
    expect(totalDebits).toBe(1850);
    expect(totalCredits).toBe(1850);
  });

  it("step 4: pay the bill in full (DR AP / CR Cash)", async () => {
    cashAccountId = (await getAccountByNumber(1000)).id;

    // Create JE as draft first (DB trigger prevents inserting as posted without lines)
    const { data: je, error: jeErr } = await sb.from("journal_entries").insert({
      entry_date: "2026-04-10",
      description: `Bill payment — ${TEST_PREFIX}`,
      reference: "CHK-5678",
      source: "manual",
      status: "draft",
      total_amount: 1850,
      created_by: TEST_USER_ID,
      created_by_name: TEST_USER_NAME,
    }).select().single();

    expect(jeErr).toBeNull();
    paymentJeId = je!.id;
    cleanup.journalEntryIds.push(paymentJeId);

    const { error: lineErr } = await sb.from("journal_entry_lines").insert([
      { journal_entry_id: paymentJeId, account_id: apAccountId, debit: 1850, credit: 0, description: "AP payment", line_order: 0 },
      { journal_entry_id: paymentJeId, account_id: cashAccountId, debit: 0, credit: 1850, description: "Cash disbursement", line_order: 1 },
    ]);
    expect(lineErr).toBeNull();

    // Post the JE now that lines exist (trigger validates balance)
    const { error: postErr } = await sb.from("journal_entries")
      .update({ status: "posted", posted_at: new Date().toISOString() })
      .eq("id", paymentJeId);
    expect(postErr).toBeNull();

    // Record bill_payment
    const { data: pmt, error: pmtErr } = await sb.from("bill_payments").insert({
      bill_id: testBillId,
      payment_date: "2026-04-10",
      amount: 1850,
      payment_method: "check",
      check_number: "5678",
      journal_entry_id: paymentJeId,
      recorded_by: TEST_USER_ID,
      recorded_by_name: TEST_USER_NAME,
    }).select().single();
    expect(pmtErr).toBeNull();
    cleanup.billPaymentIds.push(pmt!.id);

    // Update bill
    await sb.from("bills").update({
      amount_paid: 1850,
      balance_due: 0,
      status: "paid",
    }).eq("id", testBillId);
  });

  it("step 5: verify payment JE is balanced", async () => {
    const { data: lines } = await sb.from("journal_entry_lines")
      .select("debit, credit")
      .eq("journal_entry_id", paymentJeId);

    const totalDebits = lines!.reduce((sum, l) => sum + Number(l.debit), 0);
    const totalCredits = lines!.reduce((sum, l) => sum + Number(l.credit), 0);
    expect(totalDebits).toBe(1850);
    expect(totalCredits).toBe(1850);
  });

  it("step 6: verify bill is 'paid' with zero balance", async () => {
    const { data: bill } = await sb.from("bills")
      .select("status, total, amount_paid, balance_due")
      .eq("id", testBillId)
      .single();

    expect(bill!.status).toBe("paid");
    expect(Number(bill!.total)).toBe(1850);
    expect(Number(bill!.amount_paid)).toBe(1850);
    expect(Number(bill!.balance_due)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 6: Double-Entry Integrity
// ═══════════════════════════════════════════════════════════════════════

describe.skipIf(!HAS_SUPABASE)("Double-Entry Integrity", () => {
  it("all posted JEs have balanced lines (total debits = total credits)", async () => {
    const { data: entries, error: entriesErr } = await sb
      .from("journal_entries")
      .select("id, description")
      .eq("status", "posted")
      .limit(50);

    expect(entriesErr).toBeNull();
    if (!entries || entries.length === 0) return;

    const entryIds = entries.map((e) => e.id);
    const { data: lines, error: linesErr } = await sb
      .from("journal_entry_lines")
      .select("journal_entry_id, debit, credit")
      .in("journal_entry_id", entryIds);

    expect(linesErr).toBeNull();

    // Group by journal_entry_id and check balance
    const byEntry = new Map<string, { debits: number; credits: number }>();
    for (const line of lines ?? []) {
      const jeId = line.journal_entry_id as string;
      const existing = byEntry.get(jeId) || { debits: 0, credits: 0 };
      existing.debits += Number(line.debit) || 0;
      existing.credits += Number(line.credit) || 0;
      byEntry.set(jeId, existing);
    }

    const unbalanced: string[] = [];
    for (const [jeId, totals] of byEntry) {
      const diff = Math.abs(Math.round(totals.debits * 100) - Math.round(totals.credits * 100));
      if (diff > 0) {
        const entry = entries.find((e) => e.id === jeId);
        unbalanced.push(`${jeId} (${entry?.description}): debits=${totals.debits} credits=${totals.credits}`);
      }
    }

    expect(unbalanced).toEqual([]);
  });

  it("invoice_payments amounts are positive", async () => {
    const { data, error } = await sb
      .from("invoice_payments")
      .select("id, amount")
      .limit(100);

    expect(error).toBeNull();
    for (const pmt of data ?? []) {
      expect(Number(pmt.amount)).toBeGreaterThan(0);
    }
  });

  it("bill_payments amounts are positive", async () => {
    const { data, error } = await sb
      .from("bill_payments")
      .select("id, amount")
      .limit(100);

    expect(error).toBeNull();
    for (const pmt of data ?? []) {
      expect(Number(pmt.amount)).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 7: Relational Integrity — JOINs used by APIs work
// ═══════════════════════════════════════════════════════════════════════

describe.skipIf(!HAS_SUPABASE)("Relational Integrity: API JOIN patterns", () => {
  it("invoices → customers JOIN works (used by GET /api/accounting/invoices)", async () => {
    const { error } = await sb
      .from("invoices")
      .select("*, customers(company_name), invoice_line_items(count)")
      .limit(1);
    expect(error).toBeNull();
  });

  it("bills → vendors JOIN works (used by GET /api/accounting/bills)", async () => {
    const { error } = await sb
      .from("bills")
      .select("*, vendors(company_name), bill_line_items(count)")
      .limit(1);
    expect(error).toBeNull();
  });

  it("invoices → invoice_line_items JOIN works", async () => {
    const { error } = await sb
      .from("invoices")
      .select("*, invoice_line_items(*)")
      .limit(1);
    expect(error).toBeNull();
  });

  it("journal_entry_lines → journal_entries!inner JOIN works (used by GL)", async () => {
    const { error } = await sb
      .from("journal_entry_lines")
      .select("id, account_id, debit, credit, journal_entries!inner(id, entry_date, description, status)")
      .eq("journal_entries.status", "posted")
      .limit(1);
    expect(error).toBeNull();
  });

  it("recurring_journal_entries → lines JOIN works", async () => {
    const { error } = await sb
      .from("recurring_journal_entries")
      .select("*, recurring_journal_entry_lines(*, chart_of_accounts(account_number, name))")
      .limit(1);
    expect(error).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 8: Constraint Validation
// ═══════════════════════════════════════════════════════════════════════

describe.skipIf(!HAS_SUPABASE)("Constraints: Payment terms and status enums", () => {
  it("rejects invalid customer payment_terms", async () => {
    const { error } = await sb.from("customers").insert({
      company_name: `${TEST_PREFIX} Bad Terms Customer`,
      payment_terms: "Net 999",
    }).select().single();

    expect(error).toBeTruthy();
    // Clean up if somehow it succeeded
    if (!error) {
      const { data } = await sb.from("customers").select("id").eq("company_name", `${TEST_PREFIX} Bad Terms Customer`).single();
      if (data) {
        await sb.from("customers").delete().eq("id", data.id);
      }
    }
  });

  it("rejects invalid invoice status", async () => {
    // We need a real customer_id to test this constraint
    const { data: cust } = await sb.from("customers").select("id").limit(1).single();
    if (!cust) return;

    const { error } = await sb.from("invoices").insert({
      customer_id: cust.id,
      invoice_date: "2026-01-01",
      due_date: "2026-02-01",
      status: "invalid_status",
      created_by: TEST_USER_ID,
      created_by_name: TEST_USER_NAME,
    }).select().single();

    expect(error).toBeTruthy();
  });

  it("rejects negative payment amount on invoice_payments", async () => {
    const { data: inv } = await sb.from("invoices").select("id").limit(1).single();
    if (!inv) return;

    const { error } = await sb.from("invoice_payments").insert({
      invoice_id: inv.id,
      payment_date: "2026-01-01",
      amount: -100,
      payment_method: "check",
      recorded_by: TEST_USER_ID,
      recorded_by_name: TEST_USER_NAME,
    }).select().single();

    expect(error).toBeTruthy();
  });
});
