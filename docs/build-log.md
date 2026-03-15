# Build Log

A chronological record of what was built and the reasoning behind each decision.

## March 14, 2026 -- First Hardware Deployment

### Starting Point

The repository contained architecture documentation, three sensor module scaffolds, Viam configuration files, and a Next.js dashboard that ran only in mock mode. Nothing had been deployed to real hardware. The goal for the day was to prove the full pipeline: sensor on a Raspberry Pi reads a target, viam-server pushes data to Viam Cloud, and a browser dashboard displays live status.

### Phase 1: System Setup

#### Operating System and viam-server

The Pi 5 was running Raspberry Pi OS Lite 64-bit (aarch64). The first step was a full system update, then installing viam-server. Viam distributes viam-server as a single AppImage binary for aarch64. It was downloaded directly from Viam's package storage and placed in `/usr/local/bin/`. No package manager installation was needed. Version 0.116.0 was current at the time.

A systemd unit file was created to run viam-server on boot. This matters because the Pi will be unattended in a production setting. If it loses power and restarts, viam-server needs to come back up automatically.

#### Repository and Python Environment

The repository was cloned from GitHub. A Python virtual environment was created and the Viam Python SDK (v0.71.1) was installed. The requirements.txt at the repo root lists only `viam-sdk>=0.69.0` because the sensor modules are pure Python with no hardware-specific dependencies until real PLC/robot hardware is connected.

### Phase 2: Connecting to Viam Cloud

#### Machine Registration

A machine named "staubli-pi" was created in app.viam.com under Andrew's organization. The Viam app provides machine cloud credentials (a part ID and secret) which get saved to `/etc/viam.json` on the Pi. When viam-server starts with this config, it phones home to Viam Cloud and establishes a persistent connection. The machine showed "Live" in the Viam app within seconds.

#### API Key Generation

The machine cloud credentials (part ID + secret) authenticate viam-server to the cloud. But the browser-based dashboard needs a separate API key to connect via the TypeScript SDK. An API key with Operator role was created through the Viam app's Connect > API Keys page. This distinction matters: the machine credentials are for the server process, the API key is for client applications.

### Phase 3: Deploying the Vision Health Sensor

#### Why Vision Health First

The vision-health-sensor was the only module that could run without real industrial hardware. It performs two checks against any IP:port target: an ICMP ping (is the host reachable?) and a TCP connection attempt (is a service listening?). By pointing it at Google's DNS server (8.8.8.8 port 53), we get a target that is always reachable and always listening. This lets us prove the entire pipeline without waiting for shop floor hardware.

#### Module Deployment

The module files were copied from the repo to `/opt/viam-modules/vision-health-sensor/`. A Python virtual environment was pre-created inside the module directory so viam-server would not need to create one on first launch. The `run.sh` entry point script handles venv creation if it does not exist, but pre-creating it avoids a slow first start.

The module was registered in the Viam app's JSON configuration with two blocks: one declaring the module (name, executable path, type=local) and one declaring the sensor component (name "vision-health", API "rdk:component:sensor", model matching the module's meta.json, and attributes specifying host and port).

#### Verification

After saving the config in the Viam app, viam-server reloaded automatically. The Control tab showed a sensor component called "vision-health" with Get Readings returning `{"connected": true, "process_running": true}`. Both checks passed because 8.8.8.8 responds to ping and accepts TCP connections on port 53.

### Phase 4: Connecting the Dashboard

#### The Problem

The dashboard was built to run in two modes: mock mode (simulated data, no hardware) and live mode (real Viam Cloud connection). Mock mode worked. Live mode had never been tested because there was no deployed machine to connect to.

#### What Needed to Change

Several things were wrong in the existing code:

**Component name mismatch.** The dashboard's `sensors.ts` mapped the vision sensor to `"vision-health-monitor"` but the actual Viam component was named `"vision-health"`. This name must match exactly. The other two sensor names were also updated to match the naming convention we planned for them.

**SDK credential format.** The Viam TypeScript SDK v0.34.0 expects `authEntity` inside the `credentials` object, not as a separate top-level parameter. The existing code had it at the top level, which compiled fine but would fail at runtime. This was caught during the build step.

**TypeScript target.** The `tsconfig.json` had no `target` specified. The code used `[...set]` (spreading a Set into an array), which requires ES2015 or higher. Adding `"target": "es2017"` fixed the build error.

