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

# Default connection timeouts
_CONNECT_TIMEOUT = 3.0
_READ_TIMEOUT = 5.0


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
            if isinstance(v, list):
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
        self._discovered_api: str | None = None
        self._poll_count = 0
        self._consecutive_failures = 0
        self._last_raw_response: dict[str, Any] = {}

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
        Logs all responses for debugging. Returns the working base path
        or None if nothing responds.
        """
        client = await self._get_client()

        # Try HTTP first, then HTTPS, then alternate port
        bases = [
            f"http://{self.host}:{self.port}",
            f"https://{self.host}:443",
            f"http://{self.host}:2400",
        ]

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
                        self._discovered_api = pattern
                        logger.info("API discovered: %s%s", base, pattern)
                        return pattern
                except Exception as e:
                    logger.debug("DISCOVER %s → %s", url, e)

        logger.warning("No Staubli REST API found at %s", self.host)
        return None

    async def poll(self) -> StaubliState:
        """Poll the controller for current state.

        If no API has been discovered yet, runs discovery first.
        Falls back to basic TCP check if REST API is unavailable.
        """
        state = StaubliState()
        t0 = time.monotonic()

        try:
            client = await self._get_client()

            # Discovery on first poll or after failures
            if self._discovered_api is None:
                await self.discover()

            if self._discovered_api is not None:
                # Read variables via discovered API
                url = f"{self._base_url}{self._discovered_api}"
                resp = await client.get(url)
                if resp.status_code < 400:
                    data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
                    self._last_raw_response = data
                    self._parse_response(state, data)
                    state.connected = True
                else:
                    state.error = f"HTTP {resp.status_code}"
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
            # Force rediscovery after 5 consecutive failures
            if self._consecutive_failures >= 5:
                self._discovered_api = None
                self._consecutive_failures = 0
                logger.info("Forcing API rediscovery after repeated failures")

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
            # Safety interlocks
            servo = data.get("diServo", data.get("safety", {}))
            if isinstance(servo, dict):
                state.stop1_active = bool(servo.get("Disable1", servo.get("stop1", False)))
                state.stop2_active = bool(servo.get("Disable2", servo.get("stop2", False)))
                state.door_open = bool(servo.get("DoorSwitch", servo.get("door", False)))
        except Exception as e:
            logger.debug("Failed to parse safety: %s", e)

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
                    "nPartsFound", "sPart", "sJointRx"}
        unknown = set(data.keys()) - handled
        if unknown:
            logger.info("Unhandled Staubli fields (baseline): %s", unknown)

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    @property
    def last_raw(self) -> dict[str, Any]:
        """Last raw API response — useful for debugging and baselining."""
        return self._last_raw_response
