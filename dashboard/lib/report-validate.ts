/**
 * report-validate.ts — Application-level SQL validation for the report generator.
 * Used by both the generate endpoint and the re-run endpoint.
 */

const FORBIDDEN_PATTERNS = [
  /;\s*$/,                    // trailing semicolons (multi-statement)
  /;\s*\w/,                   // semicolons followed by another statement
  /\binsert\b/i,
  /\bupdate\b/i,
  /\bdelete\b/i,
  /\bdrop\b/i,
  /\balter\b/i,
  /\bcreate\b/i,
  /\btruncate\b/i,
  /\bgrant\b/i,
  /\brevoke\b/i,
  /\bcopy\b/i,
  /\bexecute\b/i,
  /\bpg_catalog\b/i,
  /\binformation_schema\b/i,
  /\bpg_read_file\b/i,
  /\bpg_write_file\b/i,
  /\blo_import\b/i,
  /\blo_export\b/i,
  /\bset\s+role\b/i,
  /\bset\s+session\b/i,
];

export function validateSQL(sql: string): { valid: boolean; reason?: string } {
  const trimmed = sql.trim();

  if (!/^(select|with)\b/i.test(trimmed)) {
    return { valid: false, reason: "Query must start with SELECT or WITH" };
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { valid: false, reason: `Query contains forbidden pattern: ${pattern.source}` };
    }
  }

  return { valid: true };
}
