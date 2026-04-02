# IronSight Data Pipeline

How sensor data flows from truck hardware to the dashboard.

## Data Flow

```
Sensor (CAN bus / PLC)
  |
  v
viam-server (Pi) -- captures Readings at 1 Hz
  |
  v
Local cache: /home/andrew/.viam/capture/
  |  (JSONL files, persists across reboots)
  v
Cloud sync -- every 6 seconds (0.1 min interval)
  |
  v
Viam Cloud (app.viam.com data store)
  |
  v
Dashboard API route -- exportTabularData() query
  |
  v
Next.js frontend -- charts, gauges, alerts
```

**Offline resilience:** If WiFi drops, viam-server buffers captures locally.
When connectivity returns, it syncs the backlog automatically. The Pi 5 also
keeps a separate JSONL offline buffer at `/home/andrew/.viam/offline-buffer/`
(50 MB cap).

## Payload Structure

**CRITICAL**: `exportTabularData()` returns rows with a nested payload.

```json
{
  "timeCaptured": "2026-04-01T14:30:00.000Z",
  "payload": {
    "readings": {
      "engine_rpm": 1200,
      "coolant_temp_f": 195.0,
      "vehicle_speed_mph": 45.2,
      "battery_voltage_v": 13.8,
      "fuel_level_pct": 72.5,
      "active_dtc_count": 0,
      "_protocol": "j1939",
      "_bus_connected": true,
      "_vehicle_off": false,
      "vehicle_state": "running"
    }
  }
}
```

You must unwrap to `row.payload.readings` -- NOT `row.payload` directly.
Accessing `row.payload.engine_rpm` will return `undefined`.

## Field Names by Protocol

### Common Fields (both J1939 and OBD-II)

| Field | Unit | Description |
|-------|------|-------------|
| `engine_rpm` | RPM | Engine speed |
| `coolant_temp_f` | degF | Engine coolant temperature |
| `vehicle_speed_mph` | mph | Vehicle speed |
| `battery_voltage_v` | V | Battery / system voltage |
| `fuel_level_pct` | % | Fuel tank level |
| `active_dtc_count` | count | Number of active trouble codes |
| `_protocol` | string | `"j1939"` or `"obd2"` |
| `_bus_connected` | bool | CAN bus communication status |
| `_vehicle_off` | bool | Vehicle ignition off detection |
| `vehicle_state` | string | `"running"`, `"idle"`, `"off"` |

### J1939 Only (Heavy Trucks)

| Field | Unit | Description |
|-------|------|-------------|
| `oil_pressure_psi` | PSI | Engine oil pressure |
| `oil_temp_f` | degF | Engine oil temperature |
| `boost_pressure_psi` | PSI | Turbo boost pressure |
| `dpf_soot_load_pct` | % | Diesel particulate filter soot load |
| `def_level_pct` | % | Diesel exhaust fluid level |
| `trans_oil_temp_f` | degF | Transmission oil temperature |
| `fuel_rate_gph` | gal/hr | Fuel consumption rate |
| `engine_load_pct` | % | Engine load percentage |
| `intake_manifold_temp_f` | degF | Intake manifold temperature |
| `accel_pedal_pos_pct` | % | Accelerator pedal position |
| `engine_hours` | hours | Total engine hours |
| `total_fuel_gallons` | gal | Lifetime fuel consumed |
| `total_miles` | miles | Odometer reading |

### OBD-II Only (Passenger Vehicles)

| Field | Unit | Description |
|-------|------|-------------|
| `throttle_position_pct` | % | Throttle position |
| `short_fuel_trim_b1_pct` | % | Short-term fuel trim, bank 1 |
| `long_fuel_trim_b1_pct` | % | Long-term fuel trim, bank 1 |
| `catalyst_temp_b1s1_f` | degF | Catalyst temperature, bank 1 sensor 1 |
| `maf_flow_gps` | g/s | Mass airflow rate |
| `intake_air_temp_f` | degF | Intake air temperature |
| `timing_advance_deg` | deg | Ignition timing advance |
| `commanded_egr_pct` | % | Commanded EGR valve position |
| `control_module_voltage_v` | V | Control module voltage |
| `abs_load_pct` | % | Absolute engine load |
| `ambient_air_temp_f` | degF | Ambient air temperature |
| `ethanol_fuel_pct` | % | Ethanol fuel percentage |
| `barometric_pressure_inhg` | inHg | Barometric pressure |

