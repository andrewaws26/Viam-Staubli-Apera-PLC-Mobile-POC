# IronSight Data Management Guide

## Overview

Each RAIV truck carries a Raspberry Pi 5 running viam-server. Three sensor modules capture hardware state from the PLC, robot arm controller, and vision system. Viam's Data Management service writes these readings to local disk and syncs them to Viam Cloud when the truck has internet connectivity.

This document covers how data flows from PLC registers to the cloud, how to operate the system, and the storage/cost implications at fleet scale.

---

## 1. How Data Flows

```
PLC Registers          Robot Arm Controller       Vision Server
(Click C0-10DD2E-D)    (Stäubli CS9)              (Apera AI)
   │ Modbus TCP            │ Modbus/TCP Socket        │ Ping + TCP probe
   │ 192.168.0.10:502      │ raiv-cs9.local:502       │ health check
   ▼                       ▼                          ▼
┌────────────────────────────────────────────────────────────┐
│                    viam-server (Pi 5)                       │
│                                                            │
│  plc-monitor          robot-arm-monitor    vision-health   │
│  get_readings()       get_readings()       get_readings()  │
│  46 fields @ 1 Hz     4 fields @ 0.2 Hz   2 fields @ 0.2 Hz│
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           Data Management Service                     │  │
│  │  • Calls get_readings() at configured frequency       │  │
│  │  • Writes protobuf-encoded .capture files to disk     │  │
│  │  • Syncs to cloud every 6 seconds (when online)       │  │
│  │  • Buffers locally when offline                       │  │
│  └──────────────┬───────────────────────────────────────┘  │
│                 │                                           │
│     /home/pi/.viam/capture/                                │
│     └── <component-name>/                                  │
│         └── <method>/                                      │
│             └── <timestamp>.capture                        │
└─────────────────┼──────────────────────────────────────────┘
                  │ HTTPS (outbound only)
                  │ syncs when connectivity available
                  ▼
┌────────────────────────────────────────────────────────────┐
│                     Viam Cloud                              │
│  • Stores all readings as queryable time-series data       │
│  • Accessible via Data tab, API, or MQL                    │
│  • Tagged with: robot-cell-monitor, raiv-digital-twin      │
│  • Retained until manually deleted or retention policy set  │
└────────────────────────────────────────────────────────────┘
```

### What Each Sensor Captures

**PLC Monitor** (`plc-monitor`) — 46 fields per reading at 1 Hz:
- `connected` (bool), `fault` (bool), `button_state` (string)
- 25 E-Cat cable signals: `servo_power_on`, `servo_disable`, `plate_cycle`, `abort_stow`, `speed`, `gripper_lock`, `clear_position`, `belt_forward`, `belt_reverse`, 9 lamp status signals, `emag_status`, `emag_on`, `emag_part_detect`, `emag_malfunction`, `poe_status`, `estop_enable`, `estop_off`
- 6 motion/vibration readings: `vibration_x/y/z`, `gyro_x/y/z`
- Environmental: `temperature_f`, `humidity_pct`, `pressure_simulated`
- Servo: `servo1_position`, `servo2_position`
- State: `cycle_count`, `system_state`, `last_fault`
- Analytics: `servo_power_press_count`, `estop_activation_count`, `current_uptime_seconds`, `last_estop_duration_seconds`

**Robot Arm Monitor** (`robot-arm-monitor`) — 4 fields per reading at 0.2 Hz:
- `connected` (bool), `mode` (string), `fault` (bool), `fault_code` (int)

**Vision Health Monitor** (`vision-health-monitor`) — 2 fields per reading at 0.2 Hz:
- `connected` (bool), `process_running` (bool)

### What the Data Looks Like on Disk

Viam writes captured readings as binary protobuf files in a structured directory:

```
/home/pi/.viam/capture/
├── plc-monitor/
│   └── Readings/
│       ├── 2026-03-18T08-00-00Z.capture
│       ├── 2026-03-18T08-00-01Z.capture
│       └── ...
├── robot-arm-monitor/
│   └── Readings/
│       └── ...
└── vision-health-monitor/
    └── Readings/
        └── ...
```

Each `.capture` file contains one or more protobuf-encoded `SensorData` messages with:
- Timestamp (nanosecond precision)
- Component name and method
- The readings map (key-value pairs)
- Machine ID and part metadata

Files are written incrementally and rotated periodically. After successful sync to cloud, local files are deleted to free disk space.

---

## 2. Offline Behavior and Sync

### The Offline-First Design

RAIV trucks operate on remote railroad job sites for 5–10+ hours with no internet. The data management system is designed around this reality:

