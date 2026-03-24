# TPS Remote Monitoring — System Architecture

## Overview

This document describes the architecture for a remote monitoring system for RAIV railroad Tie Plate Systems (TPS) using Viam Robotics. The system provides real-time machine state monitoring, encoder-based track distance measurement, and production analytics (plate drop counting) from a fleet of 30+ trucks, each equipped with a Click PLC and Raspberry Pi 5.

**One-sentence summary:** Monitor every TPS truck's PLC state, encoder distance, and plate drops from anywhere with a browser.

### Hardware in Scope

- Click PLC C0-10DD2E-D at 169.168.10.21:502 (Modbus TCP)
- SICK DBS60E encoder (1000 PPR, connected via PLC's High-Speed Counter)
- Raspberry Pi 5 running viam-server
- ZipLink ZL-RTB20-1 breakout board for PLC I/O access
- Rhino PSR-24-480 24 VDC power supply

---

## 1. Data Point Readability Assessment

### Click PLC C0-10DD2E-D — PRIMARY DATA SOURCE

| Data Point | Confidence | Method | Notes |
|---|---|---|---|
| DS Holding Registers (DS1-DS25) | High | Modbus TCP FC03, addr 0-24 | TPS config and status |
| Encoder pulse count (DD1) | High | Modbus TCP FC03, addr 16384-16385 | 32-bit signed via HSC x1 quadrature |
| Discrete inputs (X1-X8) | High | Modbus TCP FC02, addr 0-7 | Power loop, camera, air eagle feedback |
| Output coils (Y1-Y3) | High | Modbus TCP FC01, addr 8192-8194 | TPS eject solenoids |
| Internal coils (C1999-C2000) | High | Modbus TCP FC01, addr 1998-1999 | Encoder reset, floating zero |

**Viam integration:** Custom `plc-sensor` module (registered as `plc-monitor` in Viam) reads all of the above via Modbus TCP at 1 Hz. No third-party registry module needed — the custom module provides richer TPS-specific derived fields (encoder distance, speed, plates per minute) beyond raw register access.

### SICK DBS60E Encoder — VIA PLC HSC

The encoder is not read directly by the Pi. It connects to the Click PLC's High-Speed Counter (HSC) input, and the PLC exposes the count as DD1 (Modbus address 16384-16385, 32-bit signed). The `plc-sensor` module derives:

- **Track distance** (mm and ft) from pulse count and wheel circumference (406.4 mm / 16" DMF RW-1650 railgear guide wheel)
- **Speed** (mm/s and ft/min) from delta count / delta time
- **Revolutions** from count / PPR
- **Direction** (forward/reverse) from count delta sign

### Wire / Connection State — INDIRECT MONITORING

Physical wires cannot be directly monitored by Viam. Instead, detect the **consequence** of a disconnection:

- PLC loses power or Ethernet → Modbus TCP connection fails → `connected: false` in sensor readings
- Encoder cable disconnected → count stops changing → visible in dashboard
- Discrete input wire pulled → input drops to false → immediately visible in readings

The dashboard shows connection status and turns red when the PLC becomes unreachable.

---

## 2. System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    RAIV TRUCK (per truck)                      │
│                                                              │
│  ┌────────────────┐    ┌──────────────────┐                  │
│  │ SICK DBS60E    │    │ TPS Machine I/O  │                  │
│  │ Encoder        │    │ (power loop,     │                  │
│  │ (1000 PPR)     │    │  ejects, air     │                  │
│  └───────┬────────┘    │  eagles, camera) │                  │
│          │ HSC input    └────────┬─────────┘                  │
│          │                      │ wired to X/Y/C              │
│  ┌───────┴──────────────────────┴──────────┐                  │
│  │  Click PLC C0-10DD2E-D (169.168.10.21)  │                  │
│  │  Modbus TCP server on port 502          │                  │
│  └──────────────────┬──────────────────────┘                  │
│                     │ Modbus TCP (Ethernet)                    │
│  ┌──────────────────┴──────────────────────────────────┐      │
│  │           RASPBERRY PI 5 (viam-server)               │      │
│  │                                                      │      │
│  │  ┌──────────────────────────────────────────────┐    │      │
│  │  │  plc-sensor module (registered: plc-monitor) │    │      │
│  │  │  - Reads DS1-DS25, DD1, X1-X8, Y1-Y3,       │    │      │
│  │  │    C1999-C2000 via Modbus TCP at 1 Hz        │    │      │
│  │  │  - Derives: distance, speed, plates/min      │    │      │
│  │  │  - Returns ~55 fields per reading            │    │      │
│  │  └────────────────────┬─────────────────────────┘    │      │
│  │                       │                              │      │
│  │  ┌────────────────────┴─────────────────────────┐    │      │
│  │  │       Viam Data Management Service            │    │      │
│  │  │  capture_dir: /home/andrew/.viam/capture      │    │      │
│  │  │  offline_buffer: /home/andrew/.viam/          │    │      │
│  │  │                  offline-buffer/ (50 MB cap)  │    │      │
│  │  │  sync_interval: 0.1 min                       │    │      │
│  │  └────────────────────┬─────────────────────────┘    │      │
│  └───────────────────────┼──────────────────────────────┘      │
│                          │                                      │
└──────────────────────────┼──────────────────────────────────────┘
                           │ HTTPS (outbound only)
                           ▼
┌────────────────────────────────────────────────────────────────┐
│                       VIAM CLOUD                                │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐      │
│  │ Data Storage  │  │  Triggers    │  │   Viam API      │      │
│  │ (time-series) │  │  (future)    │  │   (gRPC/REST)   │      │
│  └──────┬───────┘  └──────────────┘  └────────┬────────┘      │
└─────────┼─────────────────────────────────────┼────────────────┘
          │                                     │
          ▼                                     ▼
┌────────────────────────────────────────────────────────────────┐
│               REMOTE MONITORING (any browser)                   │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           NEXT.JS DASHBOARD (Vercel)                      │  │
│  │                                                          │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │              TPS Controller                         │  │  │
│  │  │  Status: CONNECTED / FAULT / DISCONNECTED          │  │  │
│  │  │  Encoder: distance, speed, direction               │  │  │
│  │  │  Ejects: Y1, Y2, Y3 status                        │  │  │
│  │  │  Production: plates/min, plate count               │  │  │
│  │  │  Inputs: power loop, camera, air eagles            │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │                                                          │  │
│  │  Server-side API route proxies Viam credentials          │  │
│  │  (VIAM_MACHINE_ADDRESS, VIAM_API_KEY_ID, VIAM_API_KEY)  │  │
│  │  Only NEXT_PUBLIC_MOCK_MODE is browser-side              │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
│  On fault/disconnect: card turns RED, audible klaxon fires     │
└────────────────────────────────────────────────────────────────┘
```

### Key Architectural Decisions

1. **One Pi + one PLC per truck** — each RAIV truck runs a single `viam-server` instance on a Raspberry Pi 5 that reads the Click PLC via Modbus TCP. Fleet target: 30+ trucks.

2. **Outbound-only connectivity** — the Viam agent pushes data to Viam Cloud via HTTPS. No inbound ports need to be opened on the truck's network. This is critical for field deployment where trucks operate on remote railroad job sites.

3. **Single sensor module** — the `plc-sensor` module (registered as `plc-monitor`) is the only Viam component. It returns ~55 fields per reading at 1 Hz, covering all PLC registers, encoder-derived values, and production analytics.

4. **Dashboard connects via WebRTC through Viam Cloud** — the Next.js dashboard on Vercel connects directly to viam-server on the Pi via WebRTC, negotiated through Viam Cloud. This provides low-latency live readings. The data_manager service separately syncs readings to cloud storage for historical access.

5. **Offline-first data pipeline** — trucks operate 5-10+ hours without internet. Sensor readings are captured to persistent local storage (`/home/andrew/.viam/capture`) with a 50 MB offline JSONL buffer at `/home/andrew/.viam/offline-buffer/`. Sync is opportunistic when connectivity is available.

---

## 3. Sensor Module

| Module | Viam Name | Type | Language | Status |
|---|---|---|---|---|
| `plc-sensor` | `plc-monitor` | Sensor | Python | Deployed, production |

### Module Details

**`plc-sensor`** (custom, deployed at `modules/plc-sensor/`)
- Implements Viam's `Sensor` interface
- Connects to Click PLC C0-10DD2E-D via Modbus TCP (pymodbus)
- Returns ~55 fields per `get_readings()` call at 1 Hz:

**System health fields:**
- `connected` (bool), `fault` (bool), `system_state` ("running"/"idle"/"disconnected"), `last_fault` (string)
- `current_uptime_seconds` (int), `total_reads` (int), `total_errors` (int)

**Encoder and track distance fields (derived from DD1):**
- `encoder_count` (int, raw 32-bit signed), `encoder_direction` ("forward"/"reverse")
- `encoder_distance_mm` (float), `encoder_distance_ft` (float)
- `encoder_speed_mmps` (float), `encoder_speed_ftpm` (float), `encoder_revolutions` (float)

**TPS machine status fields:**
- `tps_power_loop` (X4), `camera_signal` (X3), `encoder_enabled` (derived), `floating_zero` (C2000), `encoder_reset` (C1999)

**TPS eject system fields:**
- `eject_tps_1` (Y1), `eject_left_tps_2` (Y2), `eject_right_tps_2` (Y3)
- `air_eagle_1_feedback` (X5), `air_eagle_2_feedback` (X6), `air_eagle_3_enable` (X7)

**TPS production fields (derived from Y1 transitions):**
- `plates_per_minute` (float, rolling 60s window), `plate_drop_count` (int, cumulative)

**DS holding registers:** `ds1` through `ds25` (all 25 from Modbus addr 0-24)

**Discrete inputs (raw):** `x1`, `x2`, `x8`

**Self-healing:** Exponential backoff on connection failures (1s to 30s), automatic reconnection when PLC comes back online, full diagnostic logging with troubleshooting hints on first failure.

**Offline buffering:** When configured with `offline_buffer_dir`, readings are appended to date-stamped JSONL files that persist across reboots. Oldest files pruned when buffer exceeds `offline_buffer_max_mb` (default 50 MB).

---

## 4. Dashboard Tech Stack

### Next.js + Viam TypeScript SDK (deployed)

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Next.js (React) | Mobile-responsive, server-side API routes for credential security |
| Viam integration | `@viamrobotics/sdk` (TypeScript) | Official SDK, direct API access to sensor readings via WebRTC |
| Real-time updates | Polling at 2s interval via Viam SDK | Simple, reliable, sufficient for production |
| Alerting (visual) | CSS animations + browser audio API | Red flash + audible klaxon on fault |
| Alerting (push) | Viam Triggers → webhook → email/Slack | Future item |
| Hosting | Vercel | Dashboard available even when Pi is offline |

### Credential Security

The dashboard uses a **server-side API route** to proxy Viam credentials. Environment variables are set in Vercel WITHOUT the `NEXT_PUBLIC_` prefix so they are never exposed to the browser:

- `VIAM_MACHINE_ADDRESS` — the machine's cloud address
- `VIAM_API_KEY_ID` — API key identifier
- `VIAM_API_KEY` — API key secret

Only `NEXT_PUBLIC_MOCK_MODE` is browser-side (enables demo mode without hardware).

### Single Status Card

The dashboard shows a single **TPS Controller** card with all sensor data organized into sections: system health, encoder/track distance, machine status, eject system, and production metrics.

### Alternatives Considered

- **Grafana:** Good for time-series but harder to customize the mobile-responsive single-card UX. Better suited for historical analysis.
- **Viam's built-in dashboard:** Too limited for custom alert UX and mobile responsiveness.

---

## 5. Deployment Status and Roadmap

### Completed — Single Truck Prototype

All core components are deployed and working on the bench prototype:

1. **viam-server** on Raspberry Pi 5 — auto-starts, auto-recovers from power loss
2. **plc-sensor module** — reads all TPS PLC registers at 1 Hz with self-healing reconnection
3. **Offline-first data pipeline** — persistent capture directory, JSONL offline buffer, opportunistic cloud sync
4. **Next.js dashboard on Vercel** — mobile-responsive, single TPS Controller card, fault alerting with klaxon
5. **Encoder integration** — track distance, speed, direction derived from SICK DBS60E via PLC HSC
6. **Production analytics** — plates per minute and plate drop count derived from Y1 eject coil transitions
7. **Diagnostics engine** (`diagnostics.py`) — 19 rules across 5 categories (plate flipper, encoder, eject, PLC, operation), evaluates every 1Hz reading after 60s warmup, provides severity-tagged alerts with step-by-step operator actions
8. **Touch screen UI** (`ironsight-touch.py`) — 3.5" glove-friendly display on Pi framebuffer with 6 pages: HOME (live production), LIVE (PLC registers), COMMANDS (system actions), DIAGNOSE (AI-powered diagnosis via Claude), LOGS (activity), SYSTEM (health)
9. **AI diagnosis** — DIAGNOSE page sends full system context (PLC registers, signal metrics, control bits, eth0 health, Viam capture status, encoder state) to Claude for plain-English diagnosis, color-coded by severity (green=ok, yellow=warning, red=critical)
10. **IronSight watchdog** — cron-based health monitor with auto-healing, alert deduplication, and incident reporting

### Next — Fleet Rollout

**Goal:** Deploy to 30+ RAIV railroad trucks, each with identical Pi 5 + Click PLC configuration.

**Scope:**
1. Publish `plc-sensor` module to Viam Registry for OTA deployment
2. Create Viam Fragment for fleet-wide configuration with per-truck PLC IP overrides
3. Configure Viam Triggers for server-side alerting (email/Slack on fault conditions)
4. Scale dashboard to multi-truck fleet view
5. Establish field deployment procedures (SD card imaging, PLC IP assignment, Viam provisioning)

### Future — Production Hardening

- Grafana for historical trend analysis across fleet
- ML anomaly detection trained on fleet-wide sensor data
- Predictive maintenance models based on encoder wear patterns and plate drop cadence
- USB SSD for capture directory (if data volumes warrant it)

---

## 6. Privacy Architecture — Surveillance Prevention by Design

### Data Flow Boundaries (enforced by architecture, not policy)

```
COLLECTED:                          NEVER COLLECTED:
  PLC connection state (up/down)      Camera feeds of work area
  Encoder count and distance          Operator identity
  Digital I/O states (on/off)         Production counts by operator
  Eject coil states                   Cycle time per operator
  DS holding register values          Audio from work area
  Track speed and direction           GPS location
  Plate drop count and rate           Personal data of any kind
```

### How the Architecture Enforces This

- The `plc-sensor` module has a **fixed return schema** — it can only return the ~55 fields defined in its `get_readings()` implementation. Adding a new data field requires writing new code, building a new module version, and deploying it.
- No cameras, microphones, or GPS receivers are connected to the Viam agent. The Pi 5 reads only the Click PLC via Modbus TCP.
- The Viam data management service captures only what the sensor module reports. There is no ambient data collection.
- **Expanding scope requires:** new module code → code review → build → deploy → reconfigure Viam agent. This is a multi-step, auditable process, not a configuration toggle.

---

## 7. Work Split

| Task | Software Lead | Hardware Lead | Together |
|---|---|---|---|
| Viam agent setup and configuration | Primary | | |
| PLC Modbus sensor module | Primary | Consult on register map | |
| Click PLC ladder logic | | Primary | |
| Dashboard build and deployment | Primary | | |
| Encoder integration and calibration | | Primary | Consult on wheel diameter |
| Fleet SD card imaging procedure | Primary | | |
| Per-truck PLC IP and wiring | | Primary | |
| Field deployment and testing | | | Joint |

**Clean seam:** The hardware lead owns everything that runs *on* the PLC (ladder logic, I/O wiring, encoder mounting). The software lead owns everything that runs *outside* the PLC (Viam agent, plc-sensor module, dashboard, cloud configuration). The interface contract is: the PLC exposes Modbus TCP registers at a known IP and port; the software side reads them.

---

## 8. Resolved and Open Questions

### Resolved

| # | Question | Answer |
|---|---|---|
| 1 | What PLC brand/model? | Click PLC C0-10DD2E-D — supports Modbus TCP natively |
| 2 | PLC IP address? | 169.168.10.21:502 |
| 3 | Encoder type and connection? | SICK DBS60E-BDEC01000 (1000 PPR), connected to PLC HSC input |
| 4 | Wheel diameter for distance calc? | 406.4 mm (16" DMF RW-1650 railgear guide wheel) |
| 5 | Capture directory persistence? | `/home/andrew/.viam/capture` on SD card ext4 (survives power loss) |

### Open (for fleet rollout)

| # | Question | Impact if Wrong |
|---|---|---|
| 1 | Will all trucks use the same PLC IP (169.168.10.21) or will each need a unique IP? | Affects Viam Fragment per-truck override strategy |
| 2 | Will trucks have cellular connectivity for cloud sync, or only WiFi at the shop? | Affects sync interval tuning and offline buffer sizing |
| 3 | SD card endurance under continuous 1 Hz writes — should we move capture_dir to USB SSD? | SD card wear could cause field failures |
| 4 | Per-truck identification scheme (truck number, asset tag)? | Needed for fleet-wide data tagging and dashboard multi-truck view |

---

## 9. Current Implementation State

Last updated: March 20, 2026. This section maps every component in the architecture diagram above to its actual current state.

### Component-by-component status

**Viam Agent (viam-server).** Deployed and working. Runs on a Raspberry Pi 5 (Raspberry Pi OS Lite 64-bit, aarch64) as a systemd service. Auto-starts on boot, auto-recovers from power loss. Connected to Viam Cloud. Machine shows "Live" in the Viam app. Power cycle test passed: unplugging the Pi and plugging it back in results in full automatic recovery with no manual intervention.

**PLC Sensor module (`plc-sensor` / `plc-monitor`).** Deployed and working against real hardware. Custom Python module at `modules/plc-sensor/` registered as Viam component `plc-monitor`. Connects via Modbus TCP to a **Click PLC C0-10DD2E-D** at `169.168.10.21:502`.

The module reads the full TPS register map every second:
- **DS1-DS25** (Modbus addr 0-24): all 25 TPS holding registers
- **DD1** (Modbus addr 16384-16385): 32-bit signed encoder count from SICK DBS60E via HSC
- **X1-X8** (discrete inputs): TPS power loop (X4), camera signal (X3), air eagle feedback (X5/X6), air eagle enable (X7)
- **Y1-Y3** (output coils at addr 8192-8194): TPS eject solenoids
- **C1999-C2000** (internal coils at addr 1998-1999): encoder reset, floating zero

The module derives production analytics from raw PLC data:
- **Track distance** (mm, ft) and **speed** (mm/s, ft/min) from encoder count delta and wheel circumference
- **Plates per minute** from OFF-to-ON transitions on Y1 (Eject TPS_1) over a rolling 60-second window
- **Plate drop count** (cumulative, resets on viam-server restart)
- **System state** ("running" when tps_power_loop is active, "idle" otherwise, "disconnected" on Modbus failure)

Self-healing: exponential backoff (1s to 30s) on connection failures, automatic reconnection, diagnostic logging with troubleshooting hints.

The deployed module files at `/opt/viam-modules/` are **symlinked** to the git repo at `/home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC/modules/`, so `git pull` immediately updates the code viam-server runs. The PLC is powered by a Rhino PSR-24-480 24 VDC supply and connected to the Pi via Ethernet. A ZipLink ZL-RTB20-1 breakout board provides clean terminal access to all PLC I/O.

**Viam Data Management Service.** Deployed and working. Configured with:
- `capture_dir`: `/home/andrew/.viam/capture` (persistent, on SD card ext4 filesystem — survives power loss)
- `offline_buffer_dir`: `/home/andrew/.viam/offline-buffer/` (50 MB cap, date-stamped JSONL files)
- `sync_interval`: 0.1 min (6 seconds)
- Only the `plc-monitor` sensor is captured. Readings are stored as binary protobuf files and synced to Viam Cloud. Historical readings are visible in the Viam app Data tab.

**Viam Triggers.** Not configured. Dashboard handles alerting client-side. Cloud-side triggers for email/Slack are a future item.

**Monitoring Dashboard.** Deployed and working. Next.js application deployed to Vercel. Mobile-responsive. Accessible from any browser with internet access. Connects to viam-server on the Pi 5 via the Viam TypeScript SDK over WebRTC, negotiated through Viam Cloud. Polls sensor readings every 2 seconds. Single **TPS Controller** status card showing system health, encoder/track data, machine status, eject system, and production metrics. Fault detection with audible klaxon, red screen flash, alert banner, and fault history log. Server-side API route proxies Viam credentials (env vars without `NEXT_PUBLIC_` prefix). Mock mode available via `NEXT_PUBLIC_MOCK_MODE` for demos without hardware.

### Deployment workflow

```
git pull → sudo systemctl restart viam-server
```

Module files are symlinked from `/opt/viam-modules/` to the git repo, so pulling new code and restarting the service is the complete deployment process. No build step required (Python module).

---

## 10. Data Management Architecture

Last updated: March 18, 2026. See `docs/data-management.md` for the full operational guide and `docs/fleet-deployment-plan.md` for the rollout plan.

### Offline-First Design Rationale

RAIV trucks operate on remote railroad job sites for 5–10+ hours with no internet connectivity. The entire data pipeline is designed around this constraint:

- **Capture is local-first.** Sensor readings are written to persistent local disk regardless of network state. The capture process has zero dependency on cloud connectivity.
- **Sync is opportunistic.** When the truck has internet (typically at the shop), viam-server automatically uploads buffered data to Viam Cloud. No manual intervention required.
- **Power loss is expected.** Trucks on remote sites may lose power unexpectedly. The capture directory is on the SD card's ext4 filesystem (journaled), not `/tmp`. Data captured before power loss survives the reboot.

### Why capture_dir Must Be Persistent Storage

The `capture_dir` setting in `viam-server.json` controls where sensor readings are buffered on disk before syncing to the cloud. This MUST be a persistent path that survives reboots and power loss.

- **Current setting:** `/home/andrew/.viam/capture` (persistent, on SD card ext4 filesystem)
- **Previously:** `/tmp/viam-data` (WRONG — `/tmp` is volatile, cleared on reboot)

If `capture_dir` points to `/tmp` and the truck loses power in the field, all buffered data that hasn't synced is permanently lost. This was identified and fixed during the March 2026 data management audit.

### Data Retention and Lifecycle

```
Sensor reading captured → Written to local .capture file
                          → Synced to Viam Cloud (when online)
                          → Deleted from local disk (after confirmed sync)
                          → Retained in cloud (until retention policy or manual deletion)
```

Viam's auto-deletion threshold: if the filesystem reaches **90% disk usage** AND the capture directory accounts for at least 50% of that usage, viam-server deletes every Nth captured file (default every 5th) to free space. For a 32 GB SD card at current data rates (~39 MB/day), this threshold would take 700+ offline days to reach.

### Data Volume Summary

At current capture rates (PLC at 1 Hz) during 10-hour workdays:

| Scope | Daily | Monthly (22 days) |
|---|---|---|
| Per truck | ~39 MB | ~858 MB |
| 30+-truck fleet | ~1.4 GB | ~30.9 GB |

Estimated Viam Cloud cost at fleet scale with 90-day retention: **~$51/month**. See `docs/data-management.md` section 3 for the full cost breakdown.

### Future: Viam Abstraction Roadmap

The long-term strategy is to minimize custom-owned code by shifting infrastructure responsibilities to Viam's managed services. The only code we maintain should be the `plc-sensor` module — the protocol translation layer between the Click PLC (Modbus TCP) and the Viam sensor interface. Everything else should be Viam-managed.

#### Step 1: Publish Modules to the Viam Registry

**Current state:** Module is `"type": "local"` — deployed as files on the Pi via symlink to git repo.

**Target state:** Module published to the Viam Registry as a versioned package.

**What Viam then owns:**
- OTA deployment and updates across all 30+ trucks
- Module version management and rollback
- No more SSH-ing into Pis to update module code

#### Step 2: Use Viam Fragments for All Configuration

**Current state:** Config managed per-machine in the Viam app.

**Target state:** A single Viam Fragment applied to all 30+ machines, with per-truck overrides for PLC IP and truck-specific tags.

**What Viam then owns:**
- Config distribution fleet-wide
- Config versioning (latest / pinned / tagged)
- Config rollback

#### Step 3: Use Viam Triggers Instead of Dashboard-Side Alerting

**Current state:** The dashboard handles fault detection client-side (JavaScript polling + klaxon).

**Target state:** Viam Triggers — cloud-side rules that fire on conditions like `system_state == "disconnected"` or `fault == true`. Triggers send webhooks to email/Slack.

**What Viam then owns:**
- Alerting pipeline execution
- Delivery to email/Slack/webhook endpoints
- Alert rule management (no custom code)

#### Step 4: Use Viam's ML Pipeline for Predictive Maintenance

**Current state:** Data captured and stored in Viam Cloud. No ML models.

**Target state:** Anomaly detection and fault prediction models trained on captured data via Viam's ML tools, deployed back to each Pi for edge inference.

**What Viam then owns:**
- Model training infrastructure
- Model versioning in the Viam Registry
- OTA model deployment to edge devices
- Edge inference runtime on the Pi

See `docs/data-management.md` section 9 for detailed ML data requirements.

#### Abstraction Summary

| Concern | Today (we own it) | After abstraction (Viam owns it) |
|---|---|---|
| Module deployment | Symlinked git repo on each Pi | Viam Registry + OTA |
| Config management | Edit JSON per truck | Fragments with overrides |
| Alerting | Dashboard JS code | Viam Triggers |
| Data storage | SD card + manual checks | Viam Cloud + retention policies |
| ML training | Not started | Viam ML pipeline |
| Model deployment | Not started | Viam edge ML |
| Fleet health monitoring | SSH into each Pi | Viam app fleet view |

**The resulting ownership boundary:** We own one Python sensor module (`plc-sensor`) that translates Modbus TCP registers into Viam sensor readings with TPS-specific derived fields. Everything else — deployment, configuration, data management, alerting, ML, and fleet operations — is Viam-managed.

### Future: ML Data Collection Requirements

The ~55 PLC fields captured at 1 Hz provide a rich time-series dataset for ML. The two highest-value models and their data requirements:

**Model 1 — Anomaly Detection (unsupervised, no labeling required):**
- Key features: `encoder_speed_mmps`, `encoder_distance_mm`, `plates_per_minute`, `ds1`-`ds25`, `current_uptime_seconds`
- Learns "normal" operating signatures per truck, flags deviations before they become faults
- Minimum data: 2-4 weeks of normal operation per truck; recommended 8+ weeks to capture full range of operating conditions (load, terrain, shift patterns)

**Model 2 — Fault Prediction (supervised, requires labeled fault events):**
- Key features: `system_state` transitions, `fault`/`last_fault`, `tps_power_loop`, `air_eagle_1_feedback`/`air_eagle_2_feedback`, eject coil patterns (`eject_tps_1`, `eject_left_tps_2`, `eject_right_tps_2`)
- Learns signal patterns that precede faults
- Minimum data: 50-100 labeled fault events across the fleet; recommended 200+ for reliable classification
- Critical bottleneck: faults are rare, so accumulating labeled examples takes time across the fleet

**Practical timeline at current collection rates:**

| Milestone | Timeline | What It Enables |
|---|---|---|
| 8 weeks of fleet data | Week 8 | Train anomaly detection model (unsupervised — no labeling needed) |
| 50+ labeled fault events | Ongoing | Train basic fault classification model |
| 16+ weeks of fleet data | Week 16+ | Refined anomaly detection + fault classification with edge deployment |

See `docs/data-management.md` section 9 for the full ML data requirements breakdown.

### Future: Additional Data Sources

- **GPS/location data.** Adding a GPS module to the Pi would enable per-truck location tracking and geofencing. This would require a privacy review per section 6.
- **Predictive maintenance analytics.** The `plates_per_minute`, `plate_drop_count`, `encoder_distance_mm`, and `current_uptime_seconds` fields enable usage-based maintenance scheduling per truck — no ML required, just threshold-based rules via Viam Triggers.
- **USB SSD for capture directory.** If data volumes increase (e.g., higher capture rate or additional sensors), the capture directory should move from the SD card to a USB SSD to avoid SD card wear.
