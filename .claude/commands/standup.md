Morning standup — full platform status in one shot.

Gather everything in parallel where possible, then present a single consolidated report.

## 1. Git Activity (last 24 hours)

- `git log --oneline --since="24 hours ago" --all` — Recent commits across all branches
- `git branch -a --sort=-committerdate | head -10` — Active branches
- `git status --short` — Any uncommitted local changes

## 2. Open Pull Requests

- `gh pr list --state open --limit 10` — All open PRs with status
- For each open PR, note CI status: `gh pr checks <number> --required`

## 3. CI Pipeline

- `gh run list --limit 5` — Last 5 GitHub Actions runs with pass/fail
- If any recent run failed, show which job failed: `gh run view <id>`

## 4. Vercel Production Deploy

- `curl -s -o /dev/null -w "%{http_code}" https://viam-staubli-apera-plc-mobile-poc.vercel.app/api/cell-readings?sim=true` — Dashboard health check (expect 200)
- `vercel ls --limit 3 2>/dev/null || echo "Vercel CLI not linked"` — Recent deployments

## 5. Pi 5 Status (best-effort — Pi may be offline)

Try `ssh -o ConnectTimeout=5 andrew@100.112.68.52` for each:
- `uptime && vcgencmd measure_temp 2>/dev/null`
- `systemctl is-active viam-server can0`
- `df -h / | tail -1`
- `cat /tmp/ironsight-heal-status.json 2>/dev/null || echo "No heal status"`

If SSH fails, report "Pi offline (expected — truck-mounted)" and move on. Do NOT treat this as an error.

## 6. Watchdog Incidents (last 24h)

If Pi is reachable:
- `find ~/Viam-Staubli-Apera-PLC-Mobile-POC/scripts/incidents/archive -name "*.md" -mtime -1 2>/dev/null | wc -l` — Incident count
- Show the most recent incident if any exist

If Pi is unreachable, skip this section.

## Report Format

Present as a clean summary table:

```
=== IronSight Morning Standup (YYYY-MM-DD) ===

Git         | X commits, Y open PRs, Z uncommitted files
CI          | Last run: passed/failed (link)
Vercel      | Production: UP/DOWN (HTTP status)
Pi 5        | Online/Offline | viam-server: OK | CAN: OK | Disk: XX%
Incidents   | N in last 24h (or "Pi offline")

Recent Commits:
  - <hash> <message>
  - ...

Open PRs:
  - #N <title> (CI: pass/fail)
  - ...

Action Items:
  - [list anything that needs attention: failed CI, high disk, open incidents]
```

If everything is green, end with: "All clear — nothing needs attention."
