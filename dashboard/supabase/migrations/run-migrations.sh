#!/bin/bash
# Run all migrations against a Supabase project
# Usage: ./run-migrations.sh <project-ref>
# Requires SUPABASE_ACCESS_TOKEN env var

set -euo pipefail

PROJECT_REF="${1:?Usage: $0 <supabase-project-ref>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN}"

for f in "$SCRIPT_DIR"/[0-9]*.sql; do
  NAME=$(basename "$f")
  echo "Running $NAME..."

  SQL=$(cat "$f")
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg q "$SQL" '{query: $q}')")

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | head -n -1)

  if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
    echo "  ✓ $NAME succeeded"
  else
    echo "  ✗ $NAME failed (HTTP $HTTP_CODE)"
    echo "  $BODY"
    exit 1
  fi
done

echo ""
echo "All migrations complete!"
