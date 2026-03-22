#!/bin/bash
# IronSight iPhone USB Tethering Setup
#
# Configures the Raspberry Pi so that when you plug in an iPhone via USB:
#   1. iPhone USB Ethernet interface auto-configures
#   2. Pi gets a static IP (172.20.10.2) on the iPhone's USB subnet
#   3. SSH is immediately available from Blink at 172.20.10.2
#   4. IronSight display auto-starts in SSH session
#
# iPhone USB tethering uses 172.20.10.0/28:
#   - iPhone: 172.20.10.1
#   - Pi:     172.20.10.2 (static)
#
# Usage: sudo bash scripts/iphone-usb-setup.sh

set -e

STATIC_IP="172.20.10.2"
GATEWAY="172.20.10.1"
PREFIX="28"
PROJECT_DIR="/home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC"
DISPLAY_SCRIPT="$PROJECT_DIR/scripts/ironsight-display.py"

echo "========================================="
echo "  IronSight iPhone USB Setup"
echo "========================================="
echo ""

# --- 1. Ensure ipheth module loads on boot ---
echo "[1/6] Configuring ipheth kernel module..."
if ! grep -q "^ipheth" /etc/modules 2>/dev/null; then
    echo "ipheth" >> /etc/modules
    echo "  Added ipheth to /etc/modules"
else
    echo "  ipheth already in /etc/modules"
fi
modprobe ipheth 2>/dev/null || true

# --- 2. Install required packages ---
echo "[2/6] Installing iPhone USB support..."
apt-get install -y usbmuxd libimobiledevice-utils > /dev/null 2>&1
systemctl enable usbmuxd 2>/dev/null || true
echo "  usbmuxd installed and enabled"

# --- 3. Create udev rule for auto-detection ---
echo "[3/6] Creating udev rule for iPhone detection..."
cat > /etc/udev/rules.d/90-iphone-usb.rules << 'UDEV'
# When an iPhone is connected via USB, trigger network setup
# Apple vendor ID: 05ac
ACTION=="add", SUBSYSTEM=="net", DRIVERS=="ipheth", \
    RUN+="/bin/bash -c '/usr/local/bin/ironsight-iphone-connect &'"

# Also match by vendor for usbmuxd
ACTION=="add", SUBSYSTEM=="usb", ATTR{idVendor}=="05ac", \
    RUN+="/usr/bin/systemctl start usbmuxd"
UDEV
echo "  Created /etc/udev/rules.d/90-iphone-usb.rules"

# --- 4. Create the connection script ---
echo "[4/6] Creating iPhone connection script..."
cat > /usr/local/bin/ironsight-iphone-connect << 'SCRIPT'
#!/bin/bash
# Auto-configure iPhone USB tethering with static IP
# Called by udev when an iPhone is plugged in

LOG="/var/log/ironsight-iphone.log"
STATIC_IP="172.20.10.2"
GATEWAY="172.20.10.1"
PREFIX="28"
STATUS_SCRIPT="/home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC/scripts/ironsight-status.py"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG"; }

log "iPhone USB detected — configuring..."

# Post to display
if [ -f "$STATUS_SCRIPT" ]; then
    python3 "$STATUS_SCRIPT" system iphone "iPhone USB connected" --level success 2>/dev/null &
fi

# Wait for the interface to fully appear
sleep 2