1. **Capture never stops.** Whether online or offline, viam-server writes readings to `/home/pi/.viam/capture/` at the configured frequency. The capture process has no dependency on connectivity.

2. **Sync is opportunistic.** Every 6 seconds (`sync_interval_mins: 0.1`), viam-server checks if it can reach Viam Cloud. If yes, it uploads any pending `.capture` files. If no, it moves on and tries again in 6 seconds.

3. **Data accumulates safely.** During a 10-hour offline shift, approximately 39 MB of data accumulates on disk. A 32 GB SD card can buffer weeks of data if needed.

4. **Sync resumes automatically.** When the truck returns to the shop and connects to WiFi, viam-server detects connectivity and begins uploading the full backlog. No manual intervention required.

### How Sync Works in Detail

When viam-server syncs captured data to the cloud:

1. It scans the capture directory for files not modified in the last 10 seconds (prevents syncing files still being written)
2. Files are uploaded via encrypted gRPC to Viam Cloud
3. Successfully synced files are deleted from local disk
4. If upload fails mid-file, that file is retried from the **beginning of the file** on the next sync cycle
5. On repeated failures, viam-server uses **exponential backoff**, increasing the retry interval up to a maximum of **1 hour**, then retries every hour
6. When connectivity returns, the backoff resets and sync resumes at the normal 6-second interval

**Deduplication:** Sync continues where it left off without duplicating data. If interruption happens mid-file, that file restarts from the beginning, but already-synced files are not re-uploaded.

### Why capture_dir Must Be Persistent Storage

**Critical:** The capture directory MUST be on persistent storage that survives power loss and reboots.

The original config used `/tmp/viam-data`. On Linux, `/tmp` is a tmpfs (RAM-backed filesystem) that is cleared on every reboot. If a truck loses power — which **will** happen on remote job sites — all buffered data that hasn't synced to the cloud is permanently lost.

The current config uses `/home/pi/.viam/capture`, which is on the SD card's ext4 filesystem. This survives power loss, reboots, and even unclean shutdowns (ext4 has journaling).

### Disk Usage and Auto-Deletion

Viam monitors disk usage and automatically deletes captured files when **all three** of these conditions are true:

1. Data capture is enabled on the data manager service
2. Local disk usage is **>= 90%**
3. The Viam capture directory is **at least 50%** of total disk usage

When triggered, it deletes every Nth captured file (controlled by `delete_every_nth_when_disk_full`, default `5`). If disk usage is >= 90% but the capture directory is less than 50% of usage, viam-server logs a warning but does **not** delete files (the disk pressure is from something else).

**Mitigations:**
- A 32 GB SD card provides ~28 GB usable space. At 39 MB/day, you'd need 700+ offline days to hit 90%.
- For extra safety or higher capture rates, mount a USB drive and set `capture_dir` to the USB path (e.g., `/mnt/usb-viam-data`).
- Monitor disk usage via SSH: `df -h /home/pi/.viam/capture`

---

## 3. Storage and Cost Estimates

### Per-Reading Size Estimates

| Component | Fields | Estimated Size (protobuf + metadata) |
|---|---|---|
| `plc-monitor` | 46 | ~1.0 KB per reading |
| `robot-arm-monitor` | 4 | ~0.2 KB per reading |
| `vision-health-monitor` | 2 | ~0.18 KB per reading |

### Daily Volume Per Truck (10-hour workday)

| Component | Frequency | Readings/Day | Size/Day |
|---|---|---|---|
| `plc-monitor` | 1 Hz | 36,000 | **36.0 MB** |
| `robot-arm-monitor` | 0.2 Hz | 7,200 | **1.4 MB** |
| `vision-health-monitor` | 0.2 Hz | 7,200 | **1.3 MB** |
| **Total per truck** | | **50,400** | **~38.7 MB** |

### Scaling to Fleet

| Time Period | Per Truck | 36-Truck Fleet |
|---|---|---|
| Daily (10-hr shift) | 39 MB | 1.4 GB |
| Weekly (5 days) | 195 MB | 7.0 GB |
| Monthly (22 days) | 858 MB | 30.9 GB |
| Yearly | 10.3 GB | 370.8 GB |

### Viam Cloud Cost Estimate

Pricing: **$0.50/GB/month** storage + **$0.15/GB** upload (one-time on ingest).

| | Monthly Upload | Cumulative Storage (Month 1) | Cumulative Storage (Month 12) |
|---|---|---|---|
| **Per truck** | $0.13 upload + $0.43 storage = **$0.56** | 0.86 GB | 10.3 GB |
| **36 trucks** | $4.64 upload + $15.45 storage = **$20.09** | 30.9 GB | 370.8 GB |

