# IronSight System Audit Report

**Date:** 2026-04-02
**Scope:** Full codebase audit — security, dead code, error handling, performance, fleet scaling, UX
**Auditor:** Claude Opus 4.6 (automated deep analysis)
**Status:** Research only — no code changes made

---

## CRITICAL — Outages, Security Issues, Data Loss

### C-1. Hardcoded SSH Credentials in Source Code
**File:** `dashboard/app/api/truck-history-local/route.ts:10-12`
```typescript
const PI_HOST = "100.113.196.68";
const PI_USER = "andrew";
const PI_PASS = "1111";
```
Also in `scripts/fleet/fleet-health.sh:37,39` (`sshpass -p '1111'`) and `CLAUDE.md:239`.

**Issue:** Plaintext SSH password committed to git. Anyone with repo access can connect to the Pi Zero. Password visible in Vercel serverless environment and git history.

**Fix:** Switch to SSH key-based auth. Move credentials to env vars. Rotate Pi Zero password immediately. Scrub from git history.

---

### C-2. Command Injection Risk in truck-history-local
**File:** `dashboard/app/api/truck-history-local/route.ts:28-31`
```typescript
const { stdout } = await execAsync(
  `sshpass -p '${PI_PASS}' ssh -o StrictHostKeyChecking=no ${PI_USER}@${PI_HOST} "sudo tail -${linesToRead} ${filePath}"`,
);
```

**Issue:** Shell command built from string interpolation. `StrictHostKeyChecking=no` disables MITM protection. `sudo` used without TTY. While `linesToRead` is bounded by `Math.min`, this is still a shell execution pattern that should use a Node.js SSH library.

**Fix:** Use a Node.js SSH2 library instead of shell exec. Enable `StrictHostKeyChecking=yes` with managed known_hosts. Remove `sshpass` entirely.

---

### C-3. No Authentication on ironsight-command-center
**File:** `/Users/andrewsieg/ironsight-command-center/server.js:150-212`

**Issue:** All endpoints (`/api/prompts`, `/api/events`, `/api/prompts/launch`) are completely open. Any network client can read, modify, delete prompts and launch arbitrary Claude processes via `launchInTerminal()`. The AppleScript generation at lines 108-120 uses unsanitized user input (`name`), enabling AppleScript injection. Path traversal possible via `status` parameter at line 216.

**Fix:** Add authentication (API key or localhost-only binding). Whitelist `status` values. Escape AppleScript input. Add content-size limits.

---

### C-4. Browser Exposes Viam API Keys via NEXT_PUBLIC_ Variables
**Files:** `dashboard/lib/viam.ts:34-36`, `dashboard/.env.local:28,31,70-73`

**Issue:** `NEXT_PUBLIC_VIAM_API_KEY`, `NEXT_PUBLIC_VIAM_API_KEY_ID`, and truck equivalents are exposed in the browser bundle. Any client can extract these and access Viam machines directly.

**Fix:** For production/fleet deployment, proxy all Viam WebRTC connections through server-side API routes. Create read-only API keys with minimal privileges. (Currently documented as accepted for internal use.)

---

### C-5. ai-chat and ai-diagnose Crash on Viam Timeout
**Files:** `dashboard/app/api/ai-chat/route.ts:42`, `dashboard/app/api/ai-diagnose/route.ts:39`

**Issue:** `const history = await getAiHistorySummary()` is called OUTSIDE the main try/catch block. If Viam Cloud times out, the entire endpoint crashes with an unhandled rejection.

**Fix:** Move the `getAiHistorySummary()` call inside the existing try/catch block. 5-minute fix.

---

### C-6. CAN Bus Listener Thread Can Die Silently
**File:** `modules/j1939-sensor/src/models/j1939_sensor.py:396-470`

**Issue:** `_listen_loop()` (background thread) has no top-level try/except. If a CAN read fails with an unexpected exception, the thread dies silently. No more truck data is captured until service restart.

**Fix:** Wrap entire `_listen_loop()` body in try/except with logging and reconnect logic.

---

### C-7. No Truck Registry — Cannot Query Any Truck Beyond #1
**Files:** All API routes in `dashboard/app/api/`, `dashboard/lib/sensors.ts:5-39`

**Issue:** Every API route hardcodes a single Part ID (e.g., `sensor-history/route.ts:46`, `truck-readings/route.ts:40`, `shift-report/route.ts:47-48,511`). No `?truck_id` parameter exists. No database or config maps truck identifiers to Part IDs. The shift report hardcodes `truckId: "Truck 1"` at line 511.

