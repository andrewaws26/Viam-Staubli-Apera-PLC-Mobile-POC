# Mission Brief: Full Claude Code Autonomous Setup

## Objective

Set up Claude Code's native configuration layer for the IronSight project. Currently all autonomous automation is script-based (self-heal.py, watchdog.sh, fleet-sync.sh). The `.claude/` directory doesn't exist in git — no hooks, no custom commands, no project settings. This brief adds all of it plus turn limits on existing automation.

## Environment Assumptions

- **Primary dev machine: macOS** — all slash commands and hooks must work on Mac
- **Claude CLI runs via subscription** — no API billing, so `--max-budget-usd` is not applicable
- **Pi 5 is remote** — may or may not be reachable via Tailscale SSH (100.112.68.52)
- **CAN bus listen-only is a PHYSICAL SAFETY requirement** — not just data quality, but truck ECU safety

## Current State

**What works (script-based, already deployed on Pi 5):**
- `scripts/self-heal.py` — cron every 2 min, Tier 1 offline fixes + Tier 2 Claude escalation (3 calls/hr max)
- `scripts/watchdog.sh` — cron every 5 min, health checks + Claude fix with hysteresis
- `scripts/fleet/fleet-sync.sh` — cron every 10 min, auto-pull + restart on module changes
- `.github/workflows/ci.yml` — dashboard lint/test/build/deploy on push
- `.github/workflows/dev-pi.yml` — self-hosted Pi runner with manual claude-session task

**What's missing (Claude Code native features):**
- No `.claude/` directory tracked in git (`.claude/` is gitignored on line 23 of `.gitignore`)
- No hooks (PreToolUse, PostToolUse, Stop)
- No custom slash commands
- No `--max-turns` on watchdog/self-heal Claude calls
- No Python module tests in CI (297 tests only run manually)

## Tasks

### 1. Update `.gitignore` (line 23)

Change `.claude/` to `.claude/settings.local.json` so that `.claude/settings.json` and `.claude/commands/` get committed while local overrides stay private.

### 2. Create `.claude/settings.json` with hooks

**PreToolUse hook** (matcher: `Bash`) — Safety guard that reads the command from stdin JSON and blocks dangerous operations. The script MUST:

- Use Python (not jq) for JSON parsing — guaranteed available on both macOS and Pi
- **Fail closed**: if JSON parsing fails or stdin is empty, block the command and warn
- Read stdin JSON, extract the `input.command` field, check against patterns
- Exit 0 to allow, exit 2 with a reason message on stderr to block

**Patterns to block:**
- `rm -rf /` or `rm -rf ~` (catastrophic delete)
- `git push --force` to main/master
- Direct `git push` to main/master without going through a branch
- **CAN bus safety (CRITICAL)**: Any command containing `can0` that brings the interface up without `listen-only on`. This MUST catch:
  - Bare commands: `ip link set can0 up type can bitrate 250000`
  - With sudo: `sudo ip link set can0 up ...`
  - Inside SSH: `ssh pi "ip link set can0 up ..."` or `ssh andrew@100.112.68.52 "...can0..."`
  - The ONLY allowed `can0 up` pattern is one that also contains `listen-only on`
  - `can0 down` is safe (just removes the interface, no transmission) — do NOT block
  - When in doubt, BLOCK. A false positive is an inconvenience. A false negative is a safety hazard on a 60,000 lb truck.

**PostToolUse hook** (matcher: `Bash`) — Audit trail that appends a JSON line to `~/.claude/audit.jsonl` after every Bash command with timestamp, command, and exit code. Use Python for JSON serialization. Lightweight append only.

### 3. Create custom slash commands in `.claude/commands/`

Each `.md` file becomes a `/command-name` slash command. Create these 5:

**`health-check.md`** — Fleet health diagnostics (Pi-targeted via SSH):
- Note at the top: "Requires Pi 5 reachable at 100.112.68.52 via Tailscale"
- SSH into the Pi and run:
  - Check viam-server status (`systemctl is-active viam-server`)
  - Check CAN bus (`ip link show can0`)
  - Check PLC reachability (`ping -c 1 -W 2 169.168.10.21`)
  - Check disk/memory (`df -h /`, `free -h`)
  - Check recent viam-server errors (`journalctl -u viam-server --since "5 min ago" --no-pager | tail -20`)
