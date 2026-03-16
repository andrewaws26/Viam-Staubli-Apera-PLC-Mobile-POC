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

---

## March 15, 2026 — Pi Zero W Deployment, Live Modbus Pipeline, Dashboard Fixes

### Starting Point

The PLC simulator code and the plc-sensor module code were written but not deployed. The dashboard showed three yellow "Pending" cards (PLC, Wire, Robot Arm) and one green card (Vision). The goal was to flash the Pi Zero W, deploy the simulator, connect the plc-sensor module on the Pi 5, and get the PLC indicator green on the dashboard.

### Pi Zero W Setup

The Pi Zero W was flashed with Raspberry Pi OS Lite and connected to the local WiFi network at 192.168.1.74 (`raiv-plc.local` via mDNS). Setup scripts in `pi-zero-setup/` automated the process: install system packages (python3, pip, i2c-tools, libgpiod), clone the repository, create a Python virtual environment with pymodbus, RPi.GPIO, smbus2, adafruit-circuitpython-dht, and install the systemd service.

The PLC simulator starts on boot via `plc-simulator.service`. It binds Modbus TCP to port 502 (using `CAP_NET_BIND_SERVICE` for the privileged port). The GY-521 accelerometer reads via I2C bus 1, the DHT22 reads via GPIO pin 4, and two servos run on PWM pins 12 and 13. The work cycle state machine starts in IDLE and transitions to RUNNING when the Plate Cycle register is set.

### Modbus TCP Working Across Network

The Pi 5 at 192.168.1.89 runs viam-server with the plc-sensor module. The module connects to `raiv-plc.local:502` and reads all Modbus registers every second. The full pipeline was verified: Pi Zero W physical sensors → Modbus register writes → network → Pi 5 Modbus reads → plc_sensor.py decoding → Viam SDK → Viam Cloud → Vercel dashboard.

Register test script (`pi-zero-setup/04-test-registers.sh`) confirmed all 14 sensor registers (100-113) return valid data: vibration X/Y/Z near 0/0/9.81 m/s², temperature ~72°F, humidity ~45%, pressure ~512, servo positions updating during work cycle, system state toggling between idle (0) and running (1).

### plc-sensor Module — Real pymodbus Reads

The plc-sensor module (`modules/plc-sensor/src/plc_sensor.py`) was updated from scaffold to production code using pymodbus. It reads two register blocks per poll: E-Cat cable registers (0-24) for digital I/O states, and sensor data registers (100-113) for analog values. Signed int16 decoding handles accelerometer and gyroscope values that can be negative. Temperature and humidity use `_int16_to_float` with a scale of 10 to handle edge cases where the DHT22 returns values that encode as negative int16. System state and fault codes are decoded from integer register values to human-readable labels ("idle", "running", "fault", "e-stopped").

### Dashboard — Live PLC Data

The dashboard component name was updated from `plc-sensor` to `plc-monitor` to match the Viam component instance name. The PLC detail panel displays decoded sensor values directly from the plc-sensor module's named keys: system state, cycle count, temperature (°F), humidity (%), vibration X/Y/Z (m/s²), pressure, servo positions (°), and last fault. The PLC card health logic is: green/OK when `connected === true && fault === false`, red/FAULT when fault is true, yellow/PENDING when the component isn't reachable.

Data decoding bugs were fixed:
- **Signed int16 handling:** The simulator's Modbus server now encodes temperature and humidity using the same `_float_to_int16` function as vibration/gyro, ensuring consistent unsigned int16 encoding. The reader uses `_int16_to_float` for decoding. This prevents negative values from appearing when raw register values cross the signed/unsigned boundary.
- **zero_mode=True:** Added explicit `zero_mode=True` to the Modbus server's `ModbusSlaveContext` to eliminate address offset ambiguity between pymodbus versions.
- **Dashboard field mapping:** The dashboard detail panel now uses the correct named keys from plc_sensor.py (`system_state`, `cycle_count`, `temperature_f`, `humidity_pct`, etc.) instead of raw register keys.

