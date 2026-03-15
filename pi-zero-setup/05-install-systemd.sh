#!/usr/bin/env bash
# Step 7: Install and enable the systemd service so the PLC simulator starts on boot
set -euo pipefail

PI="andrew@192.168.1.74"

echo "=== Step 7: Installing systemd service for PLC Simulator ==="
ssh "$PI" 'bash -s' << 'EOF'
set -euo pipefail

SERVICE_SRC=~/Viam-Staubli-Apera-PLC-Mobile-POC/plc-simulator/systemd/plc-simulator.service
SERVICE_DEST=/etc/systemd/system/plc-simulator.service

# Stop existing nohup instance if running
pkill -f "python.*src.main" 2>/dev/null || true
sleep 1

# Copy the service file
sudo cp "$SERVICE_SRC" "$SERVICE_DEST"
echo "Copied service file to $SERVICE_DEST"

# Reload systemd, enable and start
sudo systemctl daemon-reload
sudo systemctl enable plc-simulator.service
sudo systemctl start plc-simulator.service

echo ""
echo "Service status:"
sudo systemctl status plc-simulator.service --no-pager || true

echo ""
echo "Checking Modbus port..."
sleep 3
if ss -tlnp 2>/dev/null | grep -q ":502 "; then
    echo "SUCCESS: Modbus TCP server is listening on port 502"
else
    echo "Checking logs..."
    sudo journalctl -u plc-simulator.service --no-pager -n 20
fi

echo ""
echo "The PLC simulator will now start automatically on boot."
EOF
