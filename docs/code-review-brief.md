# Code Review Brief — Security & Robustness Fixes

Branch: `claude/code-review-K740g`

This brief covers 10 issues found during code review, ordered by priority. Each fix is scoped and independent — tackle them in order, commit after each one.

---

## 1. Replace pickle with JSON in rollup modules

**Why:** `pickle.load()` from disk enables arbitrary code execution if an attacker writes a crafted file to the rollup directory.

**Files:**
- `modules/plc-sensor/src/plc_rollup.py:210` — `self._buckets = pickle.load(f)`
- `modules/j1939-sensor/src/models/j1939_rollup.py:187` — `self._buckets = pickle.load(f)`

**Fix:** Replace pickle serialization with JSON. The `HourlyBucket` dataclass in each file holds simple numeric fields (count, sum, min, max, last) — JSON handles this natively. Update both `_load()` and `_save()` methods. Add a migration path: if the file exists and isn't valid JSON, log a warning and start fresh (don't crash). Remove `import pickle`.

**Test:** Run `python3 -m pytest modules/plc-sensor/tests/ -v -k rollup` and `python3 -m pytest modules/j1939-sensor/tests/ -v -k rollup`. If no rollup tests exist, add basic round-trip tests for save/load.

---

## 2. Add CAN bus listen-only verification at startup

**Why:** If the OS-level CAN config is wrong, the Pi silently ACKs every frame on the J1939 truck bus, disrupting ECU communication and triggering dashboard warning lights. This is a safety-critical issue.

**File:** `modules/j1939-sensor/src/models/j1939_can.py:372-400` — `start_can_listener()`

**Fix:** After creating the `can.Bus()` instance, verify listen-only mode is active by reading the interface flags. Use `subprocess.run(["ip", "-d", "link", "show", can_interface], capture_output=True, text=True)` and check that the output contains `LISTEN-ONLY` or `listen-only on`. If not found, log CRITICAL and return None (refusing to start). Do NOT attempt to set listen-only from Python — that's the OS/systemd job. Just refuse to run if it's not set.

**Test:** Run `python3 -m pytest modules/j1939-sensor/tests/ -v -k can`. Add a test that mocks subprocess to return output without listen-only and verifies the function returns None.

---

## 3. Add write-verify and interlock to PLC register writes

**Why:** Writing to PLC registers without verification could damage the TPS machine. No check that the PLC accepted the value, no check that the machine is stopped.

**File:** `modules/plc-sensor/src/plc_commands.py`
- Lines 187-221: `_handle_set_spacing()` — writes DS2 (address 1)
- Lines 242-263: `_handle_set_detector_offset()` — writes DS5 (address 4)

**Fix for both handlers:**
1. Before writing, read discrete inputs to check if TPS is running (X4 = DI bit 3). If running, return error "TPS must be stopped to change this setting".
2. After `client.write_register()`, sleep 0.15s (PLC scan time), then `client.read_holding_registers()` to verify the value was accepted.
3. If verify fails, return error with both expected and actual values.

**Test:** Run `python3 -m pytest modules/plc-sensor/tests/ -v -k command`. Update existing command tests to verify the new interlock and verify-after-write behavior.

---

## 4. Track partial Modbus read failures

**Why:** If encoder or coil reads fail but DS registers succeed, the readings dict mixes valid data with zeros. The diagnostic engine then makes wrong decisions.

**File:** `modules/plc-sensor/src/plc_readings.py:237-340` — `read_modbus_io()`

**Fix:** Add a `_read_failures` list to the returned dict. Each try/except block that catches a non-critical read failure should append the register group name to this list (e.g., `"encoder_dd1"`, `"discrete_inputs"`, `"output_coils"`). Return `"_read_status": "partial"` if any failures, `"ok"` if all succeeded. The caller in `plc_sensor.py` can then log the partial status and the diagnostic engine can skip rules that depend on missing data.

**Test:** Run `python3 -m pytest modules/plc-sensor/tests/ -v -k readings`.

---

## 5. Replace hardcoded /home/andrew paths with Path.home()

**Why:** All Python modules hardcode `/home/andrew/` — breaks silently on any other deploy user.

**Files and lines to fix:**
- `modules/plc-sensor/src/plc_rollup.py:21` — rollup dir
- `modules/j1939-sensor/src/models/j1939_rollup.py:9` — rollup dir
- `modules/j1939-sensor/src/models/j1939_can.py:32,37` — offline buffer + proprietary PGN log
- `modules/j1939-sensor/src/models/j1939_discovery.py:31` — VIN cache
- `modules/j1939-sensor/src/models/vehicle_profiles.py:19` — vehicle profiles dir
- `modules/common/system_health.py:124` — capture dir

