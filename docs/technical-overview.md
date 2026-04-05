# Technical Overview

Technical context and design rationale for the remote monitoring POC. Covers what was built, why each decision was made, what Viam handles natively vs what required custom work, and the honest current state of the system.

## The Problem

Railroad trucks use a Tie Plate System (TPS) to position and secure tie plates during track maintenance. The TPS machine, its eject system, encoder-based track distance measurement, and production counters are all controlled by a Click PLC on each truck. When the truck is out on a remote stretch of track, there is no way to monitor machine status, production progress, or fault conditions without physically being on the truck.

The business need is remote monitoring. Not remote control. Not analytics. Just the ability to see, from anywhere, whether the TPS is running, what its production counts are, whether the eject system is functioning, and how far the truck has traveled — and to get an alert when something goes wrong.

The technical challenge is that the Click PLC has no native Viam support. A custom Modbus TCP integration is required to read the PLC's registers and coils, translate raw values into meaningful TPS status fields, and push them through the Viam data pipeline to a remote dashboard.

## What Was Built

A working proof of concept that demonstrates the full data pipeline from a Click PLC on a railroad truck to a remote mobile-responsive dashboard, deployed and accessible from the public internet. The system has three layers.

On the truck, a Raspberry Pi 5 runs viam-server as a systemd service. A single custom Python sensor module (plc-sensor) reads a Click PLC C0-10DD2E-D via Modbus TCP at 169.168.10.21:502. Each reading returns approximately 55 fields covering encoder data and track distance, TPS machine status, eject system state, production counters, and all 25 DS registers (DS1–DS25). The Pi auto-starts on boot and auto-recovers from power loss with no manual intervention. Offline readings are buffered to JSONL files and synced when connectivity returns.

In the cloud, Viam Cloud receives sensor readings via HTTPS, stores them in its data management service, and provides WebRTC signaling for remote SDK connections.

On the client side, a Next.js dashboard is deployed to Vercel. It calls a server-side API route (`/api/sensor-readings`) that proxies requests to Viam Cloud — Viam credentials never reach the browser. The dashboard displays a single TPS Controller status card with detail panels for Encoder/Track Distance, TPS Production, TPS Machine Status, TPS Eject System, and a collapsible PLC Raw Registers view (DS1–DS25). The design is mobile-responsive for use on phones and tablets in the field.

## Technical Decisions and Reasoning

### Custom modules over registry modules

The Viam registry has a community Modbus module that could read PLC registers. A custom module was written instead because the project has a privacy constraint. The plc-sensor module returns a fixed schema of approximately 55 fields defined in code. A generic Modbus module could be reconfigured to read arbitrary registers, potentially exposing sensitive TPS production data or operational metrics beyond the agreed monitoring scope. The custom module enforces the data boundary at the code level, not the configuration level. This is a deliberate architectural choice, not an oversight.

### Sensor API over Board API

Each hardware source is modeled as a Viam Sensor component, not a Board or Generic component. The Sensor API is the right fit because the system only reads state. It does not actuate anything. The Sensor API's `get_readings()` method returns a dictionary of values, which maps cleanly to the health status schema each module defines.

### Python over Go for modules

The Viam module SDK is available in Python and Go. Python was chosen because rapid prototyping matters more than performance for a POC that polls every 2 seconds. Python also has better library support for the protocols likely needed (pymodbus for Modbus TCP, standard library for TCP sockets). If performance became a concern at scale, the module interface is the same in Go and a rewrite would be straightforward.

### WebRTC for dashboard connectivity

The Viam TypeScript SDK connects to machines via WebRTC, negotiated through Viam Cloud. This means the dashboard running on a phone or laptop anywhere can read sensor data from a Pi on a railroad truck without any port forwarding or VPN. The Pi only needs outbound HTTPS to app.viam.com. This is the single most important architectural property for monitoring trucks in the field, where cellular connectivity is the only option and no inbound connections are possible.

### Privacy by design, not by policy

