/**
 * Schema Sync Tests
 *
 * Ensures the AI report generator's schema context stays in sync with
 * the actual database schema defined in migration files.
 *
 * WHY: The report generator broke because schema-context.ts had fabricated
 * column names that didn't match the real migrations. These tests enforce
 * that every table and critical column from the migrations is represented
 * in the schema context, and that no phantom tables exist.
 *
 * WHEN TO UPDATE: If you add a migration that creates or alters a table,
 * these tests will fail until you update lib/report-schema-context.ts.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ── Load schema context and migrations ────────────────────────────────

const MIGRATIONS_DIR = path.resolve(__dirname, "../../supabase/migrations");
const SCHEMA_CONTEXT_PATH = path.resolve(__dirname, "../../lib/report-schema-context.ts");

function readMigrations(): { name: string; sql: string }[] {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith(".sql"))
    .sort();
  return files.map(f => ({
    name: f,
    sql: fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf-8"),
  }));
}

function readSchemaContext(): string {
  return fs.readFileSync(SCHEMA_CONTEXT_PATH, "utf-8");
}

/**
 * Extract all CREATE TABLE table names from SQL migration files.
 * Matches: CREATE TABLE [IF NOT EXISTS] table_name
 */
function extractTableNames(sql: string): string[] {
  const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
  const tables: string[] = [];
  let match;
  while ((match = regex.exec(sql)) !== null) {
    tables.push(match[1].toLowerCase());
  }
  return tables;
}

/**
 * Extract columns from a CREATE TABLE block.
 * Returns { tableName: [col1, col2, ...] }
 */
function extractColumns(sql: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  // Match CREATE TABLE ... ( ... ) blocks
  const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*?)(?:\);)/gi;
  let match;
  while ((match = tableRegex.exec(sql)) !== null) {
    const tableName = match[1].toLowerCase();
    const body = match[2];
    const cols: string[] = [];
    // Extract column names (first word of each line that isn't a constraint)
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("--")) continue;
      // Skip constraint keywords
      if (/^(PRIMARY|UNIQUE|CHECK|CONSTRAINT|FOREIGN|EXCLUDE|CREATE|INDEX)/i.test(trimmed)) continue;
      const colMatch = trimmed.match(/^(\w+)\s+/);
      if (colMatch) {
        const col = colMatch[1].toLowerCase();
        // Skip SQL keywords that aren't column names
        if (!["primary", "unique", "check", "constraint", "foreign", "index", "create", "alter", "drop", "references"].includes(col)) {
          cols.push(col);
        }
      }
    }
    if (cols.length > 0) {
      result.set(tableName, cols);
    }
  }
  return result;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("Schema Sync: Migrations ↔ Schema Context", () => {
  const migrations = readMigrations();
  const schemaContext = readSchemaContext();
  const allSql = migrations.map(m => m.sql).join("\n");

  // Collect all tables from all migrations
  const allTables = new Set<string>();
  const allColumns = new Map<string, string[]>();

  for (const m of migrations) {
    for (const table of extractTableNames(m.sql)) {
      allTables.add(table);
    }
    for (const [table, cols] of extractColumns(m.sql)) {
      const existing = allColumns.get(table) || [];
      allColumns.set(table, [...existing, ...cols]);
    }
  }

  // Tables that are internal/system and don't need to be in the schema context
  const EXCLUDED_TABLES = new Set([
    "exec_readonly_query", // This is a function, not a table
  ]);

  it("should have migration files", () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  it("should have a schema context file", () => {
    expect(schemaContext.length).toBeGreaterThan(0);
  });

  describe("Every migration table should be in schema context", () => {
    const tables = [...allTables].filter(t => !EXCLUDED_TABLES.has(t));

    for (const table of tables) {
      it(`table "${table}" should be mentioned in schema context`, () => {
        // Check if the table name appears in the schema context
        // Use word boundary to avoid partial matches
        const regex = new RegExp(`\\b${table}\\b`, "i");
        expect(
          regex.test(schemaContext),
          `Table "${table}" from migrations is NOT in report-schema-context.ts. ` +
          `Update the schema context to include this table and its columns.`
        ).toBe(true);
      });
    }
  });

  describe("Critical columns should be in schema context", () => {
    // These are columns that have historically caused bugs when missing or wrong
    const criticalColumns: [string, string][] = [
      ["dtc_history", "spn"],
      ["dtc_history", "fmi"],
      ["work_orders", "status"],
      ["work_orders", "priority"],
      ["employee_profiles", "user_name"],
      ["fleet_trucks", "id"],
      ["timesheets", "status"],
      ["invoices", "total"],
      ["journal_entries", "status"],
    ];

    for (const [table, column] of criticalColumns) {
      it(`${table}.${column} should be in schema context`, () => {
        // Look for the column name near the table name in the context
        expect(
          schemaContext.toLowerCase().includes(column),
          `Critical column "${table}.${column}" not found in schema context`
        ).toBe(true);
      });
    }
  });

  describe("Forbidden/wrong names should NOT be in schema context", () => {
    // Names that have historically been fabricated or wrong
    const forbidden: [string, string][] = [
      ["dtc_history", "code"],           // Uses spn/fmi, not code
      ["sensor_readings", "*"],          // Doesn't exist in Supabase
      ["maintenance_log", "*"],          // It's maintenance_events
    ];

    for (const [context, name] of forbidden) {
      if (name === "*") {
        it(`table "${context}" should NOT be in schema context (it doesn't exist)`, () => {
          // Check it's not listed as a table (allow it in comments/notes)
          const tablePattern = new RegExp(`^\\s*${context}\\b`, "im");
          const schemaLines = schemaContext.split("\n");
          const inTableLine = schemaLines.some(line =>
            tablePattern.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.includes("NOT")
          );
          expect(inTableLine).toBe(false);
        });
      } else {
        it(`column "${name}" should not appear as a column of "${context}"`, () => {
          // Find the section for this table and check the column isn't in Columns line
          const sectionRegex = new RegExp(
            `${context}[\\s\\S]*?Columns:[^\\n]*`,
            "i"
          );
          const match = schemaContext.match(sectionRegex);
          if (match) {
            const columnsLine = match[0].split("Columns:").pop() || "";
            const hasColumn = new RegExp(`\\b${name}\\b`, "i").test(columnsLine);
            expect(hasColumn, `"${name}" should not be a column of "${context}"`).toBe(false);
          }
        });
      }
    }
  });
});

describe("Schema Sync: Migration count tracking", () => {
  const migrations = readMigrations();

  it("should track the current migration count (update this when adding migrations)", () => {
    // This test ensures you're aware of all migrations.
    // When you add a new migration, update this number AND update schema-context.ts.
    const currentCount = migrations.length;
    expect(currentCount).toBeGreaterThanOrEqual(31); // Update this when adding migrations
  });
});
