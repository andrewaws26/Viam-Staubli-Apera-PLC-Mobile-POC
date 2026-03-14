# Deploying the Vision Health Sensor on Raspberry Pi 5

This guide walks through deploying the vision-health-sensor module on a Raspberry Pi 5 running Raspberry Pi OS, connecting it to Viam Cloud, and seeing live sensor readings in the Viam app.

**Time required:** ~20 minutes

**What you'll prove:** The full data pipeline works end-to-end. A sensor on the Pi reads data, Viam syncs it to the cloud, and you see live readings in a browser.

---

## Prerequisites

- Raspberry Pi 5 running Raspberry Pi OS (64-bit, Bookworm)
- Pi connected to the internet via Wi-Fi or Ethernet
- SSH access to the Pi (or a keyboard/monitor attached)
- A free Viam account at https://app.viam.com

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
cd /home/pi
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
  "name": "vision-health-sensor-module",
  "executable_path": "/home/pi/Viam-Staubli-Apera-PLC-Mobile-POC/modules/vision-health-sensor/run.sh"
}
```

### 4b. Add the sensor component

In the `"components"` array, add:

```json
{
  "name": "vision-health-monitor",
  "api": "rdk:component:sensor",
  "model": "viam-staubli-apera-poc:monitor:vision-health-sensor",
  "attributes": {
    "host": "8.8.8.8",
    "port": 53
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

**What this does:**
- `host: 8.8.8.8` — Google's public DNS server (always responds to ping and TCP:53)
- `port: 53` — DNS port (always listening)
- `capture_frequency_hz: 0.2` — captures one reading every 5 seconds

### 4c. Add the data manager service

In the `"services"` array, add:

```json
{
  "name": "data-manager",
  "type": "data_manager",
  "attributes": {
    "capture_dir": "/tmp/viam-data",
    "sync_interval_mins": 0.1,
    "tags": ["robot-cell-monitor"]
  }
}
```

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

Watch the logs. You should see:

```
info  vision-health-sensor-module  VisionHealthSensor configured: host=8.8.8.8 port=53
```

If you see errors about the module not starting, check:
- Is `run.sh` executable? (`chmod +x modules/vision-health-sensor/run.sh`)
- Is Python 3.11+ installed? (`python3 --version`)
- Can the Pi reach the internet? (`ping 8.8.8.8`)

---

## Step 6: Verify sensor readings in the Viam app

1. In the Viam app, go to your machine's **Control** tab
2. Find the **vision-health-monitor** sensor component
3. Click **Get Readings**
4. You should see:

```json
{
  "connected": true,
  "process_running": true
}
```

Both values should be `true` because `8.8.8.8` responds to both ICMP ping and TCP connections on port 53.

---

## Step 7: Test the fault scenario

Now prove that the sensor detects a failure. In the Viam app **Config** tab (JSON mode), change the host to a non-existent IP:

```json
"attributes": {
  "host": "192.168.1.254",
  "port": 12345
}
```

Save the config. Wait a few seconds for viam-server to reconfigure. Then check **Control** > **Get Readings** again:

```json
{
  "connected": false,
  "process_running": false
}
```

Both values flip to `false`. This is the "pull a wire" demo — change the target from reachable to unreachable and watch the dashboard react.

Change it back to `8.8.8.8` / `53` when done testing.

---

## Step 8: Verify data sync to Viam Cloud

1. In the Viam app, go to the **Data** tab (top navigation)
2. Filter by your machine name
3. You should see timestamped sensor readings appearing every ~5 seconds
4. Each row shows `connected` and `process_running` values

This confirms the full pipeline: Pi sensor -> viam-server -> Viam Cloud.

---

## Test targets reference

| Target | Host | Port | Expected result | Use case |
|---|---|---|---|---|
| Google DNS | `8.8.8.8` | `53` | connected=true, process_running=true | Verify pipeline works |
| Non-existent IP | `192.168.1.254` | `12345` | connected=false, process_running=false | Verify fault detection |
| Your router | `192.168.1.1` | `80` | connected=true, process_running=varies | Test local network |
| Apera server (real) | TBD | TBD | Depends on hardware state | Production use |

---

## Troubleshooting

**Module fails to start:**
```bash
# Check if run.sh is executable
ls -la /home/pi/Viam-Staubli-Apera-PLC-Mobile-POC/modules/vision-health-sensor/run.sh

# Try running it manually
/home/pi/Viam-Staubli-Apera-PLC-Mobile-POC/modules/vision-health-sensor/run.sh --help

# Check if viam-sdk installs correctly
cd /home/pi/Viam-Staubli-Apera-PLC-Mobile-POC/modules/vision-health-sensor
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

**Readings show connected=false but Pi has internet:**
```bash
# ICMP might be blocked. Test manually:
ping -c 1 8.8.8.8

# If ping is blocked, the sensor still works — process_running will be true
# (TCP probe is independent of ICMP)
```

**No data in the Data tab:**
- Check that the `data_manager` service is configured
- Check that `service_configs` with `capture_methods` is on the component
- Check viam-server logs for sync errors
