/**
 * AutoFix — detect-diagnose-review-fix-verify pipeline.
 *
 * Two modes:
 *   diagnoseOnly  — run real tools, capture errors, return diagnosis (DEFAULT)
 *   full          — diagnose → branch → fix → verify → show diff (explicit approval)
 *
 * The key insight: auto-fix should NEVER silently change code. On a codebase with
 * payroll tax, accounting, and 60+ tables, confidence comes from SEEING what the
 * agent found and what it wants to do — then choosing to let it proceed.
 *
 * Flow:
 *   1. Health check fails
 *   2. Agent auto-diagnoses (runs real tool, captures errors) — always safe
 *   3. Watch view shows diagnosis + "Review & Fix" button
 *   4. You click "Review & Fix" → agent branches, fixes, verifies, shows diff
 *   5. You review the diff and either keep it (merge) or discard it
 */

const path = require("path");
const { exec } = require("./executor");

const FIX_STRATEGIES = {
  tests: {
    label: "Tests",
    diagnose: (dir) => ({ cmd: "npx", args: ["vitest", "run", "--reporter=verbose"], cwd: path.join(dir, "dashboard"), timeout: 180_000 }),
    fixPrompt: (errors) => `Tests are failing. Here's the actual error output:\n\n\`\`\`\n${errors}\n\`\`\`\n\nFix the failing tests. Read the test files and source code, fix the root cause. Run the tests again to verify.`,
    maxAttempts: 3,
  },
  typecheck: {
    label: "TypeScript",
    diagnose: (dir) => ({ cmd: "npx", args: ["tsc", "--noEmit"], cwd: path.join(dir, "dashboard"), timeout: 60_000 }),
    fixPrompt: (errors) => `TypeScript errors:\n\n\`\`\`\n${errors}\n\`\`\`\n\nFix the type errors. Don't use \`any\` or \`@ts-ignore\`. Run tsc --noEmit to verify.`,
    maxAttempts: 3,
  },
  build: {
    label: "Build",
    diagnose: (dir) => ({ cmd: "npx", args: ["next", "build"], cwd: path.join(dir, "dashboard"), timeout: 300_000 }),
    fixPrompt: (errors) => `Build is failing:\n\n\`\`\`\n${errors}\n\`\`\`\n\nFix the build errors. Run next build to verify.`,
    maxAttempts: 2,
  },
  lint: {
    label: "Lint",
    diagnose: (dir) => ({ cmd: "npx", args: ["eslint", ".", "--format", "compact"], cwd: path.join(dir, "dashboard"), timeout: 60_000 }),
    fixPrompt: (errors) => `Lint errors:\n\n\`\`\`\n${errors}\n\`\`\`\n\nFix the lint errors. Keep changes minimal.`,
    maxAttempts: 3,
  },
};