**Fix:** Replace each `/home/andrew` with `Path.home()` from pathlib. Example:
```python
# Before
DEFAULT_BUFFER_DIR = "/home/andrew/.viam/offline-buffer/truck"
# After
DEFAULT_BUFFER_DIR = str(Path.home() / ".viam" / "offline-buffer" / "truck")
```

Do NOT touch the `scripts/` directory paths — those are Pi-specific operational scripts, not deployed modules.

**Test:** Run both Python test suites. Grep for any remaining `/home/andrew` in `modules/`.

---

## 6. Fix chat queue race condition with file locking

**Why:** Between `readlines()` and truncate, a concurrent writer's events are lost.

**File:** `modules/plc-sensor/src/plc_utils.py:15-41` — `_read_chat_queue()`

**Fix:** Use `fcntl.flock()` for exclusive locking:
```python
import fcntl

def _read_chat_queue() -> list:
    try:
        with open(_CHAT_QUEUE_FILE, "r+") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            lines = f.readlines()
            f.seek(0)
            f.truncate()
            fcntl.flock(f, fcntl.LOCK_UN)
        # parse lines outside the lock
        ...
    except FileNotFoundError:
        return []
```

**Test:** Run `python3 -m pytest modules/plc-sensor/tests/ -v -k utils` or `chat`.

---

## 7. URL-encode weather city parameter

**Why:** Unescaped city name in f-string allows URL parameter injection.

**File:** `modules/plc-sensor/src/plc_weather.py:70`

**Fix:**
```python
from urllib.parse import quote
url = f"http://wttr.in/{quote(city)}?format=%c+%t+%h+%w&u"
```

One-line fix. No test changes needed.

---

## 8. Make audit logging await-able with retry

**Why:** Fire-and-forget means security-critical audit entries silently vanish on Supabase errors.

**File:** `dashboard/lib/audit.ts:127-143` — `logAudit()`

**Fix:** Change signature to `async function logAudit(entry: AuditEntry): Promise<void>`. Await the Supabase insert. Add one retry on failure with a 500ms delay. If both attempts fail, `console.error` with full context (this is the fallback — at least it hits Vercel logs). Update all callers — most are in API route handlers that can safely `await logAudit(...)`. If a caller truly can't await, wrap in `void logAudit(...)` explicitly so the fire-and-forget is intentional and visible.

**Test:** Run `cd dashboard && npx vitest run` to check nothing breaks. If audit tests exist, verify the retry logic.

---

## 9. Fix getUserRole to return 503 on auth failure

**Why:** Defaulting to "operator" on Clerk errors means a Clerk outage silently downgrades all users instead of failing safely.

**File:** `dashboard/lib/auth-guard.ts:44-52` — `getUserRole()`

**Fix:** Change the catch block to re-throw or return a sentinel that the caller handles as 503. The cleanest approach: make `getUserRole` return `string | null`, return `null` on error, and have `requireAuth()` return a 503 response when role is null. Keep the "operator" default only for the case where Clerk succeeds but no role is set in metadata (that's a legitimate default for new users).

**Test:** Run `cd dashboard && npx vitest run` — check auth-related tests pass.

---

## 10. Add rate limiting to AI endpoints

**Why:** `/api/ai-chat` and `/api/ai-diagnose` call Claude API with no throttling. A bot or runaway client causes cost explosion.

**Files:**
- `dashboard/app/api/ai-chat/route.ts`
- `dashboard/app/api/ai-diagnose/route.ts`

**Fix:** Import `createRateLimiter` from `dashboard/lib/rate-limit.ts`. Create a limiter (e.g., 20 requests per minute per user). At the top of each POST handler, after auth, call `limiter.check(userId)`. If rate limited, return 429 with `Retry-After` header. The pattern already exists in the chat `@ai` mention handler — follow that approach.

**Test:** Run `cd dashboard && npx vitest run`.

---

## After all fixes

1. Run full Python tests: `python3 -m pytest modules/plc-sensor/tests/ -v && python3 -m pytest modules/j1939-sensor/tests/ -v`
2. Run full dashboard tests: `cd dashboard && npx vitest run`
3. Run dashboard build: `cd dashboard && npx next build`
4. Commit and push to `claude/code-review-K740g`
