#!/usr/bin/env python3
"""PreToolUse hook — safety guard for Bash commands.

Reads JSON from stdin (Claude Code hook protocol), extracts the command,
and blocks dangerous operations. Fail-closed: if parsing fails, block.

Exit codes:
  0 = allow
  2 = block (reason on stderr)
"""
import json
import re
import sys


def check_command(cmd: str) -> str | None:
    """Return a block reason if the command is dangerous, else None."""

    # --- Catastrophic deletes ---
    if re.search(r'\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?-[a-zA-Z]*r[a-zA-Z]*\s+[/~](\s|$|")', cmd) or \
       re.search(r'\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?-[a-zA-Z]*f[a-zA-Z]*\s+[/~](\s|$|")', cmd):
        return "BLOCKED: rm -rf on / or ~ is catastrophic"

    # --- Git push --force to main/master ---
    if re.search(r'\bgit\s+push\b.*--force\b', cmd) and re.search(r'\b(main|master)\b', cmd):
        return "BLOCKED: git push --force to main/master"

    # --- Direct git push to main/master (without --force, but without a branch/PR) ---
    # Matches: git push origin main, git push origin master
    if re.search(r'\bgit\s+push\s+\S+\s+(main|master)\b', cmd):
        return "BLOCKED: direct push to main/master — use a feature branch + PR"

    # --- CAN bus safety (CRITICAL — physical safety on truck J1939 bus) ---
    # Look for can0 anywhere in the command (catches SSH-wrapped commands too)
    if 'can0' in cmd:
        # Allow bringing the interface DOWN (safe, no transmission)
        # Match: ip link set can0 down
        if re.search(r'\bip\s+link\s+set\s+can0\s+down\b', cmd):
            return None  # safe

        # For any can0 UP command, require listen-only on
        if re.search(r'\bip\s+link\s+set\s+can0\b', cmd):
            if 'listen-only on' not in cmd:
                return (
                    "BLOCKED: CAN bus safety — can0 must use listen-only mode. "
                    "Normal mode ACKs truck ECU frames and triggers dashboard "
                    "warning lights. Add 'listen-only on' to the command."
                )

    return None


def main():
    # Fail closed: if we can't parse input, block
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            print("BLOCKED: empty hook input — fail closed", file=sys.stderr)
            sys.exit(2)

        data = json.loads(raw)
        command = data.get("input", {}).get("command", "")

        if not command:
            # No command to check (shouldn't happen for Bash tool)
            sys.exit(0)

    except (json.JSONDecodeError, KeyError, TypeError) as e:
        print(f"BLOCKED: failed to parse hook input ({e}) — fail closed", file=sys.stderr)
        sys.exit(2)

    reason = check_command(command)
    if reason:
        print(reason, file=sys.stderr)
        sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()