### Current State

Three of four dashboard cards are green:
- **Vision System:** OK — pinging 8.8.8.8:53
- **PLC / Controller:** OK — live Modbus data from Pi Zero W
- **Wire / Connection:** OK — derived from PLC connected state
- **Robot Arm:** Pending — hardware not available

The PLC detail panel shows live sensor data updating every 2 seconds. The full digital twin pipeline is working: physical sensors on the Pi Zero W → Modbus TCP → Pi 5 plc-sensor module → Viam Cloud → Vercel dashboard.

---

## March 16, 2026 — Shop Network Migration, Push Button Integration, E-Cat Signal Dashboard

### Starting Point

Three of four dashboard cards were green. The system was running on a home network (192.168.1.x). The PLC simulator was deployed to the Pi Zero W but had no physical push button wired. The dashboard showed PLC sensor data but not the individual E-Cat cable signals. Some data values displayed incorrectly (negative humidity, -1 system state, negative cycle count) due to signed int16 interpretation issues in the Modbus data pipeline.

### Shop Network Deployment

The system was moved from the home network to the shop network (192.168.0.x). The Pi 5 is now at 192.168.0.172 and the Pi Zero W at 192.168.0.173. All hardcoded IP addresses in the pi-zero-setup scripts were replaced with configurable hostname defaults (`raiv-plc.local` via mDNS) with environment variable overrides (`RAIV_PLC_SSH`). The robot-arm-sensor default host was changed from a hardcoded IP to `raiv-cs9.local`. The viam-server.json config already used `raiv-plc.local` for the PLC simulator.

### Push Button Wiring and Integration

A Fuji AR22F0L E3 industrial push button — the same model used on the RAIV trucks — was wired to the Pi Zero W via a Keyestudio T-cobbler breakout board on a breadboard:

- Contact block terminal 3 → GPIO 17 (via T-cobbler)
- Contact block terminal 4 → GND (via T-cobbler)
- Contact type: Normally Open (NO)
- Behavior: Pressing the button closes the circuit, pulling GPIO 17 LOW

The PLC simulator was updated to handle this button:

1. **GPIO 17 reconfigured**: Previously used for E-stop (with pull-down), now used for the push button with an internal pull-up resistor enabled. The E-stop was moved to GPIO 27.
2. **50ms debounce**: Edge detection callback registered with `bouncetime=50` to reject contact bounce from the industrial switch.
3. **Register 2 (Plate Cycle)**: Set to 1 when button is pressed (GPIO LOW), 0 when released (GPIO HIGH).
4. **Coil 0 (button_state)**: Set to True when pressed, False when released.
5. **Work cycle trigger**: Pressing the button calls `work_cycle.trigger_start()`, which transitions the state machine from IDLE to RUNNING.
6. **Timestamped logging**: Every press and release is logged with the GPIO state, register values, and coil state.

### E-Cat GPIO Simulation

The PLC simulator now supports physical GPIO inputs for E-Cat registers 0-24. A configuration map in `config.yaml` (`ecat_gpio_pins`) maps register numbers to GPIO BCM pins. Currently only register 2 (Plate Cycle) is wired to GPIO 17. The GPIO reader runs at 50ms polling intervals. For any pin that is physically wired, if the wire is disconnected, the pull-down resistor ensures the corresponding register reads 0. Registers without physical GPIO pins retain their simulated values.

### PLC Sensor Module — E-Cat Signal Names and Robust Decoding

The plc-sensor module was updated with consistent E-Cat signal naming matching the 25-pin cable pinout:

- Registers 0-8: `servo_power_on`, `servo_disable`, `plate_cycle`, `abort_stow`, `speed`, `gripper_lock`, `clear_position`, `belt_forward`, `belt_reverse`
- Registers 9-17: `lamp_servo_power` through `lamp_belt_reverse`
- Registers 18-24: `emag_status`, `emag_on`, `emag_part_detect`, `emag_malfunction`, `poe_status`, `estop_enable`, `estop_off`

