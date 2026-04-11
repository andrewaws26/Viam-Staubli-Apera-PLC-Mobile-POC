# Truck Engine Health Baseline System -- Technical Reference

> For future Claude instances working on this codebase. Read this before modifying any baseline, health assessment, or truck monitoring code.

## 1. Architecture

### Data Flow

```
J1939 CAN Bus (250kbps, listen-only)
    |
    | MCP2515 CAN HAT on Pi 5 (GPIO25 IRQ, 12MHz crystal)
    v
j1939_sensor.py -- Reads raw CAN frames at 1 Hz
    |
    | pgn_decoder.py -- Decodes PGN → named fields (engine_rpm, coolant_temp_f, etc.)
    | j1939_fleet_metrics.py -- Computes derived metrics (electrical_health, battery_health, etc.)
    v
Viam Cloud -- Captures as "truck-engine" component, syncs every 6 seconds
    |
    | exportTabularData() / getLatestReading() via Viam SDK
    v
Dashboard API Routes (/api/truck-health, /api/truck-readings, /api/baseline-check)
    |
    | assessTruckHealth() in lib/truck-baseline.ts
    v
TruckHealthPanel.tsx -- Visual health display in the dashboard
```

### Key Constraints
- Pi MUST be in listen-only mode. Normal mode ACKs frames and triggers DTCs on the truck.
- CAN bus is 250kbps J1939. Never change to 500kbps or OBD-II protocol.
- All Viam credentials are server-side only (Next.js API routes). Never expose in browser.
- Viam data payload is nested: `row.payload.readings.engine_rpm`, not `row.payload.engine_rpm`.

## 2. Baseline Data Source

### How the Baselines Were Computed

The BASELINES array in `truck-baseline.ts` was populated by querying 14,705 data points from Viam Cloud using `exportTabularData()` for the `truck-engine` component on the Mack Granite (VIN ...9830).

**Query method:**
```typescript
const data = await fetchSensorData(partId, "truck-engine", hours);
// hours = 168 (7 days) to get April 8-10 window
```

**For each metric, computed:**
- `min` -- lowest observed value across all 14,705 points
- `max` -- highest observed value across all 14,705 points
- `avg` -- arithmetic mean across all non-null readings

**Data characteristics:**
- All data is idle/parked (vehicle_speed_mph = 0 for every reading)
- Engine was started and stopped multiple times (RPM ranges from 0 to 1,099)
- Cold starts captured (coolant from 82 F to 199 F)
- 3 active DTCs present in every single reading (SCR/DEF fault)
- Fuel level low throughout (19-30%)
- Engine hours: 5,421.6 to 5,427.3 (~5.7 hours of engine runtime)

### The /api/baseline-check Endpoint

`GET /api/baseline-check?truck=01` probes Viam Cloud to report how much data exists for baseline building. It checks three time windows (1h, 24h, 7d) across all sensor components and reports:
- Point counts per window
- Which key fields are present
- Min/max/avg for each numeric field
- Whether enough data exists for a reliable baseline (>1,800 points = baseline_ready)

This endpoint is useful for verifying data availability before updating baselines.

## 3. Code Locations

### Core Baseline Logic
**`dashboard/lib/truck-baseline.ts`**
- Lines 12-70: Type definitions (`BaselineRange`, `MetricHealth`, `CategoryHealth`, `TruckHealth`, `HealthStatus`, `HealthCategory`)
- Lines 74-82: `CATEGORY_LABELS` mapping
- Lines 86-278: `BASELINES` array -- all 15 metrics with observed min/max/avg and warn/crit thresholds
- Lines 282-310: Helper functions (`num()`, `pctDev()`, `round1()`, `worstStatus()`)
- Lines 314-405: `assessMetric()` -- evaluates a single metric against its baseline, returns status + plain English detail
- Lines 409-531: `assessTruckHealth()` -- main entry point. Takes a readings object, assesses all metrics, groups by category, generates findings and overall status

