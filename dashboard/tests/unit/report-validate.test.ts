/**
 * SQL Validation Tests for the Report Generator
 *
 * Tests the app-level SQL validation that runs BEFORE queries hit the database.
 * The validateSQL function is the first safety gate — it must:
 *   1. Allow all legitimate SELECT queries Claude generates
 *   2. Block every mutation, privilege escalation, and system access attempt
 *
 * WHY THIS MATTERS:
 * If validation is too strict (false positives), the report generator breaks
 * for users — this was the original bug where "created_at" triggered "create".
 * If validation is too loose, an attacker could mutate data via prompt injection.
 *
 * HOW TO RUN: cd dashboard && npx vitest run tests/unit/report-validate.test.ts
 */

import { describe, it, expect } from "vitest";
import { validateSQL } from "@/lib/report-validate";

// ── Valid Queries ─────────────────────────────────────────────────

describe("validateSQL: accepts valid queries", () => {
  it("simple SELECT", () => {
    expect(validateSQL("SELECT * FROM customers LIMIT 100")).toEqual({ valid: true });
  });

  it("SELECT with joins", () => {
    const sql = `SELECT c.company_name, SUM(i.total_amount)
FROM customers c JOIN invoices i ON i.customer_id = c.id
GROUP BY c.company_name`;
    expect(validateSQL(sql)).toEqual({ valid: true });
  });

  it("CTE (WITH clause)", () => {
    const sql = `WITH overdue AS (SELECT * FROM invoices WHERE due_date < CURRENT_DATE) SELECT * FROM overdue LIMIT 500`;
    expect(validateSQL(sql)).toEqual({ valid: true });
  });

  it("lowercase select", () => {
    expect(validateSQL("select id, name from customers")).toEqual({ valid: true });
  });

  it("mixed case SELECT", () => {
    expect(validateSQL("Select id From fleet_trucks")).toEqual({ valid: true });
  });
});

// ── Word-Boundary Edge Cases (THE BUG THAT WAS FIXED) ────────────
// These tests verify that column names containing SQL keywords as
// substrings are NOT blocked. This was the original bug:
// "created_at" contains "create", "updated_at" contains "update", etc.

describe("validateSQL: word-boundary safety (column names with keyword substrings)", () => {
  it("allows created_at column", () => {
    expect(validateSQL("SELECT id, name, created_at FROM fleet_trucks LIMIT 10")).toEqual({ valid: true });
  });

  it("allows updated_at column", () => {
    expect(validateSQL("SELECT id, updated_at FROM work_orders")).toEqual({ valid: true });
  });

  it("allows is_deleted column", () => {
    expect(validateSQL("SELECT * FROM chat_messages WHERE is_deleted = false")).toEqual({ valid: true });
  });

  it("allows created_by column", () => {
    expect(validateSQL("SELECT created_by, COUNT(*) FROM work_orders GROUP BY created_by")).toEqual({ valid: true });
  });

  it("allows columns like 'execution_time'", () => {
    expect(validateSQL("SELECT prompt, execution_time_ms FROM saved_reports")).toEqual({ valid: true });
  });

  it("allows 'alterations' or 'altered' in aliases/strings", () => {
    expect(validateSQL("SELECT id, 'altered' as note FROM fleet_trucks")).toEqual({ valid: true });
  });

  it("allows 'dropoff_location' column", () => {
    expect(validateSQL("SELECT dropoff_location FROM deliveries LIMIT 10")).toEqual({ valid: true });
  });

  it("allows 'inserted_at' column", () => {
    expect(validateSQL("SELECT inserted_at FROM audit_log LIMIT 10")).toEqual({ valid: true });
  });

  it("allows 'copyable' or 'copied' in context", () => {
    expect(validateSQL("SELECT copied_from FROM templates LIMIT 10")).toEqual({ valid: true });
  });

  it("allows 'granted_at' column", () => {
    expect(validateSQL("SELECT granted_at FROM permissions LIMIT 10")).toEqual({ valid: true });
  });
});

// ── Realistic Claude-Generated Queries ───────────────────────────
// These are queries Claude actually generates for the report generator.

