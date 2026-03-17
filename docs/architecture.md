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

Last updated: March 16, 2026. This section maps every component in the architecture diagram above to its actual current state.

### Component-by-component status

**Viam Agent (viam-server).** Deployed and working. Runs on a Raspberry Pi 5 (Raspberry Pi OS Lite 64-bit, aarch64) as a systemd service. Version 0.116.0. Auto-starts on boot, auto-recovers from power loss. Connected to Viam Cloud at `staubli-pi-main.djgpitarpm.viam.cloud`. Machine shows "Live" in the Viam app. Power cycle test passed: unplugging the Pi and plugging it back in results in full automatic recovery with no manual intervention.

**Vision Health Sensor module.** Deployed and working. Custom Python module at `/opt/viam-modules/vision-health-sensor/`. Registered in Viam app as component "vision-health". Targets 8.8.8.8:53 (Google DNS) as a stand-in for the Apera vision server. Returns `{"connected": true, "process_running": true}` on every poll. Both ICMP ping and TCP port probe run concurrently with timeouts. Data capture configured at 0.2 Hz, readings sync to Viam Cloud via the data_manager service.

**Robot Arm Sensor module.** Scaffold only. Code is complete with Viam registration, configuration handling, and placeholder readings for both Modbus TCP and VAL3 socket protocols. Not deployed to the Pi. Blocked on Staubli CS9 protocol confirmation from the hardware lead.

**PLC / Modbus Sensor module.** Deployed and working against real hardware. Custom Python module at `modules/plc-sensor/` registered as Viam component `plc-monitor`. Connects via Modbus TCP to a **Click PLC C0-10DD2E-D** at `192.168.0.10:502`. The Click PLC runs ladder logic that reads two physical buttons (Fuji AR22F0L servo power button on X1, NC e-stop on X2), implements latching toggle and fault logic, drives two output lamps (Y1 for servo power, Y2 for system-OK), and writes state to DS registers that map to Modbus holding registers. The plc-sensor module reads 25 E-Cat cable registers (0-24) and 18 sensor/state registers (100-117). The PLC is powered by a Rhino PSR-24-480 24 VDC supply and connected to the Pi via a Netgear Ethernet switch. A ZipLink ZL-RTB20-1 breakout board provides clean terminal access to all PLC I/O. The Pi Zero W PLC simulator at `raiv-plc.local` is retained as a development tool but is no longer the primary integration target. The Pi 5 (192.168.0.176, WiFi) runs viam-server with the plc-sensor module connecting to the Click PLC over the local network.

**Wire / Connection monitoring.** Derived from PLC sensor readings. The dashboard Wire/Connection card shows green when the PLC sensor reports `connected: true` and `fault: false`. When the Pi Zero W loses power or network, the Modbus connection fails and the card turns red. Additionally, each of the 25 E-Cat cable signals is individually monitored. If any signal drops from 1 to 0, a specific fault event is logged (e.g., "E-Cat Signal Lost — Servo Power ON (Pin 1)"). Recovery is also logged when signals return to 1. For GPIO-wired signals, physically disconnecting a wire causes the pin's pull-down to register 0, which is immediately visible on the dashboard.

**Viam Data Management Service.** Deployed and working. Configured in the Viam app with capture directory at `/tmp/viam-data`, sync interval of 6 seconds, tagged with "robot-cell-monitor". Historical readings are visible in the Viam app Data tab.

**Viam Triggers.** Not configured. Dashboard handles alerting client-side. Cloud-side triggers for email/Slack are a future item.

**Monitoring Dashboard.** Deployed and working. Next.js application deployed to Vercel. Accessible from any browser with internet access. Connects to viam-server on the Pi 5 via the Viam TypeScript SDK (@viamrobotics/sdk v0.34.0) over WebRTC, negotiated through Viam Cloud. Polls sensor readings every 2 seconds. Three of four cards are green: Vision System (OK), PLC / Controller (OK), Wire / Connection (OK). Robot Arm shows yellow Pending (hardware not available). Two data panels: (1) PLC Sensor Data showing system state, cycle count, temperature, humidity, vibration, pressure, servo positions, button state; (2) E-Cat Signal Status showing all 25 cable signals with green/red dot indicators. E-Cat signal changes are logged in fault history with signal name and pin number (loss in red, recovery in green). Fault detection with audible klaxon, red screen flash, alert banner, and 10-event fault history log. Mock mode available via environment variable for demos without hardware.

### Divergences from the original plan

**Raspberry Pi 5 instead of Pi 4 or NUC.** Section 2 mentioned "Raspberry Pi 4/5, Intel NUC, or similar." The Pi 5 was used because it was available. viam-server runs comfortably on it.

**Component naming.** The Viam module directories use model names like `plc-sensor` and `robot-arm-sensor`, but the Viam component instance names differ: `plc-monitor`, `robot-arm-monitor`, `vision-health`. The dashboard uses the component instance names to query readings. The vision sensor is `vision-health`, the PLC sensor is `plc-monitor`, the robot arm is `robot-arm-sensor` (pending).

**Dashboard hosted on Vercel, not on the Pi.** Section 4 listed "Vercel or local machine" as hosting options. Vercel was chosen because the dashboard should be available even when the Pi is offline. When the Pi loses power, the dashboard still loads and shows the fault state. If the dashboard ran on the Pi, it would go down at exactly the moment you most need it.

**Dashboard reads directly from machine via WebRTC, not from cloud data API.** Section 2 shows the dashboard reading from "Viam API (gRPC/REST)" in the cloud layer. The actual implementation connects the browser directly to viam-server on the Pi via WebRTC, negotiated through Viam Cloud. This has lower latency but means live readings require the machine to be online. The data_manager service separately syncs readings to cloud storage for historical access.

**Privacy architecture is fully enforced.** Section 6 described the privacy constraints. The implementation follows them exactly. The vision-health-sensor returns only `connected` (bool) and `process_running` (bool). No camera, audio, or personnel data is collected or displayable.

### What the pending modules need

The PLC sensor module is deployed and working against a real Click PLC C0-10DD2E-D at 192.168.0.10. The ladder logic writes to the same DS register addresses the Pi Zero W simulator used, so the plc-sensor module required only a host IP change and a fault code rename (`clamp_fail` → `estop_triggered`). The Pi Zero W simulator remains available for development but is no longer the primary target.

The robot arm sensor module code is complete for both protocol options. To activate it: confirm which protocol the CS9 exposes and provide either the Modbus register addresses or confirm that a VAL3 socket server is running.

The wire/connection indicator derives its state from the PLC sensor and is now active — it shows green when the PLC is connected and turns red when the connection drops.
