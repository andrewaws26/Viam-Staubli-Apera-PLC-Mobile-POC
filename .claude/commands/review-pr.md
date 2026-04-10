Review an open pull request using your local Claude CLI session.

If the user specifies a PR number, use that. Otherwise, list open PRs and review the most recent one.

## Steps

1. Get the PR details:
   ```bash
   gh pr view <number> --json title,body,changedFiles,additions,deletions
   ```

2. Get the full diff:
   ```bash
   gh pr diff <number>
   ```

3. Review the diff for:
   - **Bugs or logic errors** — off-by-one, null checks, race conditions
   - **Security issues** — credential leaks, SQL injection, XSS, auth bypass
   - **Project rule violations** (from CLAUDE.md):
     - Never use DD1 for distance (must use DS10)
     - Never disable CAN bus listen-only mode
     - Viam credentials must stay server-side
     - Auth middleware is default-deny
     - Journal entries must balance (debits = credits)
   - **Breaking changes** to existing behavior
   - **Missing tests** for new functionality

4. Be concise. Only flag actual issues — do not suggest style changes, variable renames, or comment additions. If everything looks good, say so in one sentence.

5. Optionally post the review as a PR comment:
   ```bash
   gh pr comment <number> --body "<review>"
   ```
   Ask before posting the comment.