### Dashboard UI
**`dashboard/components/TruckHealthPanel.tsx`**
- Lines 32-69: Status color/label helper functions
- Lines 76-153: `MetricBar` -- range visualization showing observed range (green zone), threshold markers, and current value position
- Lines 159-189: `MetricRow` -- single metric display with dot, value, bar chart, and deviation text
- Lines 195-250: `CategoryCard` -- expandable card per health category with status badge and metric list
- Lines 256-274: `FindingsSection` -- notable findings from the assessment
- Lines 304-353: `TruckHealthPanel` -- main component. Receives `TruckHealth` object, renders overall status card, category cards, findings, and data quality footer

### Integration Point
**`dashboard/components/TruckPanel.tsx`**
- Line 46: `import { assessTruckHealth } from "../lib/truck-baseline"`
- Lines 431-434: `useMemo` hook that calls `assessTruckHealth(readings)` whenever readings change
- Line 538: `<TruckHealthPanel health={truckHealth} />` placement in the layout (after DTCPanel, before GaugeGrid)

### API Endpoint
**`dashboard/app/api/truck-health/route.ts`**
- Lines 20-44: `generateSimReadings()` for truck "00" sim mode (uses real Mack baseline averages with jitter)
- Lines 52-94: `GET` handler -- auth check, sim mode routing, truck registry lookup
- Lines 98-142: `fetchAndAssess()` -- fetches latest reading from Viam Cloud, runs `assessTruckHealth()`, returns structured JSON with health status + raw readings + metadata

### Baseline Check API
**`dashboard/app/api/baseline-check/route.ts`**
- Lines 10-14: Component definitions with key fields to check
- Lines 19-135: `GET` handler -- queries Viam Cloud across 3 time windows, computes field statistics, determines baseline readiness

### Test Suite
**`dashboard/tests/unit/truck-baseline.test.ts`** -- 37 tests across 8 describe blocks:
- BASELINES array validation (expected metrics, valid ranges, categories, threshold ordering)
- Structure tests (required fields, category grouping, deviation/detail strings)
- Normal readings (overall good, per-metric checks)
- Warning thresholds (coolant 215 F, oil pressure 18 PSI, battery 12.8 V, oil temp 240 F, trans temp 210 F, fuel level 20%)
- Critical thresholds (coolant 235 F, oil pressure 12 PSI, battery 12.0 V, oil temp 255 F)
- Missing data handling (empty readings, partial readings, string coercion)
- Findings (DTC notes, low fuel, vehicle moving, engine-off battery)
- Category status rollup (worst-first sorting)
- Deviation strings (normal vs percentage-based)
- Real Mack Granite scenario (actual baseline averages)

### Pi-Side Code
**`modules/j1939-sensor/src/models/pgn_decoder.py`**
- Lines 151-166: `PGN_65271` definition -- Vehicle Electrical Power (VEP). Decodes 5 SPNs:
  - SPN 114: Net Battery Current (amps)
  - SPN 115: Alternator Current (amps)
  - SPN 167: Charging System Potential / Alternator Voltage (volts)
  - SPN 158: Battery Potential / Power Input (volts)
  - SPN 168: Battery Potential Switched (volts)
- Line 725: PGN 65271 registered in the PGN_MAP lookup table

**`modules/j1939-sensor/src/models/j1939_fleet_metrics.py`**
- Lines 84-263: `compute_fleet_metrics()` -- runs every reading cycle on the Pi
- Lines 196-232: Battery health scoring -- checks voltage against RPM-dependent thresholds (different for engine on vs off, 12V vs 24V systems)
- Lines 234-261: Electrical health scoring -- compares alternator voltage to battery voltage, checks charging spread, detects NOT_CHARGING / OVERCHARGE / LOW / OK states
- Line 238: `charging_spread_v` computation (alternator voltage minus battery voltage)

## 4. How to Update Baselines

When more data becomes available (driving data, seasonal data, more trucks):

### Step 1: Query New Data
```typescript
// Use the baseline-check endpoint to verify data exists
// GET /api/baseline-check?truck=01

// Or query directly via Viam SDK
const data = await fetchSensorData(partId, "truck-engine", hours);
```

### Step 2: Compute New Statistics
For each metric in the BASELINES array, compute new min/max/avg from the larger dataset. If combining idle + driving data, consider maintaining separate baseline profiles:

