# Remote Monitoring POC — System Architecture

## Overview

This document describes the architecture for a proof-of-concept remote monitoring system for an industrial robot cell using Viam Robotics. The goal is to demonstrate real-time hardware state monitoring from a remote location and trigger alerts when faults occur.

**One-sentence summary:** Unplug the Pi and watch the dashboard react.

### Hardware in Scope

- 6-axis industrial robot arm with Stäubli CS9 controller
- Apera AI vision system running on a GPU-equipped server
- One or more industrial controllers (PLC or similar)
- Junction boxes with operator buttons
- Physical wiring between components

---

## 1. Data Point Readability Assessment

### Robot Arm (Stäubli CS9) — REQUIRES CUSTOM WORK

| Data Point | Confidence | Method | Notes |
|---|---|---|---|
| Robot power state (on/off) | High | Network ping or Modbus TCP status word | Simplest heartbeat |
| Robot mode (auto/manual/teach) | Medium | Modbus TCP status registers or VAL3 socket server | Requires validation of register map |
| E-stop state | Medium | Safety I/O or dedicated safety relay | Safety signals may be on separate circuit |
| Fault/error codes | Medium | VAL3 socket server or Modbus TCP | Validate which faults are exposed |
| Joint positions | High | Real-time interface | Available but overkill for POC |

**Viam native support: None.** Viam has no built-in Stäubli driver. The CS9 supports multiple communication paths:

- **Modbus TCP** — The CS9 has a built-in Modbus TCP Server/Client. If enabled, robot state registers can be read directly using the existing `viam-modbus` registry module. This is the preferred path for the POC.
- **VAL3 socket server** — A custom TCP socket server written in Stäubli's VAL3 language. The hardware integration lead can write a minimal one that broadcasts a heartbeat and fault status.
- **uniVAL PLC** — Fieldbus protocol (EtherNet/IP or PROFINET depending on configuration) that exposes status words and command registers. Requires appropriate licensing.
- **OPC-UA** — Optional server available on CS9 but may require a separate license. No existing Viam module for OPC-UA.

**Assumptions to validate:**
- Is Modbus TCP enabled on the CS9? What registers expose robot mode, fault state, and power status?
- If Modbus TCP is not available, is uniVAL PLC licensed and active?
- Which fieldbus protocol is configured (EtherNet/IP vs PROFINET)?

### Vision System (Apera AI) — REQUIRES CUSTOM WORK

| Data Point | Confidence | Method | Notes |
|---|---|---|---|
| System heartbeat (running/not) | High | Network ping or TCP socket health check | Simplest approach |
| Vision process state | Medium | Apera Vue API or log monitoring | Depends on what Apera exposes |
| Last detection result (pass/fail) | Low–Medium | Socket interface or shared file | Integration-specific |
| GPU/server health | High | Standard OS-level monitoring | Server runs standard OS |

**Viam native support: None.** Apera Vue communicates with robot controllers via TCP sockets using a proprietary protocol. Apera's API documentation is not publicly available — it is provided to customers and partners via their support portal.

For POC monitoring:
- **Simplest path:** A lightweight agent on the vision server that checks if the Apera Vue process is running and reports status over a simple TCP/HTTP endpoint.
- **Richer path:** If Apera exposes a status API, read vision pipeline state directly.

**Assumptions to validate:**
- What OS does the vision server run?
- Does Apera Vue expose any HTTP/REST/socket API for system status beyond its robot communication channel?

### PLC / Industrial Controller — BEST VIAM FIT

| Data Point | Confidence | Method | Notes |
|---|---|---|---|
| Digital I/O states | High | Modbus TCP registers | Standard PLC capability |
| Controller heartbeat | High | Modbus TCP or network ping | Reliable |
| Operator button states | High | Mapped through PLC digital inputs | Junction box buttons wire to PLC |

**Viam native support: Partial.** The `viam-soleng/viam-modbus` module exists in the Viam registry and maps PLC registers as a Viam board component with GPIO-style access. If the PLC supports Modbus TCP (most major PLC brands do), this is the fastest integration path.

