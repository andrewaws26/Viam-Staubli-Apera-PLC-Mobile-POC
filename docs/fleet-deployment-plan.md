# IronSight Fleet Deployment Plan

## Overview

This document outlines the phased plan for scaling IronSight from the current bench POC to a 36-truck fleet deployment. Each phase has clear success criteria before advancing to the next.

---

## Phase 1: Validate on Bench (Current State)

**Goal:** Prove that offline data capture and sync work reliably before putting hardware in a truck.

### 1.1 Offline Scenario Test

**Test procedure:**
1. Start viam-server on the Pi 5 with all three sensor modules running
2. Confirm data is appearing in the Viam Cloud Data tab (baseline)
3. Disconnect the Pi from the network (unplug Ethernet and/or disable WiFi)
4. Leave the system running for 1+ hours while disconnected
5. Monitor local disk: `watch -n 10 'du -sh /home/pi/.viam/capture/'` — confirm data accumulates
6. Reconnect the Pi to the network
7. Verify in Viam Cloud that all readings from the offline period appear with correct timestamps
8. Confirm no gaps or duplicates in the time-series data

**Success criteria:**
- [ ] Data accumulates locally during offline period (~39 MB/hour at current rates)
- [ ] All data syncs to cloud within 5 minutes of reconnection
- [ ] Timestamps in cloud match when data was actually captured (not when it synced)
- [ ] No duplicate readings in cloud

### 1.2 Measure Actual Data Volume

Compare estimated vs actual:

| Metric | Estimated | Actual (fill in) |
|---|---|---|
| PLC reading size (single) | ~1.0 KB | |
| Daily data (10-hr, all sensors) | ~39 MB | |
| Sync time for 1-hour backlog | ~15 seconds | |

### 1.3 Verify Cloud Data Usability

- [ ] Can filter data by component name in Viam Data tab
- [ ] Can filter data by tags (`robot-cell-monitor`)
- [ ] Can export data as JSON or CSV
- [ ] PLC readings are queryable with meaningful field names (not register numbers)
- [ ] Time-series view shows expected patterns (e.g., temperature drift, vibration changes)

### 1.4 Power Loss Recovery Test