```typescript
// Example: computing new baseline from query results
const values = data
  .map(d => d.payload.readings.engine_rpm)
  .filter(v => v !== null && v !== undefined && typeof v === 'number');

const newBaseline = {
  min: Math.min(...values),
  max: Math.max(...values),
  avg: values.reduce((a, b) => a + b, 0) / values.length,
};
```

### Step 3: Update BASELINES Array
Edit `dashboard/lib/truck-baseline.ts`, update the `min`, `max`, `avg` values in the relevant baseline entry. Update the `note` field to reflect the new data source.

### Step 4: Review Thresholds
Warn/crit thresholds are engineering-based (not data-derived), so they generally should NOT change when baselines update. However, review whether the new data reveals that thresholds need adjustment:
- If driving data shows coolant routinely hitting 205 F under load, the 210 F warn threshold may be too tight for loaded operation
- Consider adding load-dependent thresholds (different warn levels when engine_load_pct > 50%)

### Step 5: Run Tests
```bash
cd dashboard && npx vitest run tests/unit/truck-baseline.test.ts
```

Update test expectations if baselines changed significantly.

### Future: Driving Baselines
When driving data exists, the system should support multiple baseline profiles:
- **Idle baseline** (current) -- engine_load < 20%, vehicle_speed = 0
- **Driving baseline** -- vehicle_speed > 0, varying loads
- **Towing baseline** -- engine_load > 60%, sustained
- **Cold start baseline** -- coolant_temp < 120 F, first 10 minutes

The `assessTruckHealth()` function would need a `mode` parameter or auto-detect based on current RPM/speed/load which baseline to use.

### Future: Seasonal Baselines
Summer ambient temperatures shift all thermal baselines up by 15-25 F. Winter cold starts produce drastically different oil pressure patterns. Baselines should eventually be keyed by ambient temperature range.

## 5. How to Add New Metrics

Adding a new metric to the baseline system is a 3-step process:

### Step 1: Add to BASELINES Array
In `dashboard/lib/truck-baseline.ts`, add a new entry to the BASELINES array:

```typescript
{
  key: "new_metric_key",       // Must match the field name in truck readings
  label: "Human Readable Name",
  unit: "unit",
  min: 0,                      // Observed minimum from data
  max: 100,                    // Observed maximum from data
  avg: 50,                     // Observed average from data
  warnLow: 10,                 // Optional: warn if below this
  critLow: 5,                  // Optional: critical if below this
  warnHigh: 90,                // Optional: warn if above this
  critHigh: 95,                // Optional: critical if above this
  category: "engine",          // One of: engine, cooling, lubrication, electrical, fuel, transmission, emissions
  note: "Explain what this metric is and why the thresholds are what they are.",
},
```

### Step 2: Set Thresholds Based on Engineering Knowledge
Do not set arbitrary thresholds. Each threshold should have a mechanical reason:
- Oil pressure critLow at 15 PSI: below this, oil film thickness is insufficient for bearing lubrication
- Coolant critHigh at 230 F: aluminum head warping begins in this range
- Battery warnLow at 13.0 V: alternator output should maintain above this when running

### Step 3: Everything Else Auto-Discovers
The `assessTruckHealth()` function iterates over the BASELINES array. Adding a new entry automatically:
- Creates a MetricHealth assessment for it
- Groups it into the correct category
- Includes it in the category status rollup
- Shows it in the TruckHealthPanel UI (the CategoryCard and MetricBar components render whatever metrics exist)
- Reports deviations in findings if applicable

No changes needed to TruckHealthPanel.tsx, TruckPanel.tsx, or the API route.

### Step 4: Add Tests
Add test cases to `dashboard/tests/unit/truck-baseline.test.ts`:
- Verify the metric appears in the BASELINES array
- Test warning and critical thresholds with specific values
- Test the detail message contains relevant diagnostic text

## 6. How to Query Baseline Data

### From the Dashboard (API)

**Health Assessment with Latest Reading:**
```
GET /api/truck-health?truck=01
```
Returns: Full `TruckHealth` object with overall status, categories, metrics, findings, plus raw readings and metadata.

