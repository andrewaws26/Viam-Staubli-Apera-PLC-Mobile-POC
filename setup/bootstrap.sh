#!/bin/bash
# IronSight Pi 5 Bootstrap — sets up a fresh Raspberry Pi 5 to run all modules.
#
# Single-Pi architecture: one Pi 5 per truck runs plc-sensor, cell-sensor,
# and j1939-sensor (CAN bus). Auto-discovery finds the PLC on any subnet.
#
# Prerequisites:
#   - Raspberry Pi 5, Raspberry Pi OS (64-bit, Bookworm)
#   - Waveshare CAN HAT (B) installed on GPIO header (for J1939)
#   - Internet connection (WiFi or Ethernet)
#   - This repo cloned to /home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC
#
# Usage:
#   cd /home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC
#   sudo bash setup/bootstrap.sh
#
# After running:
#   1. Edit WiFi passwords in /etc/NetworkManager/system-connections/*.nmconnection
#   2. Set up Viam cloud: copy /etc/viam.json from app.viam.com
#   3. Install Tailscale: curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up
#   4. Install Claude Code: npm install -g @anthropic-ai/claude-code
#   5. Reboot

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS_DIR="$REPO_DIR/scripts"
SETUP_DIR="$REPO_DIR/setup"
USER="andrew"

echo "=== IronSight Pi 5 Bootstrap (Consolidated) ==="
echo "Repo: $REPO_DIR"
echo ""

# ── 1. System packages ──
echo "[1/10] Installing system packages..."
apt-get update -qq
apt-get install -y -qq python3-pip python3-venv network-manager can-utils smbclient

# ── 2. Python dependencies ──
echo "[2/10] Installing Python packages..."
pip3 install --break-system-packages pymodbus>=3.5 anthropic python-can

# ── 3. Viam server ──
echo "[3/10] Installing Viam server..."
if ! command -v viam-server &>/dev/null; then
    curl -fsSL https://storage.googleapis.com/packages.viam.com/apps/viam-server/viam-server-stable-aarch64.AppImage -o /usr/local/bin/viam-server
    chmod +x /usr/local/bin/viam-server
    echo "  You must create /etc/viam.json with your cloud credentials from app.viam.com"
else
    echo "  viam-server already installed: $(viam-server --version 2>/dev/null || echo 'unknown')"
fi

# ── 4. Module symlinks (all three modules) ──
echo "[4/10] Setting up sensor modules..."

# plc-sensor
mkdir -p /opt/viam-modules/plc-sensor/src
for f in plc_sensor.py plc_utils.py plc_offline.py plc_metrics.py plc_weather.py diagnostics.py system_health.py; do
    [ -f "$REPO_DIR/modules/plc-sensor/src/$f" ] && \
        ln -sf "$REPO_DIR/modules/plc-sensor/src/$f" /opt/viam-modules/plc-sensor/src/"$f"
done
cp "$REPO_DIR/modules/plc-sensor/run.sh" /opt/viam-modules/plc-sensor/run.sh
cp "$REPO_DIR/modules/plc-sensor/requirements.txt" /opt/viam-modules/plc-sensor/requirements.txt
chmod +x /opt/viam-modules/plc-sensor/run.sh
echo "  plc-sensor module deployed"

# cell-sensor
mkdir -p /opt/viam-modules/cell-sensor/src
for f in cell_sensor.py staubli_client.py apera_client.py network_monitor.py; do
    [ -f "$REPO_DIR/modules/cell-sensor/src/$f" ] && \
        ln -sf "$REPO_DIR/modules/cell-sensor/src/$f" /opt/viam-modules/cell-sensor/src/"$f"
done
cp "$REPO_DIR/modules/cell-sensor/run.sh" /opt/viam-modules/cell-sensor/run.sh
cp "$REPO_DIR/modules/cell-sensor/requirements.txt" /opt/viam-modules/cell-sensor/requirements.txt
chmod +x /opt/viam-modules/cell-sensor/run.sh
echo "  cell-sensor module deployed"