**Fix:** Create `dashboard/lib/truck-registry.ts` (or use Viam machine tags). Add `?truck_id` parameter to all data-fetching routes. Build a truck selector in the dashboard UI.

---

### C-8. Historical Queries Will OOM at Fleet Scale
**Files:** `dashboard/app/api/sensor-history/route.ts:189-218`, `dashboard/app/api/shift-report/route.ts:583-614`

**Issue:** Routes load entire time windows into memory before processing. For 36 trucks x 8 hours = ~1 million readings = ~1.5 GB in RAM. Downsampling happens AFTER full load (sensor-history line 225). Vercel has a 60-second timeout. Expected response time at 36 trucks: 30-60 seconds, likely timeout or OOM.

**Fix:** Add pagination or streaming. Enforce per-query limits (e.g., max 24h for 1 truck, max 1h for 5+ trucks). Downsample server-side before loading into memory.

---

## IMPORTANT — Fleet Scale Issues, Resource Waste

### I-1. Dead File: truck-viam.ts (Completely Unused)
**File:** `dashboard/lib/truck-viam.ts`

**Issue:** Exports `getTruckSensorReadings()` and `sendTruckCommand()` but zero imports found anywhere. Superseded by server-side API routes and `truck-data.ts`.

**Fix:** Delete the file.

---

### I-2. Dead Route: /api/truck-history-local
**File:** `dashboard/app/api/truck-history-local/route.ts`

**Issue:** Defined but never called from any component. Also contains the hardcoded SSH credentials (see C-1). Double reason to remove.

**Fix:** Delete the route directory.

---

### I-3. Dead Route: /api/pi-health
**File:** `dashboard/app/api/pi-health/route.ts`

**Issue:** Defined but never called. PiHealthCard uses a direct module import (`viam.ts`) instead of this API route.

**Fix:** Delete the route or wire PiHealthCard to use it (cleaner architecture).

---

### I-4. AI Error Responses Leak Internal Details
**Files:** `dashboard/app/api/ai-chat/route.ts:144-147`, `dashboard/app/api/ai-diagnose/route.ts:118-121`

**Issue:** Returns full Anthropic API error text to the client: `{ error: "Claude API error", details: errText }`. May contain rate limit info, quota details, or internal metadata.

**Fix:** Log full error server-side. Return generic message to client: `{ error: "ai_unavailable" }`.

---

### I-5. ai-report-summary Silently Swallows Errors
**File:** `dashboard/app/api/ai-report-summary/route.ts:86`

**Issue:** Catch block returns `{ summary: "" }` with HTTP 200. Client cannot distinguish "no data" from "API crashed."

**Fix:** Return HTTP 502 with error details so the UI can show an error state.

---

### I-6. No React Error Boundary
**File:** `dashboard/components/Dashboard.tsx`

**Issue:** No Error Boundary component found anywhere. If any component throws during render, the entire dashboard crashes to a white screen.

**Fix:** Add an ErrorBoundary wrapper at the Dashboard root that shows a "Something went wrong, refresh" message.

---

### I-7. OBD2Poller Init Not Wrapped in try/except
**File:** `modules/j1939-sensor/src/models/j1939_sensor.py:297`

**Issue:** `OBD2Poller()` construction is not wrapped. If the poller fails to initialize, it kills `sensor.reconfigure()` entirely.

**Fix:** Wrap in try/except, set `self._obd2_poller = None` on failure, log the error.

---

### I-8. truck-data.ts fetchTruckData Has No Error Handling
**File:** `dashboard/lib/truck-data.ts:108-128`

**Issue:** `fetchTruckData()` has no try/catch. `exportTabularData()` can timeout with no recovery. Callers mostly handle it, but the function itself provides no diagnostics.

**Fix:** Add try/catch with logging. Re-throw for callers.

---

### I-9. No Rate Limiting on API Routes
**Files:** All routes in `dashboard/app/api/`

**Issue:** No rate limiting middleware. AI endpoints (`ai-chat`, `ai-diagnose`) call Anthropic API (which has its own limits), but repeated calls to historical data endpoints could exhaust Viam API quotas or Vercel function resources.

**Fix:** Add basic rate limiting (100 req/min/IP) via middleware or Vercel Edge Config.

---

### I-10. Missing HTTP Security Headers
**File:** `dashboard/next.config.mjs`

**Issue:** No security headers configured. Missing: `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`.

