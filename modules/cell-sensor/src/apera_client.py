"""
Apera Vue AI Vision socket client.

Communicates with Apera Vue via ASCII CSV over TCP port 14040.
Protocol decoded from VAL3 source code and pipeline configuration.

Commands:
  d,tcp,x;y;z;rx;ry;rz       — TCP debug (connection test)
  l,w.{pipe}.detector,x,y,z,…  — Detect objects (returns class counts)
  l,w.{pipe}.grip_planner,…   — Wait for pick pose

This client is READ-ONLY by default. It only sends detection queries,
never triggers pick cycles or robot motion.
"""

import asyncio
import json
import logging
import socket
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.request import urlopen, Request
from urllib.error import URLError

logger = logging.getLogger("cell-sensor.apera")

_CONNECT_TIMEOUT = 2.0
_READ_TIMEOUT = 5.0
_HTTP_TIMEOUT = 3.0
_DEFAULT_PIPELINE = "RAIV_pick_belt_1"

# Apera Vue management ports (from system dump)
_HEALTH_PORT = 44333      # containerloader health check
_APP_MANAGER_PORT = 44334  # app manager REST API

# Known part classes at B&B (from pipeline config)
_KNOWN_CLASSES = ["14in_plate", "18in_plate", "pandrol_plate", "anchor", "spike"]


@dataclass
class AperaState:
    """Parsed vision system state from socket responses."""
    connected: bool = False
    socket_latency_ms: float = 0.0
    last_poll_ms: float = 0.0
    error: str = ""

    # Pipeline
    pipeline_name: str = ""
    pipeline_state: str = "unknown"  # idle, capturing, detecting, planning, error
    last_cycle_ms: float = 0.0

    # Detections
    total_detections: int = 0
    detections_by_class: dict[str, int] = field(default_factory=dict)
    detection_confidence_avg: float = 0.0

    # Pick planning
    pick_pose_available: bool = False
    trajectory_available: bool = False

    # Calibration (from miscal check)
    calibration_status: str = "unchecked"  # ok, drift, failed, unchecked
    last_cal_check: str = ""
    cal_residual_mm: float = 0.0

    # System health (from containerloader health check on :44333)
    system_status: str = "unknown"  # alive, busy, down, unreachable
    app_manager_ok: bool = False    # :44334 responds

    def to_dict(self) -> dict[str, Any]:
        """Flatten to dict for Viam sensor readings."""
        d: dict[str, Any] = {}
        for k, v in self.__dict__.items():
            if isinstance(v, dict):
                for dk, dv in v.items():
                    d[f"apera_{k}_{dk}"] = dv
            else:
                d[f"apera_{k}"] = v
        return d


