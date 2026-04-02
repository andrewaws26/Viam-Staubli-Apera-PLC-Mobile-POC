# IronSight Unified Data Platform Report

## What Was Wrong

### Bug 1: Viam Cloud Payload Nesting (All dashboard data shows zeros)
**Root cause:** Viam Cloud stores sensor readings nested under `payload.readings.{field}`, not `payload.{field}`. All API routes (`truck-history`, `sensor-history`, `truck-readings`, `sensor-readings`, `pi-health`) extracted `row.payload` and accessed fields directly on it. Since `row.payload` is `{ readings: { engine_rpm: 1200, ... } }`, accessing `row.payload.engine_rpm` returned `undefined`, which `num()` converted to `0`.

**Evidence:** Every chart and gauge in the dashboard showed zeros despite Viam Cloud having 72,000+ data points with real values.

### Bug 2: OBD2 vs J1939 Separation
**Root cause:** The sensor module and TruckPanel.tsx already handled protocol separation correctly — the sensor sets `_protocol: "obd2"` or `_protocol: "j1939"`, and TruckPanel has separate field groups for each. The issue was that API routes didn't pass `_protocol` through, and the payload nesting bug (Bug 1) masked all fields including `_protocol`.

### Bug 3: WebRTC Connections Fail Through CGNAT
**Root cause:** Five server-side API routes and all browser-side data fetching used `createRobotClient()` (WebRTC) to connect to the Pis. WebRTC requires direct peer-to-peer connectivity that fails through:
- Carrier-grade NAT (iPhone tethering)
- Vercel serverless functions (no `RTCPeerConnection` in Node.js)

Routes affected:
- `truck-readings/route.ts` — live truck sensor data
- `sensor-readings/route.ts` — live PLC sensor data
- `pi-health/route.ts` — Pi health monitoring
- Browser imports in `TruckPanel.tsx` — live readings, history, DTC clear, diagnostics

### Bug 4: Vehicle-Off Zero Readings
**Root cause:** The sensor module captured at 1Hz continuously, even when the engine was off and no CAN traffic existed. This filled Viam Cloud with payloads where every field was 0, wasting storage and polluting historical analysis. 72,871 zero readings over 7 days observed.

### Bug 5: Hardcoded Part IDs and Credential Chaos
**Root cause:**
- `truck-history/route.ts:38` hardcoded `TRUCK_PART_ID = "ca039781-665c-47e3-9bc5-35f603f3baf1"`
- `sensor-history/route.ts:46` hardcoded `DEFAULT_PART_ID = "7c24d42f-1d66-4cae-81a4-97e3ff9404b4"`
- No `TRUCK_VIAM_PART_ID` environment variable existed
- `pi-health/route.ts` used `NEXT_PUBLIC_` browser-exposed vars in a server-side route
- No documentation on credential strategy for fleet scaling

## What We Did

### Workstream 1: Data Layer (5 files)

| File | Change |
|------|--------|
| `dashboard/app/api/truck-history/route.ts` | Added `payload.readings` unwrap in `fetchTruckData()`. Changed `TRUCK_PART_ID` to read from `process.env.TRUCK_VIAM_PART_ID` with hardcoded fallback. |
| `dashboard/app/api/sensor-history/route.ts` | Added `payload.readings` unwrap in `fetchData()`. |
| `dashboard/app/api/truck-readings/route.ts` | **Full rewrite.** Replaced `createRobotClient` (WebRTC) with `createViamClient` + `exportTabularData()` (HTTPS). Queries last 300s, returns newest reading. Returns `{ _offline: true }` with 200 when no data. |
| `dashboard/app/api/sensor-readings/route.ts` | **Full rewrite.** Same WebRTC→Data API migration as truck-readings. Uses `VIAM_PART_ID` for TPS machine. |
| `dashboard/app/api/pi-health/route.ts` | **Full rewrite.** Removed all `NEXT_PUBLIC_` vars. Uses Data API with server-side credentials. Queries appropriate part ID per machine. |

### Workstream 2: Sensor Module (1 file)

| File | Change |
|------|--------|
| `modules/j1939-sensor/src/models/j1939_sensor.py` | Added `_vehicle_off` flag after vehicle state inference. When true, returns minimal 6-field payload (skips derived metrics). Added core field normalization ensuring 10 fields always exist. Guarded offline buffer to skip writes when vehicle is off. |

### Workstream 3: Dashboard UI (2 files)

