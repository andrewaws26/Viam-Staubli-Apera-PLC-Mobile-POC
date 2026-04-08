#!/bin/bash
# Switch between test and production environments
# Usage: ./env-switch.sh [test|prod]

ENV="${1:?Usage: $0 [test|prod]}"
DASHBOARD_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ "$ENV" = "test" ]; then
  echo "Switching to TEST environment..."
  cp "$DASHBOARD_DIR/.env.test" "$DASHBOARD_DIR/.env.local"
  echo "Done. Using test Supabase (ompauiikdjumhzclmddk)"
elif [ "$ENV" = "prod" ]; then
  echo "Switching to PRODUCTION environment..."
  # Pull fresh production env from Vercel
  cd "$DASHBOARD_DIR" && npx vercel env pull .env.local --environment production --yes
  echo "Done. Using production Supabase (bppztvrvaajrgyfwesoe)"
else
  echo "Unknown environment: $ENV"
  echo "Usage: $0 [test|prod]"
  exit 1
fi
