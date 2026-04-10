# IronSight Dev — Command Center

**Date**: 2026-04-09
**Type**: Native macOS Electron app
**Purpose**: System clarity, AI team standups, autonomous dev assistance

## Overview

IronSight Dev is a native macOS app that replaces the old tray-only dev utility with a full command center. It gives a solo developer instant visibility into system health, AI-powered virtual teams that proactively surface issues, and a prompt library for common development tasks.

The app runs as a proper Dock app with menu bar, keyboard shortcuts, and persistent window state.

## Architecture

```
dev-app/
  main.js              # Orchestrator: app lifecycle, IPC, window, tray, menus
  index.html           # UI: markup + styles + renderer JS (single file)
  preload.js           # IPC bridge (contextIsolation)
  lib/
    executor.js        # Shell execution with streaming, cancellation, timeout
    health.js          # 11 health checks with registry pattern + caching
    context.js         # Git context builder + smart context for Claude
    feed.js            # Unified change feed (git + workflows + GitHub PRs)
    templates.js       # Conditional prompt templates based on health state
    teams.js           # 8 AI teams with standups, chat, learning, inter-team comms
```

### Data Flow

```
Health Engine → IPC → Renderer (tiles)
Teams Engine → Claude CLI → IPC → Renderer (findings/chat)
Git/Supabase → Feed Merger → IPC → Renderer (timeline)
electron-store → Conversations, Memories, Settings, Credentials
```

## AI Teams

Eight virtual teams powered by Claude CLI (`claude -p`), each with a domain persona:

| Team | ID | Focus | Key Prompt Areas |
|------|----|-------|-----------------|
| **PM** | `pm` | Prioritization | Receives ALL team findings, sequences work for solo dev |
| **QA** | `qa` | Test quality | Coverage gaps, flaky tests, missing edge cases |
| **Dev** | `dev` | Code quality | Tech debt, unused code, complex functions |
| **DB** | `db` | Schema integrity | Migrations, indexes, N+1 queries, RLS |
| **Security** | `security` | Auth & deps | npm audit, auth bypass, secrets exposure |
| **Finance** | `finance` | Accounting | Double-entry integrity, tax accuracy, audit trails |
| **IT** | `it` | Infrastructure | Vercel, Supabase, Pi fleet, CI/CD |
| **Marketing** | `marketing` | Go-to-market | Positioning, messaging, competitive differentiation |

### How Teams Work

1. **Standup**: Each team runs a Claude analysis against current system context (git state, health checks, recent changes). Domain teams run in parallel, then PM runs after with all findings.
2. **Chat**: Ongoing conversation with the team's persona + system context injected. Last 10 messages sent for continuity.
3. **Inter-team**: One team can ask another a question. Both conversations are logged in their respective histories.
4. **Learning**: Teams store corrections, preferences, and learned patterns in memory. This memory is injected into every prompt so teams adapt over time.
5. **Streaming**: All Claude calls stream output to the renderer in real-time via IPC events.

### Team Memory System

Each team has persistent memory stored in electron-store:

- **Corrections**: "Don't suggest @ts-ignore, use proper types" — things the user corrected
- **Preferences**: "Always run tests before suggesting deploys" — how the team should work
- **Learnings**: "The accounting module uses DB triggers for balance enforcement" — codebase knowledge

Memory is injected into every prompt (standup and chat) so teams don't repeat mistakes. Users can add, remove, and clear memories via the UI.

## Health Check Engine

11 checks across two categories, each with configurable intervals and state transition notifications:

**Code Quality** (manual/scheduled):
- `git` — branch, dirty files, unpushed commits (15s)
- `tests` — vitest run with JSON reporter (manual)
- `build` — next build (manual)
- `typecheck` — tsc --noEmit (5min, staggered)
- `lint` — eslint with max-warnings (5min, staggered)
- `deps` — npm audit (30min)

**Services** (polling):
- `vercel` — production URL health + response time (60s)
- `supabase` — client query latency (60s)
- `ci` — GitHub Actions latest run status (60s)
- `pi` — device heartbeat from Supabase (60s, also push via Realtime)
- `migrations` — count of .sql files in supabase/migrations (5min)

### Key Design Decisions

- **Registry pattern**: Each check is a function returning `{ status, summary, detail }`. Add new checks by adding to the registry array.
- **State transitions only**: macOS notifications fire only on ok→fail and fail→ok, not on every poll.
- **Staggered startup**: Cheap checks (git, services) run immediately; expensive checks (tests, build, lint) stagger at 5/15/25s to avoid startup spike.
- **Running guard**: A `Set` prevents duplicate concurrent checks.

## Smart Context System

Every Claude invocation (templates, team chat, standups, dev assist) auto-injects system context:

```markdown
## Current System State
- Branch: develop (3 dirty files, 1 unpushed)
- Failing: tests (2 fail), typecheck (3 errors)
- Changed: dashboard/app/api/foo/route.ts, dashboard/lib/bar.ts

### Failure Details
[first 2000 chars of failing output per check]
```

This means Claude always knows what's happening before answering.

## UI Layout

```
┌──────────────────────────────────────┐
│  ● ● ●  IronSight Dev  [HEALTHY]    │  titlebar (draggable)
├─────┬────────────────────────────────┤
│  S  │  [content area]               │
│ ALL │  System: health grid + feed    │
│ DEV │  Team: findings + chat         │
│ --- │  Standup: all teams grid       │
│  P  │  Assist: prompt library        │
│ --- │  Settings: theme, creds        │
│ Q D │                                │
│ S F │                                │
│ I M │                                │
│     │                                │
│  ⚙  │                                │
├─────┴────────────────────────────────┤
│  ● 11/11 healthy │ Pi 5: online     │  status bar
└──────────────────────────────────────┘
```

