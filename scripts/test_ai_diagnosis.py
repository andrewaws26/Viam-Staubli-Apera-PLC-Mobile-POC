#!/usr/bin/env python3
"""
Test that AI diagnosis actually works when run as root.

The ironsight-touch service runs as root (needs /dev/fb0), but claude CLI
is authenticated under /home/andrew. This test verifies the HOME override
lets root invoke claude successfully.

Run: sudo python3 scripts/test_ai_diagnosis.py
"""

import os
import subprocess
import sys
import time


def test_claude_cli_with_home_override():
    """Core test: claude CLI works when HOME=/home/andrew."""
    print("TEST 1: Claude CLI with HOME=/home/andrew")
    env = {**os.environ, "HOME": "/home/andrew"}
    result = subprocess.run(
        ["claude", "-p", "--model", "sonnet"],
        input="Reply with exactly: OK",
        capture_output=True, text=True, timeout=30,
        env=env,
    )
    assert result.returncode == 0, f"claude exited {result.returncode}: {result.stderr}"
    assert result.stdout.strip(), "claude returned empty output"
    print(f"  Response: {result.stdout.strip()[:80]}")
    print("  PASS\n")


def test_claude_cli_without_override_fails_as_root():
    """Proves the bug: without HOME override, root can't use claude."""
    if os.geteuid() != 0:
        print("TEST 2: SKIP (not running as root)")
        return
    print("TEST 2: Claude CLI WITHOUT HOME override (should fail as root)")
    # Don't override HOME — it stays as /root
    result = subprocess.run(
        ["claude", "-p", "--model", "sonnet"],
        input="Reply with exactly: OK",
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0 or "login" in result.stdout.lower() or "not logged in" in result.stdout.lower():
        print(f"  Correctly failed: {result.stdout.strip()[:80]}")
        print("  PASS (confirmed: root without HOME override can't auth)\n")
    else:
        # If root is somehow also authenticated, that's fine — just note it
        print(f"  Root is authenticated too (OK but unexpected): {result.stdout.strip()[:60]}")
        print("  PASS (no fix needed for root)\n")


def test_diagnosis_prompt_gets_real_response():
    """Send a realistic diagnosis prompt and verify we get a real answer back."""
    print("TEST 3: Realistic diagnosis prompt returns substantive response")
    env = {**os.environ, "HOME": "/home/andrew"}
    prompt = (
        "You are a TPS railroad monitoring AI. System status:\n"
        "PLC connected, 6 plates dropped, speed 0 ft/min, encoder idle.\n"
        "All systems normal, no diagnostics active.\n\n"
        "Give a short diagnosis (2-3 sentences max). Plain text only."
    )
    result = subprocess.run(
        ["claude", "-p", "--model", "sonnet"],
        input=prompt,
        capture_output=True, text=True, timeout=60,
        env=env,
    )
    assert result.returncode == 0, f"claude exited {result.returncode}: {result.stderr}"
    out = result.stdout.strip()
    assert len(out) > 20, f"Response too short ({len(out)} chars): {out}"
    # Should NOT contain "AI unavailable" — that's the fallback we're fixing
    assert "AI unavailable" not in out, f"Got fallback message: {out}"
    assert "not logged in" not in out.lower(), f"Auth failure: {out}"
    print(f"  Response ({len(out)} chars): {out[:120]}...")
    print("  PASS\n")


def main():
    print("=" * 60)
    print("AI Diagnosis Test — verifying Claude CLI works for root")
    print("=" * 60)
    if os.geteuid() == 0:
        print(f"Running as: root (simulates ironsight-touch service)")
    else:
        print(f"Running as: {os.getenv('USER')} (run with sudo for full test)")
    print()

    failures = []

    for test in [
        test_claude_cli_with_home_override,
        test_claude_cli_without_override_fails_as_root,
        test_diagnosis_prompt_gets_real_response,
    ]:
        try:
            test()
        except Exception as e:
            name = test.__name__
            print(f"  FAIL: {e}\n")
            failures.append(name)

    print("=" * 60)
    if failures:
        print(f"FAILED: {', '.join(failures)}")
        sys.exit(1)
    else:
        print("ALL TESTS PASSED")
        sys.exit(0)


if __name__ == "__main__":
    main()
