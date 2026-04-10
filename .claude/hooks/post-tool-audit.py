#!/usr/bin/env python3
"""PostToolUse hook — audit trail for Bash commands.

Appends a JSON line to ~/.claude/audit.jsonl after every Bash command.
"""
import json
import os
import sys
from datetime import datetime, timezone


def main():
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            sys.exit(0)

        data = json.loads(raw)
        command = data.get("input", {}).get("command", "")
        exit_code = data.get("output", {}).get("exitCode", None)
    except (json.JSONDecodeError, KeyError, TypeError):
        sys.exit(0)  # Audit is best-effort, don't block on failure

    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "command": command,
        "exit_code": exit_code,
    }

    audit_path = os.path.expanduser("~/.claude/audit.jsonl")
    try:
        with open(audit_path, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except OSError:
        pass  # Best-effort, never block

    sys.exit(0)


if __name__ == "__main__":
    main()
