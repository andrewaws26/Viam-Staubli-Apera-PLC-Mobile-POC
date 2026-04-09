/**
 * report-validate.ts — Application-level SQL validation for the report generator.
 * Used by both the generate endpoint and the re-run endpoint.
 *
 * Token-aware: strips string literals and comments before checking patterns,
 * so values like 'Please delete this row' won't trigger false positives.
 */

/** Strip single-quoted strings and comments so we only check SQL keywords. */
function stripLiteralsAndComments(sql: string): string {
  return sql
    // Remove single-quoted strings (handles escaped quotes)
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    // Remove double-quoted identifiers
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    // Remove block comments
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    // Remove line comments
    .replace(/--[^\n]*/g, " ");
}

/** DML/DDL keywords that must never appear as SQL statements (outside string literals). */
const FORBIDDEN_KEYWORDS = [
  "insert", "update", "delete", "drop", "alter", "create",
  "truncate", "grant", "revoke", "copy", "execute",
];

/** System catalog access that could leak metadata. */
const FORBIDDEN_IDENTIFIERS = [
  "pg_catalog", "information_schema", "pg_read_file", "pg_write_file",
  "lo_import", "lo_export",
];

/** Session manipulation. */
const FORBIDDEN_SESSION = [
  /\bset\s+role\b/i,
  /\bset\s+session\b/i,
];

export function validateSQL(sql: string): { valid: boolean; reason?: string } {
  const trimmed = sql.trim();

  if (!/^(select|with)\b/i.test(trimmed)) {
    return { valid: false, reason: "Query must start with SELECT or WITH" };
  }

  // Check for semicolons (multi-statement injection or trailing semicolons)
  if (/;/.test(trimmed)) {
    return { valid: false, reason: "Semicolons not allowed (potential multi-statement injection)" };
  }

  // Strip literals so we don't match keywords inside strings
  const cleaned = stripLiteralsAndComments(trimmed);

  for (const keyword of FORBIDDEN_KEYWORDS) {
    const re = new RegExp(`\\b${keyword}\\b`, "i");
    if (re.test(cleaned)) {
      return { valid: false, reason: `Query contains forbidden keyword: ${keyword.toUpperCase()}` };
    }
  }

  for (const ident of FORBIDDEN_IDENTIFIERS) {
    const re = new RegExp(`\\b${ident}\\b`, "i");
    if (re.test(cleaned)) {
      return { valid: false, reason: `Query references forbidden system object: ${ident}` };
    }
  }

  for (const pattern of FORBIDDEN_SESSION) {
    if (pattern.test(cleaned)) {
      return { valid: false, reason: "Session manipulation not allowed" };
    }
  }

  // Limit query complexity (prevent resource exhaustion)
  const subqueryCount = (cleaned.match(/\bselect\b/gi) || []).length;
  if (subqueryCount > 10) {
    return { valid: false, reason: `Query too complex: ${subqueryCount} SELECT clauses (max 10)` };
  }

  return { valid: true };
}
