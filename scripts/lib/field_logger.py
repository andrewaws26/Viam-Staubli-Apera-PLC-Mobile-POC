"""
IronSight Field Test Logger — structured logging for post-deployment analysis.

Writes JSON-lines to /var/log/ironsight-field.jsonl for analysis after physical
testing. Each event captures timing, success/failure, and context for diagnosing
resilience gaps.

Categories:
  - network:    PLC discovery, eth0 link, DHCP, subnet negotiation
  - can:        CAN bus interface, frame reception, listen-only mode
  - module:     Viam module startup, readings, failures
  - plc:        Modbus TCP connection, register reads, response times
  - system:     Pi health (CPU, memory, temp, throttle), service state
  - discovery:  Full discovery sequence timing and results
  - watchdog:   Watchdog check results and auto-fix actions

Usage:
    from lib.field_logger import field_log
    field_log("network", "plc_discovered", plc_ip="192.168.1.2",
              discovery_time_ms=1234, subnet="192.168.1", method="default_scan")
"""

import json
import os
import socket
import time
from pathlib import Path
from typing import Any, Optional

LOG_FILE = Path("/var/log/ironsight-field.jsonl")
HOSTNAME = socket.gethostname()
MAX_LOG_SIZE_MB = 25  # Rotate when log exceeds this size


def field_log(
    category: str,
    event: str,
    success: Optional[bool] = None,
    duration_ms: Optional[float] = None,
    error: Optional[str] = None,
    **kwargs: Any,
) -> None:
    """Write a structured JSON log event for field-test analysis.

    Args:
        category: Event category (network, can, module, plc, system, discovery, watchdog).
        event: Specific event name (e.g. 'plc_discovered', 'can_frame_received').
        success: Whether the operation succeeded (None = informational).
        duration_ms: How long the operation took in milliseconds.
        error: Error message if the operation failed.
        **kwargs: Additional context fields.
    """
    entry = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "epoch": time.time(),
        "host": HOSTNAME,
        "cat": category,
        "event": event,
    }

    if success is not None:
        entry["ok"] = success
    if duration_ms is not None:
        entry["ms"] = round(duration_ms, 1)
    if error:
        entry["error"] = str(error)[:500]

    entry.update(kwargs)

    try:
        _rotate_if_needed()
        with open(LOG_FILE, "a") as f:
            f.write(json.dumps(entry, default=str) + "\n")
    except Exception:
        pass  # Never crash the caller over logging


def _rotate_if_needed() -> None:
    """Rotate log file if it exceeds the size limit."""
    try:
        if LOG_FILE.exists() and LOG_FILE.stat().st_size > MAX_LOG_SIZE_MB * 1024 * 1024:
            rotated = LOG_FILE.with_suffix(".jsonl.1")
            if rotated.exists():
                rotated.unlink()
            LOG_FILE.rename(rotated)
    except Exception:
        pass


class FieldTimer:
    """Context manager for timing operations and logging them.

    Usage:
        with FieldTimer("network", "plc_discovery", subnet="192.168.1") as t:
            result = discover_plc()
            t.set(plc_ip=result)
    """

    def __init__(self, category: str, event: str, **kwargs: Any):
        self.category = category
        self.event = event
        self.kwargs = kwargs
        self.start = 0.0
        self.extra: dict[str, Any] = {}

    def set(self, **kwargs: Any) -> None:
        """Add extra fields to the log entry."""
        self.extra.update(kwargs)

    def __enter__(self) -> "FieldTimer":
        self.start = time.monotonic()
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        elapsed_ms = (time.monotonic() - self.start) * 1000
        merged = {**self.kwargs, **self.extra}
        if exc_type:
            field_log(self.category, self.event, success=False,
                      duration_ms=elapsed_ms, error=str(exc_val), **merged)
        else:
            field_log(self.category, self.event, success=True,
                      duration_ms=elapsed_ms, **merged)


# ─── Convenience loggers for common events ───────────────────────────


def log_discovery_result(
    plc_ip: Optional[str],
    method: str,
    duration_ms: float,
    subnets_scanned: int = 0,
    config_changed: bool = False,
) -> None:
    """Log the result of a PLC discovery sequence."""
    field_log("discovery", "plc_discovery_complete",
              success=plc_ip is not None,
              duration_ms=duration_ms,
              plc_ip=plc_ip,
              method=method,
              subnets_scanned=subnets_scanned,
              config_changed=config_changed)


def log_can_status(
    interface_up: bool,
    rx_frames: int = 0,
    listen_only: bool = True,
    error: Optional[str] = None,
) -> None:
    """Log CAN bus interface status."""
    field_log("can", "status_check",
              success=interface_up,
              interface_up=interface_up,
              rx_frames=rx_frames,
              listen_only=listen_only,
              error=error)


def log_module_event(
    module: str,
    event: str,
    success: bool = True,
    error: Optional[str] = None,
    **kwargs: Any,
) -> None:
    """Log a Viam module lifecycle event."""
    field_log("module", event,
              success=success,
              module=module,
              error=error,
              **kwargs)


def log_plc_connection(
    plc_ip: str,
    connected: bool,
    response_time_ms: Optional[float] = None,
    error: Optional[str] = None,
) -> None:
    """Log a PLC Modbus TCP connection attempt."""
    field_log("plc", "connection_check",
              success=connected,
              duration_ms=response_time_ms,
              plc_ip=plc_ip,
              error=error)


def log_system_health(
    cpu_temp_c: float,
    cpu_pct: float,
    mem_pct: float,
    disk_pct: float,
    throttled: int = 0,
    services: Optional[dict[str, str]] = None,
) -> None:
    """Log Pi 5 system health metrics."""
    field_log("system", "health_snapshot",
              cpu_temp_c=round(cpu_temp_c, 1),
              cpu_pct=round(cpu_pct, 1),
              mem_pct=round(mem_pct, 1),
              disk_pct=round(disk_pct, 1),
              throttled=throttled,
              services=services or {})


def log_eth0_event(
    event: str,
    ip_addresses: Optional[list[str]] = None,
    dhcp: bool = False,
    **kwargs: Any,
) -> None:
    """Log an eth0 network event (link up, DHCP, IP change)."""
    field_log("network", event,
              ip_addresses=ip_addresses,
              dhcp=dhcp,
              **kwargs)