The system explicitly does not collect camera feeds, operator identity, cycle times, or any data that could be used for personnel tracking. This is enforced architecturally: the sensor modules have fixed return schemas, no cameras are connected to the Viam agent, and expanding the data collected requires writing new module code, reviewing it, building it, and deploying it. This is not a policy document that can be ignored. It is a code constraint that requires engineering effort to change.

## Vercel Deployment: Why the Dashboard Lives Separately from the Pi

The dashboard was initially running on the Pi as a Next.js dev server. Moving it to Vercel was not just a convenience decision. It was an architectural improvement for three reasons.

First, availability. The dashboard's job is to tell you when something is wrong. If it runs on the Pi and the Pi goes down, the dashboard goes down too. You see a browser timeout instead of a fault alarm. Hosting on Vercel means the dashboard loads instantly regardless of Pi state. When the Pi is offline, the dashboard shows the fault. When the Pi is online, the dashboard shows live data. The user always gets useful information.

Second, separation of concerns. The Pi's job is to run viam-server and sensor modules. Running a Node.js process alongside it wastes RAM and CPU that should be reserved for the data pipeline. It also adds a failure mode: if the Node process crashes, the dashboard goes down even though the sensors are fine.

Third, network architecture. In a real truck deployment, the Pi connects via cellular with no inbound connections possible. A browser on a phone or laptop cannot reach a web server on the Pi directly. But the Vercel-hosted dashboard connects to the Pi through Viam Cloud via WebRTC. The Pi only makes outbound HTTPS connections. The dashboard only makes outbound WebSocket connections. No special network configuration is needed on either side.

## What Viam Can and Cannot Do Natively

### Viam handles well

- **Data pipeline orchestration.** viam-server manages module lifecycle, captures readings at configurable intervals, syncs to cloud. This is significant infrastructure that does not need to be built from scratch.
- **Remote connectivity.** WebRTC-based connection through Viam Cloud means no VPN, no port forwarding, no special network configuration on the truck beyond outbound HTTPS over cellular.
- **Module system.** The ability to write a Python class that implements the Sensor interface and have it automatically appear as a component in the Viam app with cloud data sync is the core value proposition. The module system turns custom integrations into first-class Viam citizens.
- **Configuration management.** Machine configuration lives in the cloud and is pushed to the agent. Changing a sensor's target IP does not require SSH access to the Pi.
- **Data capture and sync.** The data_manager service captures readings at configurable intervals and syncs them to Viam Cloud automatically. Historical data is available in the Viam app without any additional database or time-series infrastructure.

### Viam does not handle

- **Click PLC Modbus TCP integration.** No native driver exists for the Click C0-10DD2E-D. The custom plc-sensor module reads coils, input registers, and DS registers via pymodbus and maps them into meaningful TPS status fields.
- **TPS-specific data interpretation.** Raw register values need domain-specific translation — encoder counts to track distance, bit-packed status registers to individual TPS machine and eject states, production counter aggregation. This logic lives in the custom module.
- **Custom alert UX.** Viam's built-in dashboard shows raw sensor readings but cannot do mobile-responsive status cards, detail panels, or collapsible register views. A custom dashboard is required for the field monitoring experience.

## How the Custom Sensor Module Pattern Works

A Viam sensor module is a Python process that viam-server launches and manages. The module registers a model with the Viam resource registry, specifying the API it implements (Sensor) and a model triplet (namespace:family:model). When viam-server's configuration includes a component with a matching model, it creates an instance of the module's class.

The class implements three key methods:

1. `validate_config` -- checks that required attributes (like `host`) are present in the configuration.
2. `new` / `reconfigure` -- creates or updates the instance with configuration values. This runs when viam-server starts or when the configuration changes in the cloud.
3. `get_readings` -- returns a dictionary of sensor values. This is called by viam-server on a schedule (for data capture) or on demand (from the Control tab or SDK calls).

The module's `run.sh` entry point manages a Python virtual environment and launches the module process. viam-server communicates with it over gRPC on a Unix socket. If the module crashes, viam-server restarts it.

