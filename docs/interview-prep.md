# Interview Preparation

Technical context for discussing this project in an FDE or Solutions Architect interview at Viam or a similar robotics/IoT company.

## The Problem

An industrial robot cell has four types of equipment: a Staubli robot arm, an Apera AI vision system, a PLC, and physical wiring connecting them through junction boxes. When something fails, the failure is detected by an operator standing at the cell. If the cell is in a remote facility or running an unattended shift, failures go undetected.

The business need is remote monitoring. Not remote control. Not analytics. Just the ability to see, from anywhere, whether each piece of equipment is up or down, and to get an alert when something breaks.

The technical challenge is that none of this equipment has native Viam support. Viam has no Staubli driver. Viam has no Apera integration. The PLC brand is not yet confirmed. And physical wire state cannot be directly sensed by software. Every integration requires custom work.

## What Was Built

A working proof of concept that demonstrates the full data pipeline from hardware sensor to remote dashboard. One custom Python sensor module (vision-health-sensor) runs on a Raspberry Pi 5, performs ICMP ping and TCP port checks against a target, and reports results through viam-server to Viam Cloud. A Next.js dashboard connects to Viam Cloud via the TypeScript SDK over WebRTC and displays live component health with 2-second polling.

Two additional sensor modules (PLC, robot arm) are scaffolded with complete Viam registration, configuration handling, and placeholder readings. They are architecturally identical to the working sensor and will activate when connected to real hardware.

## Technical Decisions and Reasoning

### Custom modules over registry modules

The Viam registry has a community Modbus module that could read PLC registers. Custom modules were written instead because the project has a privacy constraint. Each sensor must return a fixed schema (booleans and status strings only) defined in code. A generic Modbus module could be reconfigured to read arbitrary registers, including ones containing production data. Custom modules enforce the data boundary at the code level, not the configuration level. This is a deliberate architectural choice, not an oversight.

### Sensor API over Board API

Each hardware source is modeled as a Viam Sensor component, not a Board or Generic component. The Sensor API is the right fit because the system only reads state. It does not actuate anything. The Sensor API's `get_readings()` method returns a dictionary of values, which maps cleanly to the health status schema each module defines.

### Python over Go for modules

The Viam module SDK is available in Python and Go. Python was chosen because rapid prototyping matters more than performance for a POC that polls every 2 seconds. Python also has better library support for the protocols likely needed (pymodbus for Modbus TCP, standard library for TCP sockets). If performance became a concern at scale, the module interface is the same in Go and a rewrite would be straightforward.

### WebRTC for dashboard connectivity

The Viam TypeScript SDK connects to machines via WebRTC, negotiated through Viam Cloud. This means the dashboard running on a laptop in a different building (or city) can read sensor data from the Pi without any port forwarding or VPN. The Pi only needs outbound HTTPS to app.viam.com. This is the single most important architectural property for industrial deployments, where IT/OT network segmentation policies typically block all inbound connections to factory equipment.

### Privacy by design, not by policy

The system explicitly does not collect camera feeds, operator identity, cycle times, or any data that could be used for personnel tracking. This is enforced architecturally: the sensor modules have fixed return schemas, no cameras are connected to the Viam agent, and expanding the data collected requires writing new module code, reviewing it, building it, and deploying it. This is not a policy document that can be ignored. It is a code constraint that requires engineering effort to change.

## What Viam Can and Cannot Do Natively

### Viam handles well

- **Data pipeline orchestration.** viam-server manages module lifecycle, captures readings at configurable intervals, syncs to cloud. This is significant infrastructure that does not need to be built from scratch.
- **Remote connectivity.** WebRTC-based connection through Viam Cloud means no VPN, no port forwarding, no firewall rules on the factory network beyond outbound HTTPS.
- **Module system.** The ability to write a Python class that implements the Sensor interface and have it automatically appear as a component in the Viam app with cloud data sync is the core value proposition. The module system turns custom integrations into first-class Viam citizens.
- **Configuration management.** Machine configuration lives in the cloud and is pushed to the agent. Changing a sensor's target IP does not require SSH access to the Pi.

### Viam does not handle

