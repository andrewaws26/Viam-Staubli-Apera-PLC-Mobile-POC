import { describe, it, expect } from "vitest";
import { validateSQL } from "@/lib/report-validate";

describe("validateSQL", () => {
  // Valid queries
  it("accepts simple SELECT", () => {
    expect(validateSQL("SELECT * FROM customers LIMIT 100")).toEqual({ valid: true });
  });

  it("accepts SELECT with joins", () => {
    const sql = `SELECT c.company_name, SUM(i.total_amount) FROM customers c JOIN invoices i ON i.customer_id = c.id GROUP BY c.company_name`;
    expect(validateSQL(sql)).toEqual({ valid: true });
  });

  it("accepts CTE (WITH clause)", () => {
    const sql = `WITH overdue AS (SELECT * FROM invoices WHERE due_date < CURRENT_DATE) SELECT * FROM overdue LIMIT 500`;
    expect(validateSQL(sql)).toEqual({ valid: true });
  });

  it("accepts lowercase select", () => {
    expect(validateSQL("select id, name from customers")).toEqual({ valid: true });
  });

  // Must start with SELECT or WITH
  it("rejects queries not starting with SELECT or WITH", () => {
    expect(validateSQL("EXPLAIN SELECT 1").valid).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validateSQL("").valid).toBe(false);
  });

  // Mutation keywords
  it("rejects INSERT", () => {
    expect(validateSQL("SELECT 1; INSERT INTO customers VALUES ('x')").valid).toBe(false);
  });

  it("rejects UPDATE", () => {
    expect(validateSQL("SELECT * FROM customers WHERE update = 1").valid).toBe(false);
  });

  it("rejects DELETE", () => {
    expect(validateSQL("SELECT * FROM customers WHERE delete = true").valid).toBe(false);
  });

  it("rejects DROP", () => {
    expect(validateSQL("SELECT 1; DROP TABLE customers").valid).toBe(false);
  });

  it("rejects ALTER", () => {
    expect(validateSQL("SELECT 1; ALTER TABLE customers ADD COLUMN x TEXT").valid).toBe(false);
  });

  it("rejects CREATE", () => {
    expect(validateSQL("SELECT 1; CREATE TABLE evil (id int)").valid).toBe(false);
  });

  it("rejects TRUNCATE", () => {
    expect(validateSQL("SELECT 1; TRUNCATE customers").valid).toBe(false);
  });

  // Privilege escalation
  it("rejects GRANT", () => {
    expect(validateSQL("SELECT 1; GRANT ALL ON customers TO public").valid).toBe(false);
  });

  it("rejects REVOKE", () => {
    expect(validateSQL("SELECT 1; REVOKE ALL ON customers FROM public").valid).toBe(false);
  });

  // System access
  it("rejects pg_catalog access", () => {
    expect(validateSQL("SELECT * FROM pg_catalog.pg_tables").valid).toBe(false);
  });

  it("rejects information_schema access", () => {
    expect(validateSQL("SELECT * FROM information_schema.tables").valid).toBe(false);
  });

  it("rejects pg_read_file", () => {
    expect(validateSQL("SELECT pg_read_file('/etc/passwd')").valid).toBe(false);
  });

  // Multi-statement injection
  it("rejects trailing semicolons followed by statements", () => {
    expect(validateSQL("SELECT 1; DROP TABLE customers").valid).toBe(false);
  });

  // SET commands
  it("rejects SET ROLE", () => {
    expect(validateSQL("SELECT 1; SET ROLE postgres").valid).toBe(false);
  });

  it("rejects SET SESSION", () => {
    expect(validateSQL("SELECT 1; SET SESSION authorization postgres").valid).toBe(false);
  });

  // Case insensitivity
  it("rejects case-insensitive INSERT", () => {
    expect(validateSQL("SELECT 1; INSERT INTO foo VALUES (1)").valid).toBe(false);
  });

  it("rejects mixed case DROP", () => {
    expect(validateSQL("SELECT 1; Drop Table foo").valid).toBe(false);
  });
});