**No handling for missing components.** When the dashboard polls a sensor that does not exist on the machine, the Viam SDK throws an error. The original code treated all errors as connection failures, showing red "FAULT" cards. This is misleading. The fix was to add a `ComponentNotFoundError` class that catches SDK errors containing "not found", "unknown", or similar messages, and map those to a new "pending" status. Pending components show as yellow cards with "Not configured in Viam yet" instead of false fault alarms.

**WebRTC signaling.** The browser SDK connects to viam-server via WebRTC, negotiated through Viam Cloud. The initial connection attempt hung silently because the signaling address was not specified. Adding `signalingAddress: "https://app.viam.com:443"` to the `createRobotClient` call fixed this. A `reconnectMaxAttempts: 3` was also added so failed connections would surface errors instead of hanging indefinitely.

#### The Result

After these fixes, the dashboard showed:
- Vision System: green "OK" with live readings polling every 2 seconds
- Robot Arm: yellow "Pending"
- PLC / Controller: yellow "Pending"
- Wire / Connection: yellow "Pending"
- Header: green "Viam Connected"
- Footer: "Live -- Viam Cloud"

The Vision System card updates every 2 seconds with fresh data from the real sensor on the Pi. The connection goes from the browser, through Viam Cloud's WebRTC signaling, to viam-server on the Pi, which queries the vision-health-sensor module, which pings 8.8.8.8 and probes TCP port 53.

---

## March 15, 2026 -- Vercel Deployment, Power Cycle Test, Production Readiness

### Starting Point

The system was live on the Pi with one sensor returning real data and the dashboard running locally via `npm run dev`. The goal for the day was to move the dashboard to a production deployment, prove the system survives a power cycle, and clean up everything for public presentation.

### Deploying the Dashboard to Vercel

#### Why Vercel Instead of Running on the Pi

The dashboard was running on the Pi as a Next.js dev server. This worked for testing but had three problems. First, the Pi's purpose is to run viam-server and sensor modules. Running a Node.js dev server alongside it wastes resources and adds a failure mode. Second, the dev server is not a production build. It is slower, has no caching, and recompiles on each request. Third, the dashboard should be accessible even when the Pi is down. If the Pi loses power, the dashboard should still load and show the disconnected state rather than failing to load entirely.

Vercel solves all three. The dashboard builds to static files, deploys to a CDN, and loads instantly from any browser anywhere. The Pi only needs to run viam-server. The dashboard connects to the Pi through Viam Cloud, so the architecture is the same. The only difference is where the browser loads the HTML and JavaScript from.

#### The Build Fix

The production build (`npm run build`) failed on Vercel with a TypeScript error: `Type 'Set<string>' can only be iterated through when using the '--downlevelIteration' flag or with a '--target' of 'es2015' or higher.` The local build on the Pi had passed because the local TypeScript version handled this differently. The `tsconfig.json` already had `"target": "es2017"` from the previous day's fix, but Vercel's build environment still triggered the error. Adding `"downlevelIteration": true` to `tsconfig.json` fixed it. This is a belt-and-suspenders fix. The target should be sufficient, but the explicit flag ensures compatibility across build environments.

#### Environment Variables

The Vercel deployment needed the same environment variables that the local `.env.local` provided. Four variables were configured in the Vercel project settings: `NEXT_PUBLIC_MOCK_MODE=false`, the machine address, the API key ID, and the API key. These are embedded in the client bundle at build time since they use the `NEXT_PUBLIC_` prefix. For a POC this is acceptable. For production, credentials should be proxied through a server-side API route.

### The Power Cycle Test

This was the most important test of the day. The question was simple: if the Pi loses power unexpectedly, does everything come back automatically?

The test procedure was to open the Vercel-hosted dashboard in a browser, confirm the Vision System showed green OK, then physically unplug the Pi's power cable. Within seconds the dashboard detected the lost connection. The Vision System indicator turned red with a fault alarm. The audible klaxon fired. The alert banner appeared. This proved that the dashboard correctly detects and reports a machine going offline.

After plugging the Pi back in, viam-server started automatically via the systemd service. It re-established its connection to Viam Cloud. The dashboard detected the restored connection and the Vision System indicator returned to green OK. No manual intervention was needed at any step.

