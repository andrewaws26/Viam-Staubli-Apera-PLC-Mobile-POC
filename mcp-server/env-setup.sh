#!/bin/bash
# Source this file to export env vars needed by MCP servers:
#   source mcp-server/env-setup.sh
#
# Reads keys from dashboard/.env.local and exports them for Claude Code MCP.

ENV_FILE="$(dirname "$0")/../dashboard/.env.local"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found"
  return 1 2>/dev/null || exit 1
fi

# Export keys needed by MCP servers
while IFS='=' read -r key value; do
  case "$key" in
    VIAM_API_KEY|VIAM_API_KEY_ID|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)
      export "$key=$value"
      echo "  Exported $key"
      ;;
  esac
done < "$ENV_FILE"

# GitHub token from gh CLI
if command -v gh &>/dev/null && gh auth status &>/dev/null 2>&1; then
  export GITHUB_PERSONAL_ACCESS_TOKEN=$(gh auth token)
  echo "  Exported GITHUB_PERSONAL_ACCESS_TOKEN (from gh CLI)"
fi

echo "MCP environment ready."
