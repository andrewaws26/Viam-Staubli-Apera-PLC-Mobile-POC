#!/bin/bash
# TPS Pi Bootstrap — sets up a fresh Raspberry Pi 5 to run the full system.
#
# Prerequisites:
#   - Raspberry Pi OS (64-bit, Bookworm)
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
#   4. Reboot

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS_DIR="$REPO_DIR/scripts"
SETUP_DIR="$REPO_DIR/setup"
USER="andrew"

echo "=== TPS Pi Bootstrap ==="
echo "Repo: $REPO_DIR"
echo ""

# ── 1. System packages ──
echo "[1/8] Installing system packages..."
apt-get update -qq
apt-get install -y -qq python3-pip python3-venv network-manager

# ── 2. Python dependencies ──
echo "[2/8] Installing Python packages..."
pip3 install --break-system-packages pymodbus>=3.5 anthropic

# ── 3. Viam server ──
echo "[3/8] Installing Viam server..."
if ! command -v viam-server &>/dev/null; then
    curl -fsSL https://storage.googleapis.com/packages.viam.com/apps/viam-server/viam-server-stable-aarch64.AppImage -o /usr/local/bin/viam-server
    chmod +x /usr/local/bin/viam-server
    echo "  ⚠  You must create /etc/viam.json with your cloud credentials from app.viam.com"
else
    echo "  viam-server already installed: $(viam-server --version 2>/dev/null || echo 'unknown')"
fi

# ── 4. Module symlink ──
echo "[4/8] Setting up plc-sensor module..."
mkdir -p /opt/viam-modules/plc-sensor/src
ln -sf "$REPO_DIR/modules/plc-sensor/src/plc_sensor.py" /opt/viam-modules/plc-sensor/src/plc_sensor.py
cp "$REPO_DIR/modules/plc-sensor/run.sh" /opt/viam-modules/plc-sensor/run.sh
cp "$REPO_DIR/modules/plc-sensor/requirements.txt" /opt/viam-modules/plc-sensor/requirements.txt
chmod +x /opt/viam-modules/plc-sensor/run.sh

# ── 5. Systemd services ──
echo "[5/8] Installing systemd services..."
cp "$SETUP_DIR/systemd/viam-server.service" /etc/systemd/system/
cp "$SETUP_DIR/systemd/plc-subnet.service" /etc/systemd/system/
cp "$SETUP_DIR/systemd/ironsight-server.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable viam-server.service
systemctl enable plc-subnet.service
systemctl enable ironsight-server.service

# ── 6. Crontab for watchdog ──
echo "[6/8] Setting up watchdog cron..."
CRON_LINE="*/5 * * * * $SCRIPTS_DIR/watchdog.sh"
(crontab -u "$USER" -l 2>/dev/null | grep -v "watchdog.sh"; echo "$CRON_LINE") | crontab -u "$USER" -

# ── 7. WiFi configs ──
echo "[7/8] Installing WiFi connection templates..."
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

# ── 8. Create directories ──
echo "[8/8] Creating data directories..."
mkdir -p /home/$USER/.viam/offline-buffer
mkdir -p /home/$USER/.viam/capture
mkdir -p "$REPO_DIR/uploads/photos"
mkdir -p "$REPO_DIR/uploads/analyses"
mkdir -p "$SCRIPTS_DIR/incidents"
chown -R $USER:$USER /home/$USER/.viam

echo ""
echo "=== Bootstrap complete ==="
echo ""
echo "Remaining manual steps:"
echo "  1. Edit WiFi passwords:  sudo nano /etc/NetworkManager/system-connections/BB-Shop.nmconnection"
echo "  2. Set Viam cloud creds: copy JSON from app.viam.com to /etc/viam.json"
echo "  3. Install Tailscale:    curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up"
echo "  4. Reboot:               sudo reboot"
echo ""
echo "After reboot, verify:"
echo "  systemctl status viam-server"
echo "  systemctl status plc-subnet"
echo "  systemctl status ironsight-server"
echo "  crontab -l  (should show watchdog.sh every 5 min)"