function createAutoFix({ repoRoot, store, onProgress }) {
  const STORE_KEY = "autofix-history";
  const STORE_DIAG = "autofix-diagnoses";
  const attempts = new Map();
  const history = store?.get(STORE_KEY) || [];
  const diagnoses = new Map(); // checkId -> { errors, diagnosedAt, label }
  const globalRuns = [];
  let activeRun = null;

  // Restore persisted diagnoses
  const savedDiag = store?.get(STORE_DIAG) || {};
  for (const [k, v] of Object.entries(savedDiag)) diagnoses.set(k, v);

  function save() {
    store?.set(STORE_KEY, history.slice(-50));
  }

  function saveDiagnoses() {
    store?.set(STORE_DIAG, Object.fromEntries(diagnoses));
  }

  function canRun(checkId) {
    const oneHourAgo = Date.now() - 3_600_000;
    const recentGlobal = globalRuns.filter((t) => t > oneHourAgo);
    if (recentGlobal.length >= 5) return { ok: false, reason: "Rate limit: 5/hour max" };

    const attempt = attempts.get(checkId);
    if (attempt) {
      const strategy = FIX_STRATEGIES[checkId];
      if (attempt.count >= (strategy?.maxAttempts || 3)) return { ok: false, reason: `Max attempts (${attempt.count}) reached` };
      const cooldown = Date.now() - attempt.lastAttempt;
      if (cooldown < 600_000) return { ok: false, reason: `Cooldown: ${Math.ceil((600_000 - cooldown) / 60_000)}m` };
    }

    if (activeRun) return { ok: false, reason: `Already running: ${activeRun}` };

    return { ok: true };
  }

  /**
   * Diagnose only — run the real tool, capture errors, store the diagnosis.
   * Safe to run automatically. Does NOT change any code.
   */
  async function diagnose(checkId) {
    const strategy = FIX_STRATEGIES[checkId];
    if (!strategy) return null;

    notify("progress", checkId, { phase: "diagnose", detail: `Diagnosing ${strategy.label}...` });

    const diagOpts = strategy.diagnose(repoRoot);
    const diagResult = await exec(diagOpts.cmd, diagOpts.args, { cwd: diagOpts.cwd, timeout: diagOpts.timeout });
    const errorOutput = (diagResult.stdout + "\n" + diagResult.stderr).slice(-8000);

    if (diagResult.exitCode === 0) {
      // It's actually passing — clear any stale diagnosis
      diagnoses.delete(checkId);
      saveDiagnoses();
      return { passing: true };
    }

    const diagnosis = {
      checkId,
      label: strategy.label,
      errors: errorOutput,
      errorCount: countErrors(checkId, errorOutput),
      diagnosedAt: new Date().toISOString(),
      exitCode: diagResult.exitCode,
    };

    diagnoses.set(checkId, diagnosis);
    saveDiagnoses();

    notify("diagnosed", checkId, diagnosis);

    return diagnosis;
  }

  /**
   * Full fix — diagnose → create branch → Claude fixes → verify → capture diff.
   * Only runs when explicitly triggered by the user. Creates a branch for safety.
   */
  async function fix(checkId) {
    const strategy = FIX_STRATEGIES[checkId];
    if (!strategy) return { success: false, reason: `No strategy for: ${checkId}` };

    const check = canRun(checkId);
    if (!check.ok) return { success: false, reason: check.reason };

    activeRun = checkId;
    const attempt = attempts.get(checkId) || { count: 0, lastAttempt: 0 };
    attempt.count++;
    attempt.lastAttempt = Date.now();
    attempts.set(checkId, attempt);
    globalRuns.push(Date.now());

    const entry = {
      checkId,
      label: strategy.label,
      attempt: attempt.count,
      startedAt: new Date().toISOString(),
      phases: [],
      success: false,
      diff: null,
      branch: null,
    };

    notify("started", checkId, { attempt: attempt.count, label: strategy.label });

    try {
      // Phase 1: Create a safety branch
      const branchName = `autofix/${checkId}-${Date.now()}`;
      const currentBranch = (await exec("git", ["branch", "--show-current"], { cwd: repoRoot, timeout: 5_000 })).stdout.trim();

      // Stash any uncommitted work first
      const stashResult = await exec("git", ["stash", "push", "-m", `autofix-save-${checkId}`], { cwd: repoRoot, timeout: 10_000 });
      const didStash = !stashResult.stdout.includes("No local changes");

      await exec("git", ["checkout", "-b", branchName], { cwd: repoRoot, timeout: 10_000 });
      entry.branch = branchName;
      entry.phases.push({ phase: "branch", detail: `Created ${branchName}` });
      notify("progress", checkId, { phase: "branch", detail: `Working on branch ${branchName}` });

      // Phase 2: Get fresh diagnosis
      notify("progress", checkId, { phase: "diagnose", detail: `Running ${strategy.label} check...` });
      const diagOpts = strategy.diagnose(repoRoot);
      const diagResult = await exec(diagOpts.cmd, diagOpts.args, { cwd: diagOpts.cwd, timeout: diagOpts.timeout });
      const errorOutput = (diagResult.stdout + "\n" + diagResult.stderr).slice(-8000);
      entry.phases.push({ phase: "diagnose", exitCode: diagResult.exitCode, output: errorOutput.slice(-2000) });

      if (diagResult.exitCode === 0) {
        // Already passing — clean up branch
        await exec("git", ["checkout", currentBranch], { cwd: repoRoot, timeout: 10_000 });
        await exec("git", ["branch", "-D", branchName], { cwd: repoRoot, timeout: 10_000 });
        if (didStash) await exec("git", ["stash", "pop"], { cwd: repoRoot, timeout: 10_000 });
        entry.success = true;
        entry.phases.push({ phase: "skip", detail: "Already passing" });
        notify("complete", checkId, { success: true, detail: "Already passing", needsReview: false });
        history.push(entry); save(); activeRun = null;
        return { success: true, reason: "Already passing" };
      }

      // Phase 3: Claude fixes on the branch
      notify("progress", checkId, { phase: "fix", detail: "Claude is working on a fix..." });
      const fixResult = await exec("claude", [
        "-p", strategy.fixPrompt(errorOutput),
        "--output-format", "text",
        "--dangerously-skip-permissions",
        "--max-turns", "15",
      ], {
        cwd: repoRoot, shell: false, timeout: 300_000,
        onStdout: (chunk) => notify("progress", checkId, { phase: "fix", chunk }),
      });
      entry.phases.push({ phase: "fix", exitCode: fixResult.exitCode, output: fixResult.stdout.slice(-2000) });

      // Phase 4: Verify the fix
      notify("progress", checkId, { phase: "verify", detail: "Verifying fix..." });
      const verifyResult = await exec(diagOpts.cmd, diagOpts.args, { cwd: diagOpts.cwd, timeout: diagOpts.timeout });
      entry.phases.push({ phase: "verify", exitCode: verifyResult.exitCode });
      entry.success = verifyResult.exitCode === 0;

      // Phase 5: Capture the diff (so user can review before merging)
      const diffResult = await exec("git", ["diff", "--stat"], { cwd: repoRoot, timeout: 10_000 });
      const fullDiff = await exec("git", ["diff"], { cwd: repoRoot, timeout: 10_000 });
      entry.diff = {
        stat: diffResult.stdout.trim(),
        full: fullDiff.stdout.slice(-15_000),
        filesChanged: (diffResult.stdout.match(/\d+ file/)?.[0] || "0 files"),
      };
      entry.phases.push({ phase: "diff", detail: entry.diff.stat });

      // Go back to original branch — leave the fix branch for review
      await exec("git", ["checkout", currentBranch], { cwd: repoRoot, timeout: 10_000 });
      if (didStash) await exec("git", ["stash", "pop"], { cwd: repoRoot, timeout: 10_000 });

      entry.completedAt = new Date().toISOString();

      notify("complete", checkId, {
        success: entry.success,
        needsReview: true,
        branch: branchName,
        diff: entry.diff,
        detail: entry.success
          ? `Fixed on branch ${branchName}. Review the diff and merge when ready.`
          : `Fix attempted on ${branchName} but verification failed. Review the changes.`,
        attempt: attempt.count,
      });

      if (entry.success) {
        attempts.delete(checkId);
        diagnoses.delete(checkId);
        saveDiagnoses();
      }

      history.push(entry);
      save();
      return {
        success: entry.success,
        branch: branchName,
        diff: entry.diff,
        needsReview: true,
        reason: entry.success ? "Fixed — review diff and merge" : "Verification failed — review changes",
      };
    } catch (err) {
      // Try to get back to the original branch on error
      try {
        const currentBranch = (await exec("git", ["branch", "--show-current"], { cwd: repoRoot, timeout: 5_000 })).stdout.trim();
        if (currentBranch.startsWith("autofix/")) {
          const branches = (await exec("git", ["branch"], { cwd: repoRoot, timeout: 5_000 })).stdout;
          const mainBranch = branches.includes("develop") ? "develop" : branches.includes("main") ? "main" : "main";
          await exec("git", ["checkout", mainBranch], { cwd: repoRoot, timeout: 10_000 });
        }
      } catch {}

      entry.phases.push({ phase: "error", detail: err.message });
      history.push(entry); save();
      notify("complete", checkId, { success: false, detail: err.message, needsReview: false });
      return { success: false, reason: err.message };
    } finally {
      activeRun = null;
    }
  }

  /**
   * Merge an autofix branch into current branch after review.
   */
  async function mergeFix(branch) {
    const result = await exec("git", ["merge", branch, "--no-ff", "-m", `Merge autofix: ${branch}`], { cwd: repoRoot, timeout: 30_000 });
    if (result.exitCode === 0) {
      await exec("git", ["branch", "-d", branch], { cwd: repoRoot, timeout: 10_000 });
      return { success: true };
    }
    return { success: false, reason: result.stderr || "Merge failed" };
  }

  /**
   * Discard an autofix branch.
   */
  async function discardFix(branch) {
    await exec("git", ["branch", "-D", branch], { cwd: repoRoot, timeout: 10_000 });
    return { success: true };
  }

  function notify(event, checkId, data) {
    if (onProgress) onProgress(event, checkId, data);
  }

  function resetAttempts(checkId) {
    if (checkId) attempts.delete(checkId);
    else attempts.clear();
  }

  function getDiagnoses() {
    return Object.fromEntries(diagnoses);
  }

  function getStatus() {
    return {
      active: activeRun,
      strategies: Object.keys(FIX_STRATEGIES),
      diagnoses: Object.fromEntries(diagnoses),
      canFix: Object.keys(FIX_STRATEGIES).reduce((acc, id) => {
        acc[id] = canRun(id);
        return acc;
      }, {}),
      recentHistory: history.slice(-10),
    };
  }

  function getHistory() { return history.slice(-50); }

  return { diagnose, fix, mergeFix, discardFix, canRun, resetAttempts, getDiagnoses, getStatus, getHistory };
}

function countErrors(checkId, output) {
  if (checkId === "tests") return parseInt(output.match(/(\d+) failed/)?.[1] || "0");
  if (checkId === "typecheck") return output.split("\n").filter(l => l.includes("error TS")).length;
  if (checkId === "lint") return parseInt(output.match(/(\d+) error/)?.[1] || "0");
  return 0;
}

module.exports = { createAutoFix, FIX_STRATEGIES };
