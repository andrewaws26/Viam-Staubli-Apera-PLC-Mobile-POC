# IronSight — Pi 5 "viam-pi" Node

**Role:** TPS (Tie Plate System) monitoring hub, cellular gateway, dashboard data source, AI assistant

**Tailscale IP:** 100.112.68.52
**Hostname:** viam-pi
**SSH:** andrew@100.112.68.52 (password: 1111)
**OS:** Raspberry Pi OS Lite 64-bit (aarch64)

## Hardware

| Component | Details |
|-----------|---------|
| Board | Raspberry Pi 5 Model B Rev 1.1, 8GB RAM, 235GB SD card |
| UPS | PiSugar battery (I2C, RTC, uninterruptible power) |
| Display | SunFounder ili9486 SPI touchscreen, 480x320, /dev/fb0 |
| Audio | USB audio codec (Texas Instruments PCM2902) |
| PLC link | Ethernet to Click PLC at 169.168.10.21 (secondary IP 169.168.10.100/24 on eth0) |
| WiFi | wlan0 — BB-Shop (pri:30), Verizon_X6JPH6 (pri:20), Andrew-Hotspot (pri:40) |

## Running Services

| Service | Description | Port |
|---------|-------------|------|
| viam-server | Viam agent + plc-sensor module | 8080 (gRPC), 8421-8423 |
| ironsight-server | Upload & analysis HTTP server | 8420 |
| ironsight-touch | Touch display UI (requires /dev/fb0 ili9486) | — |
| ironsight-discovery-daemon | Network device scanner | — |
| ollama | Local LLM server | 11434 (localhost only) |
| pisugar-server | Battery/UPS management | — |
| tailscaled | Tailscale VPN | 53238 |
| plc-subnet | Adds 169.168.10.100/24 on eth0 for PLC access | — |
| network-resilience | WiFi health check / auto-recovery | — |
| viam-health | Viam server health check | — |
| ironsight-dashboard | Web dashboard (DISABLED — Vercel serves it now) | 3000 |

## Viam Module: plc-sensor

- **Path:** `/home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC/modules/plc-sensor/`
- **Model:** `viam-staubli-apera-poc:monitor:plc-sensor`
- **Component name:** `plc-monitor` (sensor type)
- **Protocol:** Modbus TCP to Click PLC at 169.168.10.21:502
- **Poll rate:** 1 Hz
- **Data sync:** Every 6 seconds to Viam Cloud
- **Offline buffer:** `~/.viam/offline-buffer/` (50MB cap)

### Key files on this Pi

```
modules/plc-sensor/src/plc_sensor.py     # Core sensor — THE critical file
modules/plc-sensor/src/diagnostics.py    # 19-rule diagnostic engine
scripts/ironsight-server.py              # Upload & analysis server (port 8420)
scripts/ironsight-touch.py               # SPI touchscreen UI
scripts/ironsight-discovery-daemon.py    # Network scanner
scripts/incidents/                       # Auto-generated incident reports
```

### PLC data returned by plc-sensor

The sensor reads the Click PLC Modbus register map and returns:
- 25-pin E-Cat cable signals (registers 0-24)
- Sensor data: vibration, temperature, humidity, pressure, servo positions, cycle count
- Decoded system state and fault codes
- DS10 countdown for distance (NEVER DD1)

## Network Configuration

- **eth0:** Static secondary IP 169.168.10.100/24 for PLC subnet (via plc-subnet service)
- **wlan0:** WiFi with priority-based network selection
- **Tailscale:** VPN mesh — reachable from Mac at 100.112.68.52

The Pi serves as the cellular gateway for the truck fleet unit — it bridges the local PLC network to Viam Cloud over WiFi/cellular.

## Viam Cloud

- **Machine address:** staubli-pi-main.djgpitarpm.viam.cloud
- **Machine key ID:** 506f842a-16cb-437c-9799-c4463b46c8b1
- **Org:** 6be89252-bac4-4510-896f-f153fff17368
- **Location:** djgpitarpm
- **Data capture:** Configured in Viam app, readings sync every 6s
- **Capture directory:** /tmp/viam-data

## Installed Tools

Claude Code, Node.js, Ollama (no models loaded), Tailscale, can-utils, htop, tmux, i2c-tools

## After Editing Code

```bash
# After changing plc_sensor.py or diagnostics.py:
sudo systemctl restart viam-server

# After changing ironsight-server.py:
sudo systemctl restart ironsight-server

# After changing ironsight-touch.py:
sudo systemctl restart ironsight-touch

# Check service status:
systemctl status viam-server ironsight-server ironsight-touch ironsight-discovery-daemon
```

## Constraints

1. **PLC is on a private subnet** (169.168.10.x) — only reachable via eth0 with the secondary IP.
2. **Touch display requires ili9486 SPI** — won't work without the physical screen attached to /dev/fb0.
3. **PiSugar provides UPS** — if main power drops, Pi stays up on battery. Monitor via pisugar-server.
4. **Offline buffer is capped at 50MB** — if WiFi is down too long, oldest data is dropped.
5. **Never use DD1 for distance** — always DS10 countdown.
6. **No E-Cat, servo, robot, or vision code** in TPS/truck monitoring paths.

## Autonomous Systems on This Pi

- **Watchdog cron:** Runs every 5 minutes, calls Claude headless to diagnose and fix issues
- **Discovery daemon:** Continuously scans for unknown PLCs (Modbus, MC Protocol, EtherNet/IP)
- **Incident reports:** Auto-generated in `scripts/incidents/` when faults are detected

## Relationship to Other Nodes

- **Mac orchestrator** — manages this Pi via SSH over Tailscale, pushes code changes
- **Pi Zero** — sibling node on the same truck, handles J1939 CAN bus diagnostics
- **Viam Cloud** — both this Pi and the Pi Zero report data; dashboard reads from cloud
- **Vercel dashboard** — reads from Viam Cloud via WebRTC, displays data from both Pis