class AperaClient:
    """Async TCP client for Apera Vue socket protocol."""

    def __init__(self, host: str = "192.168.3.151", port: int = 14040,
                 pipeline: str = _DEFAULT_PIPELINE):
        self.host = host
        self.port = port
        self.pipeline = pipeline
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._poll_count = 0
        self._consecutive_failures = 0
        self._last_raw_response: str = ""

    async def _ensure_connected(self) -> bool:
        """Open TCP socket if not already connected."""
        if self._writer is not None and not self._writer.is_closing():
            return True

        try:
            self._reader, self._writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.port),
                timeout=_CONNECT_TIMEOUT,
            )
            # Enable TCP keepalive to detect half-open connections
            # (e.g. after a switch reboot where the remote side vanishes silently)
            sock = self._writer.get_extra_info("socket")
            if sock is not None:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
                # Linux-specific: probe after 10s idle, every 5s, fail after 3 misses
                try:
                    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPIDLE, 10)
                    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPINTVL, 5)
                    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPCNT, 3)
                except (AttributeError, OSError):
                    pass  # Not all platforms expose these constants
            logger.info("Connected to Apera socket at %s:%d", self.host, self.port)
            return True
        except Exception as e:
            logger.debug("Apera connect failed: %s", e)
            self._reader = None
            self._writer = None
            return False

    async def _send_recv(self, cmd: str) -> str:
        """Send a command and read the response line."""
        if not self._writer or self._writer.is_closing():
            raise ConnectionError("Not connected")

        self._writer.write((cmd + "\n").encode())
        await self._writer.drain()

        raw = await asyncio.wait_for(
            self._reader.readline(),
            timeout=_READ_TIMEOUT,
        )
        response = raw.decode().strip()
        self._last_raw_response = response
        return response

    async def _disconnect(self) -> None:
        writer = self._writer
        # Null out immediately to prevent concurrent poll from using stale fd
        self._reader = None
        self._writer = None
        if writer and not writer.is_closing():
            writer.close()
            try:
                await asyncio.wait_for(writer.wait_closed(), timeout=2.0)
            except Exception:
                # Force-close the underlying socket if graceful close hangs
                try:
                    sock = writer.get_extra_info("socket")
                    if sock is not None:
                        sock.close()
                except Exception:
                    pass

    async def poll(self) -> AperaState:
        """Poll the vision system for current state.

        Sends safe read-only commands:
        1. TCP debug — verifies socket is alive
        2. Detector wait — gets current detection counts (if pipeline idle)

        Does NOT trigger pick cycles or robot motion.
        """
        state = AperaState(pipeline_name=self.pipeline)
        t0 = time.monotonic()

        try:
            if not await self._ensure_connected():
                state.error = f"Cannot reach {self.host}:{self.port}"
                state.connected = False
                self._consecutive_failures += 1
                if self._consecutive_failures >= 5:
                    self._consecutive_failures = 0
                state.last_poll_ms = (time.monotonic() - t0) * 1000
                return state

            # Step 1: TCP debug — connection test + latency measurement
            t_cmd = time.monotonic()
            try:
                resp = await self._send_recv("d,tcp,0;0;0;0;0;0")
                state.socket_latency_ms = (time.monotonic() - t_cmd) * 1000
                state.connected = True

                if resp.startswith("ok"):
                    state.pipeline_state = "idle"
                    logger.debug("TCP debug OK (%.0f ms)", state.socket_latency_ms)
                elif resp.startswith("er"):
                    state.pipeline_state = "error"
                    state.error = resp
                    logger.warning("TCP debug error: %s", resp)
                else:
                    logger.info("TCP debug unexpected response: %s", resp)

            except asyncio.TimeoutError:
                state.error = "TCP debug timeout — pipeline may be busy"
                state.pipeline_state = "detecting"
                state.connected = True  # Socket connected, just busy
                logger.info("Apera socket timeout — pipeline likely running")

            # Step 2: Detector query — get detection counts
            # Only if the TCP debug succeeded (pipeline idle)
            if state.pipeline_state == "idle":
                try:
                    t_det = time.monotonic()
                    # Use detector wait with zero pose — safe, read-only
                    det_resp = await self._send_recv(
                        f"l,w.{self.pipeline}.detector,0,0,0,0,0,0"
                    )
                    state.last_cycle_ms = (time.monotonic() - t_det) * 1000

                    self._parse_detector_response(state, det_resp)

                except asyncio.TimeoutError:
                    logger.debug("Detector query timeout — pipeline busy")
                    state.pipeline_state = "detecting"
                except Exception as e:
                    logger.debug("Detector query failed: %s", e)

            # Step 3: System health check via HTTP management ports
            # Only check periodically (every 10th poll) to avoid overhead
            if self._poll_count % 10 == 0:
                try:
                    health = await self.check_health()
                    state.system_status = health.get("system_status", "unknown")
                    state.app_manager_ok = health.get("app_manager_ok", False)
                except Exception:
                    pass

            self._poll_count += 1
            self._consecutive_failures = 0

        except Exception as e:
            self._consecutive_failures += 1
            state.error = str(e)
            state.connected = False
            # Reconnect on next poll
            await self._disconnect()

        state.last_poll_ms = (time.monotonic() - t0) * 1000
        return state

    def _parse_detector_response(self, state: AperaState, resp: str) -> None:
        """Parse detector response: ok,{num_classes},{cls1},...,{count1},...

        Response format from VAL3 code analysis:
          ok,{num_classes},{class_id_0},...,{class_id_n},{count_0},...,{count_n}
        """
        if not resp.startswith("ok"):
            if resp.startswith("er"):
                state.pipeline_state = "error"
                state.error = f"Detector: {resp}"
            logger.warning("Detector response: %s", resp)
            return

        parts = resp.split(",")
        # Log full response for baselining
        logger.info("Detector raw (%d fields): %s", len(parts), resp[:200])

        try:
            if len(parts) < 2:
                return

            num_classes = int(parts[1])
            if num_classes <= 0 or len(parts) < 2 + num_classes * 2:
                state.total_detections = 0
                return

            # Extract class IDs and counts
            class_ids = parts[2:2 + num_classes]
            count_strs = parts[2 + num_classes:2 + num_classes * 2]

            state.detections_by_class = {}
            state.total_detections = 0
            for cls_id, count_str in zip(class_ids, count_strs):
                count = int(float(count_str))
                state.detections_by_class[cls_id] = count
                state.total_detections += count

            state.pipeline_state = "idle"

        except (ValueError, IndexError) as e:
            logger.warning("Failed to parse detector response: %s (%s)", resp[:100], e)

    async def check_health(self) -> dict[str, Any]:
        """Check Apera Vue system health via management HTTP endpoints.

        Probes:
          :44333 — containerloader health (returns {"status": "alive|busy|down"})
          :44334 — app manager (responds = management API available)

        These are unauthenticated HTTP endpoints on the Apera Ubuntu host.
        """
        result: dict[str, Any] = {
            "system_status": "unreachable",
            "app_manager_ok": False,
            "health_latency_ms": 0,
        }
        t0 = time.monotonic()

        # Check containerloader health (:44333)
        try:
            url = f"http://{self.host}:{_HEALTH_PORT}"
            resp = await asyncio.get_event_loop().run_in_executor(
                None, lambda: urlopen(url, timeout=_HTTP_TIMEOUT)
            )
            if resp.status == 200:
                body = json.loads(resp.read())
                result["system_status"] = body.get("status", "unknown")
            else:
                result["system_status"] = "error"
        except Exception as e:
            logger.debug("Health check :44333 failed: %s", e)
            result["system_status"] = "unreachable"

        # Check app manager (:44334)
        try:
            url = f"http://{self.host}:{_APP_MANAGER_PORT}"
            resp = await asyncio.get_event_loop().run_in_executor(
                None, lambda: urlopen(url, timeout=_HTTP_TIMEOUT)
            )
            result["app_manager_ok"] = resp.status < 500
        except Exception:
            result["app_manager_ok"] = False

        result["health_latency_ms"] = round((time.monotonic() - t0) * 1000)
        return result

    async def reconnect(self) -> dict[str, Any]:
        """Force-close and re-establish the TCP socket connection."""
        await self._disconnect()
        connected = await self._ensure_connected()
        return {
            "success": connected,
            "message": "Socket reconnected" if connected else f"Cannot reach {self.host}:{self.port}",
        }

    async def restart_via_app_manager(self) -> dict[str, Any]:
        """Attempt to restart Apera Vue via the app manager REST API on :44334.

        The app manager container has Docker socket access and manages
        container lifecycle. We probe known endpoints for restart capability.
        """
        endpoints_to_try = [
            ("POST", f"http://{self.host}:{_APP_MANAGER_PORT}/restart"),
            ("POST", f"http://{self.host}:{_APP_MANAGER_PORT}/api/restart"),
            ("POST", f"http://{self.host}:{_APP_MANAGER_PORT}/api/v1/restart"),
            ("GET", f"http://{self.host}:{_APP_MANAGER_PORT}/api/status"),
        ]

        results = []
        for method, url in endpoints_to_try:
            try:
                req = Request(url, method=method)
                if method == "POST":
                    req.add_header("Content-Type", "application/json")
                    req.data = b"{}"
                resp = await asyncio.get_event_loop().run_in_executor(
                    None, lambda r=req: urlopen(r, timeout=_HTTP_TIMEOUT)
                )
                body = resp.read().decode()
                results.append({
                    "endpoint": url,
                    "method": method,
                    "status": resp.status,
                    "body": body[:500],
                })
                logger.info("App manager %s %s → %d: %s", method, url, resp.status, body[:200])
            except URLError as e:
                status = getattr(e, "code", None) or 0
                results.append({
                    "endpoint": url,
                    "method": method,
                    "status": status,
                    "error": str(e.reason) if hasattr(e, "reason") else str(e),
                })
            except Exception as e:
                results.append({
                    "endpoint": url,
                    "method": method,
                    "status": 0,
                    "error": str(e),
                })

        # Check if any endpoint returned a success
        success = any(r.get("status", 0) in (200, 201, 202, 204) for r in results)
        return {
            "success": success,
            "message": "Restart command sent" if success else "No restart endpoint responded — probe results attached",
            "probes": results,
        }

    async def close(self) -> None:
        await self._disconnect()

    @property
    def last_raw(self) -> str:
        """Last raw socket response — useful for debugging."""
        return self._last_raw_response