**Assumptions to validate:**
- What PLC brand/model is in the cell?
- Does it support Modbus TCP, or only EtherNet/IP / PROFINET?

### Wire / Connection State — INDIRECT MONITORING

Physical wires cannot be directly monitored by Viam. Instead, detect the **consequence** of a pulled wire:

- Wire connects PLC to robot → communication fault on PLC side → readable via PLC registers
- Wire connects button box to PLC → digital input state change → readable via Modbus
- Wire connects a network device → ping failure → readable via network check

This is the strongest POC demo point — monitor the endpoints and infer wire state from the fault.

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    FACTORY FLOOR                             │
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌───────┐ │
│  │ Robot    │    │ Vision   │    │   PLC    │    │Button │ │
│  │ Arm      │    │ Server   │    │          │    │ Box   │ │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘    └───┬───┘ │
│       │               │               │              │     │
│       │ Modbus TCP     │ TCP/HTTP      │ Modbus TCP   │     │
│       │ or TCP Socket  │ health check  │              │(wired│
│       │               │               │              │to PLC)│
│  ┌────┴───────────────┴───────────────┴──────────────┴───┐  │
│  │              VIAM AGENT (viam-server)                  │  │
│  │         Runs on: dedicated Linux SBC or PC             │  │
│  │                                                        │  │
│  │  ┌─────────────┐ ┌──────────────┐ ┌────────────────┐  │  │
│  │  │ Custom      │ │ Custom       │ │ Modbus TCP     │  │  │
│  │  │ Robot Arm   │ │ Vision       │ │ Sensor Module  │  │  │
│  │  │ Sensor      │ │ Health       │ │ (from registry)│  │  │
│  │  │ Module      │ │ Sensor       │ │                │  │  │
│  │  └──────┬──────┘ └──────┬───────┘ └───────┬────────┘  │  │
│  │         │               │                 │           │  │
│  │  ┌──────┴───────────────┴─────────────────┴────────┐  │  │
│  │  │         Viam Data Management Service             │  │  │
│  │  │   - Captures readings at configurable interval   │  │  │
│  │  │   - Syncs to Viam Cloud                          │  │  │
│  │  └──────────────────────┬──────────────────────────┘  │  │
│  └─────────────────────────┼─────────────────────────────┘  │
│                            │                                 │
└────────────────────────────┼─────────────────────────────────┘
                             │ HTTPS (outbound only)
                             ▼
┌────────────────────────────────────────────────────────────┐
│                     VIAM CLOUD                              │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ Data Storage  │  │  Triggers    │  │   Viam API      │  │
│  │ (time-series) │  │  (threshold  │  │   (gRPC/REST)   │  │
│  │              │  │   alerts)    │  │                 │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬────────┘  │
└─────────┼─────────────────┼────────────────────┼───────────┘
          │                 │                    │
          ▼                 ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                 REMOTE MONITORING LOCATION                    │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              MONITORING DASHBOARD                     │   │
