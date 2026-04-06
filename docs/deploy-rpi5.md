# Deploying the TPS PLC Sensor on Raspberry Pi 5

This guide walks through deploying the plc-sensor module on a Raspberry Pi 5 running Raspberry Pi OS. The module connects to a Click PLC over Modbus TCP, reads ~100+ fields of TPS machine data, and syncs everything to Viam Cloud.

**Time required:** ~20 minutes

**What you'll prove:** The full data pipeline works end-to-end. The PLC sensor on the Pi reads live Modbus registers from the Click PLC, Viam syncs the data to the cloud, and you see real-time TPS machine status in a browser.

---

## Prerequisites

- Raspberry Pi 5 running Raspberry Pi OS (64-bit, Bookworm)
- Pi connected to the same subnet as the Click PLC (169.168.10.x)
- SSH access to the Pi (or a keyboard/monitor attached)
- A free Viam account at https://app.viam.com
- Click PLC C0-10DD2E-D powered on and reachable at 169.168.10.21

---

## Step 1: Install viam-server on the Pi

SSH into your Pi and run:

```bash
curl -fsSL https://storage.googleapis.com/packages.viam.com/apps/viam-server/viam-server-stable-aarch64.AppImage -o viam-server
chmod +x viam-server
sudo mv viam-server /usr/local/bin/viam-server
```

Verify it works:

```bash
viam-server --version
```

---

## Step 2: Create a machine in the Viam app

1. Go to https://app.viam.com and log in
2. Click **New machine** and name it something like `robot-cell-poc`
3. On the machine's page, click the **Setup** tab
4. You'll see a **Machine cloud credentials** section with an `id` and `secret`
5. **Keep this tab open** — you'll need these values in step 4

---

## Step 3: Clone the repo on the Pi

```bash
cd /home/andrew
git clone https://github.com/andrewaws26/Viam-Staubli-Apera-PLC-Mobile-POC.git
cd Viam-Staubli-Apera-PLC-Mobile-POC
```

---

## Step 4: Configure the machine via the Viam app

Do **NOT** use the local JSON config file. Instead, configure the machine through the Viam app's web UI — this gives you live reconfiguration and cloud sync.

### 4a. Add the module

1. In the Viam app, go to your machine's **Config** tab
2. Switch to **JSON** mode (toggle in the top-right)
3. In the `"modules"` array, add:

```json
{
  "type": "local",
  "name": "plc-sensor-module",
  "executable_path": "/home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC/modules/plc-sensor/run.sh"
}
```

### 4b. Add the sensor component

In the `"components"` array, add:

```json
{
  "name": "plc-monitor",
  "api": "rdk:component:sensor",
  "model": "viam-staubli-apera-poc:monitor:plc-sensor",
  "attributes": {
    "host": "169.168.10.21",
    "port": 502,
    "wheel_diameter_mm": 406.4
  },
  "depends_on": [],
  "service_configs": [
    {
      "type": "data_manager",
      "attributes": {
        "capture_methods": [
          {
            "method": "Readings",
            "capture_frequency_hz": 0.2,
            "additional_params": {}
          }
        ]
      }
    }
  ]
}
```

**Attributes reference:**

| Attribute | Required | Default | Description |
|---|---|---|---|
| `host` | Yes | — | PLC IP address (169.168.10.21 for the Click PLC) |
| `port` | No | 502 | Modbus TCP port |
| `wheel_diameter_mm` | No | 406.4 | Wheel diameter in mm for encoder calculations |
| `offline_buffer_dir` | No | — | Directory for buffering data when cloud sync is unavailable |
| `offline_buffer_max_mb` | No | 50 | Max size in MB for the offline buffer |

### 4c. Add the data manager service

In the `"services"` array, add:

```json
{
  "name": "data-manager",
  "type": "data_manager",
  "attributes": {
    "capture_dir": "/home/andrew/.viam/capture",
    "sync_interval_mins": 0.1,
    "tags": ["robot-cell-monitor"]
  }
}
```

> **Important:** Use `/home/andrew/.viam/capture` as the capture directory, not `/tmp`. Data in `/tmp` is lost on reboot.