- **Staubli robot arm integration.** No native driver exists. The CS9 supports Modbus TCP and VAL3 sockets, but a custom module is required to speak either protocol.
- **Apera AI vision system integration.** No native driver exists. The health check (ping + TCP probe) is a workaround. Richer monitoring would require knowledge of Apera's proprietary status API.
- **Physical wire state monitoring.** Viam cannot directly sense whether a wire is connected. This is handled by monitoring the endpoints and inferring wire state from communication faults. This is actually the strongest demo point: pull a wire, and the system detects the downstream failure.
- **Custom alert UX.** Viam's built-in dashboard shows raw sensor readings but cannot do full-screen red flashes, audible alarms, or custom status cards. A custom dashboard is required for the demo experience.

## How the Custom Sensor Module Pattern Works

A Viam sensor module is a Python process that viam-server launches and manages. The module registers a model with the Viam resource registry, specifying the API it implements (Sensor) and a model triplet (namespace:family:model). When viam-server's configuration includes a component with a matching model, it creates an instance of the module's class.

The class implements three key methods:

1. `validate_config` -- checks that required attributes (like `host`) are present in the configuration.
2. `new` / `reconfigure` -- creates or updates the instance with configuration values. This runs when viam-server starts or when the configuration changes in the cloud.
3. `get_readings` -- returns a dictionary of sensor values. This is called by viam-server on a schedule (for data capture) or on demand (from the Control tab or SDK calls).

The module's `run.sh` entry point manages a Python virtual environment and launches the module process. viam-server communicates with it over gRPC on a Unix socket. If the module crashes, viam-server restarts it.

The vision-health-sensor module's `get_readings` runs two async checks concurrently: an ICMP ping (using the system `ping` command) and a TCP connection attempt (using Python's `asyncio.open_connection`). Both have timeouts. The results are returned as `{"connected": bool, "process_running": bool}`.

## How the Pipeline Flows

1. viam-server on the Pi calls `get_readings()` on the vision-health-sensor module.
2. The module pings the target host and attempts a TCP connection to the target port.
3. Results are returned to viam-server as a dictionary.
4. viam-server makes the readings available via its gRPC API.
5. The browser dashboard (running on any device) calls `createRobotClient()` from the Viam TypeScript SDK, which establishes a WebRTC connection through Viam Cloud to the Pi's viam-server.
6. The dashboard calls `SensorClient.getReadings("vision-health")` every 2 seconds.
7. Readings are compared against the health predicate in the sensor config. If `connected` is false or `process_running` is false, the component is marked as faulted.
8. On fault detection (rising edge), the dashboard fires an audible alarm, flashes the screen red, shows an alert banner, and logs the event to fault history.

## Honest Current State

### Working

- Vision health sensor deployed on Pi 5, returning live readings from 8.8.8.8:53
- Full WebRTC pipeline from Pi to Viam Cloud to browser dashboard
- Dashboard shows live "OK" status for vision, "Pending" for unconfigured components
- Fault detection with audio alarm, visual flash, and history log
- viam-server configured as systemd service with auto-start on boot
- Mock mode for demos without hardware

### Pending (hardware blocked)

- PLC sensor: needs Modbus register map from hardware lead
- Robot arm sensor: needs protocol confirmation (Modbus TCP vs VAL3) from hardware lead
- Wire pull demo: needs PLC and physical wiring to demonstrate fault cascade
- Vision sensor pointed at real Apera server: needs IP and port from shop floor

### Not yet started

- GPIO robot car phase (mobile platform demo)
- Viam Triggers for email/Slack alerting
- Grafana for historical trend analysis
- Production deployment (static build, Nginx or Vercel)

## How This Demonstrates FDE/SA Skills

**Integration across heterogeneous systems.** The system connects a Raspberry Pi, a cloud platform, and a browser application using three different protocols (gRPC for module communication, WebRTC for remote access, HTTP for cloud sync). An FDE needs to bridge systems that were not designed to work together.

**Working within constraints.** The privacy architecture is not an afterthought. It was designed into the system from the start and enforced at the code level. An FDE at a customer-facing company needs to build systems that respect customer concerns, not just technically function.

**Knowing what to build vs what to use.** The project uses Viam's module system, data pipeline, and cloud connectivity. It builds custom sensor modules, a custom dashboard, and custom error handling. An SA needs to know where the platform ends and custom work begins.

**Unblocking yourself.** The PLC and robot arm sensors are blocked on hardware details. Rather than waiting, the vision sensor was deployed as a working proof of concept using a universally available target (Google DNS). This proves the architecture works while the hardware questions are resolved.

**Documentation as engineering output.** The architecture document, deployment guide, and this build log are not afterthoughts. They are how a multi-person project communicates design intent, records decisions, and enables the next person to pick up the work.