| File | Change |
|------|--------|
| `dashboard/components/TruckPanel.tsx` | Replaced 5 browser-side WebRTC call sites: live readings (`getTruckSensorReadings` → `fetch("/api/truck-readings")`), history (`sendTruckCommand get_history` → `fetch("/api/truck-history")`), DTC clear, report generation, diagnostic commands. Added `_offline` and `_vehicle_off` state handling. |
| `dashboard/components/PiHealthCard.tsx` | Replaced `getTruckSensorReadings` with `fetch("/api/truck-readings")`. |

### Workstream 4: Configuration & Documentation (4 files)

| File | Change |
|------|--------|
| `dashboard/.env.local.example` | Added `TRUCK_VIAM_PART_ID`, `ANTHROPIC_API_KEY`, fleet scaling notes. |
| `CLAUDE.md` | Added "Viam Data API Payload Structure" and "Credential Architecture (Fleet Scale)" sections. |
| `docs/data-pipeline.md` | **New.** Full data flow documentation, payload structure, field names by protocol, query patterns, env var reference. |
| `docs/fleet-onboarding.md` | **New.** Step-by-step guide for adding a new truck to the fleet. |

## Architecture Decisions

### 1. Data API over WebRTC for all read paths
WebRTC (`createRobotClient`) requires direct peer-to-peer connectivity. The Data API (`createViamClient` → `exportTabularData`) uses standard HTTPS, works through any NAT, and runs on serverless. Trade-off: Data API has ~6 second latency (cloud sync interval), while WebRTC was real-time. For a monitoring dashboard polled every 3 seconds, 6-second-old data is acceptable.

**Command paths stay on WebRTC.** DTC clear, PGN requests, etc. require `do_command()` which needs a direct machine connection. These fail gracefully with clear error messages.

### 2. Payload unwrapping with fallback
The unwrap code checks for `raw.readings` and falls back to `raw` if it's flat:
```typescript
const readings = (typeof raw.readings === "object" && raw.readings !== null
  ? raw.readings : raw) as Record<string, unknown>;
```
This handles both the current nested format and potential future format changes.

### 3. Vehicle-off detection with minimal payload
When `_vehicle_off: true`, the sensor returns only 6 fields instead of 80+. This reduces cloud storage by ~97% for parked vehicles while preserving battery voltage for drain monitoring. The dashboard shows "Vehicle off" state rather than confusing zero readings.

### 4. Organization-level key for data queries
A single org-level API key queries data from ANY machine in the organization. This means the dashboard needs just one set of data credentials regardless of fleet size. Machine-level keys are only needed for direct commands (DTC clear, etc.) to specific trucks.

## Fleet Scaling Plan

### Current architecture supports 30+ trucks:

**Data queries (org key):**
- `VIAM_API_KEY` / `VIAM_API_KEY_ID`: One org-level key set once in Vercel
- Queries `exportTabularData` by Part ID — works for any machine in the org

**Per-truck configuration:**
- Each truck needs a unique `TRUCK_VIAM_PART_ID` (from `/etc/viam.json` on the Pi)
- For commands: per-truck `TRUCK_VIAM_MACHINE_ADDRESS` and API key

**Scaling path:**
1. **Phase 1 (current):** Single truck, env vars in Vercel
2. **Phase 2 (5-10 trucks):** Truck registry JSON in repo mapping truck names → Part IDs
3. **Phase 3 (30+ trucks):** Database-backed truck registry, API endpoint for truck management, per-truck pages in dashboard

**Onboarding a new truck:**
1. Set up Pi Zero with CAN HAT + Waveshare module
2. Install viam-server, create machine in Viam app
3. Clone repo, configure j1939-sensor module
4. Get Part ID from `/etc/viam.json`
5. Add Part ID to truck registry
6. Verify data flowing via `/api/truck-history?hours=1`

See `docs/fleet-onboarding.md` for the complete guide.

## Future Work

1. **Truck registry database** — Replace single `TRUCK_VIAM_PART_ID` env var with a multi-truck registry
2. **Per-truck dashboard pages** — URL pattern like `/truck/[truckId]` with dynamic Part ID lookup
3. **Command path graceful degradation** — When WebRTC fails, queue commands and retry with exponential backoff
4. **Data capture rate throttling** — When vehicle is off, reduce viam-server capture interval from 1Hz to 0.1Hz via config
5. **Historical data compaction** — Downsample old data in Viam Cloud to reduce storage costs
6. **Alert system** — Push notifications when DTC codes appear or thresholds are exceeded
7. **Multi-protocol dashboard URL** — Auto-redirect to OBD2 or J1939 view based on connected vehicle