**Cost growth over time** (36 trucks, no data deletion):

| Month | Cumulative Cloud Storage | Monthly Storage Cost | Monthly Upload Cost | Total Monthly Cost |
|---|---|---|---|---|
| 1 | 30.9 GB | $15.45 | $4.64 | **$20.09** |
| 6 | 185.4 GB | $92.70 | $4.64 | **$97.34** |
| 12 | 370.8 GB | $185.40 | $4.64 | **$190.04** |

**Recommendation:** Set a cloud data retention policy (e.g., 90 days) to cap storage costs. At 90 days, storage would plateau at ~93 GB fleet-wide = ~$46.50/month storage + $4.64 upload = **~$51/month total**.

### SD Card Lifespan

Modern industrial SD cards (Samsung PRO Endurance, SanDisk MAX Endurance) are rated for continuous write workloads:

- **Daily writes per truck:** ~39 MB captured + ~39 MB deleted after sync ≈ 78 MB/day total writes
- **Samsung PRO Endurance 32 GB:** Rated for 17,520 hours of continuous 26 Mbps write ≈ 205 TB total writes
- **At 78 MB/day:** 205 TB ÷ 78 MB = **7.2 million days** (~19,700 years)

SD card write endurance is not a concern at this data rate. The SD card will fail from age or physical damage long before write exhaustion.

**If capture rates increase significantly** (e.g., adding camera image capture at multiple Hz), consider moving to a USB SSD for both endurance and capacity.

---

## 4. Querying Data in Viam Cloud

### Via the Viam App Dashboard