This test was more dramatic and more realistic than the planned wire pull demo. In a factory setting, power interruptions are a real failure mode. The fact that the entire system recovers automatically from a cold restart proves the systemd service configuration is correct and the Viam Cloud reconnection logic works.

### SSH Key Authentication

SSH key authentication was configured for passwordless access to the Pi. An ed25519 key pair was generated on the Pi and the public key was added to the GitHub account. This enables `git push` from the Pi without entering credentials. A separate SSH key was already in `authorized_keys` for remote access from the development machine.

### Data Capture Configuration

The data_manager service was configured in the Viam app to capture sensor readings and sync them to Viam Cloud. The vision-health sensor captures readings at 0.2 Hz (one every 5 seconds) and syncs to the cloud every 6 seconds. This means historical readings are available in the Viam app's Data tab even when the dashboard is not open. The data_manager service runs inside viam-server and requires no additional infrastructure.

### Documentation Overhaul

All project documentation was rewritten to reflect the actual deployed state. The README was updated with the current module status, dashboard status, and deployment details. The architecture document got a new section mapping every planned component to its actual implementation state. The technical overview was expanded with new sections on the Vercel deployment decision and lessons learned. A demo guide was written with the exact procedure for the power cycle demo.

### Architecture Decisions Made Today

#### Why the Dashboard Does Not Run on the Pi

This decision deserves its own explanation because it might seem counterintuitive. The Pi is on the same network as the sensor hardware. Running the dashboard there would mean shorter network paths and no dependency on external hosting. But the dashboard is for remote monitoring. Its entire purpose is to be accessed from somewhere other than the factory floor. Hosting it on the Pi means it goes down when the Pi goes down, which is exactly when you most need to know something is wrong.

Hosting on Vercel means the dashboard is always available. When the Pi is down, the dashboard loads normally and shows the disconnected/fault state. The user sees the problem. If the dashboard were hosted on the Pi, the user would see a browser connection timeout and would not know if the Pi is down, the network is down, or the dev server crashed.

#### Why the API Key Is in the Client Bundle

The Viam API key is embedded in the Next.js client bundle via `NEXT_PUBLIC_` environment variables. This is visible to anyone who opens browser dev tools. For this POC the key has Operator role, which allows reading sensor data but not reconfiguring the machine. The risk is low and the simplicity gain is high. The alternative would be a Next.js API route that proxies SDK calls, keeping the key server-side. That would be the right approach for a production deployment.

### What Comes Next

#### Shop Hardware Integration

The three pending sensors need real hardware. The PLC sensor needs a Modbus register map. The robot arm sensor needs protocol confirmation. The vision health sensor needs the real Apera server IP and port. Each of these is a configuration change in the Viam app, not a code change.

#### GPIO Phase (Robot Car)

A mobile robot car controlled via GPIO will be added as a physical demonstration platform. This adds a second Viam machine with motors and GPIO-controlled components, proving that Viam can manage both monitoring and actuation.

#### Remaining Production Items

Viam Triggers for email/Slack alerting on faults. Grafana for historical trend analysis using the data already being captured by the data_manager service.

---

## March 15, 2026 — Phase 1 Build: PLC Simulator + Full Digital Twin Pipeline

### Starting Point

The system had one live sensor (vision-health) and three pending indicators. The PLC sensor module was scaffold-only, returning placeholder values. There was no physical PLC to connect to. The goal was to build a complete PLC simulation on a Pi Zero W that mirrors the real RAIV truck's Click PLC, connect it to the existing Viam infrastructure, and light up the PLC indicator on the dashboard.

### What Was Built

#### PLC Simulator (plc-simulator/)

A standalone Python application for the Pi Zero W that simulates the Click PLC. This is NOT a Viam module — the Pi Zero W does not run Viam. It is a pure Modbus TCP server that exposes the same register map as the real PLC on the truck.

**Modbus Register Map.** The register layout mirrors the real RAIV truck's 25-pin E-Cat cable pinout. Registers 0-8 are command signals (Servo Power ON, Plate Cycle, Abort/Stow, etc.) that can be written by a remote operator. Registers 9-17 are status lamp feedback. Registers 18-24 are system state (E-Mag, POE, E-stop). Registers 100-113 are sensor data: accelerometer X/Y/Z, gyroscope X/Y/Z, temperature, humidity, pressure, servo positions, cycle count, system state, and fault codes.