# Find the iPhone network interface (usually eth1, enx..., or usb0)
IFACE=""
for iface in /sys/class/net/*/device/driver; do
    if readlink -f "$iface" | grep -q "ipheth"; then
        IFACE=$(echo "$iface" | cut -d'/' -f5)
        break
    fi
done

# Fallback: look for new interfaces that appeared
if [ -z "$IFACE" ]; then
    for iface in eth1 eth2 usb0 usb1; do
        if [ -d "/sys/class/net/$iface" ]; then
            # Check if it's the iPhone by looking at driver
            DRIVER=$(readlink -f "/sys/class/net/$iface/device/driver" 2>/dev/null | xargs basename 2>/dev/null)
            if [ "$DRIVER" = "ipheth" ]; then
                IFACE="$iface"
                break
            fi
        fi
    done
fi

# Last resort: any interface with ipheth driver
if [ -z "$IFACE" ]; then
    IFACE=$(ip -o link show | grep -v "lo\|wlan\|eth0\|tailscale" | awk -F': ' '/state UP/{print $2}' | head -1)
fi

if [ -z "$IFACE" ]; then
    log "ERROR: Could not find iPhone network interface"
    exit 1
fi

log "Found iPhone interface: $IFACE"

# Check if NetworkManager already has a connection for this
NM_CON="iphone-usb"
if nmcli connection show "$NM_CON" &>/dev/null; then
    # Update existing connection
    nmcli connection modify "$NM_CON" \
        connection.interface-name "$IFACE" \
        ipv4.addresses "${STATIC_IP}/${PREFIX}" \
        ipv4.gateway "$GATEWAY" \
        ipv4.method manual \
        ipv4.never-default yes \
        connection.autoconnect yes \
        connection.autoconnect-priority 25 \
        2>/dev/null
    log "Updated NM connection '$NM_CON' for $IFACE"
else
    # Create new connection
    nmcli connection add \
        type ethernet \
        con-name "$NM_CON" \
        ifname "$IFACE" \
        ipv4.addresses "${STATIC_IP}/${PREFIX}" \
        ipv4.gateway "$GATEWAY" \
        ipv4.method manual \
        ipv4.never-default yes \
        connection.autoconnect yes \
        connection.autoconnect-priority 25 \
        2>/dev/null
    log "Created NM connection '$NM_CON' for $IFACE"
fi

# Bring it up
nmcli connection up "$NM_CON" 2>/dev/null
RESULT=$?

if [ $RESULT -eq 0 ]; then
    log "SUCCESS: iPhone USB tethering active — Pi is at $STATIC_IP"
    log "SSH from Blink: ssh andrew@$STATIC_IP"

    if [ -f "$STATUS_SCRIPT" ]; then
        python3 "$STATUS_SCRIPT" system iphone "iPhone connected — SSH at $STATIC_IP" --level success 2>/dev/null &
    fi
else
    # Fallback: manually set IP if NM fails
    log "NM failed, falling back to manual IP..."
    ip addr flush dev "$IFACE" 2>/dev/null
    ip addr add "${STATIC_IP}/${PREFIX}" dev "$IFACE" 2>/dev/null
    ip link set "$IFACE" up 2>/dev/null
    log "Manual IP set: $STATIC_IP on $IFACE"

    if [ -f "$STATUS_SCRIPT" ]; then
        python3 "$STATUS_SCRIPT" system iphone "iPhone USB — manual IP at $STATIC_IP" --level warning 2>/dev/null &
    fi
fi

# Verify connectivity to iPhone
sleep 1
if ping -c 1 -W 2 "$GATEWAY" &>/dev/null; then
    log "VERIFIED: Can reach iPhone at $GATEWAY"
else
    log "WARNING: Cannot ping iPhone at $GATEWAY — tethering may need to be enabled on iPhone"
fi
SCRIPT
chmod +x /usr/local/bin/ironsight-iphone-connect
echo "  Created /usr/local/bin/ironsight-iphone-connect"

# --- 5. Create disconnect handler ---
echo "[5/6] Creating disconnect handler..."
cat > /usr/local/bin/ironsight-iphone-disconnect << 'SCRIPT'
#!/bin/bash
# Clean up when iPhone is unplugged
LOG="/var/log/ironsight-iphone.log"
STATUS_SCRIPT="/home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC/scripts/ironsight-status.py"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] iPhone USB disconnected" >> "$LOG"

if [ -f "$STATUS_SCRIPT" ]; then
    python3 "$STATUS_SCRIPT" system iphone "iPhone disconnected" --level info 2>/dev/null &
fi

# NM will handle the cleanup, but deactivate the connection
nmcli connection down iphone-usb 2>/dev/null || true
SCRIPT
chmod +x /usr/local/bin/ironsight-iphone-disconnect

# Add disconnect udev rule
cat >> /etc/udev/rules.d/90-iphone-usb.rules << 'UDEV'

# When iPhone is disconnected
ACTION=="remove", SUBSYSTEM=="net", DRIVERS=="ipheth", \
    RUN+="/bin/bash -c '/usr/local/bin/ironsight-iphone-disconnect &'"
UDEV
echo "  Created disconnect handler"

# --- 6. Add SSH welcome with IronSight status ---
echo "[6/6] Setting up SSH login display..."
cat > /home/andrew/.ironsight-motd << 'MOTD'
#!/bin/bash
# IronSight SSH welcome — shows quick status on login
PROJECT_DIR="/home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC"

echo ""
echo -e "\033[94m  ╔═══════════════════════════════════╗\033[0m"
echo -e "\033[94m  ║      I R O N S I G H T            ║\033[0m"
echo -e "\033[94m  ║      TPS Remote Monitor           ║\033[0m"
echo -e "\033[94m  ╚═══════════════════════════════════╝\033[0m"
echo ""

# Quick status
VIAM=$(systemctl is-active viam-server 2>/dev/null)
ETH=$(cat /sys/class/net/eth0/carrier 2>/dev/null || echo 0)
INET=$(ping -c 1 -W 1 8.8.8.8 &>/dev/null && echo "yes" || echo "no")

dot_g="\033[92m●\033[0m"
dot_r="\033[91m●\033[0m"

echo -e "  $([[ "$VIAM" == "active" ]] && echo "$dot_g" || echo "$dot_r") viam-server    $([[ "$ETH" == "1" ]] && echo "$dot_g" || echo "$dot_r") eth0/PLC    $([[ "$INET" == "yes" ]] && echo "$dot_g" || echo "$dot_r") internet"
echo ""

# PLC IP
PLC_IP=$(python3 -c "import json; c=json.load(open('$PROJECT_DIR/config/viam-server.json')); print([x['attributes']['host'] for x in c['components'] if x['name']=='plc-monitor'][0])" 2>/dev/null || echo "unknown")
echo "  PLC: $PLC_IP"

# Uptime
UP=$(uptime -p 2>/dev/null | sed 's/up //')
echo "  Uptime: $UP"
echo ""
echo -e "  \033[90mCommands:\033[0m"
echo -e "  \033[96mpython3 scripts/ironsight-display.py --terminal\033[0m  — Live dashboard"
echo -e "  \033[96mpython3 scripts/test_plc_modbus.py\033[0m              — Test PLC"
echo -e "  \033[96msudo journalctl -u viam-server -f\033[0m               — Live logs"
echo ""
MOTD
chmod +x /home/andrew/.ironsight-motd
chown andrew:andrew /home/andrew/.ironsight-motd

# Add to .bashrc if not already there
if ! grep -q "ironsight-motd" /home/andrew/.bashrc 2>/dev/null; then
    echo "" >> /home/andrew/.bashrc
    echo "# IronSight welcome screen on SSH login" >> /home/andrew/.bashrc
    echo '[ -n "$SSH_CONNECTION" ] && [ -x "$HOME/.ironsight-motd" ] && bash "$HOME/.ironsight-motd"' >> /home/andrew/.bashrc
    echo "  Added IronSight welcome to .bashrc"
else
    echo "  IronSight welcome already in .bashrc"
fi

# --- Reload udev rules ---
udevadm control --reload-rules
udevadm trigger

echo ""
echo "========================================="
echo "  Setup Complete!"
echo "========================================="
echo ""
echo "  iPhone USB IP:  $STATIC_IP"
echo "  iPhone Gateway: $GATEWAY"
echo ""
echo "  HOW TO USE:"
echo "  1. Plug iPhone into Pi's USB-A port"
echo "     (use USB-C to USB-A cable or adapter)"
echo "  2. On iPhone: enable Personal Hotspot"
echo "     (Settings → Personal Hotspot → ON)"
echo "  3. Open Blink, SSH to: andrew@$STATIC_IP"
echo ""
echo "  It will auto-connect every time you plug in."
echo "  No WiFi needed. Direct USB connection."
echo ""
echo "  WiFi priority (unchanged):"
echo "    1. B&B Shop (30)"
echo "    2. Verizon_X6JPH6 (20)"
echo "    3. iPhone USB (25) — between shop & Verizon"
echo "    4. Andrew hotspot (10)"
echo ""
