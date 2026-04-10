"""
Staubli TX2-140 CS9 REST API client.

Polls robot state via the CS9 web server REST API. The controller exposes
VAL3 HMI variables through HTTP endpoints. We read joint positions, TCP,
temperatures, safety interlocks, production state, and system health.

Discovery mode: On first connection, probes known API patterns to determine
what the controller exposes. Logs everything for baselining.

Network: 192.168.0.254 (default), ports 80/443/2400
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger("cell-sensor.staubli")

# Known Staubli CS9 REST API patterns (tried in order)
_API_PATTERNS = [
    "/api/variables",           # CS9 v9+ variable endpoint
    "/api/app/variables",       # Alternate path
    "/api/val3/variables",      # VAL3-specific
    "/data",                    # Legacy web server
]

# Additional REST endpoints to discover and poll
_EXTRA_ENDPOINTS = {
    "torque": "/api/arm/model/staticjnttorque",
    "ioboard": "/api/ios/ioboard/status",
}

# HMI variables we want to read (decoded from VALHTML dump)
_HMI_VARIABLES = [
    # Joint positions
    "sJointRx", "sJointRy",
    # TCP
    "sTextX", "sTextY", "sTextZ", "sTextRx", "sTextRy", "sTextRz",
    # Temperatures
    "sTextTemp",
    # Production
    "bTskSelected", "bTskStatus", "nPartsFound", "sPart", "nMoveID",
    "sClassID", "nObjectCount",
    # Position flags
    "bRobotAT",
    # Conveyor
    "bConveyorON", "bPlace_FeedConv",
    # Safety
    "bTrajectoryFound", "diServo",
]

# Default connection timeouts — kept short so get_readings() isn't blocked
_CONNECT_TIMEOUT = 1.5
_READ_TIMEOUT = 3.0
_DISCOVERY_COOLDOWN = 120.0  # seconds between discovery attempts when host is down


@dataclass
class StaubliState:
    """Parsed robot state from REST API readings."""
    connected: bool = False
    last_poll_ms: float = 0.0
    poll_count: int = 0
    error: str = ""

    # Joint positions (degrees)
    j1_pos: float = 0.0
    j2_pos: float = 0.0
    j3_pos: float = 0.0
    j4_pos: float = 0.0
    j5_pos: float = 0.0
    j6_pos: float = 0.0

    # Cartesian TCP
    tcp_x: float = 0.0
    tcp_y: float = 0.0
    tcp_z: float = 0.0
    tcp_rx: float = 0.0
    tcp_ry: float = 0.0
    tcp_rz: float = 0.0

    # Motor temperatures
    temp_j1: float = 0.0
    temp_j2: float = 0.0
    temp_j3: float = 0.0
    temp_j4: float = 0.0
    temp_j5: float = 0.0
    temp_j6: float = 0.0
    temp_dsi: float = 0.0

    # Extended temperatures (from REST API additional endpoints)
    temp_encoder_j1: float = 0.0
    temp_encoder_j2: float = 0.0
    temp_encoder_j3: float = 0.0
    temp_encoder_j4: float = 0.0
    temp_encoder_j5: float = 0.0
    temp_encoder_j6: float = 0.0
    temp_drive_case_j1: float = 0.0
    temp_drive_case_j2: float = 0.0
    temp_drive_case_j3: float = 0.0
    temp_drive_case_j4: float = 0.0
    temp_drive_case_j5: float = 0.0
    temp_drive_case_j6: float = 0.0
    temp_winding_j1: float = 0.0
    temp_winding_j2: float = 0.0
    temp_winding_j3: float = 0.0
    temp_winding_j4: float = 0.0
    temp_winding_j5: float = 0.0
    temp_winding_j6: float = 0.0
    temp_junction_j1: float = 0.0
    temp_junction_j2: float = 0.0
    temp_junction_j3: float = 0.0
    temp_junction_j4: float = 0.0
    temp_junction_j5: float = 0.0
    temp_junction_j6: float = 0.0
    temp_cpu: float = 0.0
    temp_cpu_board: float = 0.0
    temp_rsi: float = 0.0
    temp_starc_board: float = 0.0

    # Joint torques (N*m, from /api/arm/model/staticjnttorque)
    torque_j1: float = 0.0
    torque_j2: float = 0.0
    torque_j3: float = 0.0
    torque_j4: float = 0.0
    torque_j5: float = 0.0
    torque_j6: float = 0.0

    # EtherCAT I/O board status (from /api/ios/ioboard/status)
    ioboard_connected: bool = False
    ioboard_bus_state: str = ""
    ioboard_slave_count: int = 0
    ioboard_op_state: bool = False

    # EtherCAT digital I/O states (from HMI variable collections)
    io_inputs: dict[str, bool] = field(default_factory=dict)
    io_outputs: dict[str, bool] = field(default_factory=dict)

    # Production
    task_selected: str = ""
    task_status: str = ""
    parts_found: int = 0
    part_picked: str = ""
    part_desired: str = ""
    class_ids: list[str] = field(default_factory=list)
    class_counts: list[int] = field(default_factory=list)
    move_id: int = 0

    # Position flags
    at_home: bool = False
    at_stow: bool = False
    at_clear: bool = False
    at_capture: bool = False
    at_start: bool = False
    at_end: bool = False
    at_accept: bool = False
    at_reject: bool = False

    # Conveyor
    conveyor_fwd: bool = False
    feed_conveyor: bool = False

    # Safety
    trajectory_found: bool = False
    stop1_active: bool = False
    stop2_active: bool = False
    door_open: bool = False

    # System health
    arm_cycles: int = 0
    power_on_hours: float = 0.0
    urps_errors_24h: int = 0
    ethercat_errors_24h: int = 0
    last_error_code: str = ""
    last_error_time: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Flatten to dict for Viam sensor readings."""
        d: dict[str, Any] = {}
        for k, v in self.__dict__.items():
            if isinstance(v, dict):
                for dk, dv in v.items():
                    d[f"staubli_{k}_{dk}"] = dv
            elif isinstance(v, list):
                for i, item in enumerate(v):
                    d[f"staubli_{k}_{i}"] = item
            else:
                d[f"staubli_{k}"] = v
        return d