Sidebar items:
- **S** — System view (health grid, attention banner, prompt bar, feed, output, workflows)
- **ALL** — Unified standup (all teams on one page, PM decision at top)
- **DEV** — Developer Assist (16-prompt library by category + custom prompt)
- **P** — PM team (receives all team findings)
- **Q/D/S/F/I/M** — Domain teams (QA, Dev, DB, Security, Finance, IT, Marketing)
- **⚙** — Settings (theme, Claude model, credentials, health check toggles)

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+Shift+I | Toggle window |
| Cmd+R | Refresh all health checks |
| Cmd+, | Settings |
| Cmd+1 | System view |
| Cmd+2-8 | Team views (QA, Dev, DB, Security, Finance, IT, Marketing) |
| Cmd+9 | PM view |
| Cmd+0 | Unified standup |

## Credentials

Stored in electron-store (encrypted on macOS), NOT in code or .env:
- **Supabase Access Token** — CLI token for DB migrations
- **Vercel Token** — CLI token for manual prod deploys
- **Resend API Key** — Email API for notifications

Manage via Settings > Service Credentials in the UI.

## Change Feed

Merges three sources into a unified reverse-chronological timeline:
1. **Git log** — last 20 commits with hash, message, date
2. **Workflow runs** — from Supabase `workflow_runs` table
3. **GitHub PRs** — via `gh pr list --json` with CI status check rollup

## Prompt Templates

6 conditional templates that activate based on health state:

| Template | Active When | Action |
|----------|------------|--------|
| Fix Failing Tests | tests=fail | Fix source code, not test expectations |
| Fix TypeScript | typecheck=fail | Fix type errors, no `any` or `@ts-ignore` |
| Review Changes | git dirty | Review for bugs, security, performance |
| Write Tests | git dirty | Vitest tests following existing patterns |
| Deploy to Prod | always | Typecheck → test → build → vercel --prod → verify |
| Explain Error | any fail | Root cause and fix |

## Prompt Library (Dev Assist)

16 categorized prompts for common dev tasks:

- **Fix**: Tests, TypeScript errors, lint warnings
- **Review**: Changes, production readiness
- **Write**: Unit tests, E2E tests
- **Deploy**: Full production deploy pipeline
- **Explain**: Error root cause analysis
- **Improve**: Feature suggestions, performance audit, accessibility
- **Architecture**: Refactoring, API audit
- **Marketing**: Landing page copy, pitch deck

## Adding New Features

### Add a new health check

1. Add to the `CHECKS` array in `lib/health.js`:
```javascript
{ id: "mycheck", label: "My Check", category: "code", interval: 300_000,
  run: async (opts) => {
    const result = await exec("my-command", [...], { timeout: 30_000 });
    return { status: result.exitCode === 0 ? "ok" : "fail", summary: "...", detail: {} };
  }
}
```

### Add a new AI team

1. Add to the `TEAMS` array in `lib/teams.js`:
```javascript
{ id: "newteam", label: "NewTeam", icon: "N", color: "#...",
  systemPrompt: `You are the ... for IronSight. Focus on: ...`,
  standupPrompt: (ctx) => `${ctx}\n\n## Standup Request\n...`
}
```
2. Add to `DOMAIN_TEAMS` array in `index.html`
3. Add to `TEAM_LABELS`, `TEAM_COLORS`, `TEAM_SUBTITLES` in `index.html`
4. Add a View menu item in `main.js` buildAppMenu()

### Add a new feed source

1. Create an async getter in `lib/feed.js`:
```javascript
async function getMyFeed(opts) {
  // Return array of { type, timestamp, title, status, detail }
}
```
2. Add to `Promise.all` in `getChangeFeed()`

### Add a new prompt template

1. Add to `TEMPLATES` array in `lib/templates.js`
2. It auto-appears in the smart bar when its `active` condition is met

### Add a new prompt to the library

1. Add to `PROMPT_LIBRARY` in `index.html`:
```javascript
{ cat: "Category", title: "Title", desc: "Description", prompt: "Full prompt text" }
```

## Running

```bash
cd dev-app
npm install
npm start
```

Requires: Node.js 18+, `claude` CLI in PATH, `gh` CLI for PR feed, Supabase env vars in `dashboard/.env.local`.

## Dependencies

- `electron` — native macOS app
- `electron-store` — persistent settings, conversations, team memories
- `@supabase/supabase-js` — workflow runs, heartbeats, Realtime subscriptions
- `node-cron` — scheduled workflow execution

## For Future Claude Instances

When picking up work on the dev app:

1. **Read this file** and `docs/session-handoff.md` for full project context
2. **Read `CLAUDE.md`** in the repo root for project rules and conventions
3. **Start the app** with `cd dev-app && npm start` to see current state
4. **The code is in 9 files** — 6 lib modules + main.js + preload.js + index.html
5. **index.html is a single file** with styles, markup, and all renderer JS inline. This is intentional — no build step, no framework, just DOM manipulation.
6. **Teams use Claude CLI** (`claude -p` with `shell: false`). Output streams via IPC events.
7. **electron-store** persists everything: window bounds, settings, credentials, conversations, team memories
8. **Adding features** follows the patterns above — each concern is isolated in its own lib file
9. **Never hardcode credentials** — they go in electron-store via the Settings UI
10. **PM team runs last** in standups so it has all other teams' findings