**Physical Sensors.** The simulator reads a GY-521 (MPU6050) accelerometer/gyroscope via I2C for vibration monitoring and a DHT22 for temperature and humidity via GPIO. The potentiometer is simulated in software because the Pi Zero W has no ADC — the real Click PLC has built-in analog inputs.

**Servo Actuators.** Two SG90 micro servos on PWM GPIO pins simulate the grinder head positioning (sweeps 0-180°) and clamp actuator (opens to 90°, holds, closes to 0°). These run through an automated work cycle state machine.

**Work Cycle State Machine.** IDLE → RUNNING → loops. The cycle runs servo sweeps and clamp actuation while polling sensors and checking fault conditions. Faults (vibration, temperature, pressure thresholds) halt the cycle and set fault registers. E-stop GPIO interrupt immediately stops all servos.

**Fault Detection.** Configurable thresholds in config.yaml for vibration magnitude, temperature max, and pressure minimum. The fault monitor runs continuously during the work cycle. 25 unit tests cover the fault detection logic and register encoding.

**Hardware-Independent.** The simulator detects missing GPIO/I2C/DHT libraries and falls back to simulated sensor values. This means it runs fine on any machine for testing the Modbus interface without Pi hardware.

#### PLC Sensor Module Update (modules/plc-sensor/)

The existing scaffold was replaced with a real Modbus TCP implementation using pymodbus. The module connects to the Pi Zero W (or any Modbus TCP host), reads all 25 E-Cat cable registers and 14 sensor data registers, decodes signed int16 values back to floats, and returns a structured dict with human-readable keys. The host and port are configurable via Viam component attributes.

#### Status API (api/)

A lightweight Flask HTTP server that runs on the Pi 5. It reads PLC state directly via Modbus TCP and exposes it as JSON at `/status` and `/health`. This serves the Matrix Portal S3 LED display and any other HTTP client. Deployed as a systemd service.

#### Matrix Portal S3 Display (display/)

CircuitPython code for the Adafruit Matrix Portal S3 driving a 64x32 RGB LED matrix. Connects to WiFi, polls the status API every second, and renders 6 colored status blocks: GRINDER (vibration), CLAMP (servo state), TEMP (temperature), PRESSURE (pressure), NETWORK (connectivity), POWER (POE status). Scrolls fault messages along the bottom rows when a fault is active.

#### Dashboard Update

The Vercel dashboard was updated to handle the richer PLC sensor data. The PLC health check now considers system_state and last_fault in addition to connected/fault. A new PlcDetailPanel component shows live sensor data (vibration, temperature, humidity, servo positions, cycle count, system state) below the status grid. The mock mode was updated to return realistic PLC data for demos.

#### Viam Server Configuration

Updated config/viam-server.json to point the plc-sensor at `raiv-plc.local:502`, set data capture at 1 Hz for PLC readings, added a Pi camera component, and tagged the data manager for the digital twin use case.

### Architecture Decisions

**Why a separate Pi Zero W instead of simulating on the Pi 5.** The real architecture has the PLC on a separate device communicating via Modbus TCP over the network. Running the simulator on a separate Pi preserves this boundary and proves the Modbus TCP integration works across a real network. It also means the Pi 5 runs exactly the same code it will run when connected to the real Click PLC.

**Why Flask instead of FastAPI for the status API.** Flask is simpler, has no async complexity, and the API has exactly two endpoints with no concurrent load. FastAPI's async advantages are not needed here.

**Why the register map mirrors the real E-Cat cable.** When the real PLC is connected, the plc-sensor module's code does not change. The register addresses are the same. The only config change is the IP address in the Viam app.

### What Comes Next

1. Flash the Pi Zero W, wire the hardware, and boot the PLC simulator.
2. Deploy the updated plc-sensor module to the Pi 5.
3. Deploy the status API on the Pi 5.
4. Copy the display code to the Matrix Portal S3.
5. Verify the full pipeline: Pi Zero W sensors → Modbus registers → Pi 5 plc-sensor → Viam Cloud → Vercel dashboard.
6. The PLC indicator on the dashboard should flip from yellow Pending to green OK.