- Report results in a structured summary table
- If SSH fails, report that Pi is unreachable and suggest checking Tailscale

**`run-tests.md`** — Run the full test suite (works on Mac):
- Python plc-sensor tests: `python3 -m pytest modules/plc-sensor/tests/ -v`
- Python j1939-sensor tests: `python3 -m pytest modules/j1939-sensor/tests/ -v`
- Dashboard unit tests: `cd dashboard && npx vitest run`
- IMPORTANT: Run the two pytest suites as separate commands (conftest collision if combined)
- Report pass/fail counts for each

**`check-plc.md`** — Test PLC Modbus TCP connection (Pi-targeted via SSH):
- Note at the top: "Requires Pi 5 reachable at 100.112.68.52 via Tailscale"
- SSH into Pi and run `python3 scripts/test_plc_modbus.py` if it exists
- Otherwise manually test with a Python snippet that connects to 169.168.10.21:502 and reads DS1-DS10
- Report current register values

**`deploy.md`** — Guided deployment workflow (works on Mac):
- Run tests first (pytest + vitest)
- Check git status for uncommitted changes
- Confirm current branch (warn if on main — should use feature branch + PR)
- Push to current branch with `git push -u origin <branch>`
- Remind: never push directly to main, always PR

**`field-status.md`** — Read field status (Pi-targeted via SSH):
- Note at the top: "Requires Pi 5 reachable at 100.112.68.52 via Tailscale"
- SSH into the Pi and read:
  - Self-heal status from `/tmp/ironsight-heal-status.json`
  - Recent incidents from `scripts/incidents/` (last 3 files)
  - Field log tail from `/var/log/ironsight-field.jsonl` (last 20 lines)
- Summarize: what's healthy, what's degraded, any recent Claude interventions
- If SSH fails, report that Pi is unreachable

### 4. Add turn limits to automation scripts

**`scripts/watchdog.sh`** — Add `--max-turns 15` to the Claude CLI invocation. The current line is:
```bash
timeout 300 /usr/local/bin/claude -p "$PROMPT" --dangerously-skip-permissions --output-format text >> "$FIX_LOG" 2>&1
```
Add `--max-turns 15` before `>>`.

**`scripts/self-heal.py`** — Add `--max-turns 15` to the Claude CLI invocation. The current code is:
```python
code, out = run(
    f'cd {PROJECT_DIR} && /usr/local/bin/claude -p "{prompt}" '
    f'--dangerously-skip-permissions --output-format text',
    timeout=300
)
```
Add `--max-turns 15` to the command string.

### 5. Add Python tests to CI

**`.github/workflows/ci.yml`** — Add a `test-python` job that runs alongside the existing `test` job:
- Use `actions/setup-python@v5` with Python 3.11
- Install requirements for each module
- Run pytest for plc-sensor and j1939-sensor as **separate steps** (conftest collision if combined in one pytest invocation)
- Add `test-python` to the `needs` list of the `build` job so Python test failures block deployment

## Branch

Create a fresh branch off `develop` (e.g., `claude/setup-claude-code-config`). Commit with clear messages. Push when done.

## Verification

After all changes:
1. Confirm `.claude/settings.json` and `.claude/commands/*.md` exist and are tracked by git
2. Confirm `.claude/settings.local.json` is still gitignored
3. Confirm the PreToolUse hook blocks `ip link set can0 up type can bitrate 250000` (no listen-only)
4. Confirm the PreToolUse hook allows `ip link set can0 up type can bitrate 250000 listen-only on`
5. Confirm the PreToolUse hook blocks `ssh pi "ip link set can0 up type can bitrate 250000"`
6. Confirm the PreToolUse hook allows `ip link set can0 down`
7. Confirm `scripts/watchdog.sh` has `--max-turns 15`
8. Confirm `scripts/self-heal.py` has `--max-turns 15`
9. Confirm `.github/workflows/ci.yml` has a `test-python` job with separate pytest steps
10. Run `cd dashboard && npx next build` to verify no build breakage (if node is available)
