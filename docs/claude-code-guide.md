# Claude Code CLI — Guide & Shortcuts for TPS/IronSight

## Quick Reference: CLI Shortcuts

### Keyboard Shortcuts (Interactive Mode)

| Shortcut | What it does |
|----------|-------------|
| `Ctrl+C` | Cancel current response (doesn't exit) |
| `Ctrl+C` x2 | Exit Claude Code |
| `Ctrl+L` | Clear screen |
| `Escape` | Clear current input |
| `Up/Down` | Scroll through prompt history |
| `Tab` | Accept autocomplete suggestion |
| `Shift+Tab` | Cycle through autocomplete options |
| `Ctrl+R` | Search prompt history |
| `\` then `Enter` | Multi-line input (newline without submitting) |
| `@` | Reference a file (autocompletes paths) |

### Slash Commands (Type in Interactive Mode)

| Command | What it does |
|---------|-------------|
| `/help` | Show all available commands |
| `/status` | Show current session info (model, tokens, cost) |
| `/model` | Switch model mid-conversation |
| `/clear` | Clear conversation history (fresh start) |
| `/compact` | Summarize conversation to free up context window |
| `/cost` | Show token usage and cost for this session |
| `/login` | Authenticate with Anthropic |
| `/permissions` | View and manage tool permissions |
| `/review` | Review code changes in current session |
| `/memory` | View/edit CLAUDE.md project instructions |
| `/terminal-setup` | Configure terminal integration |

### Useful CLI Flags

```bash
# Headless mode (no interaction — used by watchdog)
claude -p "your prompt here"

# Pipe input
cat error.log | claude -p "What's wrong?"
git diff | claude -p "Review this"

# Resume last session
claude --resume

# Continue a specific session
claude --session-id <id>

# Output formats
claude -p "query" --output-format text      # plain text
claude -p "query" --output-format json      # structured JSON
claude -p "query" --output-format stream-json  # streaming JSON

# Budget and turn limits (important for automation)
claude -p "fix it" --max-turns 15 --max-budget-usd 0.50

# Custom system prompt
claude --system-prompt "You are a PLC debugging expert"
claude --system-prompt-file ./my-prompt.txt
claude --append-system-prompt "Always check eth0 carrier first"

# Model selection
claude --model sonnet    # faster, cheaper
claude --model opus      # smarter, more expensive

# Worktree mode (isolated git branches)
claude -w feature-name   # works in its own branch

# Bare mode (fast startup, skips hooks/MCP)
claude --bare -p "quick question"

# File references
claude --file photo.jpg -p "What's in this image?"
claude --file log.txt --file config.json -p "Find the mismatch"

# Skip permissions (automation only — use carefully)
claude -p "restart service" --dangerously-skip-permissions

# Allowed/disallowed tools
claude --allowedTools "Read,Glob,Grep"  # read-only mode
claude --disallowedTools "Bash"         # no shell access
```

### File References in Chat

In interactive mode, reference files inline with `@`:
```
> What does @modules/plc-sensor/src/plc_sensor.py do with DS registers?
> Compare @config/viam-server.json with @config/fragment-tps-truck.json
```

### Shell Shortcuts

```bash
# Aliases (add to ~/.bashrc)
alias cc='claude'
alias ccp='claude -p'
alias ccr='claude --resume'
alias ironsight='bash scripts/tps-control.sh'

# Quick PLC debug
alias plc-ask='claude --append-system-prompt "You are debugging a Click PLC C0-10DD2E-D connected via Modbus TCP at 169.168.10.21:502" -p'

# Quick log analysis
alias log-check='journalctl -u viam-server --since "5 min ago" --no-pager | claude -p "Summarize any errors"'
```

---

## Improvement Roadmap: What We're Leaving on the Table

### Priority 1 — Quick Wins (do now)

#### Add Budget/Turn Limits to Watchdog
The watchdog runs `claude -p` with a 300s timeout but no turn or budget cap.
If Claude loops at 3am, it burns tokens for 5 minutes straight.

```bash
# In scripts/watchdog.sh, change:
timeout 300 /usr/local/bin/claude -p "$PROMPT" --dangerously-skip-permissions --output-format text

# To:
timeout 300 /usr/local/bin/claude -p "$PROMPT" \
  --dangerously-skip-permissions \
  --output-format text \
  --max-turns 15 \
  --max-budget-usd 0.50
```

#### Add Notifications
Claude writes incident files, but nobody sees them until they SSH in.
Options:
- **Slack webhook**: `curl -X POST -H 'Content-type: application/json' --data '{"text":"IronSight alert: PLC unreachable"}' $SLACK_WEBHOOK_URL`
- **Discord webhook**: Same pattern, different URL format
- **Email via sendgrid/mailgun**: For critical-only alerts
- **Pushover/Ntfy**: Lightweight push notifications to phone

Add a notification step at the end of the watchdog's Claude call for severity >= warning.

### Priority 2 — Medium Effort, High Value

#### CI/CD with GitHub Actions
No `.github/workflows/` exists. Useful pipelines:
- **PR checks**: Lint `plc_sensor.py`, type-check with mypy
- **Dashboard build**: `cd dashboard && npm run build` on every PR
- **Auto-review**: Claude reviews PRs before merge
- **Deploy**: Auto-deploy dashboard to Vercel on merge to main

#### Enrich CLAUDE.md with Failure Playbooks
Current CLAUDE.md is good reference but lacks troubleshooting rules.
Add sections like:
```markdown
## Troubleshooting Playbook
- PLC unreachable → Check eth0 carrier FIRST (`cat /sys/class/net/eth0/carrier`)
- If carrier=0 → Physical issue, no software fix, suppress alerts
- If carrier=1 but PLC unreachable → Check IP config, try ping, restart networking
- OverflowError in plc_sensor → Non-critical, occurs when failure count overflows float
- viam-server won't start → Check /opt/viam-modules symlinks, then journalctl
```
This saves tokens — Claude won't re-diagnose known patterns from scratch.

#### Structured JSON Output for IronSight Server
`ironsight-server.py` calls Claude with `--output-format text` then parses the response.
Switch to `--output-format json` for reliable structured data:
```bash
claude -p "$PROMPT" --output-format json
```
Parse the JSON `result` field instead of hoping text is formatted correctly.

### Priority 3 — Bigger Lifts

#### MCP Servers
MCP (Model Context Protocol) lets you give Claude custom tools beyond bash.
Currently `mcpServers: {}` in project settings.

Useful MCP servers for TPS:
- **Custom PLC MCP**: Wrap Modbus reads as proper tools (`read_register DS1`, `check_encoder`)
- **SQLite MCP**: Query incident history structurally instead of grep'ing markdown
- **Slack MCP**: Let Claude send messages directly when issues arise
- **Filesystem MCP**: Structured file operations with better guardrails

#### Hooks (Hookify is Installed but Unconfigured)
Hookify plugin is installed globally but no project hooks exist.

Useful hooks:
- **PreToolUse**: Block destructive commands (`rm -rf`, `git push --force`) on the Pi
- **PostToolUse**: Audit trail of every command Claude runs (structured log, not just text)
- **Stop hook**: Auto-summarize session and append to a running changelog
- **SessionStart hook**: Pre-load current system state so Claude doesn't have to query it

#### Worktree Mode for Parallel Work
Enabled globally (`tengu_worktree_mode`) but never used.
When you want Claude to work on two things without conflicts:
```bash
# Terminal 1
claude -w fix-overflow-error

# Terminal 2
claude -w update-dashboard
```
Each session gets its own git branch and working directory.

---

## Parallel Tasks: Running Multiple Claude Sessions Safely

### What Are Parallel Tasks?

Claude Code can run multiple independent sessions simultaneously — each working on a
different task, in its own isolated environment. This is powerful when you have several
things to do and they don't depend on each other.

There are three ways to run parallel work:

### Method 1: Worktrees (`-w` flag) — Best for Code Changes

Worktrees give each Claude session its own copy of the repo on a separate git branch.
No two sessions can step on each other's files.

```bash
# Terminal 1: Fix the OverflowError bug
claude -w fix-overflow-error
> Fix the OverflowError in plc_sensor.py line 521 where failure count overflows float

# Terminal 2: Update the dashboard
claude -w update-dashboard
> Add a connection status indicator to the dashboard header

# Terminal 3: Write tests
claude -w add-plc-tests
> Write unit tests for the Modbus register parsing in plc_sensor.py
```

Each session:
- Gets its own git branch (e.g., `fix-overflow-error`)
- Works in an isolated directory (git worktree)
- Can commit independently without merge conflicts
- Merges back when you're ready

**When to use**: Any task that changes files — bug fixes, features, refactors.

### Method 2: Headless Parallel (`-p` flag in background) — Best for Analysis

Run multiple read-only queries in parallel using background processes:

```bash
# Analyze three things at once
claude -p "Review plc_sensor.py for error handling gaps" --output-format text > review-errors.txt &
claude -p "Check watchdog.sh for race conditions" --output-format text > review-watchdog.txt &
claude -p "Audit .claude/settings.local.json permissions for security" --output-format text > review-perms.txt &

# Wait for all to finish
wait
cat review-errors.txt review-watchdog.txt review-perms.txt
```

**When to use**: Code reviews, log analysis, research questions — anything read-only.

### Method 3: Subagents (Inside a Session) — Best for Complex Tasks

Within a single interactive Claude session, Claude can spawn subagents that work in
parallel. You don't control this directly — Claude decides when to parallelize. But
you can prompt for it:

```
> I need three things done in parallel:
> 1. Search the codebase for all TODO comments
> 2. Check if any Python files have unused imports
> 3. Find all hardcoded IP addresses
```

Claude will launch multiple search agents simultaneously and collect results.

**When to use**: When you're already in a session and want Claude to fan out.

### Best Practices

#### Do: Plan Before Parallelizing
Before launching parallel sessions, think about dependencies:
```
Good (independent):
  Session A: Fix bug in plc_sensor.py
  Session B: Update dashboard CSS
  Session C: Write documentation

Bad (conflicts):
  Session A: Refactor plc_sensor.py error handling
  Session B: Add new registers to plc_sensor.py    ← SAME FILE = merge conflict
```

#### Do: Use Budget Limits on Every Parallel Session
Each session burns tokens independently. Three runaway sessions = 3x the cost.
```bash
claude -w fix-bug --max-turns 20 --max-budget-usd 1.00
claude -w update-docs --max-turns 10 --max-budget-usd 0.50
```

#### Do: Use Read-Only Mode for Analysis Tasks
If a parallel session only needs to read code, restrict its tools:
```bash
claude -p "Review this code" --allowedTools "Read,Glob,Grep"
```
This prevents accidental writes from a session that shouldn't be changing anything.

#### Do: Name Worktrees Descriptively
```bash
# Good — clear what each session is doing
claude -w fix-overflow-error-line521
claude -w dashboard-add-status-badge

# Bad — no idea what these are when you come back later
claude -w task1
claude -w branch2
```

#### Don't: Run Too Many Sessions on the Pi
The Raspberry Pi 5 has 8GB RAM. Each Claude session plus its subprocesses uses memory.
Practical limits:
- **2-3 worktree sessions**: Fine on the Pi
- **4+ sessions**: Start watching `htop` for memory pressure
- **Headless `-p` tasks**: Lighter weight, can run 4-5 comfortably

```bash
# Quick check before launching another session
free -h | head -2
```

#### Don't: Parallelize Tasks That Share State
Avoid running parallel sessions that:
- Edit the same file (merge conflicts)
- Restart the same service (race condition)
- Write to the same log or output file
- Both try to commit to the same branch

#### Don't: Forget to Merge Worktrees
Worktree branches don't auto-merge. After parallel work:
```bash
# Check what branches exist
git branch

# Merge each completed worktree branch
git checkout main
git merge fix-overflow-error
git merge dashboard-add-status-badge
git merge add-plc-tests

# Or create PRs for review
gh pr create --head fix-overflow-error --title "Fix OverflowError in plc_sensor"
```

### TPS-Specific Parallel Patterns

Here are practical parallel workflows for this project:

#### Pattern: Debug + Fix + Test
```bash
# Session 1: Investigate the problem
claude -w investigate -p "Analyze the last 50 viam-server errors and identify the root cause"

# Session 2: While that runs, write the test first
claude -w write-test -p "Write a test for plc_sensor.py that verifies encoder overflow handling"
```

#### Pattern: Multi-File Review
```bash
# Review everything in parallel before a deploy
claude -p "Review plc_sensor.py for production readiness" > /tmp/review-sensor.txt &
claude -p "Review watchdog.sh for edge cases" > /tmp/review-watchdog.txt &
claude -p "Review ironsight-server.py for security issues" > /tmp/review-server.txt &
wait && cat /tmp/review-*.txt
```

#### Pattern: Dashboard + Backend Simultaneously
```bash
# Frontend and backend don't share files — safe to parallelize
claude -w dashboard-feature   # works in dashboard/
claude -w plc-sensor-feature  # works in modules/plc-sensor/
```

### Safety Checklist Before Running Parallel Tasks

- [ ] Are the tasks truly independent? (different files, different services)
- [ ] Does the Pi have enough free memory? (`free -h`)
- [ ] Did I set `--max-budget-usd` on each session?
- [ ] Did I set `--max-turns` on unattended sessions?
- [ ] Am I using `--allowedTools` to restrict read-only sessions?
- [ ] Are worktree names descriptive enough to remember later?
- [ ] Do I have a plan to merge the branches afterward?

---

## Current Setup Summary

### How Claude Code is Used Today

| Component | How it calls Claude | Flags |
|-----------|-------------------|-------|
| **Watchdog** (cron, every 5 min) | `claude -p "$PROMPT"` | `--dangerously-skip-permissions --output-format text` |
| **IronSight Server** (HTTP endpoint) | `claude -p "$PROMPT" --file frame.jpg` | `--dangerously-skip-permissions --output-format text` |
| **TPS Control** (`ironsight chat`) | `claude --system-prompt "$REPORT"` | Interactive, no permission skip |
| **Manual SSH** | `claude` | Interactive, project permissions apply |

### Key Config Locations

| File | Purpose |
|------|---------|
| `~/.claude/settings.local.json` | Global permissions (basic read/write/search) |
| `.claude/settings.local.json` | Project permissions (126 rules — journalctl, git, networking, etc.) |
| `~/.claude/plugins/` | 37 installed plugins (hookify, security, code-review, etc.) |
| `CLAUDE.md` | Project context loaded every session |
| `scripts/incidents/*.md` | Incident history (Claude learns from past fixes) |
| `/var/log/claude-fixes.log` | Watchdog fix log |

### Installed But Unused Plugins
These are installed globally but not configured for this project:
- `hookify` — custom hook system
- `code-review` — automated code review
- `commit-commands` — git commit helpers
- `pr-review-toolkit` — PR review automation
- `security-guidance` — security checks on tool use
- `feature-dev` — feature development workflow
- Multiple LSP plugins (Python, TypeScript, Go, Rust, etc.)