**Fix:** Add `headers()` config to next.config.mjs with standard security headers.

---

### I-11. Dashboard Polling Intervals Too Aggressive for Fleet
**Files:** `dashboard/components/Dashboard.tsx:19` (2s), `dashboard/components/TruckPanel.tsx:27` (3s)

**Issue:** TPS polls every 2 seconds, truck every 3 seconds. Viam syncs every 6 seconds, so polling faster than sync is wasteful. At 36 trucks this becomes ~50 API calls/second.

**Fix:** Increase to 4-5 seconds. Add exponential backoff on failures. Add request deduplication.

---

### I-12. Fragment Config Missing Truck-Specific Tags
**File:** `config/truck-diagnostic-viam.json:40-43`

**Issue:** Data manager tags are `["truck-diagnostics", "ironsight"]` with no truck-specific identifier. Compare to `fragment-tps-truck.json` which has `"OVERRIDE_WITH_TRUCK_ID"`. Without per-truck tags, filtering data by truck in Viam Cloud queries is harder.

**Fix:** Add `"OVERRIDE_WITH_TRUCK_ID"` placeholder tag to match the TPS fragment pattern.

---

### I-13. Dev Page Accessible in Production
**File:** `dashboard/app/dev/page.tsx`

**Issue:** No environment check. The dev/calibration page with raw register views and diagnostic tools is accessible to anyone at the production Vercel URL.

**Fix:** Add `if (process.env.NODE_ENV !== 'development') return notFound();` at the top.

---

### I-14. No "Last Updated" Indicator on Dashboard
**Files:** `dashboard/components/Dashboard.tsx`, `dashboard/components/TruckPanel.tsx`, `dashboard/components/StatusCard.tsx:82`

**Issue:** Users cannot tell if data is 1 second old or 30 seconds old. StatusCard shows `lastUpdated.toLocaleTimeString()` but no relative time ("2 seconds ago"). TruckPanel has no timestamp at all.

**Fix:** Add a "Last updated: Xs ago" badge to the header or connection indicator.

---