│  │  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────────┐ │   │
│  │  │Robot   │  │Vision  │  │PLC I/O │  │Wire/Conn   │ │   │
│  │  │ green  │  │ green  │  │ green  │  │ green      │ │   │
│  │  │ ARM OK │  │ VIS OK │  │ PLC OK │  │ WIRES OK   │ │   │
│  │  └────────┘  └────────┘  └────────┘  └────────────┘ │   │
│  │                                                      │   │
│  │  ALERTS: [none]                                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  When a wire is pulled:                                     │
│  ┌─────────┐                                                │
│  │Wire/Conn│  <- turns RED, audible alert fires             │
│  │  FAULT  │                                                │
│  └─────────┘                                                │
└─────────────────────────────────────────────────────────────┘
```

### Key Architectural Decisions

1. **Single Viam agent on the factory network** — one `viam-server` instance connects to all hardware. Runs on a dedicated Linux device (Raspberry Pi 4/5, Intel NUC, or similar).

2. **Outbound-only connectivity** — the Viam agent pushes data to Viam Cloud via HTTPS. No inbound ports need to be opened on the factory network. This is critical for IT/OT security approval.

3. **Each hardware source = one Viam sensor component** — clean separation. Each sensor module is responsible for one integration and returns a simple status struct.

4. **Dashboard reads from Viam Cloud API** — the remote monitoring location never touches the factory network directly.

---

## 3. Custom Modules Needed

| Module | Type | Language | Complexity | Notes |
|---|---|---|---|---|
| `robot-arm-sensor` | Sensor | Python | Medium | Protocol depends on controller config |
| `vision-health-sensor` | Sensor | Python | Low | Health check against vision server |
| `modbus-plc-sensor` | Sensor | — | Low | Likely use existing registry module |

### Module Details

**`robot-arm-sensor`** (custom, must build)
- Implements Viam's `Sensor` interface
- Returns: `{ "connected": true/false, "mode": "auto", "fault": false, "fault_code": 0 }`
- Two possible implementations:
  - **Option A (simpler):** Hardware lead writes a minimal VAL3 program on the CS9 that opens a TCP server and pushes a JSON status blob every second. The Viam module connects as a TCP client and parses it.
  - **Option B (preferred if available):** Module reads Modbus TCP registers directly from the CS9's built-in Modbus server. No changes needed on the controller side.

**`vision-health-sensor`** (custom, must build)
- Implements Viam's `Sensor` interface
- Returns: `{ "connected": true/false, "process_running": true/false }`
- Simplest version: ICMP ping + TCP port check against the vision server
- Richer version: reads vision software status API if one is available

**PLC integration** (likely existing module)
- If the PLC supports Modbus TCP, use the existing `viam-soleng/viam-modbus` registry module
- Configure it to read specific coils/registers that map to:
  - Operator button states (junction box inputs)
  - Communication fault bits (wired connection health)

---

## 4. Dashboard Tech Stack

### Recommended: Next.js + Viam TypeScript SDK

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Next.js (React) | Fast to build, easy deployment, good for real-time UIs |
| Viam integration | `@viamrobotics/sdk` (TypeScript) | Official SDK, direct API access to sensor readings |
| Real-time updates | Polling at 1–2s interval via Viam SDK | Simple, reliable, sufficient for POC |
| Alerting (visual) | CSS animations + browser audio API | Red flash + audible tone on fault |
| Alerting (push) | Viam Triggers → webhook → email/Slack | For unattended monitoring |
| Hosting | Vercel or local machine | Vercel for zero-ops, local for air-gapped demo |

### Alternatives Considered

- **Grafana:** Good for time-series but harder to customize the "pull a wire, see it react" experience. Better suited for Phase 2 historical analysis.
- **Viam's built-in dashboard:** Too limited for custom alert UX.

---

## 5. Phased Build Plan

### Phase 1 — Minimum Viable Demo

**Goal:** Pull one wire, watch one indicator turn red on a screen in a remote location.

**Scope:**
1. Deploy `viam-server` on a Linux device on the factory network
2. Build **one** custom sensor module — the PLC Modbus integration (lowest risk, most likely to work on first attempt)
3. Wire one junction box button through the PLC so pressing it or disconnecting it changes a Modbus register
4. Build a single-page dashboard with 1–2 status indicators
5. Demo: disconnect the junction box wire → dashboard shows red within 2 seconds

**What this proves:** The full data pipeline works end-to-end. Viam can read hardware state, sync it to cloud, and a remote dashboard can display it with low latency.

**Deliverables:**
- Viam configuration file for the agent
- PLC Modbus sensor module (or registry module configuration)
- Dashboard web app (single page)
- 30-second demo video

### Phase 2 — Full Hardware Coverage

**Goal:** All four hardware sources monitored, alerts fire automatically.

**Scope:**
1. Add `robot-arm-sensor` module (hardware lead builds VAL3 or Modbus side, software lead builds Viam module)
2. Add `vision-health-sensor` module
3. Add multiple PLC data points (operator buttons, communication fault bits)
4. Dashboard shows all four sources with individual status
5. Configure Viam Triggers for email/Slack alerting on any fault
6. Add fault history (last 10 events) to dashboard

**What this proves:** The system can monitor heterogeneous industrial equipment and alert on any component failure.

### Phase 3 — Production Hardening (Future)

- Redundant Viam agent
- Grafana for historical trend analysis
- Multi-cell monitoring (scale to additional robot cells)
- Integration with existing plant SCADA/MES if applicable

---

## 6. Privacy Architecture — Surveillance Prevention by Design

### Data Flow Boundaries (enforced by architecture, not policy)

```
COLLECTED:                          NEVER COLLECTED:
  Machine power state                 Camera feeds of work area
  Fault codes (numeric)               Operator identity
  Digital I/O states (on/off)         Cycle time per operator
  Network connectivity (up/down)      Production counts by shift
  Process running (yes/no)            Audio from work area
