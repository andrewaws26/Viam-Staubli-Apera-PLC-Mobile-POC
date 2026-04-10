Validate a SQL migration file before applying it.

Read the migration file the user specifies (or the newest file in `dashboard/supabase/migrations/`).

## Checks to perform

### 1. Syntax and structure
- Valid PostgreSQL syntax
- Uses `IF NOT EXISTS` / `IF EXISTS` for safety (CREATE TABLE, DROP, ALTER)
- Includes both up and down (or is idempotent enough to re-run safely)

### 2. Naming conventions
Check against existing migrations in `dashboard/supabase/migrations/`:
- Table names: snake_case, plural (e.g., `journal_entries`, not `JournalEntry`)
- Column names: snake_case (e.g., `created_at`, not `createdAt`)
- Index names: `idx_<table>_<column>`
- FK names: `fk_<table>_<reference>`
- Migration file number is sequential (no gaps, no conflicts with existing)

### 3. Schema compatibility
Read the existing migrations to check:
- Does it reference tables that exist (from prior migrations)?
- Does it add columns with NOT NULL but no DEFAULT? (will fail on tables with data)
- Does it drop columns that other code might depend on? Search `dashboard/` for references.
- Does it create foreign keys to tables that exist?

### 4. Index coverage
- Any new foreign key column should have an index (join performance)
- Any column used in WHERE clauses frequently (check API routes) should be indexed
- Warn if adding >3 indexes on one table (write performance)

### 5. Security
- RLS policies: does the table need row-level security?
- No hardcoded secrets or credentials in the migration
- Grants/permissions: does the service role have access?

### 6. Impact assessment
- Does this migration require data backfill?
- Could it lock large tables? (ALTER TABLE on big tables can block reads)
- Is there a matching TypeScript type in `packages/shared/src/`?

## Report format

```
=== Migration Validation: <filename> ===

Syntax:        PASS / FAIL
Naming:        PASS / WARN (details)
Compatibility: PASS / FAIL (details)
Indexes:       PASS / WARN (suggestions)
Security:      PASS / WARN (details)
Impact:        LOW / MEDIUM / HIGH (explanation)

Recommendation: SAFE TO APPLY / NEEDS REVIEW / DO NOT APPLY
```

If there are issues, list each with a specific fix suggestion.
