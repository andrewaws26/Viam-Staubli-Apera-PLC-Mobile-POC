#!/bin/bash
# Install IronSight Pi Daemon as a systemd service
# Run: bash pi-daemon/install.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_NAME="ironsight-daemon"
USER="andrew"
NODE_BIN=$(which node)

echo "=== IronSight Pi Daemon Installer ==="
echo "Dir:  $SCRIPT_DIR"
echo "Node: $NODE_BIN"
echo "User: $USER"

# Install dependencies
echo ""
echo "[1/3] Installing npm dependencies..."
cd "$SCRIPT_DIR"
npm install --production

# Create systemd unit
echo "[2/3] Creating systemd service..."
sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null << EOF
[Unit]
Description=IronSight Pi Daemon — automation companion
After=network-online.target viam-server.service
Wants=network-online.target

[Service]
Type=simple
User=${USER}
WorkingDirectory=${SCRIPT_DIR}
ExecStart=${NODE_BIN} ${SCRIPT_DIR}/daemon.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

# Resource limits
MemoryMax=256M
CPUQuota=50%

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
echo "[3/3] Enabling and starting service..."
sudo systemctl daemon-reload
sudo systemctl enable ${SERVICE_NAME}
sudo systemctl start ${SERVICE_NAME}

echo ""
echo "=== Done! ==="
echo ""
echo "Useful commands:"
echo "  sudo systemctl status ${SERVICE_NAME}    # Check status"
echo "  sudo journalctl -u ${SERVICE_NAME} -f    # Live logs"
echo "  sudo systemctl restart ${SERVICE_NAME}    # Restart"
echo "  sudo systemctl stop ${SERVICE_NAME}       # Stop"
