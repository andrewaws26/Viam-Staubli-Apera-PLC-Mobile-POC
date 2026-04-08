#!/bin/bash
# ============================================================================
# Pi 5 Consolidation Script
#
# Prepares a Pi 5 to run ALL three modules (plc-sensor, cell-sensor, j1939-sensor)
# after physically moving the CAN HAT from the Pi Zero 2 W.
#
# Prerequisites:
#   1. Waveshare CAN HAT (B) physically installed on Pi 5 GPIO header
#   2. Pi 5 is running and accessible via SSH
#   3. This repo is cloned at /home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC
#
# Usage:
#   sudo bash scripts/consolidate-to-pi5.sh
#
# After running:
#   1. Reboot the Pi 5 (required for boot config changes)
#   2. Verify CAN interface: ip link show can0
#   3. Verify all modules: sudo journalctl -u viam-server -n 50
# ============================================================================

set -euo pipefail

REPO_DIR="/home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC"
MODULE_BASE="/opt/viam-modules"
BOOT_CONFIG="/boot/firmware/config.txt"

echo "=================================================================="
echo "  IronSight Pi 5 Consolidation"
echo "  Moving from dual-Pi to single-Pi architecture"
echo "=================================================================="
echo ""

# Must run as root
if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: This script must be run as root (sudo)."
    exit 1
fi

# ---- Step 1: Install CAN bus dependencies ----
echo "[1/6] Installing CAN bus dependencies..."
apt-get update -qq
apt-get install -y -qq can-utils 2>/dev/null
echo "  ✓ can-utils installed"

# ---- Step 2: Configure boot overlay for CAN HAT ----
echo "[2/6] Configuring boot overlay for Waveshare CAN HAT (B)..."

# Check if SPI is already enabled
if grep -q "^dtparam=spi=on" "$BOOT_CONFIG" 2>/dev/null; then
    echo "  ✓ SPI already enabled"
else
    echo "dtparam=spi=on" >> "$BOOT_CONFIG"
    echo "  + SPI enabled"
fi

# Check if MCP2515 overlay is already configured
if grep -q "^dtoverlay=mcp2515-can0" "$BOOT_CONFIG" 2>/dev/null; then
    echo "  ✓ MCP2515 CAN overlay already configured"
else
    # 12MHz crystal, GPIO25 interrupt, 2MHz SPI max — matches the Waveshare CAN HAT (B)
    echo "dtoverlay=mcp2515-can0,oscillator=12000000,interrupt=25,spimaxfrequency=2000000" >> "$BOOT_CONFIG"
    echo "  + MCP2515 CAN overlay added (12MHz crystal, GPIO25 interrupt)"
fi

# ---- Step 3: Create CAN interface systemd service ----
echo "[3/6] Creating CAN interface service (can0 at 250kbps, listen-only)..."

cat > /etc/systemd/system/can0.service << 'EOF'
[Unit]
Description=CAN0 interface - J1939 listen-only at 250kbps
After=network-pre.target
Before=viam-server.service

[Service]
Type=oneshot
RemainAfterExit=yes
# Bring up CAN interface in listen-only mode (CRITICAL for J1939 truck safety)
ExecStart=/sbin/ip link set can0 up type can bitrate 250000 listen-only on
ExecStop=/sbin/ip link set can0 down

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable can0.service 2>/dev/null
echo "  ✓ can0.service created and enabled"
echo "  ⚠ CRITICAL: listen-only mode prevents bus interference with truck ECUs"

# ---- Step 4: Deploy j1939-sensor module alongside existing modules ----
echo "[4/6] Deploying j1939-sensor module to $MODULE_BASE/j1939-sensor/..."

mkdir -p "$MODULE_BASE/j1939-sensor/src/models"

