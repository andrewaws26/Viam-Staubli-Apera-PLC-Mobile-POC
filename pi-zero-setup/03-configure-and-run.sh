#!/usr/bin/env bash
# Step 4 & 5: Change Modbus port to 5020, run main.py, confirm server is listening
set -euo pipefail

PI="andrew@192.168.1.74"

echo "=== Step 4: Configuring Modbus port to 5020 (avoids root requirement) ==="
ssh "$PI" 'bash -s' << 'EOF'
set -euo pipefail

cd ~/Viam-Staubli-Apera-PLC-Mobile-POC/plc-simulator

# Change port from 502 to 5020 to avoid needing root
sed -i 's/port: 502$/port: 5020/' config.yaml
echo "Config updated:"
grep "port:" config.yaml
EOF

echo ""
echo "=== Step 4: Starting PLC Simulator ==="
echo "Running in background. Will check port after 5 seconds..."
ssh "$PI" 'bash -s' << 'OUTER_EOF'
set -euo pipefail

cd ~/Viam-Staubli-Apera-PLC-Mobile-POC/plc-simulator
source venv/bin/activate

# Kill any existing instance
pkill -f "python.*src.main" 2>/dev/null || true
sleep 1

# Start the simulator in background, log to file
nohup python3 -m src.main > /tmp/plc-simulator.log 2>&1 &
PID=$!
echo "PLC Simulator started with PID: $PID"

# Wait for server to initialize
echo "Waiting for Modbus server to start..."
sleep 5

# Check if process is still running
if kill -0 $PID 2>/dev/null; then
    echo "Process is running (PID $PID)"
else
    echo "ERROR: Process died. Last 30 lines of log:"
    tail -30 /tmp/plc-simulator.log
    exit 1
fi

# Show startup log
echo ""
echo "=== Startup log ==="
cat /tmp/plc-simulator.log

echo ""
echo "=== Step 5: Checking if Modbus server is listening on port 5020 ==="
if ss -tlnp 2>/dev/null | grep -q ":5020"; then
    echo "SUCCESS: Modbus TCP server is listening on port 5020"
    ss -tlnp | grep ":5020"
elif netstat -tlnp 2>/dev/null | grep -q ":5020"; then
    echo "SUCCESS: Modbus TCP server is listening on port 5020"
    netstat -tlnp | grep ":5020"
else
    echo "WARNING: Port 5020 not detected via ss/netstat. Checking with lsof..."
    lsof -i :5020 2>/dev/null || echo "lsof not available"
    echo ""
    echo "Last 30 lines of log:"
    tail -30 /tmp/plc-simulator.log
fi
OUTER_EOF
