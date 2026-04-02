# Fleet Onboarding: Adding a New Truck

Step-by-step guide for adding a new truck to the IronSight fleet.

## Prerequisites

- Raspberry Pi Zero 2 W with Waveshare CAN HAT (B) or SPI CAN HAT (MCP2515)
- MicroSD card (32 GB+) with Raspberry Pi OS Lite (64-bit)
- Access to the Viam organization at app.viam.com
- Tailscale account for remote access
- The truck's OBD-II port (J1939 pins 3/11 for heavy trucks, standard OBD-II for passenger)

## Step 1: Set Up the Pi Zero Hardware

1. Flash Raspberry Pi OS Lite (64-bit) to the SD card.
2. Enable SPI in `/boot/firmware/config.txt`:
   ```
   dtparam=spi=on
   dtoverlay=mcp2515-can0,oscillator=12000000,interrupt=25,spimaxfrequency=2000000
   ```
   Adjust `oscillator` to match your CAN HAT crystal (12 MHz for Waveshare, 8 MHz for some MCP2515 boards).
3. Connect the CAN HAT to the Pi GPIO header.
4. Wire CAN_H and CAN_L to the truck's OBD-II port:
   - **J1939 (heavy trucks):** Pin 3 = CAN_H, Pin 11 = CAN_L (250 kbps)
   - **OBD-II (passenger):** Pin 6 = CAN_H, Pin 14 = CAN_L (500 kbps)
5. Add a 120-ohm termination resistor between CAN_H and CAN_L if the bus needs it.

## Step 2: Install and Configure viam-server

1. SSH into the Pi and install viam-server:
   ```bash
   curl https://storage.googleapis.com/packages.viam.com/apps/viam-server/viam-server-stable-aarch64.AppImage -o /usr/local/bin/viam-server
   chmod +x /usr/local/bin/viam-server
   ```
2. In the Viam app (app.viam.com):
   - Go to your organization and location.
   - Click "Add machine" and name it (e.g., `truck-042-diagnostic`).
   - Copy the setup command from the "Setup" tab and run it on the Pi.
   - This creates `/etc/viam.json` with the machine credentials and Part ID.
3. Verify viam-server starts:
   ```bash
   sudo systemctl status viam-server
   ```

## Step 3: Clone the Repo and Configure the Module

1. Clone the repository on the Pi:
   ```bash
   cd /home/andrew
   git clone <repo-url> repo
   cd repo
   ```
2. Install Python dependencies:
   ```bash
   pip3 install -r modules/j1939-sensor/requirements.txt
   ```
3. In the Viam app, add the sensor component to the machine config:
   - Component name: `truck-engine`
   - API: `rdk:component:sensor`
   - Model: (your module namespace, e.g., `ironsight:sensor:j1939`)
   - Point the module executable to `/home/andrew/repo/modules/j1939-sensor/run.sh`

4. Enable data capture on the `truck-engine` component:
   - Method: `Readings`
   - Frequency: 1 Hz
   - Sync interval: 0.1 min (6 seconds)
   - Tags: `truck-diagnostics`, `ironsight`

**Config note:** Use the `api` field only. Do NOT include `type`/`namespace`
alongside `api` on components or services -- Viam rejects the combination.

## Step 4: Get the Part ID

The Part ID uniquely identifies this machine for Data API queries.

**Option A -- from the Pi:**
```bash
cat /etc/viam.json | python3 -c "import sys,json; print(json.load(sys.stdin)['cloud']['id'])"
```

**Option B -- from the Viam app:**
1. Open the machine in app.viam.com.
2. Go to the "Config" tab.
3. The Part ID is shown in the machine details (or in the JSON config under `cloud.id`).

Record this Part ID -- you will need it in the next step.

## Step 5: Add the Truck to the Dashboard

### Current setup (single truck)

Set the following env var in Vercel (or `.env.local` for dev):
```
TRUCK_VIAM_PART_ID=<part-id-from-step-4>
```

If the truck also needs direct commands (DTC clear, PGN requests), add:
```
TRUCK_VIAM_MACHINE_ADDRESS=<machine-cloud-address>
TRUCK_VIAM_API_KEY=<machine-api-key>
TRUCK_VIAM_API_KEY_ID=<machine-api-key-id>
```

### Future setup (30+ trucks)

The dashboard will need a truck registry -- a database table or config file
mapping truck identifiers to their Part IDs:

```json
{
  "trucks": [
    {
      "id": "truck-001",
      "name": "Mack #42",
      "partId": "ca039781-665c-47e3-9bc5-35f603f3baf1",
      "machineAddress": "truck-042-diagnostic.abc123.viam.cloud",
      "protocol": "j1939"
    },
    {
      "id": "truck-002",
      "name": "Altima (test)",
      "partId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "machineAddress": "truck-altima.abc123.viam.cloud",
      "protocol": "obd2"
    }
  ]
}
```

The org-level API key (`VIAM_API_KEY` / `VIAM_API_KEY_ID`) can query
`exportTabularData` for ANY Part ID in the organization, so a single key
covers all trucks for data reads. Machine-level keys are only needed for
`do_command` (DTC clear, etc.).

## Step 6: Verify Data Is Flowing

1. **On the Pi**, check viam-server logs:
   ```bash
   sudo journalctl -u viam-server -f
   ```
   Look for `truck-engine` readings being captured.

2. **In the Viam app**, go to the machine's "Data" tab. You should see
   sensor readings appearing within 10 seconds of capture.

3. **On the dashboard**, navigate to the truck diagnostics panel. The
   gauges should populate with live data. Check the history endpoint:
   ```
   GET /api/truck-history?hours=1
   ```
   This should return time-series data with the new truck's readings.

## Step 7: Set Up Networking (Optional)

For field deployment away from WiFi:

1. Install Tailscale on the Pi for remote access.
2. Configure WiFi priorities via NetworkManager:
   ```bash
   # Field hotspot from Pi 5 (highest priority)
   nmcli connection modify "IronSight-Truck" connection.autoconnect-priority 200
   # Home/shop WiFi (fallback)
   nmcli connection modify "Shop-WiFi" connection.autoconnect-priority 100
   ```
3. The Pi 5 on the same truck provides a WiFi hotspot (`IronSight-Truck`)
   when cellular is connected. The Pi Zero auto-connects to it.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| No CAN data | `candump can0` -- if silent, check wiring and termination |
| viam-server won't start | `sudo journalctl -u viam-server -n 50` for errors |
| Data not syncing | Check WiFi: `nmcli`, check Tailscale: `tailscale status` |
| Dashboard shows no data | Verify `TRUCK_VIAM_PART_ID` matches `/etc/viam.json` |
| Wrong protocol detected | Module auto-detects; check `_protocol` field in readings |
| Pi Zero OOM | Normal at 512 MB; don't run extra services. Viam-server alone is fine |