# j1939-sensor (CAN bus — new for consolidated Pi 5)
mkdir -p /opt/viam-modules/j1939-sensor/src/models
for f in j1939_sensor.py j1939_can.py j1939_dtc.py j1939_discovery.py \
         j1939_fleet_metrics.py j1939_rollup.py \
         pgn_decoder.py pgn_utils.py pgn_dm1.py \
         obd2_poller.py obd2_pids.py obd2_dtc.py obd2_diagnostics.py \
         vehicle_profiles.py; do
    [ -f "$REPO_DIR/modules/j1939-sensor/src/models/$f" ] && \
        ln -sf "$REPO_DIR/modules/j1939-sensor/src/models/$f" /opt/viam-modules/j1939-sensor/src/models/"$f"
done
for f in main.py __init__.py; do
    [ -f "$REPO_DIR/modules/j1939-sensor/src/$f" ] && \
        ln -sf "$REPO_DIR/modules/j1939-sensor/src/$f" /opt/viam-modules/j1939-sensor/src/"$f"
done
cp "$REPO_DIR/modules/j1939-sensor/exec.sh" /opt/viam-modules/j1939-sensor/exec.sh
chmod +x /opt/viam-modules/j1939-sensor/exec.sh
[ -f "$REPO_DIR/modules/j1939-sensor/requirements.txt" ] && \
    cp "$REPO_DIR/modules/j1939-sensor/requirements.txt" /opt/viam-modules/j1939-sensor/requirements.txt
# Set up virtualenv for j1939
if [ ! -d /opt/viam-modules/j1939-sensor/.venv ]; then
    python3 -m venv /opt/viam-modules/j1939-sensor/.venv
    /opt/viam-modules/j1939-sensor/.venv/bin/pip install -q python-can typing_extensions wrapt packaging
fi
echo "  j1939-sensor module deployed"

# ── 5. CAN HAT boot overlay ──
echo "[5/10] Configuring CAN HAT boot overlay..."
BOOT_CONFIG="/boot/firmware/config.txt"
if ! grep -q "^dtparam=spi=on" "$BOOT_CONFIG" 2>/dev/null; then
    echo "dtparam=spi=on" >> "$BOOT_CONFIG"
    echo "  + SPI enabled"
fi
if ! grep -q "^dtoverlay=mcp2515-can0" "$BOOT_CONFIG" 2>/dev/null; then
    echo "dtoverlay=mcp2515-can0,oscillator=12000000,interrupt=25,spimaxfrequency=2000000" >> "$BOOT_CONFIG"
    echo "  + MCP2515 CAN overlay added (12MHz crystal, GPIO25)"
fi

# ── 5b. Passwordless sudo for self-healing ──
echo "  Configuring passwordless sudo for $USER..."
cat > /etc/sudoers.d/ironsight << EOSUDO
# IronSight self-healing: allow andrew to restart services and read logs without password.
# Required because self-heal.py runs from cron (no TTY for password prompt).
$USER ALL=(ALL) NOPASSWD: /bin/systemctl restart viam-server, /bin/systemctl restart can0, /bin/systemctl restart NetworkManager
$USER ALL=(ALL) NOPASSWD: /bin/systemctl start viam-server, /bin/systemctl start can0
$USER ALL=(ALL) NOPASSWD: /bin/systemctl stop can0
$USER ALL=(ALL) NOPASSWD: /sbin/ip link set can0 *
$USER ALL=(ALL) NOPASSWD: /bin/journalctl *
EOSUDO
chmod 440 /etc/sudoers.d/ironsight
visudo -c -f /etc/sudoers.d/ironsight 2>/dev/null && echo "  sudoers validated" || echo "  WARNING: sudoers syntax error"

# ── 6. Systemd services ──
echo "[6/10] Installing systemd services..."
cp "$SETUP_DIR/systemd/viam-server.service" /etc/systemd/system/
cp "$SETUP_DIR/systemd/plc-subnet.service" /etc/systemd/system/
cp "$SETUP_DIR/systemd/ironsight-server.service" /etc/systemd/system/

# CAN interface service (listen-only mode — critical for J1939 truck safety)
cat > /etc/systemd/system/can0.service << 'EOF'
[Unit]
Description=CAN0 interface - J1939 listen-only at 250kbps
After=network-pre.target
Before=viam-server.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/sbin/ip link set can0 up type can bitrate 250000 listen-only on
ExecStop=/sbin/ip link set can0 down

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable viam-server.service
systemctl enable plc-subnet.service
systemctl enable ironsight-server.service
systemctl enable can0.service
echo "  Services installed and enabled (including can0 listen-only)"

