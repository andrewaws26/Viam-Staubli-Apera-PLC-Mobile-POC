Guided deployment workflow (works on Mac).

Follow these steps in order:

1. **Run tests** — Execute the full test suite:
   - `python3 -m pytest modules/plc-sensor/tests/ -v`
   - `python3 -m pytest modules/j1939-sensor/tests/ -v`
   - `cd dashboard && npx vitest run`
   - If any tests fail, STOP and report failures. Do not proceed.

2. **Check git status** — Look for uncommitted changes:
   - `git status`
   - If there are uncommitted changes, warn and ask whether to proceed.

3. **Check branch** — Verify we're NOT on main:
   - `git rev-parse --abbrev-ref HEAD`
   - If on `main`, STOP and warn: "You're on main. Create a feature branch first."
   - If on `develop` or a feature branch, proceed.

4. **Push** — Push current branch to remote:
   - `git push -u origin <current-branch>`

5. **Remind** — After pushing, remind:
   - Never push directly to main, always use a PR
   - Dashboard deploys via Vercel on push to main (after PR merge)
   - If Vercel doesn't auto-deploy: `vercel --prod --yes` from repo root (NOT from dashboard/)
