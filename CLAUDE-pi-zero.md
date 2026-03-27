# IronSight — Pi Zero 2 W "truck-diagnostics" Node

**Role:** J1939 CAN bus truck OBD-II diagnostics sensor

**Tailscale IP:** 100.113.196.68
**Local mDNS:** truck-diagnostics.local (on Verizon_X6JPH6 WiFi)
**Hostname:** truck-diagnostics
**SSH:** andrew@100.113.196.68 (password: 1111)
**OS:** Raspberry Pi OS Lite 64-bit (aarch64, Bookworm)

## Hardware

| Component | Details |
|-----------|---------|
| Board | Raspberry Pi Zero 2 W, **512MB RAM**, 64GB SD card |
| CAN HAT | Waveshare Isolated RS485 CAN HAT (B) — SPI interface |
| CAN crystal | **12MHz** oscillator (NOT 8MHz like the basic version) |
| CAN interrupt | GPIO25 |
| CAN overlay | `mcp2515-can0,oscillator=12000000,interrupt=25,spimaxfrequency=2000000` |
| WiFi | Verizon_X6JPH6, PAU0F firmware installed |

### CAN HAT Configuration (in /boot/firmware/config.txt)

```
dtparam=spi=on
dtoverlay=mcp2515-can0,oscillator=12000000,interrupt=25,spimaxfrequency=2000000
```

## Running Services

| Service | Description |
|---------|-------------|
| viam-server | Viam agent + j1939-truck-sensor module |
| can0 | CAN interface at 500kbps (systemd oneshot, starts on boot) |
| tailscaled | Tailscale VPN |

### can0 Service

```bash
# Brings up CAN bus on boot
ip link set can0 up type can bitrate 500000
ifconfig can0 txqueuelen 65536
```

500kbps is the standard bitrate for 2013+ Mack/Volvo truck J1939 OBD-II.

## Viam Module: j1939-truck-sensor

- **Path:** `/home/andrew/j1939-truck-sensor/`
- **Model:** `ironsight:j1939-truck-sensor:can-sensor`
- **Component name:** `truck-engine` (sensor type)
- **Protocol:** J1939 over SPI via mcp2515 → CAN bus at 500kbps
- **Capabilities:**
  - Decodes **15 J1939 PGNs** with **30+ parameters**
  - Supports **DTC clearing** via DM11 (through Viam `do_command`)

### J1939 Parameters (typical)

The sensor decodes standard J1939 PGNs from the truck's ECM including:
- Engine RPM, speed, load, torque
- Coolant temperature, oil pressure, oil temperature
- Fuel rate, fuel level, fuel temperature
- Intake manifold temperature and pressure
- Battery voltage
- Transmission gear, output shaft speed
- Active and previously active DTCs (diagnostic trouble codes)

## Viam Cloud

- **Machine name:** truck-diagnostic
- **Part ID:** ca039781-665c-47e3-9bc5-35f603f3baf1
- **Org:** 6be89252-bac4-4510-896f-f153fff17368
- **Location:** djgpitarpm (same location as Pi 5)

## Installed Tools

Claude Code (DO NOT RUN — see constraints), Node.js 20, Tailscale, can-utils, python-can, j1939, htop, tmux, i2c-tools, overlayroot

## Constraints

### CRITICAL: 512MB RAM Limit

This Pi has only **512MB RAM**. This is the single most important constraint:

1. **NEVER run Claude Code CLI on this Pi.** Node.js + Claude Code requires >1GB RAM. Running `claude -p` caused OOM kill and the Pi dropped offline. Always run Claude from the Mac or Pi 5 and SSH into this Pi for commands.
2. **Keep Python processes lean.** The j1939-truck-sensor module + viam-server must fit in ~400MB (after OS overhead).
3. **No heavy package installs** without checking available memory first (`free -m`).
4. **overlayroot may be enabled** — if the filesystem is read-only, changes won't persist across reboots. Check with `mount | grep overlay`.

### Other Constraints

5. **CAN bus is physical** — the sensor only works when the OBD-II cable is plugged into the truck's diagnostic port.
6. **12MHz crystal** — if the CAN overlay is misconfigured with 8MHz, the bus will not sync and you'll get zero frames.
7. **WiFi only** — no ethernet. If WiFi drops, data buffers locally until reconnection.
8. **GPIO25 is reserved** for CAN interrupt — do not use for other purposes.
9. **SPI must remain enabled** — disabling SPI breaks the CAN HAT.

## Debugging CAN Bus

```bash
# Check if CAN interface is up
ip link show can0

# Watch raw CAN frames (should see data if truck is running)
candump can0

# Check for bus errors
ip -details -statistics link show can0

# Restart CAN interface
sudo ip link set can0 down
sudo ip link set can0 up type can bitrate 500000

# Restart Viam server (after code changes)
sudo systemctl restart viam-server
```

## Data Flow

```
Truck ECM (J1939 CAN bus at 500kbps)
  -> OBD-II diagnostic port
  -> Waveshare CAN HAT (B) [SPI, mcp2515, GPIO25 interrupt]
  -> can0 interface on Pi Zero
  -> j1939-truck-sensor Viam module (decodes PGNs)
  -> viam-server data capture
  -> Viam Cloud (syncs when WiFi available)
  -> Dashboard on Vercel (reads via WebRTC)
```

## Relationship to Other Nodes

- **Mac orchestrator** — manages this Pi via SSH over Tailscale. All code editing happens on Mac, deployed via SSH.
- **Pi 5** — sibling node on the same truck. Pi 5 handles TPS/PLC monitoring. Both report to the same Viam Cloud location.
- **Viam Cloud** — this Pi's data merges with Pi 5 data for a unified truck view on the dashboard.
- **Dashboard** — truck engine data appears alongside TPS data. Uses `NEXT_PUBLIC_TRUCK_VIAM_*` env vars on Vercel.

## After Editing Code

```bash
# All code editing should happen on the Mac, then deploy via:
scp -r /path/to/changes andrew@100.113.196.68:/home/andrew/j1939-truck-sensor/

# On the Pi Zero (via SSH from Mac):
sudo systemctl restart viam-server

# Check status:
systemctl status viam-server can0
journalctl -u viam-server --no-pager -n 50
```