# ── 7. PLC auto-discovery dispatcher ──
echo "[7/10] Installing PLC auto-discovery..."
cp "$SCRIPTS_DIR/10-plc-eth0-static" /etc/NetworkManager/dispatcher.d/10-plc-eth0-static
chmod +x /etc/NetworkManager/dispatcher.d/10-plc-eth0-static
mkdir -p /home/$USER/.ironsight
chown -R $USER:$USER /home/$USER/.ironsight
echo "  NetworkManager dispatcher installed (triggers discovery on eth0 link-up)"

# ── 8. Pi 5 kernel optimizations ──
echo "[8/10] Applying kernel optimizations..."
cat > /etc/sysctl.d/99-ironsight.conf << 'EOF'
# IronSight consolidated Pi 5 optimizations
net.core.rmem_max = 8388608
net.core.rmem_default = 1048576
vm.swappiness = 10
EOF
sysctl -p /etc/sysctl.d/99-ironsight.conf 2>/dev/null || true

# ── 9. Crontab for watchdog + fleet-sync ──
echo "[9/10] Setting up cron jobs..."
WATCHDOG_LINE="*/5 * * * * $SCRIPTS_DIR/watchdog.sh"
SYNC_LINE="*/10 * * * * $SCRIPTS_DIR/fleet/fleet-sync.sh"
HEAL_LINE="*/2 * * * * $SCRIPTS_DIR/self-heal.py >> /var/log/ironsight-self-heal.log 2>&1"
(crontab -u "$USER" -l 2>/dev/null | grep -v "watchdog.sh" | grep -v "fleet-sync.sh" | grep -v "self-heal.py"; echo "$WATCHDOG_LINE"; echo "$SYNC_LINE"; echo "$HEAL_LINE") | crontab -u "$USER" -

# ── 10. WiFi configs + data dirs ──
echo "[10/10] Installing WiFi templates and creating directories..."
for nmfile in "$SETUP_DIR/networkmanager/"*.nmconnection; do
    dest="/etc/NetworkManager/system-connections/$(basename "$nmfile")"
    if [ ! -f "$dest" ]; then
        cp "$nmfile" "$dest"
        chmod 600 "$dest"
        echo "  Installed: $(basename "$nmfile") — EDIT PASSWORD in $dest"
    else
        echo "  Skipped (already exists): $(basename "$nmfile")"
    fi
done

mkdir -p /home/$USER/.viam/offline-buffer
mkdir -p /home/$USER/.viam/capture
mkdir -p "$REPO_DIR/uploads/photos"
mkdir -p "$REPO_DIR/uploads/analyses"
mkdir -p "$SCRIPTS_DIR/incidents/archive"
chown -R $USER:$USER /home/$USER/.viam

echo ""
echo "=== Bootstrap complete ==="
echo ""
echo "Remaining manual steps:"
echo "  1. Edit WiFi passwords:  sudo nano /etc/NetworkManager/system-connections/BB-Shop.nmconnection"
echo "  2. Set Viam cloud creds: copy JSON from app.viam.com to /etc/viam.json"
echo "  3. Install Tailscale:    curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up"
echo "  4. Install Claude Code:  npm install -g @anthropic-ai/claude-code"
echo "  5. Set ANTHROPIC_API_KEY: echo 'export ANTHROPIC_API_KEY=sk-ant-...' >> ~/.bashrc"
echo "  6. Reboot:               sudo reboot"
echo ""
echo "After reboot, verify:"
echo "  systemctl status viam-server     # All 3 modules should construct"
echo "  systemctl status can0            # CAN interface at 250kbps listen-only"
echo "  ip link show can0                # Should show UP"
echo "  systemctl status plc-subnet      # PLC subnet IP on eth0"
echo "  crontab -l                       # watchdog + fleet-sync"
echo ""
echo "To SSH in and get Claude's help:"
echo "  ssh andrew@<tailscale-ip>"
echo "  cd ~/Viam-Staubli-Apera-PLC-Mobile-POC"
echo "  claude                           # Claude reads CLAUDE.md for full context"
