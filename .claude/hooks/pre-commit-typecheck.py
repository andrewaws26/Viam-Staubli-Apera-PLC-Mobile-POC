#!/usr/bin/env python3
"""PreToolUse hook — type-check dashboard before git commit.

Intercepts `git commit` commands and runs `tsc --noEmit` on the dashboard
first. If there are type errors, the commit is blocked with the error output.

Exit codes:
  0 = allow (not a commit, or type check passed)
  2 = block (type errors found)
"""
import json
import os
import re
import subprocess
import sys


def main():
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            sys.exit(0)

        data = json.loads(raw)
        command = data.get("input", {}).get("command", "")
    except (json.JSONDecodeError, KeyError, TypeError):
        sys.exit(0)  # Don't block on parse failure — safety guard handles that

    # Only intercept git commit commands
    if not re.search(r'\bgit\s+commit\b', command):
        sys.exit(0)

    # Skip if this is an amend with no new changes (just message edit)
    # or if it's a merge commit
    if '--allow-empty' in command:
        sys.exit(0)

    # Find dashboard directory
    try:
        repo_root = subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"],
            text=True, stderr=subprocess.DEVNULL
        ).strip()
    except Exception:
        sys.exit(0)  # Can't find repo, don't block

    dashboard_dir = os.path.join(repo_root, "dashboard")
    if not os.path.isdir(dashboard_dir):
        sys.exit(0)

    # Check if any staged files are in dashboard/ or packages/
    try:
        staged = subprocess.check_output(
            ["git", "diff", "--cached", "--name-only"],
            text=True, stderr=subprocess.DEVNULL, cwd=repo_root
        ).strip()
    except Exception:
        sys.exit(0)

    has_ts_changes = any(
        (f.startswith("dashboard/") or f.startswith("packages/"))
        and f.endswith((".ts", ".tsx"))
        for f in staged.split("\n") if f
    )

    if not has_ts_changes:
        sys.exit(0)  # No TS changes staged, skip type check

    # Run tsc --noEmit
    try:
        result = subprocess.run(
            ["npx", "tsc", "--noEmit"],
            capture_output=True, text=True, timeout=60,
            cwd=dashboard_dir,
        )
    except subprocess.TimeoutExpired:
        # Don't block on timeout — let the commit through
        sys.exit(0)
    except Exception:
        sys.exit(0)

    if result.returncode == 0:
        # Type check passed — allow commit
        sys.exit(0)

    # Type errors found — block the commit
    # Extract just the error lines (not the full output)
    errors = []
    for line in result.stdout.split("\n"):
        if ": error TS" in line:
            errors.append(line.strip())

    error_count = len(errors)
    preview = "\n".join(errors[:10])
    if error_count > 10:
        preview += f"\n... and {error_count - 10} more errors"

    print(
        f"BLOCKED: TypeScript type check failed ({error_count} errors). "
        f"Fix these before committing:\n{preview}",
        file=sys.stderr,
    )
    sys.exit(2)


if __name__ == "__main__":
    main()