describe("validateSQL: realistic Claude-generated queries", () => {
  it("fleet truck listing with timestamps", () => {
    const sql = `SELECT ft.name, ft.make, ft.model, ft.year, ft.status,
       to_char(ft.created_at, 'YYYY-MM-DD') as added_on,
       to_char(ft.updated_at, 'YYYY-MM-DD') as last_updated
FROM fleet_trucks ft
WHERE ft.status = 'active'
ORDER BY ft.name LIMIT 500`;
    expect(validateSQL(sql)).toEqual({ valid: true });
  });

  it("work orders with creator info", () => {
    const sql = `SELECT wo.title, wo.status, wo.priority, wo.created_by,
       to_char(wo.created_at, 'YYYY-MM-DD') as created_date,
       to_char(wo.updated_at, 'YYYY-MM-DD') as last_updated
FROM work_orders wo
ORDER BY wo.created_at DESC LIMIT 500`;
    expect(validateSQL(sql)).toEqual({ valid: true });
  });

  it("timesheet with approval info", () => {
    const sql = `SELECT ep.first_name || ' ' || ep.last_name as employee,
       t.status, t.week_ending, t.approved_by,
       to_char(t.created_at, 'YYYY-MM-DD') as submitted
FROM timesheets t
JOIN employee_profiles ep ON ep.user_id = t.user_id
WHERE t.status = 'submitted'
ORDER BY t.created_at DESC LIMIT 500`;
    expect(validateSQL(sql)).toEqual({ valid: true });
  });

  it("chat messages filtering deleted", () => {
    const sql = `SELECT cm.content, cm.user_name, cm.is_deleted,
       to_char(cm.created_at, 'YYYY-MM-DD HH24:MI') as sent_at
FROM chat_messages cm
WHERE cm.is_deleted = false
ORDER BY cm.created_at DESC LIMIT 100`;
    expect(validateSQL(sql)).toEqual({ valid: true });
  });

  it("invoices with customer and creator", () => {
    const sql = `SELECT i.invoice_number, c.company_name as customer,
       i.total_amount, i.balance_due, i.status,
       i.created_by, to_char(i.created_at, 'YYYY-MM-DD') as created_date
FROM invoices i
JOIN customers c ON c.id = i.customer_id
WHERE i.balance_due > 0
ORDER BY i.balance_due DESC LIMIT 500`;
    expect(validateSQL(sql)).toEqual({ valid: true });
  });

  it("CTE with aggregation", () => {
    const sql = `WITH monthly AS (
  SELECT date_trunc('month', created_at) as month,
         COUNT(*) as count
  FROM work_orders
  GROUP BY date_trunc('month', created_at)
)
SELECT to_char(month, 'YYYY-MM') as period, count
FROM monthly ORDER BY month DESC LIMIT 24`;
    expect(validateSQL(sql)).toEqual({ valid: true });
  });
});

// ── Must Start with SELECT or WITH ──────────────────────────────

describe("validateSQL: rejects non-SELECT queries", () => {
  it("rejects EXPLAIN", () => {
    expect(validateSQL("EXPLAIN SELECT 1").valid).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validateSQL("").valid).toBe(false);
  });

  it("rejects INSERT", () => {
    expect(validateSQL("INSERT INTO customers VALUES ('x')").valid).toBe(false);
  });

  it("rejects UPDATE", () => {
    expect(validateSQL("UPDATE customers SET name = 'x'").valid).toBe(false);
  });

  it("rejects DELETE", () => {
    expect(validateSQL("DELETE FROM customers").valid).toBe(false);
  });
});

// ── Mutation Keywords ───────────────────────────────────────────

describe("validateSQL: blocks standalone mutation keywords", () => {
  it("rejects semicolon + INSERT", () => {
    expect(validateSQL("SELECT 1; INSERT INTO customers VALUES ('x')").valid).toBe(false);
  });

  it("rejects standalone UPDATE keyword", () => {
    expect(validateSQL("SELECT * FROM customers WHERE update = 1").valid).toBe(false);
  });

  it("rejects standalone DELETE keyword", () => {
    expect(validateSQL("SELECT * FROM customers WHERE delete = true").valid).toBe(false);
  });

  it("rejects DROP TABLE", () => {
    expect(validateSQL("SELECT 1; DROP TABLE customers").valid).toBe(false);
  });

  it("rejects ALTER TABLE", () => {
    expect(validateSQL("SELECT 1; ALTER TABLE customers ADD COLUMN x TEXT").valid).toBe(false);
  });

  it("rejects CREATE TABLE", () => {
    expect(validateSQL("SELECT 1; CREATE TABLE evil (id int)").valid).toBe(false);
  });

  it("rejects TRUNCATE", () => {
    expect(validateSQL("SELECT 1; TRUNCATE customers").valid).toBe(false);
  });
});

// ── Privilege & System Access ───────────────────────────────────

describe("validateSQL: blocks privilege escalation and system access", () => {
  it("rejects GRANT", () => {
    expect(validateSQL("SELECT 1; GRANT ALL ON customers TO public").valid).toBe(false);
  });

  it("rejects REVOKE", () => {
    expect(validateSQL("SELECT 1; REVOKE ALL ON customers FROM public").valid).toBe(false);
  });

  it("rejects pg_catalog access", () => {
    expect(validateSQL("SELECT * FROM pg_catalog.pg_tables").valid).toBe(false);
  });

  it("rejects information_schema access", () => {
    expect(validateSQL("SELECT * FROM information_schema.tables").valid).toBe(false);
  });

  it("rejects pg_read_file", () => {
    expect(validateSQL("SELECT pg_read_file('/etc/passwd')").valid).toBe(false);
  });

  it("rejects SET ROLE", () => {
    expect(validateSQL("SELECT 1; SET ROLE postgres").valid).toBe(false);
  });

  it("rejects SET SESSION", () => {
    expect(validateSQL("SELECT 1; SET SESSION authorization postgres").valid).toBe(false);
  });
});

// ── Multi-Statement Injection ───────────────────────────────────

describe("validateSQL: blocks multi-statement injection", () => {
  it("rejects trailing semicolons followed by statements", () => {
    expect(validateSQL("SELECT 1; DROP TABLE customers").valid).toBe(false);
  });

  it("rejects trailing semicolons alone", () => {
    expect(validateSQL("SELECT 1;").valid).toBe(false);
  });

  it("rejects case-insensitive injection", () => {
    expect(validateSQL("SELECT 1; Insert INTO foo VALUES (1)").valid).toBe(false);
  });

  it("rejects mixed case injection", () => {
    expect(validateSQL("SELECT 1; Drop Table foo").valid).toBe(false);
  });
});