**Baseline Data Availability:**
```
GET /api/baseline-check?truck=01
```
Returns: Point counts, field availability, and min/max/avg per field across 1h/24h/7d windows.

**Direct Truck Readings (without assessment):**
```
GET /api/truck-readings?component=truck-engine&truck_id=01
```
Returns: Raw latest reading from Viam Cloud, plus metadata (_data_age_seconds, _offline, _vehicle_off).

**Historical Data:**
```
GET /api/truck-history?hours=168&truck_id=01
```
Returns: Aggregated historical data with time series and summary statistics.

### From Code (Direct Viam SDK)

```typescript
import { fetchSensorData, getLatestReading } from "@/lib/viam-data";

// Get latest single reading
const latest = await getLatestReading(partId, "truck-engine");
// latest.payload contains the readings object
// latest.timeCaptured is a Date

// Get historical data
const history = await fetchSensorData(partId, "truck-engine", 168); // 168 hours = 7 days
// history is an array of { payload, timeCaptured } objects
// IMPORTANT: payload.readings contains the actual fields, not payload directly
```

### From the Pi (Python)

The Pi-side code in `j1939_fleet_metrics.py` computes some health scores locally:
```python
# battery_health: "OK", "LOW", "CRITICAL", "OVERCHARGE"
# electrical_health: "OK", "LOW", "NOT_CHARGING", "OVERCHARGE"
# charging_spread_v: alternator_voltage - battery_voltage
```

These are included in the readings that sync to Viam Cloud and can be used by the dashboard baseline system.

## 7. Threshold Rationale

Every warn/crit threshold has an engineering basis. Here is the reasoning for each:

### Engine RPM
- **Warn High 2,100**: The Mack/Volvo D13 is governed to approximately 2,100 RPM. Sustained operation at governed speed under no load suggests a control issue.
- **Crit High 2,500**: Above governed max. Risk of valve float (valves not closing fully due to spring resonance at extreme RPM). Possible ECU fuel cut.

### Engine Load
- **Warn High 85%**: Sustained load above 85% is stressful but can be normal under heavy haul. Worth monitoring.
- **Crit High 95%**: Approaching mechanical torque limit. Should only happen briefly during acceleration or hill climbing.

### Boost Pressure
- **Warn High 35 PSI**: Typical max boost for a D13 under full load is 30-35 PSI. Sustained above 35 PSI could indicate wastegate stuck closed.
- **Crit High 45 PSI**: Mechanical risk to turbo compressor wheel and charge air cooler.

### Coolant Temperature
- **Warn Low 120 F**: If engine has been running for 10+ minutes and coolant is still below 120 F, the thermostat may be stuck open. Engine runs inefficiently (rich fueling, excessive wear).
- **Warn High 210 F**: Above the thermostat opening point. Cooling system is not keeping up -- check coolant level, fan clutch engagement, thermostat operation, radiator blockage.
- **Crit High 230 F**: Aluminum cylinder head begins to warp in this range. Head gasket failure imminent. Stop engine.

### Intake Manifold Temperature
- **Warn High 200 F**: The charge air cooler (intercooler) should keep intake temps well below this. High intake temp = denser fuel but thinner air charge = incomplete combustion, higher EGTs, higher NOx.
- **Crit High 230 F**: Detonation risk increases. Turbo or intercooler restriction.

### Oil Pressure
- **Warn Low 20 PSI**: Below normal warm idle range (26-30 PSI for this engine). Could indicate oil pump wear, low oil level, bearing clearance increase, or wrong oil viscosity.
- **Crit Low 15 PSI**: Oil film thickness insufficient for hydrodynamic lubrication of main and rod bearings. Metal-to-metal contact begins. Stop engine immediately.
- **Warn High 70 PSI**: Possible oil pressure relief valve stuck closed or extremely cold oil. Less common failure mode.

### Oil Temperature
- **Warn High 235 F**: Oil viscosity is degrading. The oil cooler may be restricted, or coolant flow through the oil cooler is insufficient.
- **Crit High 250 F**: Oil molecular breakdown accelerates exponentially above 250 F. Lubricating properties are compromised. Engine damage risk.