### DTC Fields

**J1939 format:** `dtc_N_spn` and `dtc_N_fmi` (N = 0..4)
- Example: `dtc_0_spn: 190`, `dtc_0_fmi: 2` = SPN 190 FMI 2

**OBD-II format:** `obd2_dtc_N` (N = 0..4)
- Example: `obd2_dtc_0: "P0300"` = Random/Multiple Cylinder Misfire

## Query Patterns

### Live Data (last 5 minutes)

Used by the main dashboard gauges. Queries a short window and returns the
most recent reading.

```typescript
const endTime = new Date();
const startTime = new Date(endTime.getTime() - 5 * 60 * 1000);
const rows = await dataClient.exportTabularData(
  partId, "truck-engine", "rdk:component:sensor", "Readings",
  startTime, endTime,
);
const latest = rows[rows.length - 1];
const readings = latest.payload.readings;
```

### Historical Data (hours/days)

Used by shift reports and trend charts. Returns time-series arrays
downsampled to MAX_POINTS (500) for chart rendering.

```typescript
const hours = 8;
const endTime = new Date();
const startTime = new Date(endTime.getTime() - hours * 3600000);
const rows = await dataClient.exportTabularData(
  partId, resourceName, "rdk:component:sensor", "Readings",
  startTime, endTime,
);
```

### Why Data API Instead of WebRTC

- **WebRTC** gives real-time readings from a live machine but requires an
  active connection and per-machine credentials.
- **Data API** (exportTabularData) queries the cloud data store. One org-level
  API key reads data from ALL machines. No WebRTC connection needed.
- For historical views, Data API is the only option -- WebRTC has no history.
- For fleet dashboards showing 30+ trucks, Data API scales; opening 30 WebRTC
  connections does not.

## Credential Setup

### Environment Variables (Complete Reference)

**Server-side (API routes):**

| Variable | Description |
|----------|-------------|
| `VIAM_API_KEY` | Organization or location API key (data queries for all machines) |
| `VIAM_API_KEY_ID` | Organization or location API key ID |
| `VIAM_MACHINE_ADDRESS` | Pi 5 TPS machine cloud address |
| `VIAM_PART_ID` | Pi 5 TPS machine Part ID |
| `TRUCK_VIAM_MACHINE_ADDRESS` | Pi Zero truck machine cloud address |
| `TRUCK_VIAM_API_KEY` | Truck machine API key (for do_command) |
| `TRUCK_VIAM_API_KEY_ID` | Truck machine API key ID |
| `TRUCK_VIAM_PART_ID` | Truck machine Part ID (for Data API queries) |
| `ANTHROPIC_API_KEY` | Claude API key for AI diagnostics |

**Client-side (browser, NEXT_PUBLIC_ prefix):**

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_MOCK_MODE` | `"true"` to use simulated data |
| `NEXT_PUBLIC_VIAM_MACHINE_ADDRESS` | Pi 5 machine address (browser WebRTC) |
| `NEXT_PUBLIC_VIAM_API_KEY_ID` | Pi 5 API key ID (browser WebRTC) |
| `NEXT_PUBLIC_VIAM_API_KEY` | Pi 5 API key (browser WebRTC) |
| `NEXT_PUBLIC_TRUCK_VIAM_MACHINE_ADDRESS` | Truck machine address (browser WebRTC) |
| `NEXT_PUBLIC_TRUCK_VIAM_API_KEY_ID` | Truck API key ID (browser WebRTC) |
| `NEXT_PUBLIC_TRUCK_VIAM_API_KEY` | Truck API key (browser WebRTC) |

### Adding a New Truck

See `docs/fleet-onboarding.md` for the step-by-step guide.