1. Log in to [app.viam.com](https://app.viam.com)
2. Navigate to your organization → **Data** tab
3. Filter by:
   - **Tags:** `robot-cell-monitor` or `raiv-digital-twin`
   - **Component:** `plc-monitor`, `robot-arm-monitor`, or `vision-health-monitor`
   - **Time range:** Select the period of interest
4. View individual readings or export as JSON/CSV

### Via the Viam CLI

```bash
# List recent data for a specific machine
viam data list --org-id <ORG_ID> --location-id <LOC_ID> --component-name plc-monitor

# Export data as JSON
viam data export --org-id <ORG_ID> --component-name plc-monitor \
  --start 2026-03-18T00:00:00Z --end 2026-03-18T23:59:59Z \
  --output plc-data-march-18.json
```

### Via the Viam Python SDK

```python
from viam.app.data_client import DataClient

# Query PLC readings for a specific truck
data = await data_client.tabular_data_by_filter(
    component_name="plc-monitor",
    tags=["truck-07"],
    start=start_time,
    end=end_time,
)
```

---

## 5. Changing Capture Configuration

### Adjust Capture Frequency

In `viam-server.json` (or via the Viam app), modify `capture_frequency_hz` on the component's `service_configs`:

```json
{
  "type": "data_manager",
  "attributes": {
    "capture_methods": [
      {
        "method": "Readings",
        "capture_frequency_hz": 2,
        "additional_params": {}
      }
    ]
  }
}
```

**Trade-off:** Higher frequency = more data = higher cloud costs, but finer-grained monitoring. For the PLC, 1 Hz is a good balance. For detecting fast transient faults, consider 5–10 Hz temporarily.

### Add a New Data Source

1. Build a new Viam sensor module (see existing modules in `modules/` for patterns)
2. Add it to the `modules` and `components` sections of `viam-server.json`
3. Add a `service_configs` block referencing `data_manager` with the desired capture frequency
4. Restart viam-server: `sudo systemctl restart viam-server`

### Disable Capture for a Component

Set `capture_frequency_hz` to `0` or remove the `service_configs` block entirely.

### Change Sync Interval

Modify `sync_interval_mins` in the `data-manager` service config. The current 0.1 (6 seconds) is aggressive but appropriate for minimizing data loss risk.

---

## 6. Viam Fragments for Fleet Deployment

A **fragment** is a reusable configuration block that can be applied to multiple machines. For 36 trucks running identical sensor configurations:

1. **Create a fragment** in the Viam app containing the full `viam-server.json` config (modules, components, services, data management)
2. **Apply the fragment** to each truck's machine
3. **Override per-truck settings** (e.g., truck-specific tags, different PLC IP addresses) in each machine's individual config — these override fragment values

### Benefits
- **Single source of truth:** Change the capture frequency in the fragment, and all 36 trucks update on their next sync
- **Consistent configuration:** No risk of one truck having different settings
- **OTA updates:** Fragment changes propagate automatically; no SSH into individual Pis

### Per-Truck Customization via Fragment Overrides
- `tags`: Add truck-specific identifiers (e.g., `["truck-07", "region-midwest"]`)
- `host` attributes: If PLCs have different IPs per truck
- Any attribute that differs per truck

---

## 7. Operations Guide

*This section is written for Corey and the field team. It uses plain language and assumes no programming experience.*

### How to Check if a Truck's Pi is Capturing Data

**From the Viam dashboard (easiest):**
1. Go to [app.viam.com](https://app.viam.com) and find the truck's machine
2. If the machine shows **"Live"** (green dot), the Pi is online and capturing
3. Click the **Data** tab and look for recent readings — you should see timestamps within the last few seconds if the truck is online

**From the truck (via SSH):**
```bash
# Connect to the Pi (you need to be on the same network)
ssh pi@<truck-pi-ip>

# Check if viam-server is running
sudo systemctl status viam-server

# Check how much captured data is waiting to sync
du -sh /home/pi/.viam/capture/

# List recent capture files
ls -lt /home/pi/.viam/capture/plc-monitor/Readings/ | head -10
```

### How to Verify Data Synced After a Truck Returns

1. Connect the truck to shop WiFi
2. Wait 1–2 minutes for the Pi to connect and begin syncing
3. In the Viam dashboard, check the truck's machine — it should show "Live"
4. Go to **Data** tab, filter by the truck's name, and look for readings from the time the truck was in the field
5. If you see data with timestamps from the field shift, sync is working

**How long does sync take?** At 39 MB for a 10-hour shift, sync takes about 1–3 minutes on typical WiFi. You'll see the data appear in the cloud dashboard progressively.

### How to Check Disk Usage on the Pi

```bash
ssh pi@<truck-pi-ip>
df -h /home/pi
```

You'll see something like:
```
Filesystem      Size  Used Avail Use%  Mounted on
/dev/mmcblk0p2   29G  4.2G   24G  15%  /
```

If `Use%` is above 80%, investigate. Above 90%, Viam may start deleting un-synced data.

### How to Restart viam-server

```bash
ssh pi@<truck-pi-ip>
sudo systemctl restart viam-server
```

Wait 30 seconds, then check:
```bash
sudo systemctl status viam-server
```

It should show `active (running)`. The machine should reappear as "Live" in the Viam dashboard within a minute.

### What to Do if the Dashboard Shows Stale Data

**If a truck shows "Offline" in the dashboard:**
- The truck may simply be in the field with no internet — this is normal
- When the truck returns and connects to WiFi, it will automatically come back online
- If the truck is at the shop and still shows offline, check: Is the Pi powered on? Is it connected to WiFi? Try restarting viam-server (see above)

**If a truck is "Live" but data timestamps are old:**
- Restart viam-server: `sudo systemctl restart viam-server`
- Check if the PLC is powered on and connected to the Pi's network
- Check the PLC's Ethernet cable connection

---

## 8. Quick Reference Card (for Truck Cab)

```
╔═══════════════════════════════════════════════════════════╗
║              IRONSIGHT — TRUCK DATA SYSTEM                ║
║                    Quick Reference                        ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  THE BLACK BOX (Raspberry Pi) UNDER THE DASH:             ║
║  • Solid RED light = powered on (normal)                  ║
║  • No lights = no power — check 12V adapter               ║
║                                                           ║
║  NORMAL OPERATION:                                        ║
║  • Do nothing. The system runs automatically.             ║
║  • It records data all day, even without internet.        ║
║  • When you return to the shop and connect to WiFi,       ║
║    data uploads automatically.                            ║
║                                                           ║
║  IF SOMETHING SEEMS WRONG:                                ║
║  1. Check that the Pi has power (red light on)            ║
║  2. Check that the Ethernet cable to the PLC is           ║
║     plugged in at both ends                               ║
║  3. If still having issues, call the shop and ask         ║
║     them to check the dashboard                           ║
║                                                           ║
║  DO NOT:                                                  ║
║  • Unplug the Pi while the truck is running               ║
║  • Disconnect the Ethernet cable during operation         ║
║  • Plug anything else into the Pi's USB ports             ║
║                                                           ║
║  CONTACT: [Shop phone number]                             ║
║  DASHBOARD: app.viam.com (ask Andrew for login)           ║
╚═══════════════════════════════════════════════════════════╝
```

*Print this card, laminate it, and mount it near the Pi in each truck cab.*