# Create symlinks for j1939-sensor source files
for f in j1939_sensor.py j1939_can.py j1939_dtc.py j1939_discovery.py \
         j1939_fleet_metrics.py j1939_rollup.py \
         pgn_decoder.py pgn_utils.py pgn_dm1.py \
         obd2_poller.py obd2_pids.py obd2_dtc.py obd2_diagnostics.py \
         vehicle_profiles.py; do
    SRC="$REPO_DIR/modules/j1939-sensor/src/models/$f"
    DST="$MODULE_BASE/j1939-sensor/src/models/$f"
    if [ -f "$SRC" ]; then
        ln -sf "$SRC" "$DST"
    fi
done

# Symlink main.py and __init__.py
for f in main.py __init__.py; do
    SRC="$REPO_DIR/modules/j1939-sensor/src/$f"
    DST="$MODULE_BASE/j1939-sensor/src/$f"
    if [ -f "$SRC" ]; then
        ln -sf "$SRC" "$DST"
    fi
done

# Copy exec.sh and requirements.txt (these need to be actual files, not symlinks)
cp "$REPO_DIR/modules/j1939-sensor/exec.sh" "$MODULE_BASE/j1939-sensor/exec.sh"
chmod +x "$MODULE_BASE/j1939-sensor/exec.sh"

if [ -f "$REPO_DIR/modules/j1939-sensor/requirements.txt" ]; then
    cp "$REPO_DIR/modules/j1939-sensor/requirements.txt" "$MODULE_BASE/j1939-sensor/requirements.txt"
fi

# Set up virtualenv and install deps
echo "  Installing Python dependencies..."
if [ ! -d "$MODULE_BASE/j1939-sensor/.venv" ]; then
    python3 -m venv "$MODULE_BASE/j1939-sensor/.venv"
fi
"$MODULE_BASE/j1939-sensor/.venv/bin/pip" install -q \
    python-can typing_extensions wrapt packaging 2>/dev/null

echo "  ✓ j1939-sensor module deployed"

# ---- Step 5: Optimize Pi 5 for consolidated workload ----
echo "[5/6] Applying Pi 5 optimizations..."

# Increase CAN receive buffer for reliable J1939 at 250kbps
if ! grep -q "net.core.rmem_max" /etc/sysctl.d/99-ironsight.conf 2>/dev/null; then
    cat > /etc/sysctl.d/99-ironsight.conf << 'EOF'
# IronSight consolidated Pi 5 optimizations
# Larger CAN socket receive buffer for J1939 at 250kbps
net.core.rmem_max = 8388608
net.core.rmem_default = 1048576
# Reduce swappiness (Pi 5 has 8GB, prefer RAM over swap)
vm.swappiness = 10
EOF
    sysctl -p /etc/sysctl.d/99-ironsight.conf 2>/dev/null
    echo "  ✓ Kernel parameters optimized (CAN buffer, swappiness)"
else
    echo "  ✓ Kernel parameters already configured"
fi

# ---- Step 6: Summary ----
echo "[6/6] Consolidation complete!"
echo ""
echo "=================================================================="
echo "  NEXT STEPS"
echo "=================================================================="
echo ""
echo "  1. REBOOT the Pi 5:  sudo reboot"
echo ""
echo "  2. After reboot, verify CAN interface:"
echo "     ip link show can0"
echo "     # Should show: can0: <NOARP,UP,LOWER_UP> ... bitrate 250000"
echo ""
echo "  3. Verify all three modules in viam-server:"
echo "     sudo journalctl -u viam-server -n 50 | grep 'Successfully constructed'"
echo "     # Should see: plc-monitor, cell-monitor, truck-engine"
echo ""
echo "  4. Test CAN bus reception (if truck is running):"
echo "     candump can0 -c -t a | head -20"
echo ""
echo "  5. Update Viam Cloud machine config to include truck-engine component"
echo "     (use config/viam-server.json as reference)"
echo ""
echo "  6. The Pi Zero 2 W can now be decommissioned or repurposed."
echo ""
echo "  ⚠ IMPORTANT: The CAN HAT MUST be in listen-only mode."
echo "    The can0.service enforces this. Never change to normal mode"
echo "    on a truck CAN bus — it will trigger dashboard warning lights."
echo "=================================================================="
