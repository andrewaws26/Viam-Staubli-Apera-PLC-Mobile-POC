#!/usr/bin/env bash
# Step 2 & 3: Clone repo, create venv, install requirements
set -euo pipefail

PI="andrew@192.168.1.74"

echo "=== Step 2: Cloning repo into home directory ==="
ssh "$PI" 'bash -s' << 'EOF'
set -euo pipefail

cd ~
if [ -d "Viam-Staubli-Apera-PLC-Mobile-POC" ]; then
    echo "Repo already exists, pulling latest..."
    cd Viam-Staubli-Apera-PLC-Mobile-POC
    git pull
else
    git clone https://github.com/andrewaws26/Viam-Staubli-Apera-PLC-Mobile-POC.git
    cd Viam-Staubli-Apera-PLC-Mobile-POC
fi
echo "Repo ready at $(pwd)"
EOF

echo ""
echo "=== Step 3: Creating Python venv and installing requirements ==="
ssh "$PI" 'bash -s' << 'EOF'
set -euo pipefail

cd ~/Viam-Staubli-Apera-PLC-Mobile-POC/plc-simulator

# Create venv if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
else
    echo "Venv already exists"
fi

# Activate and install
source venv/bin/activate
echo "Python: $(python3 --version)"
echo "Pip: $(pip --version)"

# Upgrade pip first (Pi Zero W may have old pip)
pip install --upgrade pip

# Install requirements
echo "Installing requirements..."
pip install -r requirements.txt

echo ""
echo "=== Installed packages ==="
pip list | grep -iE "pymodbus|rpi|smbus|adafruit|pyyaml"
echo ""
echo "Setup complete!"
EOF