```

### How the Architecture Enforces This

- Each sensor module has a **fixed return schema** — it can only return the fields defined in its `GetReadings()` implementation. Adding a new data field requires writing new code, building a new module version, and deploying it.
- No cameras are connected to the Viam agent. The vision system cameras are on a separate network segment and the health sensor only checks "is the process alive" — it never accesses image data.
- The Viam data management service captures only what sensors report. There is no ambient data collection.
- **Expanding scope requires:** new module code → code review → build → deploy → reconfigure Viam agent. This is a multi-step, auditable process, not a configuration toggle.

---

## 7. Work Split

| Task | Software Lead | Hardware Lead | Together |
|---|---|---|---|
| Viam agent setup and configuration | Primary | | |
| PLC Modbus integration | Primary | Consult on register map | |
| Robot arm sensor module (Viam side) | Primary | | |
| Robot arm controller-side integration | | Primary | |
| Vision health sensor module | Primary | Consult on ports/API | |
| Dashboard build | Primary | | |
| Physical wire test scenarios | | Primary | |
| Hardware network topology | | Primary | |
| Integration testing | | | Joint |
| Stakeholder demo | | | Joint |

**Clean seam:** The hardware lead owns everything that runs *on* the industrial hardware (controller programs, PLC configuration, vision system settings). The software lead owns everything that runs *outside* the industrial hardware (Viam agent, modules, dashboard, cloud configuration). The interface contract is: the hardware side exposes a TCP endpoint or Modbus register at a known IP and port that returns machine state; the software side reads it.

---

## 8. Assumptions Requiring Validation

These need answers from the hardware integration lead before committing to implementation details:

| # | Question | Impact if Wrong |
|---|---|---|
| 1 | Is Modbus TCP enabled on the CS9? What registers expose robot mode, fault state, and power status? | If unavailable, must use VAL3 socket approach |
| 2 | What fieldbus protocol is configured (EtherNet/IP vs PROFINET)? | Determines sensor module protocol |
| 3 | What PLC brand/model is in the cell? | Determines if Modbus TCP is available |
| 4 | What OS does the vision server run? | Determines health check approach |
| 5 | Does the vision software expose any status API or socket interface? | Determines richness of monitoring data |
| 6 | Is there a managed switch on the cell network with a free port for the Viam agent? | Physical connectivity requirement |
| 7 | Are there any IT/OT network segmentation policies that would block the Viam agent from reaching Viam Cloud? | May require proxy configuration or firewall rules |
| 8 | Can the hardware lead write and deploy a VAL3 program to the CS9 for testing? | Required for Option A of robot monitoring |

---

## 9. Current Implementation State

Last updated: March 19, 2026. This section maps every component in the architecture diagram above to its actual current state.

### Component-by-component status

**Viam Agent (viam-server).** Deployed and working. Runs on a Raspberry Pi 5 (Raspberry Pi OS Lite 64-bit, aarch64) as a systemd service. Version 0.116.0. Auto-starts on boot, auto-recovers from power loss. Connected to Viam Cloud at `staubli-pi-main.djgpitarpm.viam.cloud`. Machine shows "Live" in the Viam app. Power cycle test passed: unplugging the Pi and plugging it back in results in full automatic recovery with no manual intervention.

**Vision Health Sensor module.** Deployed and working. Custom Python module at `/opt/viam-modules/vision-health-sensor/`. Registered in Viam app as component "vision-health". Targets 8.8.8.8:53 (Google DNS) as a stand-in for the Apera vision server. Returns `{"connected": true, "process_running": true}` on every poll. Both ICMP ping and TCP port probe run concurrently with timeouts. Data capture configured at 0.2 Hz, readings sync to Viam Cloud via the data_manager service.

**Robot Arm Sensor module.** Scaffold only. Code is complete with Viam registration, configuration handling, and placeholder readings for both Modbus TCP and VAL3 socket protocols. Not deployed to the Pi. Blocked on Staubli CS9 protocol confirmation from the hardware lead.

**PLC / Modbus Sensor module.** Deployed and working against real hardware. Custom Python module at `modules/plc-sensor/` registered as Viam component `plc-monitor`. Connects via Modbus TCP to a **Click PLC C0-10DD2E-D** at `192.168.0.10:502`. The Click PLC reads two physical buttons (Fuji AR22F0L servo power button on X1, NC e-stop on X2) and sets coil 0 on button press. The plc-sensor module reads 25 E-Cat cable registers (0-24), 18 sensor/state registers (100-117), and coil 0 (button state).

The module implements a **software servo power latch**: pressing the blue button latches servo power ON, pressing e-stop clears it. The Click PLC does not update holding registers 0-1 (servo_power_on / servo_disable) — the latch is maintained entirely in software. The `estop_off` register (24) reads 1 during normal operation (e-stop NOT engaged) and 0 when e-stop IS active. Stale fault code 4 (`estop_triggered`) in register 113 is ignored when e-stop is not actually active.

The module also maintains **software-side analytics counters** that persist between polls (reset on viam-server restart): `servo_power_press_count` (rising-edge count of button presses), `estop_activation_count` (rising-edge count of e-stop events), `current_uptime_seconds` (time since module start), and `last_estop_duration_seconds` (duration of most recent e-stop event). These replace PLC registers 114-117 which are always zero on the Click PLC.

The deployed module files at `/opt/viam-modules/` are **symlinked** to the git repo at `/home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC/modules/`, so `git pull` immediately updates the code viam-server runs. The PLC is powered by a Rhino PSR-24-480 24 VDC supply and connected to the Pi via a Netgear Ethernet switch. A ZipLink ZL-RTB20-1 breakout board provides clean terminal access to all PLC I/O. The Pi 5 (192.168.0.176, WiFi) runs viam-server with the plc-sensor module connecting to the Click PLC over the local network.

**Wire / Connection monitoring.** Derived from PLC sensor readings. The dashboard Wire/Connection card shows green when the PLC sensor reports `connected: true` and `fault: false`. When the Pi Zero W loses power or network, the Modbus connection fails and the card turns red. Additionally, each of the 25 E-Cat cable signals is individually monitored. If any signal drops from 1 to 0, a specific fault event is logged (e.g., "E-Cat Signal Lost — Servo Power ON (Pin 1)"). Recovery is also logged when signals return to 1. For GPIO-wired signals, physically disconnecting a wire causes the pin's pull-down to register 0, which is immediately visible on the dashboard.

**Viam Data Management Service.** Deployed and working. Configured in the Viam app with capture directory at `/tmp/viam-data`, sync interval of 6 seconds, tagged with "robot-cell-monitor". Both `plc-monitor` and `vision-health` sensors are captured. Readings are stored as binary protobuf files and synced to Viam Cloud. Historical readings are visible in the Viam app Data tab. Software analytics (servo press count, e-stop count, uptime, e-stop duration) are included in every captured reading.

**Viam Triggers.** Not configured. Dashboard handles alerting client-side. Cloud-side triggers for email/Slack are a future item.

**Monitoring Dashboard.** Deployed and working. Next.js application deployed to Vercel. Accessible from any browser with internet access. Connects to viam-server on the Pi 5 via the Viam TypeScript SDK (@viamrobotics/sdk v0.34.0) over WebRTC, negotiated through Viam Cloud. Polls sensor readings every 2 seconds. Three of four cards are green: Vision System (OK), PLC / Controller (OK), Wire / Connection (OK). Robot Arm shows yellow Pending (hardware not available). Two data panels: (1) PLC Sensor Data showing system state, cycle count, temperature, humidity, vibration, pressure, servo positions, button state; (2) E-Cat Signal Status showing all 25 cable signals with green/red dot indicators. E-Cat signal changes are logged in fault history with signal name and pin number (loss in red, recovery in green). Fault detection with audible klaxon, red screen flash, alert banner, and 10-event fault history log. Mock mode available via environment variable for demos without hardware.

### Divergences from the original plan

**Raspberry Pi 5 instead of Pi 4 or NUC.** Section 2 mentioned "Raspberry Pi 4/5, Intel NUC, or similar." The Pi 5 was used because it was available. viam-server runs comfortably on it.

**Component naming.** The Viam module directories use model names like `plc-sensor` and `robot-arm-sensor`, but the Viam component instance names differ: `plc-monitor`, `robot-arm-monitor`, `vision-health`. The dashboard uses the component instance names to query readings. The vision sensor is `vision-health`, the PLC sensor is `plc-monitor`, the robot arm is `robot-arm-sensor` (pending).

**Dashboard hosted on Vercel, not on the Pi.** Section 4 listed "Vercel or local machine" as hosting options. Vercel was chosen because the dashboard should be available even when the Pi is offline. When the Pi loses power, the dashboard still loads and shows the fault state. If the dashboard ran on the Pi, it would go down at exactly the moment you most need it.

**Dashboard reads directly from machine via WebRTC, not from cloud data API.** Section 2 shows the dashboard reading from "Viam API (gRPC/REST)" in the cloud layer. The actual implementation connects the browser directly to viam-server on the Pi via WebRTC, negotiated through Viam Cloud. This has lower latency but means live readings require the machine to be online. The data_manager service separately syncs readings to cloud storage for historical access.

**Privacy architecture is fully enforced.** Section 6 described the privacy constraints. The implementation follows them exactly. The vision-health-sensor returns only `connected` (bool) and `process_running` (bool). No camera, audio, or personnel data is collected or displayable.

### What the pending modules need

The PLC sensor module is deployed and working against a real Click PLC C0-10DD2E-D at 192.168.0.10. The module maintains a software servo power latch (button press ON, e-stop clears) and software analytics counters because the Click PLC does not update the relevant holding registers. Key bug fix (March 19, 2026): the `estop_off` register (24) was incorrectly interpreted — value 1 means e-stop is NOT engaged (normal), not that e-stop is active. The deployed module files are symlinked from `/opt/viam-modules/` to the git repo so `git pull` + `sudo systemctl restart viam-server` is the complete deployment workflow.

The robot arm sensor module code is complete for both protocol options. To activate it: confirm which protocol the CS9 exposes and provide either the Modbus register addresses or confirm that a VAL3 socket server is running.

The wire/connection indicator derives its state from the PLC sensor and is now active — it shows green when the PLC is connected and turns red when the connection drops.

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

- **Current setting:** `/home/pi/.viam/capture` (persistent, on SD card ext4 filesystem)
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

At current capture rates (PLC at 1 Hz, arm and vision at 0.2 Hz) during 10-hour workdays:

| Scope | Daily | Monthly (22 days) |
|---|---|---|
| Per truck | ~39 MB | ~858 MB |
| 36-truck fleet | ~1.4 GB | ~30.9 GB |

Estimated Viam Cloud cost at fleet scale with 90-day retention: **~$51/month**. See `docs/data-management.md` section 3 for the full cost breakdown.

### Future: Viam Abstraction Roadmap

The long-term strategy is to minimize custom-owned code by shifting infrastructure responsibilities to Viam's managed services. The only code we maintain should be the three thin sensor modules — the protocol translation layer between industrial hardware and the Viam sensor interface. Everything else should be Viam-managed.

#### Step 1: Publish Modules to the Viam Registry

**Current state:** Modules are `"type": "local"` — deployed as files on the Pi via SCP.

**Target state:** Modules published to the Viam Registry as versioned packages.

**What Viam then owns:**
- OTA deployment and updates across all 36 trucks
- Module version management and rollback
- No more SSH-ing into Pis to update module code

#### Step 2: Use Viam Fragments for All Configuration

**Current state:** `viam-server.json` template config in this repo, manually applied per truck.

**Target state:** A single Viam Fragment applied to all machines, with per-truck overrides for PLC IP and truck-specific tags.

**What Viam then owns:**
- Config distribution fleet-wide
- Config versioning (latest / pinned / tagged)
- Config rollback

#### Step 3: Use Viam Triggers Instead of Dashboard-Side Alerting

**Current state:** The dashboard handles fault detection client-side (JavaScript polling + klaxon).

**Target state:** Viam Triggers — cloud-side rules that fire on conditions like `system_state == "fault"` or `estop_off == 0`. Triggers send webhooks to email/Slack.

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
| Module deployment | SCP files to each Pi | Viam Registry + OTA |
| Config management | Edit JSON per truck | Fragments with overrides |
| Alerting | Dashboard JS code | Viam Triggers |
| Data storage | SD card + manual checks | Viam Cloud + retention policies |
| ML training | Not started | Viam ML pipeline |
| Model deployment | Not started | Viam edge ML |
| Fleet health monitoring | SSH into each Pi | Viam app fleet view |

**The resulting ownership boundary:** We own three thin Python sensor modules that translate industrial protocols (Modbus TCP, TCP socket, ICMP/TCP probe) into Viam sensor readings. Everything else — deployment, configuration, data management, alerting, ML, and fleet operations — is Viam-managed.

### Future: ML Data Collection Requirements

The 46 PLC fields captured at 1 Hz provide a rich time-series dataset for ML. The two highest-value models and their data requirements:

**Model 1 — Anomaly Detection (unsupervised, no labeling required):**
- Key features: `vibration_x/y/z`, `temperature_f`, `servo1_position`, `servo2_position`, `cycle_count`, `current_uptime_seconds`
- Learns "normal" operating signatures per truck, flags deviations before they become faults
- Minimum data: 2–4 weeks of normal operation per truck; recommended 8+ weeks to capture full range of operating conditions (load, temperature, shift patterns)

**Model 2 — Fault Prediction (supervised, requires labeled fault events):**
- Key features: All 25 E-Cat signals, `system_state` transitions, `fault`/`last_fault`, `estop_activation_count`, `button_state`
- Learns signal patterns that precede faults
- Minimum data: 50–100 labeled fault events across the fleet; recommended 200+ for reliable classification
- Critical bottleneck: faults are rare, so accumulating labeled examples takes time across the fleet

**Practical timeline at current collection rates:**

| Milestone | Timeline | What It Enables |
|---|---|---|
| 8 weeks of fleet data | Week 8 | Train anomaly detection model (unsupervised — no labeling needed) |
| 50+ labeled fault events | Ongoing | Train basic fault classification model |
| 16+ weeks of fleet data | Week 16+ | Refined anomaly detection + fault classification with edge deployment |

See `docs/data-management.md` section 9 for the full ML data requirements breakdown.

### Future: Additional Data Sources

- **Image capture.** The Pi camera component (`pi-camera`) is configured but not currently captured by the data management service. Adding image capture would significantly increase data volume and may warrant moving `capture_dir` to a USB SSD.
- **Predictive maintenance analytics.** The `servo_power_press_count`, `estop_activation_count`, and `current_uptime_seconds` fields enable usage-based maintenance scheduling per truck — no ML required, just threshold-based rules via Viam Triggers.
