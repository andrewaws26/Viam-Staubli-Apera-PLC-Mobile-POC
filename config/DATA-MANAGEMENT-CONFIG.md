# Data Management Configuration Reference

This file documents the settings in `viam-server.json` and why each value was chosen.

## Service: `data-manager`

| Setting | Value | Rationale |
|---|---|---|
| `capture_dir` | `/home/pi/.viam/capture` | **Must be persistent storage.** Previously `/tmp/viam-data`, which is volatile — cleared on reboot. If a truck loses power in the field (common on remote railroad sites), all unbuffered data is lost. `/home/pi/.viam/capture` survives reboots and power loss because it's on the SD card's ext4 filesystem. |
| `sync_interval_mins` | `0.1` (6 seconds) | Aggressive sync minimizes the window of data loss if the truck loses connectivity. When offline, data accumulates locally and syncs as soon as connectivity returns. The 6-second interval means at most 6 seconds of data is "in flight" at any moment when online. |
| `tags` | `["robot-cell-monitor", "raiv-digital-twin"]` | Applied globally to all captured data for filtering in Viam Cloud. These are **template tags** — they apply to every truck. Per-truck identification (e.g., `truck-07`, `region-midwest`) should be added via each truck's individual machine config or Viam fragment overrides, not in this template. |

## Component Capture Rates

| Component | Frequency | Why |
|---|---|---|
| `plc-monitor` | 1 Hz | PLC state changes (button presses, faults, E-Cat signals) need near-real-time capture. 1 Hz balances responsiveness with storage cost. |
| `robot-arm-monitor` | 0.2 Hz (every 5s) | Arm status (mode, fault state) changes infrequently. 5-second polling is sufficient for monitoring. |
| `vision-health-monitor` | 0.2 Hz (every 5s) | Health checks (ping + TCP probe) are coarse signals. More frequent polling adds no value. |

## Storage Considerations

- **SD card write endurance:** At current rates, the PLC sensor writes ~36 MB/day during a 10-hour shift. Modern SD cards (Samsung EVO, SanDisk Extreme) are rated for tens of TB of writes. This workload is well within safe limits.
- **Disk space:** If offline for a full 10-hour shift, ~39 MB accumulates locally. A 32 GB SD card has ample room. Viam auto-deletes captured data at 90% disk usage.
- **For extended offline or higher capture rates:** Consider a USB drive mounted at `/mnt/viam-data` to avoid SD card wear and increase buffer capacity.

## Fleet Tagging Strategy (36 Trucks)

This template config uses generic tags. When deploying to the fleet:

1. Use a **Viam fragment** containing this template config
2. On each truck's machine config, add truck-specific tags: `["truck-07", "region-midwest"]`
3. Query cloud data by combining template tags + truck tags for flexible filtering
