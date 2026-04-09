# IronSight Overnight QA Report

**Date:** 2026-04-09 ~04:07 AM EDT (automated overnight run)
**Overall Health:** RED — dashboard build broken, mobile type errors, Maestro build failure
**Health Score: 55/100**

---

## 1. Web Dashboard — Unit Tests (Vitest)

**Result:** 1,213 passed / 1 failed (27 test files passed, 1 failed)
**Duration:** 510s

| Suite | Result |
|-------|--------|
| 27 test files | PASS |
| `accounting-integration.test.ts` | 1 FAIL — `rejects negative payment amount on invoice_payments` timed out (5000ms) |

**Analysis:** The single failure is a Supabase integration test that timed out — likely network latency to Supabase during the overnight window, not a code bug. All 1,213 other tests pass including the 182 new report generator/validator tests.

---

## 2. Web Dashboard — Build (`next build`)

**Result:** FAIL

```
PageNotFoundError: Cannot find module for page: /api/accounting/accounts
```

**Root Cause:** The `/api/accounting/accounts` API route file is missing or mislocated. Next.js found a reference to this route (likely in the pages manifest or a redirect) but the actual route handler file doesn't exist at the expected path.

**Severity:** HIGH — this blocks production deployment. The build compiled successfully but failed during page data collection.

**Fix needed:** Verify `dashboard/app/api/accounting/accounts/route.ts` exists and exports proper handlers.

---

## 3. Web Dashboard — Playwright E2E

**Result:** 13 passed / 17 failed (30 tests, 1.2 hours)

| Category | Passed | Failed | Detail |
|----------|--------|--------|--------|
| API Health Checks | 7 | 2 | Truck Readings + DTC History timed out (~8.5 min each) |
| API Edge Cases | 3 | 1 | `work-orders PATCH without ID` timed out (~8.7 min) |
| Page Screenshots | 0 | 6 | All hit Clerk auth redirect — homepage, fleet, work board, shift report, dev, My Work |
| UI Interactions | 0 | 4 | Auth redirect — card expand, create modal, subtask toggle, nav links |
| Responsive Layout | 0 | 3 | Auth redirect — mobile, tablet, TV/touch viewports |
| Performance | 0 | 1 | Auth redirect — work board load time can't be measured |

**Root Causes:**
1. **14 of 17 failures:** Clerk auth redirect — no test session token, all page navigations land on sign-in
2. **3 of 17 failures:** API timeouts (Truck Readings, DTC History, work-orders PATCH) — likely Viam/Supabase latency during overnight window

**Fix needed:** Clerk test account + Playwright `globalSetup.ts` for authenticated sessions. API timeouts may need increased test timeout or retry logic.

---

## 4. iOS Mobile — TypeScript Check (`tsc --noEmit`)

**Result:** FAIL — 20 errors across 4 files

| File | Errors | Issue |
|------|--------|-------|
| `cell.tsx` | 9 | `BadgeProps` missing `color` property — Badge component needs `color` and `backgroundColor` in its type definition |
| `StatusBanner.tsx` | 8 | Color hex literals not assignable to narrow theme types — needs wider `string` type or union |
| `gps-tracker.ts` | 1 | `TaskManagerTaskExecutor` expects `Promise<any>` return but callback returns `void` |
| `ai/chat/[truckId].tsx` | 1 | `TruckSensorReadings` missing index signature for `Record<string, unknown>` |
| `chat-store.test.ts` | 1 | Cannot find module `../../packages/shared/src/chat` — should use `@ironsight/shared/chat` |

**Analysis:** The `cell.tsx` + `StatusBanner.tsx` errors (17 total) are from recent UI feature additions where the component types weren't updated to match usage. Pre-existing, not regressions.

---

## 5. iOS Mobile — Maestro E2E

**Result:** FAIL — build failure, no flows executed

```
CommandError: Unknown arguments: --simulator
pod install --repo-update exited with non-zero code: 1
xcodebuild: error: 'ios/*.xcworkspace' does not exist
```

**Root Cause:** Multi-layer failure:
1. `expo run:ios --simulator` flag is invalid in current Expo CLI version (should be `--device` or just `npx expo run:ios`)
2. Fallback to `npx expo prebuild` + `xcodebuild` failed because `pod install` errored
3. Glob pattern `ios/*.xcworkspace` didn't resolve (needs exact workspace name)

**Fix needed:** Update Maestro QA script to use current Expo CLI syntax. The `--simulator` flag was removed in newer Expo versions.

---

## 6. Visual Review

| Screenshot | Status | Notes |
|------------|--------|-------|
| `01-homepage.png` | WARN | Dark/blank — likely pre-auth loading state, no visible content |

No additional page screenshots were captured due to Playwright producing zero results.

---

## Prioritized Recommendations

### Critical (blocks deployment)
1. **Fix dashboard build — missing `/api/accounting/accounts` route.** Verify the route file exists and exports GET/POST handlers. This blocks `next build` and therefore Vercel deployment.

### High Priority
2. **Fix Playwright auth setup.** Create Clerk test user + `globalSetup.ts` that authenticates once and persists the session. This unblocks all 15 failing E2E tests.
3. **Fix Maestro build script.** Update `expo run:ios` invocation to use current Expo CLI flags. Fix workspace glob in xcodebuild fallback.

### Medium Priority
4. **Add `color` prop to `BadgeProps`** in `mobile/src/components/ui/Badge.tsx`. Clears 9 errors in `cell.tsx`.
5. **Widen `StatusBanner` color types** — use `string` instead of literal theme color types. Clears 8 errors.
6. **Fix `gps-tracker.ts`** — make the `TaskManagerTaskExecutor` callback async (return `Promise`).
7. **Fix `chat-store.test.ts` import** — change `../../packages/shared/src/chat` to `@ironsight/shared/chat`.

### Low Priority
8. **Fix `ai/chat/[truckId].tsx`** — add index signature to `TruckSensorReadings` or cast to `Record<string, unknown>`.
9. **Increase timeout** on `rejects negative payment amount` integration test (or mark as `@slow`).

---

## Test Summary

| Category | Passed | Failed | Skipped |
|----------|--------|--------|---------|
| Dashboard Vitest | 1,213 | 1 | 0 |
| Dashboard Build | — | 1 | — |
| Playwright E2E | 13 | 17 | 0 |
| Mobile TypeScript | — | 20 errors | — |
| Maestro E2E | 0 | 0 | all (build fail) |
| **Total** | **1,226** | **39** | **0** |

---

*Generated by IronSight Overnight QA — Claude Code*
*Previous run: 2026-04-08 02:03 AM — Health: YELLOW (auth issues only)*
*This run: 2026-04-09 ~04:07 AM — Health: RED (build broken + type errors)*