1. While viam-server is running and data is being captured, pull the Pi's power cable
2. Wait 30 seconds, then restore power
3. Confirm viam-server auto-starts (it's a systemd service)
4. Confirm capture resumes without manual intervention
5. Confirm data that was captured before power loss (and synced) is intact in cloud
6. Confirm data captured after power loss has a gap (expected) but resumes cleanly

**Success criteria:**
- [ ] viam-server auto-recovers from unclean shutdown
- [ ] No data corruption on local disk (ext4 journaling protects against this)
- [ ] Capture directory survives reboot (NOT on /tmp)

---

## Phase 2: Single Truck Deployment

**Goal:** Deploy IronSight on one real RAIV truck and validate in field conditions.

### 2.1 Hardware Requirements

| Item | Specification | Qty | Notes |
|---|---|---|---|
| Raspberry Pi 5 | 4 GB or 8 GB, with heatsink/fan | 1 | Already proven on bench |
| SD card | 32 GB, endurance-rated (Samsung PRO Endurance or SanDisk MAX Endurance) | 1 | Endurance-rated critical for continuous writes |
| Power supply | 12V→5V USB-C adapter (automotive-rated, 5V/5A) | 1 | Must handle voltage spikes from truck electrical system |
| Ethernet cable | Cat6, appropriate length | 1 | Pi to PLC connection |
| Enclosure | DIN rail or panel-mount case for Pi | 1 | Protect from dust, vibration |
| Mounting hardware | DIN rail clips or Velcro/zip ties | 1 set | Secure against vibration |

### 2.2 Network Connectivity

> **DECISION REQUIRED:** How does the truck get internet to sync data?

| Option | Pros | Cons | Monthly Cost |
|---|---|---|---|
| **A: Shop WiFi only** | Zero ongoing cost; simple | Data only syncs at end of day when truck returns | $0 |
| **B: Cellular hotspot (MiFi)** | Real-time monitoring in the field | Cellular coverage unreliable at remote rail sites; monthly data plan | $25–50/mo |
| **C: Cellular modem on Pi** | Integrated, no extra device | Same coverage issues; adds hardware complexity | $15–30/mo + modem cost |
| **D: Starlink (truck-mounted)** | Coverage everywhere | Expensive; power draw; physical installation | $120+/mo |

**Recommendation:** Start with **Option A (shop WiFi only)**. The offline-first architecture is designed for exactly this. Data syncs when the truck returns. Add cellular later only if real-time field monitoring becomes a business requirement.

### 2.3 Storage Medium Decision

| Option | Capacity | Endurance | Cost | Notes |
|---|---|---|---|---|
| **SD card (32 GB)** | 28 GB usable | Excellent at this write rate | $10–15 | Default, simplest |
| **SD card (64 GB)** | 58 GB usable | Same | $15–25 | More buffer for extended offline |
| **USB SSD (128 GB)** | 120 GB usable | Superior | $25–40 | Better for high-frequency capture or image data |

**Recommendation:** 32 GB endurance SD card is sufficient for current data rates. If image capture is added later, switch to USB SSD.

### 2.4 Information Needed from Cody

Before deploying on the real truck:

| # | Question | Why It Matters |
|---|---|---|
| 1 | Click PLC IP address on the real truck | `plc-monitor` config needs the correct `host` |
| 2 | Click PLC register map — same as bench unit? | If register addresses differ, `plc_sensor.py` may need updates |
| 3 | Network topology on the truck | Pi needs Ethernet access to PLC; need to understand switch/wiring |
| 4 | 12V power source location for Pi | Need clean, switched 12V near the PLC |
| 5 | Physical mounting location for Pi | Must be accessible but protected from elements |
| 6 | Which truck is the test unit? | Need to coordinate downtime for installation |

### 2.5 Deployment Checklist

- [ ] Flash Pi 5 SD card with Raspberry Pi OS Lite (64-bit)
- [ ] Install viam-server and configure it to connect to Viam Cloud
- [ ] Deploy sensor modules from this repo
- [ ] Apply viam-server.json config (with truck-specific PLC IP)
- [ ] Test locally: verify `plc-monitor` reads from the truck's PLC
- [ ] Mount Pi in enclosure, secure in truck
- [ ] Connect Ethernet to PLC, power to 12V adapter
- [ ] Drive truck to shop WiFi zone, confirm data syncs
- [ ] Drive truck out of WiFi range, confirm data still captures locally
- [ ] Return to WiFi, confirm backlog syncs

---

## Phase 3: Fleet Rollout (36 Trucks)

**Goal:** Deploy IronSight across the entire RAIV fleet with consistent, maintainable configuration.

### 3.1 Viam Fragment Strategy

A **fragment** is a reusable config template that can be applied to multiple machines in Viam.

**Create one fragment containing:**
- All three module definitions (plc-sensor, robot-arm-sensor, vision-health-sensor)
- All three component definitions with default attributes
- Data management service config (capture_dir, sync_interval, base tags)

**On each truck's machine config, override:**
- PLC `host` IP (if different per truck)
- Additional tags: `["truck-01"]`, `["truck-02"]`, etc.
- Any truck-specific attributes

**This means:** To change the capture frequency fleet-wide, update the fragment once. All 36 trucks pick up the change on their next cloud sync (typically within minutes when online).

### 3.2 Machine Naming and Tagging Convention

**Machine names:** `raiv-truck-01` through `raiv-truck-36`

**Tag structure:**

| Tag | Applied Via | Purpose |
|---|---|---|
| `robot-cell-monitor` | Fragment (all trucks) | Filter all IronSight data |
| `raiv-digital-twin` | Fragment (all trucks) | Future digital twin integration |
| `truck-NN` | Per-machine override | Identify individual truck |
| `region-<name>` | Per-machine override | Group by geographic region |
| `fleet-raiv` | Fragment (all trucks) | Distinguish from other Viam projects |

**Querying examples:**
- All data from truck 07: filter by tag `truck-07`
- All PLC faults fleet-wide: filter by component `plc-monitor`, field `fault: true`
- All data from midwest trucks: filter by tag `region-midwest`

### 3.3 OTA Update Workflow

1. **Config changes (capture frequency, tags, etc.):** Update the Viam fragment in the app. Trucks pick up changes automatically within minutes of connecting to the internet. No SSH required.

2. **Module code changes (new sensor fields, bug fixes):**
   - Update the module code in this repo
   - Build and upload to Viam Registry as a versioned module
   - Update the fragment to reference the new module version
   - Trucks download the new module on their next sync

3. **OS-level changes (system packages, Pi firmware):**
   - Requires SSH access or a fleet management tool (e.g., Balena, custom Ansible playbooks)
   - Consider an OTA mechanism for Phase 3+ if OS updates become frequent

### 3.4 Monitoring and Alerting

**How to know if a Pi is offline vs just in the field:**

| Scenario | Machine Status in Viam | Last Data Timestamp | Action |
|---|---|---|---|
| Truck in field, working normally | Offline | Today (from before departure) | Normal — data will sync when truck returns |
| Truck at shop, Pi working | Live | Current (within seconds) | Normal |
| Truck at shop, Pi has issue | Offline | Stale (hours/days old) | Investigate: check power, WiFi, viam-server |
| Truck returned, data not syncing | Live | Stale (from field, not updating) | Restart viam-server, check capture dir |

**Recommended alerts (via Viam Triggers, future implementation):**
- Machine offline for >24 hours when expected to be at shop → email ops team
- `system_state: fault` or `system_state: e-stopped` → email ops team immediately
- Disk usage >80% on any Pi → email engineering team
- No data from a truck for >48 hours → flag for physical inspection

### 3.5 Fleet-Scale Cost Estimate

**Hardware (one-time):**

| Item | Per Truck | 36 Trucks |
|---|---|---|
| Raspberry Pi 5 (4 GB) | $60 | $2,160 |
| Endurance SD card (32 GB) | $12 | $432 |
| Automotive power supply | $20 | $720 |
| Enclosure + mounting | $15 | $540 |
| Ethernet cable | $5 | $180 |
| **Total hardware** | **$112** | **$4,032** |

**Monthly operating costs (36 trucks):**

| Item | Monthly Cost |
|---|---|
| Viam Cloud upload (30.9 GB × $0.15/GB) | $4.64 |
| Viam Cloud storage (with 90-day retention: ~93 GB × $0.50/GB) | $46.50 |
| Cellular connectivity (if Option B, per truck) | $0–$50/truck |
| **Total (WiFi-only sync)** | **~$51/month** |
| **Total (with cellular on all trucks)** | **~$951–$1,851/month** |

**Recommendation:** WiFi-only sync keeps operating costs under $60/month for the entire fleet. Add cellular selectively only to trucks where real-time monitoring has clear value.

### 3.6 Rollout Schedule

| Week | Activity | Trucks |
|---|---|---|
| 1–2 | Complete Phase 1 bench validation | 0 (bench only) |
| 3–4 | Phase 2 single truck deployment and field test | 1 |
| 5–6 | Validate single truck data, address issues | 1 |
| 7–8 | Create Viam fragment, prepare hardware for batch | 1 |
| 9–12 | Deploy in batches of 6–8 trucks per week | 7–36 |
| 13+ | Full fleet operational, ongoing monitoring | 36 |

**Critical path items:**
- PLC register map confirmation from Cody (blocks Phase 2)
- Network connectivity decision (blocks per-truck config)
- Pi 5 procurement (lead time may apply for 36 units)
- Enclosure design and mounting solution
- Shop WiFi coverage validation (can all truck parking spots reach WiFi?)

---

## Appendix: Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Truck loses power unexpectedly | High | Data loss (old config: HIGH; new config: LOW) | Persistent capture_dir on SD card — data survives power loss |
| SD card failure | Low | Truck stops capturing until replaced | Use endurance-rated cards; keep spares at shop; monitor via alerts |
| PLC IP differs per truck | Medium | plc-monitor can't connect | Per-truck config override in Viam fragment |
| Shop WiFi doesn't reach all parking spots | Medium | Some trucks can't sync | Survey WiFi coverage; add access points if needed |
| Cellular coverage at remote sites | High | Can't do real-time monitoring in field | Design is offline-first; cellular is nice-to-have, not required |
| Pi overheats in truck cab | Medium | viam-server crashes, data gap | Use Pi 5 with active cooling; mount in ventilated enclosure |
| Viam Cloud outage | Low | Can't view data, but capture continues locally | Data buffers locally; syncs when cloud returns |
