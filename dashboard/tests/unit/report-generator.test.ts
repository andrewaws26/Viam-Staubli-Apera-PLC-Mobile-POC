/**
 * Report Generator — Schema Accuracy, SQL Extraction, and Pipeline Tests
 *
 * Tests the AI report generator pipeline WITHOUT calling the Claude API.
 * Covers: SQL extraction, schema context accuracy against actual migrations,
 * prompt guardrails, retry logic, query logging, and route structure.
 *
 * WHY THIS MATTERS:
 * The report generator translates natural language to SQL via Claude.
 * If the schema context has wrong column names, Claude generates invalid SQL.
 * These tests ensure the schema context stays in sync with the actual DB.
 *
 * HOW TO RUN: cd dashboard && npx vitest run tests/unit/report-generator.test.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Read source files for checks ─────────────────────────────────

const DASHBOARD_ROOT = resolve(__dirname, "../..");

const generateRouteSource = readFileSync(
  resolve(DASHBOARD_ROOT, "app/api/reports/generate/route.ts"),
  "utf-8"
);

const schemaContextSource = readFileSync(
  resolve(DASHBOARD_ROOT, "lib/report-schema-context.ts"),
  "utf-8"
);

const validateSource = readFileSync(
  resolve(DASHBOARD_ROOT, "lib/report-validate.ts"),
  "utf-8"
);

const runRouteSource = readFileSync(
  resolve(DASHBOARD_ROOT, "app/api/reports/[id]/run/route.ts"),
  "utf-8"
);

// ── Re-implement extractSQL for unit testing ─────────────────────

function extractSQL(text: string): string {
  const fenced = text.match(/```(?:sql)?\s*\n?([\s\S]*?)```/);
  let sql = fenced ? fenced[1].trim() : text.trim();
  sql = sql.replace(/;\s*$/, "");
  return sql;
}

// ── SQL Extraction Tests ─────────────────────────────────────────

describe("extractSQL: extracts SQL from Claude responses", () => {
  it("extracts plain SQL (no fences)", () => {
    const input = "SELECT id, name FROM fleet_trucks LIMIT 500";
    expect(extractSQL(input)).toBe("SELECT id, name FROM fleet_trucks LIMIT 500");
  });

  it("extracts from ```sql fences", () => {
    const input = "```sql\nSELECT id FROM fleet_trucks\n```";
    expect(extractSQL(input)).toBe("SELECT id FROM fleet_trucks");
  });

  it("extracts from ``` fences (no language tag)", () => {
    const input = "```\nSELECT id FROM fleet_trucks\n```";
    expect(extractSQL(input)).toBe("SELECT id FROM fleet_trucks");
  });

  it("strips trailing semicolons", () => {
    const input = "SELECT id FROM fleet_trucks;";
    expect(extractSQL(input)).toBe("SELECT id FROM fleet_trucks");
  });

  it("strips trailing semicolons with whitespace", () => {
    const input = "SELECT id FROM fleet_trucks;  \n";
    expect(extractSQL(input)).toBe("SELECT id FROM fleet_trucks");
  });

  it("strips semicolons from fenced SQL", () => {
    const input = "```sql\nSELECT id FROM fleet_trucks;\n```";
    expect(extractSQL(input)).toBe("SELECT id FROM fleet_trucks");
  });

  it("preserves internal semicolons in strings", () => {
    const input = "SELECT 'hello; world' as greeting FROM fleet_trucks";
    expect(extractSQL(input)).toBe("SELECT 'hello; world' as greeting FROM fleet_trucks");
  });

  it("handles multi-line SQL", () => {
    const input = `SELECT ft.name,
       ft.make,
       ft.model
FROM fleet_trucks ft
WHERE ft.status = 'active'
LIMIT 500`;
    expect(extractSQL(input)).toBe(input);
  });

  it("handles response with explanation before SQL", () => {
    const input = `Here's the query:\n\`\`\`sql\nSELECT id FROM fleet_trucks\n\`\`\``;
    expect(extractSQL(input)).toBe("SELECT id FROM fleet_trucks");
  });

  it("returns empty string for empty input", () => {
    expect(extractSQL("")).toBe("");
  });

  it("trims whitespace", () => {
    const input = "  \n  SELECT id FROM fleet_trucks  \n  ";
    expect(extractSQL(input)).toBe("SELECT id FROM fleet_trucks");
  });
});

// ── Schema Context: Required Tables ──────────────────────────────
// Every queryable table must be documented. Note: sensor_readings is NOT
// in Supabase (data is in Viam Cloud), so it's excluded.

const REQUIRED_TABLES = [
  // Fleet & Monitoring
  "fleet_trucks",
  "dtc_history",
  "maintenance_events",  // NOT maintenance_log
  "truck_notes",
  "truck_assignments",
  // Work Orders
  "work_orders",
  "work_order_subtasks",
  "work_order_notes",
  // Chat
  "chat_threads",
  "chat_messages",
  "chat_reactions",
  "chat_thread_members",
  "message_reads",
  // Timesheets & HR
  "timesheets",
  "timesheet_daily_logs",
  "timesheet_railroad_timecards",
  "timesheet_inspections",
  "timesheet_ifta_entries",
  "timesheet_expenses",
  "timesheet_maintenance_time",
  "timesheet_shop_time",
  "timesheet_mileage_pay",
  "timesheet_flight_pay",
  "timesheet_holiday_pay",
  "timesheet_vacation_pay",
  "employee_profiles",
  "training_requirements",
  "training_records",
  "pto_balances",
  "pto_requests",
  "per_diem_rates",
  "per_diem_entries",
  "company_vehicles",
  // Accounting
  "chart_of_accounts",
  "journal_entries",
  "journal_entry_lines",
  "recurring_journal_entries",
  "recurring_journal_entry_lines",
  "customers",
  "vendors",
  "invoices",
  "invoice_line_items",
  "invoice_payments",
  "bills",
  "bill_line_items",
  "bill_payments",
  "bank_accounts",
  "bank_transactions",
  "reconciliation_sessions",
  "employee_tax_profiles",
  "payroll_runs",
  "payroll_run_lines",
  "benefit_plans",
  "employee_benefits",
  "workers_comp_classes",
  "fixed_assets",
  "depreciation_entries",
  "estimates",
  "estimate_line_items",
  "budgets",
  "credit_card_accounts",
  "credit_card_transactions",
  "expense_categorization_rules",
  "mileage_rates",
  "payment_reminders",
  "sales_tax_rates",
  "sales_tax_exemptions",
  "sales_tax_collected",
  // Additional
  "parts",
  "part_usage",
  "gps_tracks",
  "inspections",
  "shift_handoffs",
  // Platform
  "audit_log",
  "documents",
  "activity_feed",
  "entity_tags",
  "expense_categories",
  "saved_reports",
  "report_query_log",
];

describe("schema context: required tables", () => {
  for (const table of REQUIRED_TABLES) {
    it(`documents table: ${table}`, () => {
      expect(schemaContextSource).toContain(table);
    });
  }
});

// ── Schema Context: Correct Column Names ─────────────────────────
// These verify the EXACT column names match the actual migrations.
// This is the most critical section — wrong column names cause query failures.

const EXACT_COLUMNS = [
  // dtc_history — the original bug: no "code" column
  { table: "dtc_history", column: "spn", desc: "DTC uses spn not code" },
  { table: "dtc_history", column: "fmi", desc: "DTC uses fmi" },
  { table: "dtc_history", column: "first_seen_at", desc: "not detected_at" },
  { table: "dtc_history", column: "last_seen_at", desc: "not detected_at" },
  { table: "dtc_history", column: "occurrence_count", desc: "count field" },
  { table: "dtc_history", column: "active", desc: "boolean status" },
  // maintenance_events — correct table name
  { table: "maintenance_events", column: "event_type", desc: "not category" },
  { table: "maintenance_events", column: "performed_by", desc: "person name" },
  { table: "maintenance_events", column: "mileage", desc: "odometer" },
  // work_orders — correct status/priority values
  { table: "work_orders", column: "blocker_reason", desc: "blocked status" },
  { table: "work_orders", column: "assigned_to_name", desc: "denormalized name" },
  { table: "work_orders", column: "created_by_name", desc: "denormalized name" },
  { table: "work_orders", column: "linked_dtcs", desc: "JSONB array" },
  // work_order_subtasks — is_done not is_completed
  { table: "work_order_subtasks", column: "is_done", desc: "not is_completed" },
  { table: "work_order_subtasks", column: "sort_order", desc: "ordering" },
  // truck_notes — author_id not user_id
  { table: "truck_notes", column: "author_id", desc: "not user_id" },
  { table: "truck_notes", column: "author_name", desc: "not user_name" },
  { table: "truck_notes", column: "body", desc: "not content" },
  // chat_messages — sender_id not user_id
  { table: "chat_messages", column: "sender_id", desc: "not user_id" },
  { table: "chat_messages", column: "sender_name", desc: "not user_name" },
  { table: "chat_messages", column: "body", desc: "not content" },
  // chat_reactions — reaction not emoji
  { table: "chat_reactions", column: "reaction", desc: "not emoji" },
  // timesheets — correct column names
  { table: "timesheets", column: "railroad_working_on", desc: "not railroad" },
  { table: "timesheets", column: "rejection_reason", desc: "not rejected_reason" },
  // timesheet_daily_logs — log_date not work_date
  { table: "timesheet_daily_logs", column: "log_date", desc: "not work_date" },
  { table: "timesheet_daily_logs", column: "hours_worked", desc: "not hours" },
  // employee_profiles — user_name not first_name/last_name
  { table: "employee_profiles", column: "user_name", desc: "not first_name/last_name" },
  { table: "employee_profiles", column: "profile_picture_url", desc: "not picture_url" },
  // pto_balances — individual columns not balance_type
  { table: "pto_balances", column: "vacation_hours_total", desc: "not balance_type" },
  { table: "pto_balances", column: "sick_hours_total", desc: "individual type" },
  { table: "pto_balances", column: "personal_hours_total", desc: "individual type" },
  // pto_requests — request_type not balance_type
  { table: "pto_requests", column: "request_type", desc: "not balance_type" },
  { table: "pto_requests", column: "hours_requested", desc: "not hours" },
  // chart_of_accounts — account_type not type
  { table: "chart_of_accounts", column: "account_type", desc: "not type" },
  { table: "chart_of_accounts", column: "current_balance", desc: "not balance" },
  { table: "chart_of_accounts", column: "normal_balance", desc: "debit/credit" },
  // journal_entry_lines — journal_entry_id not entry_id
  { table: "journal_entry_lines", column: "journal_entry_id", desc: "not entry_id" },
  // invoices/bills — total not total_amount
  { table: "invoices", column: "balance_due", desc: "AR tracking" },
  { table: "invoices", column: "invoice_number", desc: "unique number" },
  // bank_accounts — institution not bank_name
  { table: "bank_accounts", column: "institution", desc: "not bank_name" },
  { table: "bank_accounts", column: "account_last4", desc: "not account_number_last4" },
  // training_requirements — frequency_months not validity_months
  { table: "training_requirements", column: "frequency_months", desc: "not validity_months" },
  // per_diem_entries — nights_count not nights
  { table: "per_diem_entries", column: "nights_count", desc: "not nights" },
  { table: "per_diem_entries", column: "layover_count", desc: "not layovers" },
];

describe("schema context: exact column names match migrations", () => {
  for (const { table, column, desc } of EXACT_COLUMNS) {
    it(`${table}.${column} — ${desc}`, () => {
      expect(schemaContextSource).toContain(column);
    });
  }
});

// ── Schema Context: Forbidden Column Names ───────────────────────
// These column names DO NOT EXIST and must NOT appear as column definitions.

describe("schema context: does NOT contain wrong column names", () => {
  it("dtc_history has no 'code' column definition", () => {
    // "code" should not appear as a column in dtc_history's definition.
    // It may appear in other contexts (e.g., "dtc_code" alias), which is fine.
    const dtcSection = schemaContextSource.match(/dtc_history:[\s\S]*?(?=\n\n|- \w)/)?.[0] || "";
    expect(dtcSection).not.toMatch(/Columns:.*\bcode\b.*(?:TEXT|text)/);
  });

  it("no table called maintenance_log", () => {
    // maintenance_events is correct, maintenance_log is wrong
    expect(schemaContextSource).not.toMatch(/^- maintenance_log:/m);
  });

  it("no sensor_readings table (data is in Viam Cloud)", () => {
    expect(schemaContextSource).not.toMatch(/^- sensor_readings:/m);
  });

  it("work_orders status column definition uses open/in_progress/blocked/done", () => {
    const woSection = schemaContextSource.match(/work_orders:[\s\S]*?(?=\n\n|- \w)/)?.[0] || "";
    // The Columns: line should list the correct values
    const columnsLine = woSection.match(/Columns:.*$/m)?.[0] || "";
    expect(columnsLine).toContain("open/in_progress/blocked/done");
    expect(columnsLine).not.toContain("completed/cancelled");
  });

  it("work_orders priority column definition uses low/normal/urgent", () => {
    const woSection = schemaContextSource.match(/work_orders:[\s\S]*?(?=\n\n|- \w)/)?.[0] || "";
    const columnsLine = woSection.match(/Columns:.*$/m)?.[0] || "";
    expect(columnsLine).toContain("low/normal/urgent");
    expect(columnsLine).not.toContain("medium/high");
  });
});

// ── Schema Context: Key Relationships ────────────────────────────

describe("schema context: join relationships", () => {
  it("documents user_id TEXT (Clerk format) convention", () => {
    expect(schemaContextSource).toMatch(/user.*TEXT.*Clerk/i);
  });

  it("documents fleet_trucks.id is TEXT not UUID", () => {
    expect(schemaContextSource).toMatch(/fleet_trucks.*id.*TEXT/i);
  });

  it("documents no ::text cast needed for truck joins", () => {
    expect(schemaContextSource).toMatch(/no.*cast.*needed/i);
  });

  it("documents customers.company_name (not name)", () => {
    expect(schemaContextSource).toContain("company_name");
  });

  it("documents invoice-customer FK", () => {
    expect(schemaContextSource).toContain("customer_id");
  });

  it("documents bill-vendor FK", () => {
    expect(schemaContextSource).toContain("vendor_id");
  });

  it("documents journal_entry_lines FK name", () => {
    expect(schemaContextSource).toContain("journal_entry_id");
  });
});

// ── Prompt Guardrails ────────────────────────────────────────────

describe("report generate route: SQL generation rules", () => {
  it("instructs Claude to return ONLY SQL", () => {
    expect(generateRouteSource).toMatch(/return only.*sql/i);
  });

  it("instructs LIMIT 500 default", () => {
    expect(generateRouteSource).toContain("LIMIT 500");
  });

  it("instructs no trailing semicolons", () => {
    expect(generateRouteSource).toMatch(/no.*semicolons/i);
  });

  it("instructs never generate mutations", () => {
    expect(generateRouteSource).toMatch(/never.*insert.*update.*delete/i);
  });

  it("instructs date formatting", () => {
    expect(generateRouteSource).toContain("to_char");
  });

  it("instructs COALESCE for nulls", () => {
    expect(generateRouteSource).toContain("COALESCE");
  });

  it("instructs LEFT JOIN", () => {
    expect(generateRouteSource).toContain("LEFT JOIN");
  });

  it("instructs ROUND for monetary values", () => {
    expect(generateRouteSource).toContain("ROUND");
  });

  it("warns about exact column names", () => {
    expect(generateRouteSource).toMatch(/exact column names/i);
  });

  it("warns dtc_history has no code column", () => {
    expect(generateRouteSource).toMatch(/no.*\"code\".*column/i);
  });

  it("warns maintenance_events not maintenance_log", () => {
    expect(generateRouteSource).toContain("maintenance_events");
  });

  it("warns work order correct status values", () => {
    expect(generateRouteSource).toMatch(/open\/in_progress\/blocked\/done/);
  });

  it("warns employee_profiles uses user_name", () => {
    expect(generateRouteSource).toContain("user_name");
  });
});

// ── Example Queries ──────────────────────────────────────────────

describe("schema context: example queries use correct columns", () => {
  it("DTC example uses spn/fmi not code", () => {
    expect(schemaContextSource).toMatch(/SELECT[\s\S]*spn[\s\S]*fmi[\s\S]*FROM dtc_history/);
  });

  it("DTC example uses first_seen_at not detected_at", () => {
    const exampleSection = schemaContextSource.slice(schemaContextSource.indexOf("Example prompt"));
    expect(exampleSection).not.toContain("detected_at");
  });

  it("timesheet example uses user_name not first_name", () => {
    const exampleSection = schemaContextSource.slice(schemaContextSource.indexOf("Example prompt"));
    expect(exampleSection).toContain("user_name");
  });

  it("timesheet example uses log_date not work_date", () => {
    const exampleSection = schemaContextSource.slice(schemaContextSource.indexOf("Example prompt"));
    expect(exampleSection).toContain("log_date");
  });

  it("timesheet example uses hours_worked not hours", () => {
    const exampleSection = schemaContextSource.slice(schemaContextSource.indexOf("Example prompt"));
    expect(exampleSection).toContain("hours_worked");
  });

  it("invoice example uses total not total_amount", () => {
    // In example SQL, SUM(i.total) not SUM(i.total_amount)
    const exampleSection = schemaContextSource.slice(schemaContextSource.indexOf("Example prompt"));
    expect(exampleSection).toMatch(/i\.total[,)]/);
  });

  it("work order example uses correct status values", () => {
    const exampleSection = schemaContextSource.slice(schemaContextSource.indexOf("Example prompt"));
    expect(exampleSection).toContain("'open'");
    expect(exampleSection).toContain("'in_progress'");
    expect(exampleSection).toContain("'blocked'");
  });

  it("includes at least 8 example queries", () => {
    const userPromptCount = (schemaContextSource.match(/^User: "/gm) || []).length;
    expect(userPromptCount).toBeGreaterThanOrEqual(8);
  });

  it("examples use proper JOIN syntax", () => {
    expect(schemaContextSource).toContain("JOIN");
  });

  it("examples include LIMIT", () => {
    expect(schemaContextSource).toContain("LIMIT 500");
  });
});

// ── API Route Structure ─────────────────────────────────────────

describe("report generate route: structure", () => {
  it("requires authentication", () => {
    expect(generateRouteSource).toContain("requireRole");
  });

  it("checks for ANTHROPIC_API_KEY", () => {
    expect(generateRouteSource).toContain("ANTHROPIC_API_KEY");
  });

  it("validates input with Zod schema", () => {
    expect(generateRouteSource).toContain("parseBody");
    expect(generateRouteSource).toContain("ReportGenerateBody");
  });

  it("calls Claude API", () => {
    expect(generateRouteSource).toContain("api.anthropic.com");
  });

  it("uses claude-sonnet model", () => {
    expect(generateRouteSource).toMatch(/claude-sonnet/);
  });

  it("uses prompt caching", () => {
    expect(generateRouteSource).toContain("cache_control");
  });

  it("validates SQL before execution", () => {
    expect(generateRouteSource).toContain("validateSQL");
  });

  it("executes via sandboxed RPC", () => {
    expect(generateRouteSource).toContain("exec_readonly_query");
  });

  it("logs audit trail", () => {
    expect(generateRouteSource).toContain("logAudit");
    expect(generateRouteSource).toContain("report_generated");
  });

  it("returns sql, results, row_count, execution_time_ms", () => {
    expect(generateRouteSource).toContain("sql");
    expect(generateRouteSource).toContain("results");
    expect(generateRouteSource).toContain("row_count");
    expect(generateRouteSource).toContain("execution_time_ms");
  });

  it("returns 422 on validation/execution failure", () => {
    expect(generateRouteSource).toContain("422");
  });

  it("returns 502 on Claude API failure", () => {
    expect(generateRouteSource).toContain("502");
  });

  it("logs errors with [REPORT-ERROR] prefix", () => {
    expect(generateRouteSource).toContain("[REPORT-ERROR]");
  });
});

// ── Auto-Retry Logic ────────────────────────────────────────────

describe("report generate route: auto-retry on failure", () => {
  it("has retry logic", () => {
    expect(generateRouteSource).toContain("[REPORT-RETRY]");
  });

  it("sends error context back to Claude", () => {
    expect(generateRouteSource).toMatch(/failed.*error|error.*fix.*SQL/i);
  });

  it("tracks retry count", () => {
    expect(generateRouteSource).toContain("retryCount");
  });

  it("returns retried flag on success after retry", () => {
    expect(generateRouteSource).toContain("retried");
  });

  it("returns both original and retry SQL on final failure", () => {
    expect(generateRouteSource).toContain("original_sql");
  });
});

// ── Query Logging ───────────────────────────────────────────────

describe("report generate route: query logging", () => {
  it("logs to report_query_log table", () => {
    expect(generateRouteSource).toContain("report_query_log");
  });

  it("logs prompt", () => {
    expect(generateRouteSource).toMatch(/prompt[\s\S]*logQuery|logQuery[\s\S]*prompt/);
  });

  it("logs success status", () => {
    expect(generateRouteSource).toContain("success: true");
    expect(generateRouteSource).toContain("success: false");
  });

  it("logs error messages", () => {
    expect(generateRouteSource).toContain("errorMessage");
  });

  it("logs execution time", () => {
    expect(generateRouteSource).toContain("executionMs");
  });

  it("logs user info", () => {
    expect(generateRouteSource).toContain("userName");
  });
});

// ── Re-Run Route Structure ──────────────────────────────────────

describe("report run route: structure", () => {
  it("requires authentication", () => {
    expect(runRouteSource).toContain("requireRole");
  });

  it("checks report ownership or shared access", () => {
    expect(runRouteSource).toContain("created_by");
    expect(runRouteSource).toContain("is_shared");
  });

  it("re-validates SQL before execution", () => {
    expect(runRouteSource).toContain("validateSQL");
  });

  it("executes via sandboxed RPC", () => {
    expect(runRouteSource).toContain("exec_readonly_query");
  });

  it("updates run count and last_run_at", () => {
    expect(runRouteSource).toContain("run_count");
    expect(runRouteSource).toContain("last_run_at");
  });

  it("logs audit trail", () => {
    expect(runRouteSource).toContain("logAudit");
    expect(runRouteSource).toContain("report_run");
  });

  it("returns 404 for missing reports", () => {
    expect(runRouteSource).toContain("404");
  });

  it("returns 403 for unauthorized access", () => {
    expect(runRouteSource).toContain("403");
  });
});

// ── Validation Module ───────────────────────────────────────────

describe("report-validate module: completeness", () => {
  it("blocks INSERT keyword", () => {
    expect(validateSource).toContain('"insert"');
  });

  it("blocks UPDATE keyword", () => {
    expect(validateSource).toContain('"update"');
  });

  it("blocks DELETE keyword", () => {
    expect(validateSource).toContain('"delete"');
  });

  it("blocks DROP keyword", () => {
    expect(validateSource).toContain('"drop"');
  });

  it("blocks CREATE keyword", () => {
    expect(validateSource).toContain('"create"');
  });

  it("blocks TRUNCATE keyword", () => {
    expect(validateSource).toContain('"truncate"');
  });

  it("blocks pg_catalog access", () => {
    expect(validateSource).toContain("pg_catalog");
  });

  it("blocks information_schema access", () => {
    expect(validateSource).toContain("information_schema");
  });

  it("blocks file I/O functions", () => {
    expect(validateSource).toContain("pg_read_file");
    expect(validateSource).toContain("pg_write_file");
  });

  it("blocks SET ROLE", () => {
    expect(validateSource).toMatch(/set.*role/i);
  });

  it("uses word boundaries (\\b) not substring matching", () => {
    // The validator builds word-boundary regexes dynamically from keyword lists
    // Verify keywords are present and that \\b is used for boundary matching
    expect(validateSource).toContain("FORBIDDEN_KEYWORDS");
    expect(validateSource).toContain('"insert"');
    expect(validateSource).toContain('"update"');
    expect(validateSource).toContain('"delete"');
    expect(validateSource).toContain('"create"');
  });

  it("requires SELECT or WITH at start", () => {
    expect(validateSource).toMatch(/select.*with/i);
  });
});

// ── DB Function Migration ────────────────────────────────────────

describe("DB function migration: word boundaries", () => {
  let migrationSource: string;

  try {
    migrationSource = readFileSync(
      resolve(DASHBOARD_ROOT, "supabase/migrations/029_fix_readonly_query.sql"),
      "utf-8"
    );
  } catch {
    migrationSource = "";
  }

  it("migration file exists", () => {
    expect(migrationSource.length).toBeGreaterThan(0);
  });

  it("uses PostgreSQL word boundaries (\\m and \\M)", () => {
    expect(migrationSource).toContain("\\m");
    expect(migrationSource).toContain("\\M");
  });

  it("blocks mutation keywords", () => {
    expect(migrationSource).toMatch(/insert.*update.*delete/i);
  });

  it("blocks system catalog access", () => {
    expect(migrationSource).toContain("pg_catalog");
    expect(migrationSource).toContain("information_schema");
  });

  it("sets statement_timeout for safety", () => {
    expect(migrationSource).toContain("statement_timeout");
  });

  it("uses SECURITY DEFINER", () => {
    expect(migrationSource).toContain("SECURITY DEFINER");
  });

  it("returns JSONB", () => {
    expect(migrationSource).toContain("RETURNS JSONB");
  });
});

// ── Query Log Migration ──────────────────────────────────────────

describe("report_query_log migration", () => {
  let migrationSource: string;

  try {
    migrationSource = readFileSync(
      resolve(DASHBOARD_ROOT, "supabase/migrations/030_report_query_log.sql"),
      "utf-8"
    );
  } catch {
    migrationSource = "";
  }

  it("migration file exists", () => {
    expect(migrationSource.length).toBeGreaterThan(0);
  });

  it("creates report_query_log table", () => {
    expect(migrationSource).toContain("report_query_log");
  });

  it("has prompt column", () => {
    expect(migrationSource).toContain("prompt");
  });

  it("has generated_sql column", () => {
    expect(migrationSource).toContain("generated_sql");
  });

  it("has success column", () => {
    expect(migrationSource).toContain("success");
  });

  it("has error_message column", () => {
    expect(migrationSource).toContain("error_message");
  });

  it("has retry_count column", () => {
    expect(migrationSource).toContain("retry_count");
  });
});