4. Click **Save** in the top-right corner

---

## Step 5: Start viam-server on the Pi

Back on the Pi, the Viam app's **Setup** tab shows a command like:

```bash
sudo viam-server -config /etc/viam.json
```

Follow the setup instructions shown in the Viam app to install the config and start the server. The typical flow is:

```bash
# The Viam app provides a one-liner that downloads the config. It looks like:
sudo viam-server --aio-setup <your-machine-id> <your-machine-secret>
```

Alternatively, start it manually:

```bash
viam-server -config /etc/viam.json
```

Watch the logs. You should see the plc-sensor module start and connect to the PLC at 169.168.10.21:502.

If you see errors about the module not starting, check:
- Is `run.sh` executable? (`chmod +x /home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC/modules/plc-sensor/run.sh`)
- Is Python 3.11+ installed? (`python3 --version`)
- Is pymodbus installed in the module's venv?

---

## Step 6: Verify sensor readings in the Viam app

1. In the Viam app, go to your machine's **Control** tab
2. Find the **plc-monitor** sensor component
3. Click **Get Readings**
4. You should see ~100+ fields including:

```json
{
  "connected": true,
  "encoder_count": 12345,
  "encoder_distance_mm": 5028.3,
  "tps_machine_running": true,
  "tps_eject_active": false,
  "production_good_count": 482,
  "production_reject_count": 3,
  "DS1": 100,
  "DS2": 200,
  ...
  "DS25": 0
}
```

The key indicator is `connected: true` — this confirms the Pi is communicating with the Click PLC over Modbus TCP. You should also see live encoder data, TPS machine status, eject system state, production counters, and DS1 through DS25 register values.

---

## Step 7: Test the fault scenario

Prove that the sensor detects a PLC communication failure:

1. **Disconnect the Ethernet cable** from the Click PLC
2. Wait a few seconds for the next reading cycle
3. Go to **Control** tab > **plc-monitor** > **Get Readings**
4. You should see:

```json
{
  "connected": false,
  "encoder_count": 0,
  "encoder_distance_mm": 0,
  "tps_machine_running": false,
  "tps_eject_active": false,
  "production_good_count": 0,
  "production_reject_count": 0,
  "DS1": 0,
  ...
}
```

When the PLC is unreachable, `connected` becomes `false` and all values drop to zero. This is the "pull a wire" demo — disconnect the PLC and watch the dashboard react in real time.

**Reconnect the Ethernet cable** when done testing. Within one or two reading cycles, `connected` should return to `true` and all values should resume.

---

## Step 8: Verify data sync to Viam Cloud

1. In the Viam app, go to the **Data** tab (top navigation)
2. Filter by your machine name
3. You should see timestamped sensor readings appearing every ~5 seconds
4. Each row contains all ~100+ fields from the PLC

This confirms the full pipeline: Click PLC -> Modbus TCP -> plc-sensor -> viam-server -> Viam Cloud.

---

## Troubleshooting

**Module fails to start:**
```bash
# Check if run.sh is executable
ls -la /home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC/modules/plc-sensor/run.sh

# Try running it manually
/home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC/modules/plc-sensor/run.sh --help

# Check if pymodbus installs correctly in the venv
cd /home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC/modules/plc-sensor
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

**Readings show connected=false but PLC should be reachable:**
```bash
# Verify the PLC is powered on and the Ethernet link light is active

# Check that the Pi can reach the PLC subnet
ping -c 3 169.168.10.21

# If ping fails, check the Pi's IP address — it must be on the 169.168.10.x subnet
ip addr show

# Test Modbus TCP connectivity directly
python3 -c "import socket; s = socket.socket(); s.settimeout(3); s.connect(('169.168.10.21', 502)); print('OK'); s.close()"
```

**No data in the Data tab:**
- Check that the `data_manager` service is configured with `capture_dir: /home/andrew/.viam/capture`
- Check that `service_configs` with `capture_methods` is present on the plc-monitor component
- Check viam-server logs for sync errors
- Verify the capture directory exists: `ls -la /home/andrew/.viam/capture`
