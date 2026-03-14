# Build Log

A chronological record of what was built on March 14, 2026, and the reasoning behind each decision.

## Starting Point

The repository contained architecture documentation, three sensor module scaffolds, Viam configuration files, and a Next.js dashboard that ran only in mock mode. Nothing had been deployed to real hardware. The goal for the day was to prove the full pipeline: sensor on a Raspberry Pi reads a target, viam-server pushes data to Viam Cloud, and a browser dashboard displays live status.

## Phase 1: System Setup

### Operating System and viam-server

The Pi 5 was running Debian Trixie (aarch64). The first step was a full system update, then installing viam-server. Viam distributes viam-server as a single AppImage binary for aarch64. It was downloaded directly from Viam's package storage and placed in `/usr/local/bin/`. No package manager installation was needed. Version 0.116.0 was current at the time.

A systemd unit file was created to run viam-server on boot. This matters because the Pi will be unattended in a production setting. If it loses power and restarts, viam-server needs to come back up automatically.

### Repository and Python Environment

The repository was cloned from GitHub. A Python virtual environment was created and the Viam Python SDK (v0.71.1) was installed. The requirements.txt at the repo root lists only `viam-sdk>=0.69.0` because the sensor modules are pure Python with no hardware-specific dependencies until real PLC/robot hardware is connected.

## Phase 2: Connecting to Viam Cloud

### Machine Registration

A machine named "staubli-pi" was created in app.viam.com under Andrew's organization. The Viam app provides machine cloud credentials (a part ID and secret) which get saved to `/etc/viam.json` on the Pi. When viam-server starts with this config, it phones home to Viam Cloud and establishes a persistent connection. The machine showed "Live" in the Viam app within seconds.

### API Key Generation

The machine cloud credentials (part ID + secret) authenticate viam-server to the cloud. But the browser-based dashboard needs a separate API key to connect via the TypeScript SDK. An API key with Operator role was created through the Viam app's Connect > API Keys page. This distinction matters: the machine credentials are for the server process, the API key is for client applications.

## Phase 3: Deploying the Vision Health Sensor

### Why Vision Health First

The vision-health-sensor was the only module that could run without real industrial hardware. It performs two checks against any IP:port target: an ICMP ping (is the host reachable?) and a TCP connection attempt (is a service listening?). By pointing it at Google's DNS server (8.8.8.8 port 53), we get a target that is always reachable and always listening. This lets us prove the entire pipeline without waiting for shop floor hardware.

### Module Deployment

The module files were copied from the repo to `/opt/viam-modules/vision-health-sensor/`. A Python virtual environment was pre-created inside the module directory so viam-server would not need to create one on first launch. The `run.sh` entry point script handles venv creation if it does not exist, but pre-creating it avoids a slow first start.

The module was registered in the Viam app's JSON configuration with two blocks: one declaring the module (name, executable path, type=local) and one declaring the sensor component (name "vision-health", API "rdk:component:sensor", model matching the module's meta.json, and attributes specifying host and port).

### Verification

After saving the config in the Viam app, viam-server reloaded automatically. The Control tab showed a sensor component called "vision-health" with Get Readings returning `{"connected": true, "process_running": true}`. Both checks passed because 8.8.8.8 responds to ping and accepts TCP connections on port 53.

## Phase 4: Connecting the Dashboard

### The Problem

The dashboard was built to run in two modes: mock mode (simulated data, no hardware) and live mode (real Viam Cloud connection). Mock mode worked. Live mode had never been tested because there was no deployed machine to connect to.

### What Needed to Change

Several things were wrong in the existing code:

**Component name mismatch.** The dashboard's `sensors.ts` mapped the vision sensor to `"vision-health-monitor"` but the actual Viam component was named `"vision-health"`. This name must match exactly. The other two sensor names were also updated to match the naming convention we planned for them.

**SDK credential format.** The Viam TypeScript SDK v0.34.0 expects `authEntity` inside the `credentials` object, not as a separate top-level parameter. The existing code had it at the top level, which compiled fine but would fail at runtime. This was caught during the build step.