### I-15. Critical PLC Fields Captured But Never Displayed
**Files:** `modules/plc-sensor/src/plc_sensor.py` (produces), `dashboard/components/` (doesn't show)

| Field | Why It Matters |
|-------|---------------|
| `camera_rate_trend` | "stable/declining/intermittent/dead" — critical diagnostic signal |
| `total_reads` / `total_errors` | Communication reliability % — never shown to operator |
| `modbus_response_time_ms` | PLC network health — hidden |
| `encoder_noise` | EMI/vibration indicator — not displayed |
| `dd1_frozen` / `ds10_frozen` | Encoder hardware fault detection — not displayed |
| `rpm_stability_pct` | Misfire detection via RPM variance — calculated but hidden |
| `engine_hours` | Service interval tracking — available but not shown |

**Fix:** Add a "System Health" section to the dashboard showing communication stats, signal trends, and encoder health.

---

## NICE TO HAVE — Cleanup, Polish, Minor Improvements

### N-1. Potentially Unused API Routes (Verify Intent)
**Files:** `dashboard/app/api/truck-command/route.ts`, `dashboard/app/api/ai-chat/route.ts`, `dashboard/app/api/ai-diagnose/route.ts`

**Issue:** These endpoints are defined but not called from any dashboard component in the codebase. They may be intentionally public API endpoints for future client-side features (chat widget, DTC clear button).

**Fix:** Verify intent. If unused, remove. If planned, document.

---

### N-2. StatusCard Missing React.memo
**File:** `dashboard/components/StatusCard.tsx`

**Issue:** If not wrapped with `React.memo()`, all 4 StatusCards re-render every 2-second poll cycle even when only one component's data changed.

**Fix:** Add `export default React.memo(StatusCard);`

---

### N-3. Chat Queue Polled Every Second Even When Empty
**File:** `modules/plc-sensor/src/plc_sensor.py:1307`

**Issue:** `_read_chat_queue()` opens and reads `/tmp/ironsight-chat-queue.jsonl` every 1-second poll cycle. File is typically empty.

**Fix:** Throttle to every 5 seconds. Queue latency goes from 1s to 5s max — acceptable for chat.

---

### N-4. No Skeleton Loaders for TruckPanel
**File:** `dashboard/components/TruckPanel.tsx`

**Issue:** When truck first connects, renders blank space for 3-5 seconds until data arrives. Other components (PiHealthCard, main Dashboard) have loading states.

**Fix:** Add skeleton content showing field labels with placeholder dashes.

---

### N-5. No Toast/Notification System
**Files:** All dashboard components

**Issue:** Diagnostic events (warnings, critical alerts) only appear in the diagnostics panel. Truck disconnection shows no notification. Error retries are silent.

**Fix:** Add a lightweight toast system for diagnostic triggers and connection state changes.

---

### N-6. Shift Report Lacks Export/Download
**File:** `dashboard/app/shift-report/page.tsx`

**Issue:** Reports can only be viewed in-browser. No PDF export, CSV download, or print-friendly layout for end-of-shift filing.

**Fix:** Add a "Download PDF" or "Print" button using browser print CSS or html2canvas.

---

### N-7. No Explicit Timeout on Viam API Calls
**Files:** All API routes using `viam-data.ts`

**Issue:** If Viam Cloud is slow, requests hang until Node.js default timeout. No explicit `Promise.race` with timeout.

**Fix:** Wrap Viam calls in `Promise.race([viamCall, timeout(10000)])`.

---

### N-8. Spacing Consistency Stats Hidden
**File:** `modules/plc-sensor/src/plc_sensor.py` (produces `avg_drop_spacing_in`, `min_drop_spacing_in`, `max_drop_spacing_in`)

**Issue:** Only `last_drop_spacing_in` is prominently displayed. Min/max/avg are calculated but not shown. Operators need spacing consistency to diagnose machine performance.

**Fix:** Add a sparkline or color bar showing min-avg-max range in the PlcDetailPanel.

---

### N-9. TruckPanel Grid Doesn't Adapt to Extra-Small Screens
**File:** `dashboard/components/TruckPanel.tsx:530+`

**Issue:** 2-column grid layout doesn't collapse to 1-column for screens < 320px width. Most Tailwind responsive classes handle sm: and up, but not the xsmall case.

**Fix:** Add `grid-cols-1 sm:grid-cols-2` pattern to truck data grids.

---

### N-10. No Data Stale Warning
**File:** `dashboard/components/Dashboard.tsx`

**Issue:** If the poll interval is 2 seconds but no successful response arrives for > 10 seconds, the dashboard shows the last known data with no visual warning that it's stale.

**Fix:** Track `lastSuccessfulPoll` timestamp. Show yellow "Data may be stale" banner if > 10 seconds since last update.

---

### N-11. Diagnostic Timestamps Missing
**File:** `dashboard/components/DiagnosticsPanel.tsx`

**Issue:** Diagnostic rules show severity and description but no timestamp of when the rule was triggered. Operators can't distinguish a current issue from one that resolved.

**Fix:** Include trigger timestamp from the diagnostic engine's output.

---

### N-12. No Connection Status Text Label
**File:** `dashboard/components/ConnectionDot.tsx`

**Issue:** Connection status is only a colored dot (green/yellow/red). No text label ("Connected", "Reconnecting", "Offline"). On small screens the dot is easy to miss.

**Fix:** Add a text label next to the dot or show it on hover/tap.

---

## SUMMARY

| Severity | Count | Top Priorities |
|----------|-------|----------------|
| **Critical** | 8 | SSH creds in code, no truck registry, fleet OOM, Viam timeout crashes |
| **Important** | 15 | Dead code cleanup, error handling gaps, rate limiting, dev page exposed |
| **Nice to Have** | 12 | React.memo, skeleton loaders, toast system, export, stale warnings |

### Immediate Actions (< 1 day)
1. Remove hardcoded SSH credentials from code (C-1, C-2)
2. Move `getAiHistorySummary()` inside try/catch (C-5)
3. Delete `dashboard/lib/truck-viam.ts` (I-1)
4. Delete `dashboard/app/api/truck-history-local/` (I-2)
5. Guard dev page with environment check (I-13)
6. Fix ai-report-summary silent failure (I-5)

### Fleet-Blocking (before 36-truck deployment)
1. Build truck registry (C-7)
2. Add `?truck_id` to all API routes (C-7)
3. Add pagination/streaming to historical queries (C-8)
4. Build truck selector UI (C-7)
5. Increase polling intervals (I-11)
6. Add React Error Boundary (I-6)

### Architecture Debt (ongoing)
1. Replace NEXT_PUBLIC_ Viam keys with server-side proxy (C-4)
2. Secure ironsight-command-center (C-3)
3. Add rate limiting (I-9)
4. Add HTTP security headers (I-10)
5. Surface hidden diagnostic fields (I-15)