The plc-sensor module's `get_readings` connects to the Click PLC via Modbus TCP (using pymodbus), reads coils, input registers, and DS registers, and returns approximately 55 fields covering encoder data, track distance, TPS machine status, eject system state, production counters, and raw DS1–DS25 values.

## How the Pipeline Flows

1. viam-server on the Pi calls `get_readings()` on the plc-sensor module at 1 Hz.
2. The module connects to the Click PLC at 169.168.10.21:502 via Modbus TCP and reads coils, input registers, and DS registers.
3. Raw register values are translated into ~100+ named fields (encoder counts, TPS status, eject state, production counters, DS1–DS25) and returned to viam-server as a dictionary.
4. viam-server makes the readings available via its gRPC API. The data_manager service captures them to a persistent directory and syncs to Viam Cloud. If the Pi is offline, readings are buffered to JSONL files and synced when connectivity returns.
5. The Vercel-hosted dashboard's browser calls `/api/sensor-readings`, a Next.js server-side API route.
6. The API route uses Viam credentials from server-side environment variables (VIAM_MACHINE_ADDRESS, VIAM_API_KEY_ID, VIAM_API_KEY) to connect to Viam Cloud and fetch the latest sensor readings. Credentials never reach the browser.
7. The dashboard renders the TPS Controller status card with detail panels for Encoder/Track Distance, TPS Production, TPS Machine Status, TPS Eject System, and collapsible PLC Raw Registers (DS1–DS25).
8. On fault detection, the dashboard shows visual fault indicators on the affected panel.

## Honest Current State

### Working

- PLC sensor module deployed on Pi 5, reading real Click PLC C0-10DD2E-D at 169.168.10.21:502 via Modbus TCP
- All ~100+ fields flowing to Viam Cloud at 1 Hz: encoder data, TPS machine status, eject system, production counters, DS1–DS25
- Dashboard deployed on Vercel, mobile-responsive, single TPS Controller status card with detail panels
- Server-side API route (`/api/sensor-readings`) proxies Viam credentials — nothing sensitive in the browser (env vars: VIAM_MACHINE_ADDRESS, VIAM_API_KEY_ID, VIAM_API_KEY; only NEXT_PUBLIC_MOCK_MODE uses the public prefix)
- Offline JSONL buffering with Viam data manager using persistent capture directory — readings sync when connectivity returns
- viam-server configured as systemd service with auto-start on boot
- Module files symlinked from `/opt/viam-modules/` to the git repo for seamless deployment
- Mock mode for demos without hardware

### Not yet started

- Viam Triggers for email/Slack alerting
- Grafana for historical trend analysis

## Engineering Approach

**Integration across heterogeneous systems.** The system connects a Raspberry Pi, a cloud platform, a CDN-hosted dashboard, and a browser application using four different protocols (gRPC for module communication, WebRTC for remote access, HTTPS for cloud sync, WebSocket for SDK signaling). Industrial monitoring requires bridging systems that were not designed to work together.

**Working within constraints.** The privacy architecture is not an afterthought. It was designed into the system from the start and enforced at the code level. The fixed-schema sensor module ensures only agreed-upon TPS monitoring data leaves the truck. Systems that touch operational equipment need to respect data boundaries, not just technically function.

**Knowing what to build vs what to use.** The project uses Viam's module system, data pipeline, and cloud connectivity. It builds custom sensor modules, a custom dashboard, and custom error handling. It uses Vercel for hosting rather than building deployment infrastructure. Knowing where the platform ends and custom work begins keeps the project lean.

**End-to-end delivery.** The system is not a partial prototype. The PLC sensor reads real hardware, the data pipeline delivers to the cloud, and the dashboard is live on Vercel. Every layer of the stack is deployed and working.

**Production thinking from day one.** The systemd service, the Vercel deployment, the power cycle test, and the data capture configuration are not afterthoughts. They are engineering decisions that ensure readiness for real-world deployment.

**Documentation as engineering output.** The architecture document, deployment guide, build log, and this technical overview are not afterthoughts. They are how a multi-person project communicates design intent, records decisions, and enables the next person to pick up the work.
