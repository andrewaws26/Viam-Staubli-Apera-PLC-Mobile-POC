#!/usr/bin/env python3
"""PostToolUse hook — auto-run relevant tests after editing dashboard files.

Matches edited source files to their test files and runs just the relevant
test. Keeps feedback fast by running a single test file with a timeout.

Exit 0 always (never block). Outputs a JSON message when tests are relevant.
"""
import json
import os
import re
import subprocess
import sys

# ── Source path pattern → test file(s) ──────────────────────────────
# Order matters: first match wins. More specific patterns go first.
TEST_MAP = [
    # Accounting (3 test files cover different aspects)
    (r"lib/accounting",              ["accounting-business-logic.test.ts",
                                      "accounting-safety-compliance.test.ts"]),
    (r"app/api/accounting",          ["accounting-integration.test.ts"]),
    (r"supabase/migrations",         ["schema-sync.test.ts"]),

    # Reporting pipeline
    (r"app/api/reports",             ["report-generator.test.ts",
                                      "ai-prompt-completeness.test.ts"]),
    (r"lib/report-schema",           ["report-generator.test.ts",
                                      "schema-sync.test.ts",
                                      "data-features.test.ts"]),
    (r"lib/report-validate",         ["report-validate.test.ts"]),

    # Shift report / aggregation
    (r"app/api/shift-report",        ["aggregation-logic.test.ts",
                                      "data-features.test.ts"]),

    # Payroll
    (r"lib/payroll-tax",             ["payroll-tax.test.ts"]),
    (r"app/api/manager",             ["manager-dashboard.test.ts"]),

    # Infrastructure
    (r"lib/rate-limit",              ["infrastructure.test.ts"]),
    (r"lib/viam-circuit-breaker",    ["infrastructure.test.ts"]),
    (r"lib/idempotency",             ["infrastructure.test.ts"]),

    # Sensor / fleet data
    (r"lib/viam-data",               ["viam-data-parsing.test.ts",
                                      "cell-sim-isolation.test.ts"]),
    (r"lib/ai-diagnostics",          ["ai-diagnostics.test.ts"]),
    (r"lib/dtc-history",             ["dtc-history.test.ts"]),
    (r"lib/spn-lookup",              ["spn-lookup.test.ts"]),
    (r"lib/pcode-lookup",            ["pcode-lookup.test.ts"]),
    (r"lib/api-schemas",             ["api-schemas.test.ts"]),
    (r"components/Cell",             ["cell-watchdog.test.ts"]),

    # Shared package types
    (r"packages/shared/src/auth",    ["auth-permissions.test.ts"]),
    (r"packages/shared/src/profile", ["profile-types.test.ts"]),
    (r"packages/shared/src/training",["training-types.test.ts"]),
    (r"packages/shared/src/pto",     ["pto-types.test.ts"]),
    (r"packages/shared/src/timesheet", ["timesheet-types.test.ts"]),

    # Auth middleware — catches all API route changes too
    (r"middleware\.ts",              ["api-auth-enforcement.test.ts"]),

    # Generic API route catch-all (less specific, goes last)
    (r"app/api/.+/route\.ts",       ["api-auth-enforcement.test.ts"]),
]

# Max test files to run per edit (keep it fast)
MAX_TESTS = 2
TIMEOUT_SECS = 45


def find_repo_root():
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"],
            text=True, stderr=subprocess.DEVNULL
        ).strip()
    except Exception:
        return None


def match_tests(file_path):
    """Return list of test file names matching the edited source file."""
    # Normalize to relative path from repo root
    rel = file_path
    for prefix in ["/dashboard/", "dashboard/"]:
        idx = rel.find(prefix)
        if idx >= 0:
            rel = rel[idx + len(prefix):]
            break

    for pattern, tests in TEST_MAP:
        if re.search(pattern, rel):
            return tests[:MAX_TESTS]
    return []


def run_tests(dashboard_dir, test_files):
    """Run vitest on specific test files. Returns (passed, summary_line)."""
    paths = [f"tests/unit/{t}" for t in test_files]
    try:
        result = subprocess.run(
            ["npx", "vitest", "run", *paths, "--reporter=verbose"],
            capture_output=True, text=True, timeout=TIMEOUT_SECS,
            cwd=dashboard_dir,
            env={**os.environ, "NODE_ENV": "test"},
        )
        output = result.stdout + "\n" + result.stderr

        # Extract summary lines
        summary = []
        for line in output.split("\n"):
            stripped = line.strip()
            if "Tests" in stripped and ("passed" in stripped or "failed" in stripped):
                summary.append(stripped)
            if "FAIL" in stripped and "test.ts" in stripped:
                summary.append(stripped)

        passed = result.returncode == 0
        detail = summary[-1] if summary else ("passed" if passed else "failed")
        return passed, detail

    except subprocess.TimeoutExpired:
        return False, f"timed out ({TIMEOUT_SECS}s)"
    except FileNotFoundError:
        return True, "npx not found (skipped)"
    except Exception as e:
        return True, f"error: {e}"


def main():
    raw = sys.stdin.read()
    if not raw.strip():
        sys.exit(0)

    try:
        data = json.loads(raw)
        file_path = data.get("input", {}).get("file_path", "")
    except (json.JSONDecodeError, KeyError, TypeError):
        sys.exit(0)

    if not file_path:
        sys.exit(0)

    # Only dashboard/packages source files
    if "/dashboard/" not in file_path and "/packages/" not in file_path:
        sys.exit(0)

    # Skip test files, configs, non-TS
    basename = os.path.basename(file_path)
    if any(x in file_path for x in ["/tests/", "/node_modules/", "/.next/"]):
        sys.exit(0)
    if basename.endswith((".test.ts", ".test.tsx", ".config.ts", ".config.mjs")):
        sys.exit(0)
    if not basename.endswith((".ts", ".tsx")):
        sys.exit(0)

    # Find matching tests
    test_files = match_tests(file_path)
    if not test_files:
        sys.exit(0)  # No matching test — skip silently

    # Find dashboard dir
    repo_root = find_repo_root()
    if not repo_root:
        sys.exit(0)
    dashboard_dir = os.path.join(repo_root, "dashboard")

    passed, detail = run_tests(dashboard_dir, test_files)

    names = ", ".join(test_files)
    if passed:
        msg = f"Auto-test passed: {names} ({detail})"
    else:
        msg = f"AUTO-TEST FAILED: {names} — {detail}"

    print(json.dumps({"decision": "allow", "message": msg}))
    sys.exit(0)


if __name__ == "__main__":
    main()