**TypeScript target.** The `tsconfig.json` had no `target` specified. The code used `[...set]` (spreading a Set into an array), which requires ES2015 or higher. Adding `"target": "es2017"` fixed the build error.

**No handling for missing components.** When the dashboard polls a sensor that does not exist on the machine, the Viam SDK throws an error. The original code treated all errors as connection failures, showing red "FAULT" cards. This is misleading. The fix was to add a `ComponentNotFoundError` class that catches SDK errors containing "not found", "unknown", or similar messages, and map those to a new "pending" status. Pending components show as yellow cards with "Not configured in Viam yet" instead of false fault alarms.

**WebRTC signaling.** The browser SDK connects to viam-server via WebRTC, negotiated through Viam Cloud. The initial connection attempt hung silently because the signaling address was not specified. Adding `signalingAddress: "https://app.viam.com:443"` to the `createRobotClient` call fixed this. A `reconnectMaxAttempts: 3` was also added so failed connections would surface errors instead of hanging indefinitely.

### The Result

After these fixes, the dashboard showed:
- Vision System: green "OK" with live readings polling every 2 seconds
- Robot Arm: yellow "Pending"
- PLC / Controller: yellow "Pending"
- Wire / Connection: yellow "Pending"
- Header: green "Viam Connected"
- Footer: "Live -- Viam Cloud"

The Vision System card updates every 2 seconds with fresh data from the real sensor on the Pi. The connection goes from the browser, through Viam Cloud's WebRTC signaling, to viam-server on the Pi, which queries the vision-health-sensor module, which pings 8.8.8.8 and probes TCP port 53.

## Architecture Decisions

### Why Custom Sensor Modules Instead of Registry Modules

Viam has a module registry with community-contributed modules. There is a `viam-modbus` module that could handle PLC communication. But for this POC, custom modules were written for two reasons. First, each module returns a fixed schema that enforces the privacy architecture. A generic Modbus module could be reconfigured to read any register, including ones that might contain production data. A custom module can only return what its `get_readings()` method defines. Second, custom modules let us handle the specific error conditions and health check logic for each piece of equipment.

### Why Next.js Instead of Grafana

Grafana would have been faster for basic time-series visualization. But the core demo is not a chart. It is a large colored circle that turns red when something breaks, accompanied by an audible alarm. Grafana cannot do browser-based audio alerts or full-screen flash animations. Next.js with the Viam TypeScript SDK gives full control over the alert experience.

### Why Browser-Side Viam SDK Instead of API Routes

The dashboard connects to Viam Cloud directly from the browser using the TypeScript SDK. This means the API key is embedded in the client bundle. For a POC this is acceptable. For production, the connection should be proxied through a Next.js API route so credentials stay server-side. The code includes comments noting this trade-off.

### Why "Pending" Instead of "Error" for Missing Components

When three of four sensors do not exist on the machine, showing them as red "FAULT" cards would be misleading. Someone viewing the dashboard would think hardware is broken when it simply has not been deployed yet. The yellow "Pending" state makes the system's actual status clear: one sensor is live, three are waiting for hardware.

## What Comes Next

### GPIO Phase (Robot Car)

A mobile robot car controlled via GPIO will be added as a physical demonstration platform. This adds a second Viam machine with motors and GPIO-controlled components, proving that Viam can manage both monitoring and actuation.

### Shop Hardware Integration

The three pending sensors need real hardware. The PLC sensor needs a Modbus register map from the hardware lead. The robot arm sensor needs confirmation of whether the CS9 exposes Modbus TCP registers or requires a VAL3 socket server. The vision health sensor just needs the real IP and port of the Apera server. Each of these is a configuration change (updating the `host` and `port` attributes in the Viam app), not a code change, because the module code already handles the protocols.

### Production Hardening

The dashboard currently runs as a dev server on the Pi. For production it would be built as a static site and served from Vercel or a local Nginx instance. The viam-server systemd service is already configured for auto-restart on failure.