### Battery Voltage
- **Warn Low 13.0 V**: With engine running, the alternator should maintain 13.8-14.0 V. Below 13.0 V means the alternator is not keeping up with electrical demand. Belt slip, failing regulator, or alternator bearing failure.
- **Crit Low 12.5 V**: Alternator has effectively failed. Battery is draining. Vehicle will eventually lose ECU power.
- **Warn High 15.0 V**: Voltage regulator not limiting alternator output. Overcharging the battery.
- **Crit High 16.0 V**: Battery gassing, electrolyte boiling. Risk of battery explosion. ECU and electronic component damage.

### Fuel Rate
- **Warn High 15 GPH**: At idle, fuel rate should be ~1.0 GPH. Under full load on highway, 12-15 GPH is normal. But 15 GPH at idle = injector leak, return line restriction, or fueling calibration error.
- **Crit High 25 GPH**: Extreme fuel waste. Major injector failure or fuel system malfunction.

### Fuel Level
- **Warn Low 25%**: Time to refuel. Operating routinely below 25% risks picking up sediment from the bottom of the tank.
- **Crit Low 15%**: Risk of fuel starvation. Air can enter the fuel system, causing hard starts, misfires, and injector damage from cavitation.

### Transmission Oil Temperature
- **Warn High 200 F**: Under load + towing, trans temps rise. Above 200 F, ATF begins to degrade faster. Check trans cooler flow, fluid level, and whether the lockup clutch is engaging.
- **Crit High 225 F**: ATF breakdown zone. Clutch pack life drops dramatically. Transmission overhaul becomes likely if sustained.

### Active DTCs
- **Warn High 1**: Any active DTC warrants investigation. Even a single code may indicate a developing issue.
- **Crit High 3**: Multiple concurrent codes typically indicate a systemic fault (like the SCR/DEF chain failure on this truck).

## 8. Known Gaps

### Data Gaps
- **No driving data**: All 14,705 points are stationary. Under-load baselines for RPM, temperatures, pressures, and fuel rate do not exist. Thresholds for loaded operation will need separate baselines.
- **No alternator/current baseline**: PGN 65271 (VEP) was recently added to the decoder. Fields `alternator_voltage_v`, `alternator_current_a`, and `net_battery_current_a` are now decoded on the Pi but have no historical data in Viam Cloud yet. Once captured, these should be added to the BASELINES array.
- **No seasonal data**: Only early spring (April, 68-83 F ambient). Summer and winter baselines will differ significantly.
- **Single truck**: Baselines are specific to VIN ...9830. Fleet-wide baselines (or per-truck auto-calibration) are not implemented.

### Feature Gaps
- **Load-dependent thresholds**: The system uses the same thresholds regardless of whether the truck is idling or pulling a hill. A more sophisticated system would adjust thresholds based on current engine load and vehicle speed.
- **Trend detection**: The system checks instantaneous values against thresholds. It does not detect gradual degradation (e.g., oil pressure dropping 1 PSI/week over two months). A time-series regression on historical data would enable this.
- **Multi-truck fleet baselines**: Each truck should auto-calibrate its own baseline from its first 7 days of data. Currently, baselines are hardcoded for one truck.
- **Correlation analysis**: The system checks each metric independently. Cross-metric correlation (e.g., coolant temp rising while oil pressure drops = possible head gasket) would add diagnostic intelligence.
- **DTC-to-baseline integration**: The system notes DTC count but does not correlate specific SPNs with the metrics that would be affected. For example, an SCR temperature DTC should flag the emissions category specifically.

### What New Data Would Enable
| Data Needed | What It Enables |
|------------|----------------|
| Driving data (speed > 0) | Load-dependent baselines, fuel economy tracking, transmission shift quality |
| Summer data (ambient > 95 F) | Thermal stress baselines, cooling system adequacy under heat |
| Winter data (ambient < 32 F) | Cold start profiles, oil pressure behavior, glow plug health |
| Alternator data (PGN 65271) | Charging system baseline, parasitic draw detection, battery degradation trending |
| Multiple trucks | Fleet-wide normal ranges, outlier detection (one truck deviating from fleet norms) |
| Maintenance event logs | Before/after baselines to verify repairs actually fixed the problem |