class StaubliClient:
    """Async client for Staubli CS9 REST API with auto-discovery."""

    def __init__(self, host: str = "192.168.0.254", port: int = 80):
        self.host = host
        self.port = port
        self._base_url = f"http://{host}:{port}"
        self._client: httpx.AsyncClient | None = None
        self._discovered_endpoints: dict[str, str] = {}  # name -> url_path
        self._poll_count = 0
        self._consecutive_failures = 0
        self._last_raw_response: dict[str, Any] = {}
        self._last_discovery_attempt: float = 0.0

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(_READ_TIMEOUT, connect=_CONNECT_TIMEOUT),
                verify=False,  # CS9 uses self-signed cert on HTTPS
                follow_redirects=True,
            )
        return self._client

    async def discover(self) -> str | None:
        """Probe the controller to find the working API pattern.

        Tries each known pattern and returns the first one that responds.
        Also probes extra endpoints (torque, ioboard) against the working base.
        Logs all responses for debugging. Returns the working HMI base path
        or None if nothing responds.
        """
        client = await self._get_client()

        # Try HTTP first, then HTTPS, then alternate port
        bases = [
            f"http://{self.host}:{self.port}",
            f"https://{self.host}:443",
            f"http://{self.host}:2400",
        ]

        hmi_pattern: str | None = None
        for base in bases:
            for pattern in _API_PATTERNS:
                url = f"{base}{pattern}"
                try:
                    resp = await client.get(url)
                    logger.info(
                        "DISCOVER %s → %d (%d bytes)",
                        url, resp.status_code, len(resp.content),
                    )
                    if resp.status_code < 400:
                        self._base_url = base
                        self._discovered_endpoints["hmi"] = pattern
                        hmi_pattern = pattern
                        logger.info("HMI API discovered: %s%s", base, pattern)
                        break
                except Exception as e:
                    logger.debug("DISCOVER %s → %s", url, e)
            if hmi_pattern:
                break

        # Probe extra endpoints against the working base URL
        if hmi_pattern:
            for name, path in _EXTRA_ENDPOINTS.items():
                url = f"{self._base_url}{path}"
                try:
                    resp = await client.get(url)
                    if resp.status_code < 400:
                        self._discovered_endpoints[name] = path
                        logger.info("Extra endpoint discovered: %s → %s", name, url)
                    else:
                        logger.debug("Extra endpoint %s returned %d", name, resp.status_code)
                except Exception as e:
                    logger.debug("Extra endpoint %s failed: %s", name, e)

        if not self._discovered_endpoints:
            logger.warning("No Staubli REST API found at %s", self.host)

        return hmi_pattern

    async def poll(self) -> StaubliState:
        """Poll the controller for current state.

        If no API has been discovered yet, runs discovery first.
        Falls back to basic TCP check if REST API is unavailable.
        """
        state = StaubliState()
        t0 = time.monotonic()

        try:
            client = await self._get_client()

            # Discovery on first poll or after failures (with cooldown)
            if not self._discovered_endpoints:
                now = time.monotonic()
                if now - self._last_discovery_attempt >= _DISCOVERY_COOLDOWN:
                    self._last_discovery_attempt = now
                    await self.discover()
                else:
                    state.error = f"Discovery cooldown ({self.host} unreachable)"
                    state.last_poll_ms = (time.monotonic() - t0) * 1000
                    return state

            if "hmi" in self._discovered_endpoints:
                # Read variables via discovered HMI API
                url = f"{self._base_url}{self._discovered_endpoints['hmi']}"
                resp = await client.get(url)
                if resp.status_code < 400:
                    data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
                    self._last_raw_response = data
                    self._parse_response(state, data)
                    state.connected = True
                else:
                    state.error = f"HTTP {resp.status_code}"

                # Poll extra endpoints concurrently
                extra_tasks = []
                extra_names = []
                for name in ("torque", "ioboard"):
                    if name in self._discovered_endpoints:
                        extra_url = f"{self._base_url}{self._discovered_endpoints[name]}"
                        extra_tasks.append(client.get(extra_url))
                        extra_names.append(name)

                if extra_tasks:
                    extra_results = await asyncio.gather(*extra_tasks, return_exceptions=True)
                    for name, result in zip(extra_names, extra_results):
                        if isinstance(result, Exception):
                            logger.debug("Extra endpoint %s error: %s", name, result)
                            continue
                        if result.status_code < 400:
                            try:
                                extra_data = result.json()
                                if name == "torque":
                                    self._parse_torque(state, extra_data)
                                elif name == "ioboard":
                                    self._parse_ioboard(state, extra_data)
                            except Exception as e:
                                logger.debug("Failed to parse %s response: %s", name, e)

            elif self._discovered_endpoints:
                # Have some endpoints but no HMI — still mark connected
                state.connected = True
                state.error = "HMI endpoint not available"
            else:
                # No API found — try a basic connection test
                try:
                    resp = await client.get(f"http://{self.host}:{self.port}/")
                    state.connected = resp.status_code < 500
                    state.error = "REST API not discovered — basic HTTP only"
                    # Log the response for future analysis
                    logger.info(
                        "Staubli root response: %d, content-type=%s, body=%s",
                        resp.status_code,
                        resp.headers.get("content-type", ""),
                        resp.text[:500],
                    )
                except Exception:
                    state.error = "Staubli unreachable"

            self._poll_count += 1
            state.poll_count = self._poll_count
            self._consecutive_failures = 0

        except Exception as e:
            self._consecutive_failures += 1
            state.error = str(e)
            state.connected = False
            # Full client reset after 5 consecutive failures — stale connections
            # in the httpx pool won't recover on their own after a network disruption
            if self._consecutive_failures >= 5:
                self._discovered_endpoints = {}
                self._consecutive_failures = 0
                if self._client and not self._client.is_closed:
                    try:
                        await self._client.aclose()
                    except Exception:
                        pass
                self._client = None
                logger.info("Full httpx client reset + API rediscovery after repeated failures")

        state.last_poll_ms = (time.monotonic() - t0) * 1000
        return state

    def _parse_response(self, state: StaubliState, data: dict[str, Any]) -> None:
        """Parse REST API response into StaubliState.

        This is intentionally defensive — logs unknown fields and skips
        missing ones. On first deployment, this builds our understanding
        of what the API actually returns.
        """
        # Log all top-level keys we see for baselining
        if data:
            logger.info("Staubli API keys: %s", list(data.keys())[:50])

        # Try to extract known fields — each wrapped in try/except
        # because we don't know the exact response format yet
        try:
            # Joint positions — might be nested under "joints" or flat
            joints = data.get("joints", data.get("sJointRx", {}))
            if isinstance(joints, dict):
                for i, key in enumerate(["j1", "j2", "j3", "j4", "j5", "j6"]):
                    val = joints.get(key, joints.get(f"J{i+1}", joints.get(str(i))))
                    if val is not None:
                        setattr(state, f"j{i+1}_pos", float(val))
        except Exception as e:
            logger.debug("Failed to parse joints: %s", e)

        try:
            # TCP position
            tcp = data.get("tcp", data.get("cartesian", {}))
            if isinstance(tcp, dict):
                for attr, keys in [
                    ("tcp_x", ["x", "X"]), ("tcp_y", ["y", "Y"]), ("tcp_z", ["z", "Z"]),
                    ("tcp_rx", ["rx", "Rx"]), ("tcp_ry", ["ry", "Ry"]), ("tcp_rz", ["rz", "Rz"]),
                ]:
                    for k in keys:
                        if k in tcp:
                            setattr(state, attr, float(tcp[k]))
                            break
        except Exception as e:
            logger.debug("Failed to parse TCP: %s", e)

        try:
            # Temperatures — might be array or dict
            temps = data.get("temperatures", data.get("sTextTemp", []))
            if isinstance(temps, list) and len(temps) >= 7:
                for i in range(6):
                    setattr(state, f"temp_j{i+1}", float(temps[i]))
                state.temp_dsi = float(temps[6])
            elif isinstance(temps, dict):
                for i in range(6):
                    val = temps.get(f"j{i+1}", temps.get(f"J{i+1}", temps.get(str(i))))
                    if val is not None:
                        setattr(state, f"temp_j{i+1}", float(val))
                dsi = temps.get("dsi", temps.get("DSI"))
                if dsi is not None:
                    state.temp_dsi = float(dsi)
        except Exception as e:
            logger.debug("Failed to parse temperatures: %s", e)

        try:
            # Extended temperatures from subsystem data
            _TEMP_MAP = {
                "temp_encoder_j": ("DsiIO", "encoder{}_temp", 6),
                "temp_drive_case_j": ("StarcIO", "driveCase{}_temp", 6),
                "temp_winding_j": ("StarcIO", "motorWinding{}_temp", 6),
                "temp_junction_j": ("StarcIO", "driveJunction{}_temp", 6),
            }
            for prefix, (subsystem, pattern, count) in _TEMP_MAP.items():
                sub_data = data.get(subsystem, {})
                if isinstance(sub_data, dict):
                    for i in range(1, count + 1):
                        key = pattern.format(i)
                        val = sub_data.get(key)
                        if val is not None:
                            setattr(state, f"{prefix}{i}", float(val))
            # Board temps
            cpu_io = data.get("CpuIO", {})
            if isinstance(cpu_io, dict):
                if "cpu_temp" in cpu_io:
                    state.temp_cpu = float(cpu_io["cpu_temp"])
                if "cpuBoard_temp" in cpu_io:
                    state.temp_cpu_board = float(cpu_io["cpuBoard_temp"])
            rsi_io = data.get("Rsi9IO", {})
            if isinstance(rsi_io, dict) and "IWtemperature" in rsi_io:
                state.temp_rsi = float(rsi_io["IWtemperature"])
            starc_io = data.get("StarcIO", {})
            if isinstance(starc_io, dict) and "STARCboard_temp" in starc_io:
                state.temp_starc_board = float(starc_io["STARCboard_temp"])
        except Exception as e:
            logger.debug("Failed to parse extended temps: %s", e)

        try:
            # Safety interlocks
            servo = data.get("diServo", data.get("safety", {}))
            if isinstance(servo, dict):
                state.stop1_active = bool(servo.get("Disable1", servo.get("stop1", False)))
                state.stop2_active = bool(servo.get("Disable2", servo.get("stop2", False)))
                state.door_open = bool(servo.get("DoorSwitch", servo.get("door", False)))
        except Exception as e:
            logger.debug("Failed to parse safety: %s", e)

        try:
            # EtherCAT digital I/O from VAL3 variable collections
            # Terminal 1: Servo control inputs
            servo = data.get("diServo", {})
            if isinstance(servo, dict):
                for key in ("Enable", "Disable1", "Disable2", "DoorSwitch", "Disable_Remote"):
                    if key in servo:
                        state.io_inputs[f"servo_{key.lower()}"] = bool(servo[key])

            # Terminal 2-3: Task/option inputs
            tsk = data.get("diTskSelect", {})
            if isinstance(tsk, dict):
                for key in ("Abort", "TPS_Cycle", "ClearPose", "WarmUp"):
                    if key in tsk:
                        state.io_inputs[f"btn_{key.lower()}"] = bool(tsk[key])
            opt = data.get("diOption", {})
            if isinstance(opt, dict):
                for key in ("Speed", "Belt_FWD", "Belt_REV", "Gripper_Lock"):
                    if key in opt:
                        state.io_inputs[f"opt_{key.lower()}"] = bool(opt[key])

            # Terminal 3: Gripper feedback inputs
            grip_in = data.get("diGripper_EGM", data.get("diGripper_EMH", {}))
            if isinstance(grip_in, dict):
                for key in ("ON", "Alarm", "Busy", "OFF", "STATUS", "MALFUNCTION", "PART-DETECT"):
                    if key in grip_in:
                        state.io_inputs[f"gripper_{key.lower().replace('-', '_')}"] = bool(grip_in[key])

            # Lamp outputs
            lamps = data.get("doLamp", {})
            if isinstance(lamps, dict):
                for key in ("Warmup", "isPowered", "ServoEnabled", "ServoDisabled",
                            "ServoDisabled1", "ServoDisabled2",
                            "Abort", "Cycle", "SlowSpeed", "ClearPose", "GripperLocked"):
                    if key in lamps:
                        state.io_outputs[f"lamp_{key.lower()}"] = bool(lamps[key])

            # Belt outputs
            belt = data.get("doBelt", {})
            if isinstance(belt, dict):
                for key in ("FWD", "REV"):
                    if key in belt:
                        state.io_outputs[f"belt_{key.lower()}"] = bool(belt[key])

            # Gripper command outputs
            grip_out = data.get("doGripper_EGM", data.get("doGripper_EMH", {}))
            if isinstance(grip_out, dict):
                for key in ("Enable", "Mag", "DeMag", "MAG", "DE-MAG"):
                    if key in grip_out:
                        state.io_outputs[f"gripper_{key.lower().replace('-', '_')}"] = bool(grip_out[key])

            # Safety stop lamp outputs
            safety_out = data.get("doSafteyStop", data.get("doSafetyStop", {}))
            if isinstance(safety_out, dict):
                for key in ("None", "Waiting", "SS1", "SS2"):
                    if key in safety_out:
                        state.io_outputs[f"safety_{key.lower()}"] = bool(safety_out[key])

        except Exception as e:
            logger.debug("Failed to parse I/O points: %s", e)

        try:
            # Production state
            state.task_selected = str(data.get("bTskSelected", data.get("task_selected", "")))
            state.task_status = str(data.get("bTskStatus", data.get("task_status", "")))
            state.parts_found = int(data.get("nPartsFound", data.get("parts_found", 0)))
            parts = data.get("sPart", {})
            if isinstance(parts, dict):
                state.part_picked = str(parts.get("Picked", ""))
                state.part_desired = str(parts.get("Desired", ""))
        except Exception as e:
            logger.debug("Failed to parse production: %s", e)

        # Log any fields we didn't handle (for baselining)
        handled = {"joints", "tcp", "cartesian", "temperatures", "sTextTemp",
                    "diServo", "safety", "bTskSelected", "bTskStatus",
                    "nPartsFound", "sPart", "sJointRx",
                    "DsiIO", "StarcIO", "CpuIO", "Rsi9IO",
                    "diTskSelect", "diOption", "diGripper_EGM", "diGripper_EMH",
                    "doLamp", "doBelt", "doGripper_EGM", "doGripper_EMH",
                    "doSafteyStop", "doSafetyStop"}
        unknown = set(data.keys()) - handled
        if unknown:
            logger.info("Unhandled Staubli fields (baseline): %s", unknown)

    def _parse_torque(self, state: StaubliState, data: Any) -> None:
        """Parse joint torque data from /api/arm/model/staticjnttorque."""
        try:
            if isinstance(data, list) and len(data) >= 6:
                for i in range(6):
                    setattr(state, f"torque_j{i+1}", round(float(data[i]), 2))
            elif isinstance(data, dict):
                torques = data.get("torques", data.get("joint_torques", data))
                if isinstance(torques, list) and len(torques) >= 6:
                    for i in range(6):
                        setattr(state, f"torque_j{i+1}", round(float(torques[i]), 2))
                elif isinstance(torques, dict):
                    for i in range(6):
                        val = torques.get(f"j{i+1}", torques.get(str(i)))
                        if val is not None:
                            setattr(state, f"torque_j{i+1}", round(float(val), 2))
        except Exception as e:
            logger.debug("Failed to parse torque: %s", e)

    def _parse_ioboard(self, state: StaubliState, data: Any) -> None:
        """Parse EtherCAT I/O board status from /api/ios/ioboard/status."""
        try:
            if isinstance(data, dict):
                state.ioboard_connected = True
                state.ioboard_bus_state = str(data.get("busState", data.get("state", "")))
                state.ioboard_slave_count = int(data.get("slaveCount", data.get("slaves", data.get("connectedSlaves", 0))))
                state.ioboard_op_state = bool(data.get("allSlavesOp", data.get("allOp", data.get("op", False))))
        except Exception as e:
            logger.debug("Failed to parse ioboard: %s", e)

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    @property
    def last_raw(self) -> dict[str, Any]:
        """Last raw API response — useful for debugging and baselining."""
        return self._last_raw_response
