# Pi 5 Troubleshooting Guide

Quick-reference for when you SSH into the Pi 5 and need Claude CLI to help diagnose.

## SSH Access

```bash
ssh andrew@100.112.68.52          # Tailscale IP (works from any network)
ssh andrew@viam-pi.local          # mDNS (same LAN only)
cd ~/Viam-Staubli-Apera-PLC-Mobile-POC
claude                            # Start Claude CLI — reads CLAUDE.md for full context
```

## Quick Health Check

```bash
# One-liner: are all services running?
systemctl is-active viam-server can0 plc-subnet ironsight-server

# Full fleet health (JSON output)
bash scripts/fleet/fleet-health.sh

# Watchdog status
cat /tmp/ironsight-status.json 2>/dev/null | python3 -m json.tool
```

## Network Auto-Discovery

When plugged into a new truck's switch, the Pi auto-discovers the PLC:

```bash
# Check if discovery ran
tail -20 /var/log/ironsight-discovery.log

# Check what PLC IP was found
cat ~/.ironsight/plc-network.conf

# Force re-discovery (if PLC IP changed)
sudo python3 scripts/plc-autodiscover.py --force

# Check eth0 IPs (should have PLC subnet + optional DHCP)
ip addr show eth0

# Check if PLC is reachable
timeout 3 bash -c "echo >/dev/tcp/$(grep PLC_IP ~/.ironsight/plc-network.conf 2>/dev/null | cut -d'"' -f2)/502" && echo "PLC OK" || echo "PLC unreachable"
```

## CAN Bus (J1939 Truck Diagnostics)

```bash
# Is CAN interface up?
ip link show can0
# Expected: can0: <NOARP,UP,LOWER_UP> ... type can bitrate 250000

# CAN service status
systemctl status can0

# Are J1939 frames arriving? (Ctrl-C to stop)
candump can0 -c -t a | head -20

# Restart CAN if needed
sudo systemctl restart can0

# Verify listen-only mode (CRITICAL — never use normal mode on truck bus)
ip -d link show can0 | grep "listen-only"
```

## Viam Server & Modules

```bash
# All modules should show "Successfully constructed"
sudo journalctl -u viam-server -n 50 | grep -E "construct|error|panic"

# Check specific module
sudo journalctl -u viam-server --since "5 min ago" | grep plc-monitor
sudo journalctl -u viam-server --since "5 min ago" | grep truck-engine
sudo journalctl -u viam-server --since "5 min ago" | grep cell-monitor

# Restart viam-server (all modules restart)
sudo systemctl restart viam-server

# Check capture data is flowing
find ~/.viam/capture -name "*.prog" -mmin -5 | head -5

# Check offline buffer
ls -la ~/.viam/offline-buffer/
```

## PLC Connection

```bash
# Test Modbus TCP connection
python3 scripts/test_plc_modbus.py --host $(grep PLC_IP ~/.ironsight/plc-network.conf 2>/dev/null | cut -d'"' -f2 || echo "169.168.10.21")

# Read PLC registers directly
python3 -c "
from pymodbus.client import ModbusTcpClient
c = ModbusTcpClient('169.168.10.21', port=502, timeout=3)
c.connect()
r = c.read_holding_registers(0, 10, slave=1)
print('DS1-DS10:', r.registers if not r.isError() else 'ERROR')
c.close()
"
```

## WiFi & Internet

```bash
# Current connections
nmcli connection show --active

# Available networks
nmcli device wifi list

# WiFi priorities
nmcli -t -f NAME,AUTOCONNECT-PRIORITY connection show | sort -t: -k2 -rn

# Internet check
ping -c 3 8.8.8.8

# Tailscale status
tailscale status
```

## Disk & Resources

```bash
# Disk usage (capture dir can grow)
df -h /
du -sh ~/.viam/capture ~/.viam/offline-buffer

# Memory
free -h

# CPU temp
vcgencmd measure_temp

# Throttle status (undervoltage = bad power supply)
vcgencmd get_throttled
# 0x0 = no throttling, 0x50005 = undervoltage detected
```

## Common Issues & Fixes

### PLC unreachable after truck swap
The auto-discovery should handle this, but if it didn't:
```bash
sudo python3 scripts/plc-autodiscover.py --force
```

### CAN bus not receiving frames
1. Check physical connection (HAT seated, cable plugged in)
2. Check interface: `ip link show can0`
3. Check listen-only: `ip -d link show can0 | grep listen-only`
4. Restart: `sudo systemctl restart can0`
5. Check boot config: `grep mcp2515 /boot/firmware/config.txt`
6. Check for SPI conflicts: `dmesg | grep -E 'mcp251|spi|chipselect'`
7. Check FUSE mount health: `mount | grep fuse | wc -l` (should be < 10)

### viam-server won't start
```bash
sudo journalctl -u viam-server -n 100 --no-pager
# Common: bad /etc/viam.json, module crash, port conflict
```

### viam-server crash-looping with SIGBUS
The viam-server AppImage needs FUSE to mount. If it crash-loops, stale FUSE mounts
accumulate and hit the system limit, causing a SIGBUS death spiral.

```bash
# Check how many FUSE mounts exist (should be 1-3, not hundreds)
mount | grep fuse | wc -l

# If hundreds: stop server, clean up, restart
sudo systemctl stop viam-server
mount | grep 'fuse.viam-server' | awk '{print $3}' | sudo xargs -I{} fusermount -u {}
sudo rm -rf /tmp/.mount_viam-s*
sudo systemctl start viam-server

# Prevent recurrence: raise FUSE mount_max in /etc/fuse.conf
grep mount_max /etc/fuse.conf
# Should show: mount_max = 1000 (bootstrap.sh sets this)
```

### CAN HAT probe fails (MCP251x error -110)
If `dmesg | grep mcp251` shows "didn't enter in conf mode after reset":

1. **SPI conflict**: Another overlay (e.g., `mhs35ips` TFT display) may be claiming `spi0.0`.
   Check: `grep -E 'mhs35|tft|lcd' /boot/firmware/config.txt`
   Fix: Comment out the conflicting overlay (the Pi 5 runs headless for field use).

2. **HAT not seated**: The MCP2515 chip isn't physically present or the HAT isn't making contact.
   Check: reseat the HAT on the GPIO header and reboot.

3. **Wrong crystal frequency**: The Waveshare CAN HAT (B) uses a 12MHz crystal.
   Check: `grep mcp2515 /boot/firmware/config.txt` should show `oscillator=12000000`.
   (Some HATs use 8MHz or 16MHz — match the crystal on the board.)

### Capture data not flowing
```bash
# Check if module is producing readings
sudo journalctl -u viam-server --since "2 min ago" | grep -c "Readings"
# If 0: module is stuck, restart viam-server
sudo systemctl restart viam-server
```

### Undervoltage / throttling
Pi needs a good 5V 5A USB-C power supply. If `vcgencmd get_throttled` shows non-zero:
1. Check power supply (must be 5V 5A, not phone charger)
2. Check cable (short, thick USB-C cable preferred)
3. The CAN HAT draws additional power — insufficient PSU causes brownouts

## Using Claude CLI on the Pi

When you SSH in and run `claude`, it reads `CLAUDE.md` at the repo root and has full context about the system. You can ask it to:

- Diagnose issues: "PLC readings stopped, what's wrong?"
- Run commands: "Check if the CAN bus is receiving frames"
- Fix configs: "The PLC is on 192.168.1.2 now, reconfigure"
- Check logs: "Show me the last 50 viam-server errors"

Claude has permission to restart services and run diagnostic commands. For code changes, it will create a branch and PR (never pushes directly to main).