A `_uint16()` function was added to ensure all Modbus register values are treated as unsigned 16-bit integers regardless of the pymodbus version. This fixes the signed int16 interpretation bugs that caused negative values for humidity, cycle count, and system state.

The module now reads Modbus coil 0 for button state and returns it as `"pressed"` or `"released"` instead of True/False.

Connection failure handling was improved: 2-second timeout, returns all register values as 0 with `connected: false` and `fault: true` on failure. Automatic reconnection on the next poll cycle.

### Dashboard — E-Cat Signal Status Grid

The PlcDetailPanel was split into two sections:

1. **PLC Sensor Data — Live**: The existing panel showing temperature, humidity, vibration, pressure, servo positions, cycle count, system state, button state, and last fault.
2. **E-Cat Signal Status**: A new 25-signal grid showing each pin of the E-Cat cable with a green dot (value = 1) or red dot (value = 0), labeled with the signal name and pin number.

### Dashboard — E-Cat Signal Fault/Recovery Logging

The dashboard now tracks the previous state of all 25 E-Cat signals between poll cycles. When any signal drops from 1 to 0, a fault event is logged: `"E-Cat Signal Lost — Servo Power ON (Pin 1)"`. When a signal returns from 0 to 1, a recovery event is logged: `"E-Cat Signal Restored — Servo Power ON (Pin 1)"`. Recovery events are displayed in green in the fault history panel to distinguish them from fault events (red).

### Data Decoding Bug Fixes

The signed int16 decoding issues were traced through the full pipeline:

1. **Root cause**: Some pymodbus versions return holding register values as signed int16 (-32768 to 32767) instead of unsigned (0 to 65535). This caused cycle count 0 to appear as -5, system state 0 as -1, and humidity 450 as negative.
2. **Fix — plc_sensor.py**: Added `_uint16()` function that masks all register values with `& 0xFFFF` to guarantee unsigned interpretation before any decoding.
3. **Fix — status_api.py**: Same `_uint16()` function applied to all register reads.
4. **Verification**: The `_int16_to_float()` function correctly handles the signed→unsigned→float conversion for scaled values (vibration, temperature, humidity). Raw integer values (cycle count, system state, servo positions) are now guaranteed to be non-negative.

### Code Cleanup

- All pi-zero-setup scripts: Replaced hardcoded `andrew@192.168.1.74` with `${RAIV_PLC_SSH:-andrew@raiv-plc.local}` environment variable with hostname default.
- `config/viam-server.json`: Robot arm host changed from `192.168.1.10` to `raiv-cs9.local`.
- `modules/robot-arm-sensor/src/robot_arm_sensor.py`: Default host changed from `192.168.1.10` to `raiv-cs9.local`.
- Status API: E-Cat signal names updated to match the plc-sensor module naming convention.
- Mock data: Updated to include all 25 E-Cat signals for demo mode.

### Current State

Three of four dashboard cards are green:
- **Vision System:** OK — pinging 8.8.8.8:53
- **PLC / Controller:** OK — live Modbus data from Pi Zero W at 192.168.0.173
- **Wire / Connection:** OK — derived from PLC connected state
- **Robot Arm:** Pending — hardware not available

The dashboard now shows:
- PLC sensor data panel with temperature, humidity, vibration, pressure, servos, cycle count, system state, button state
- E-Cat signal status grid with 25 green/red indicators
- Fault history with E-Cat signal loss/recovery events color-coded
- Industrial push button state ("pressed" / "released")

Full pipeline: Fuji AR22F0L button → GPIO 17 → Pi Zero W PLC simulator → Modbus TCP → Pi 5 plc-sensor module → Viam Cloud → Vercel dashboard.
