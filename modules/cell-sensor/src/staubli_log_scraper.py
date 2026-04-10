"""
Staubli CS9 FTP log scraper.

Connects to the controller's FTP server and downloads log files for
event parsing. Extracts URPS errors, EtherCAT faults, safety stops,
servo events, app crashes, arm cycle counts, and CPU load — all within
a rolling 24-hour window.

Runs on a 60-second interval via asyncio.to_thread() so the blocking
FTP I/O never stalls the event loop. Graceful on every failure path —
never crashes the cell sensor.
"""

import asyncio
import ftplib
import io
import json
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger("cell-sensor.staubli-logs")

# Log file paths on the CS9 controller
_SYSTEM_LOG = "/log/system.log"
_USER_LOG = "/log/user.log"
_ARM_JSON = "/log/arm.json"
_THREAD_USAGE = "/log/thread_usage.json"

# Known event patterns
_RE_URPS = re.compile(r"(?:URPS|0x168[Dd])", re.IGNORECASE)
_RE_ETHERCAT = re.compile(r"(?:EtherCAT|ECAT|ecatError)", re.IGNORECASE)
_RE_FRAME_LOSS = re.compile(r"frame[_ ]?loss|lost[_ ]?frame", re.IGNORECASE)
_RE_SAFETY = re.compile(r"(?:safety[_ ]?stop|e[_ ]?stop|protective[_ ]?stop)", re.IGNORECASE)
_RE_SERVO_DISABLE = re.compile(r"servo[_ ]?(?:off|disable)", re.IGNORECASE)
_RE_SERVO_ENABLE = re.compile(r"servo[_ ]?(?:on|enable)", re.IGNORECASE)
_RE_CRASH = re.compile(r"(?:crash|fatal|segfault|exception|unhandled)", re.IGNORECASE)
_RE_RESTART = re.compile(r"(?:app[_ ]?start|application[_ ]?started|boot)", re.IGNORECASE)

# Timestamp patterns found in Staubli logs
_TS_PATTERNS = [
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M:%S",
    "%d/%m/%Y %H:%M:%S",
    "%Y%m%d_%H%M%S",
]

_RE_TIMESTAMP = re.compile(
    r"(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}|\d{2}/\d{2}/\d{4} \d{2}:\d{2}:\d{2}|\d{8}_\d{6})"
)

# FTP connection settings
_FTP_TIMEOUT = 5.0


@dataclass
class StaubliLogState:
    """Parsed log state from FTP scrape."""
    log_connected: bool = False
    last_scrape_ms: float = 0.0
    scrape_count: int = 0
    error: str = ""

    # URPS (Universal Robot Protection System) events
    urps_events_24h: int = 0
    urps_last_time: str = ""
    urps_last_code: str = ""

    # EtherCAT events
    ethercat_events_24h: int = 0
    ethercat_last_time: str = ""
    ethercat_frame_loss_24h: int = 0

    # Safety stops
    safety_stops_24h: int = 0
    safety_last_cause: str = ""
    safety_last_time: str = ""

    # Servo state changes
    servo_disable_count_24h: int = 0
    servo_enable_count_24h: int = 0

    # App health
    app_restarts_24h: int = 0
    app_last_crash_time: str = ""
    app_last_crash_reason: str = ""

    # Arm lifetime stats (from arm.json)
    arm_total_cycles: int = 0
    arm_power_on_hours: float = 0.0

    # Controller load (from thread_usage.json)
    controller_cpu_load_pct: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        """Flatten to dict with staubli_log_ prefix for Viam sensor readings."""
        d: dict[str, Any] = {}
        for k, v in self.__dict__.items():
            d[f"staubli_log_{k}"] = v
        return d


def _parse_timestamp(text: str) -> datetime | None:
    """Extract and parse the first timestamp from a log line."""
    match = _RE_TIMESTAMP.search(text)
    if not match:
        return None
    ts_str = match.group(1)
    for fmt in _TS_PATTERNS:
        try:
            return datetime.strptime(ts_str, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _is_within_24h(ts: datetime | None, cutoff: datetime) -> bool:
    """Check if a timestamp is within the 24h window."""
    if ts is None:
        return False
    return ts >= cutoff


class StaubliLogScraper:
    """FTP-based log scraper for Staubli CS9 controller."""

    def __init__(self, host: str = "192.168.0.254", port: int = 21,
                 user: str = "maintenance", password: str = "spec_cal"):
        self.host = host
        self.port = port
        self._user = user
        self._password = password
        self._ftp: ftplib.FTP | None = None
        self._scrape_count = 0

    def _connect(self) -> ftplib.FTP:
        """Establish or reuse FTP connection."""
        if self._ftp is not None:
            try:
                self._ftp.voidcmd("NOOP")
                return self._ftp
            except Exception:
                self._close_ftp()

        ftp = ftplib.FTP()
        ftp.connect(self.host, self.port, timeout=_FTP_TIMEOUT)
        ftp.login(self._user, self._password)
        self._ftp = ftp
        logger.info("FTP connected to %s:%d", self.host, self.port)
        return ftp

    def _close_ftp(self) -> None:
        if self._ftp is not None:
            try:
                self._ftp.quit()
            except Exception:
                try:
                    self._ftp.close()
                except Exception:
                    pass
            self._ftp = None

    def _download(self, ftp: ftplib.FTP, path: str) -> str:
        """Download a file from FTP as a string. Returns empty on failure."""
        buf = io.BytesIO()
        try:
            ftp.retrbinary(f"RETR {path}", buf.write)
            return buf.getvalue().decode("utf-8", errors="replace")
        except Exception as e:
            logger.debug("FTP download %s failed: %s", path, e)
            return ""

    def _scrape_sync(self) -> StaubliLogState:
        """Blocking FTP scrape — runs in a thread."""
        state = StaubliLogState()
        t0 = time.monotonic()

        try:
            ftp = self._connect()
            state.log_connected = True

            # Download log files
            system_log = self._download(ftp, _SYSTEM_LOG)
            user_log = self._download(ftp, _USER_LOG)
            arm_json = self._download(ftp, _ARM_JSON)
            thread_json = self._download(ftp, _THREAD_USAGE)

            # Parse logs
            combined_log = system_log + "\n" + user_log
            self._parse_log(state, combined_log)
            self._parse_arm_json(state, arm_json)
            self._parse_thread_usage(state, thread_json)

            self._scrape_count += 1
            state.scrape_count = self._scrape_count

        except Exception as e:
            state.error = str(e)
            state.log_connected = False
            self._close_ftp()
            logger.debug("FTP scrape failed: %s", e)

        state.last_scrape_ms = (time.monotonic() - t0) * 1000
        return state

    def _parse_log(self, state: StaubliLogState, log_text: str) -> None:
        """Parse combined system+user log for events within 24h window."""
        if not log_text:
            return

        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

        for line in log_text.splitlines():
            if not line.strip():
                continue

            ts = _parse_timestamp(line)

            # URPS events (0x168D)
            if _RE_URPS.search(line):
                if _is_within_24h(ts, cutoff):
                    state.urps_events_24h += 1
                    if ts:
                        ts_str = ts.isoformat()
                        if not state.urps_last_time or ts_str > state.urps_last_time:
                            state.urps_last_time = ts_str
                            # Try to extract error code — prefer hex, skip timestamps
                            code_match = re.search(r"(0x[0-9A-Fa-f]+)", line)
                            if not code_match:
                                # Fall back to numeric codes after the URPS keyword
                                code_match = re.search(r"(?:URPS|0x168[Dd]).*?(\b\d{4,}\b)", line)
                            if code_match:
                                state.urps_last_code = code_match.group(1)

            # EtherCAT events
            if _RE_ETHERCAT.search(line):
                if _is_within_24h(ts, cutoff):
                    state.ethercat_events_24h += 1
                    if ts:
                        ts_str = ts.isoformat()
                        if not state.ethercat_last_time or ts_str > state.ethercat_last_time:
                            state.ethercat_last_time = ts_str
                    # Frame loss counter
                    if _RE_FRAME_LOSS.search(line):
                        state.ethercat_frame_loss_24h += 1

            # Safety stops
            if _RE_SAFETY.search(line):
                if _is_within_24h(ts, cutoff):
                    state.safety_stops_24h += 1
                    if ts:
                        ts_str = ts.isoformat()
                        if not state.safety_last_time or ts_str > state.safety_last_time:
                            state.safety_last_time = ts_str
                            # Extract cause — take text after the safety keyword
                            cause_match = re.search(
                                r"(?:safety[_ ]?stop|e[_ ]?stop|protective[_ ]?stop)[:\s]*(.{0,80})",
                                line, re.IGNORECASE
                            )
                            if cause_match:
                                state.safety_last_cause = cause_match.group(1).strip()

            # Servo disable/enable
            if _RE_SERVO_DISABLE.search(line):
                if _is_within_24h(ts, cutoff):
                    state.servo_disable_count_24h += 1

            if _RE_SERVO_ENABLE.search(line):
                if _is_within_24h(ts, cutoff):
                    state.servo_enable_count_24h += 1

            # App crashes/restarts
            if _RE_CRASH.search(line):
                if _is_within_24h(ts, cutoff):
                    if ts:
                        ts_str = ts.isoformat()
                        if not state.app_last_crash_time or ts_str > state.app_last_crash_time:
                            state.app_last_crash_time = ts_str
                            # Extract reason — take text after the crash keyword
                            reason_match = re.search(
                                r"(?:crash|fatal|segfault|exception|unhandled)[:\s]*(.{0,120})",
                                line, re.IGNORECASE
                            )
                            if reason_match:
                                state.app_last_crash_reason = reason_match.group(1).strip()

            if _RE_RESTART.search(line):
                if _is_within_24h(ts, cutoff):
                    state.app_restarts_24h += 1

    def _parse_arm_json(self, state: StaubliLogState, text: str) -> None:
        """Parse arm.json for lifetime cycle count and power-on hours."""
        if not text:
            return
        try:
            data = json.loads(text)
            if isinstance(data, dict):
                # Try multiple possible key names
                state.arm_total_cycles = int(
                    data.get("totalCycles",
                    data.get("total_cycles",
                    data.get("cycles",
                    data.get("nbCycles", 0))))
                )
                state.arm_power_on_hours = round(float(
                    data.get("powerOnHours",
                    data.get("power_on_hours",
                    data.get("runHours",
                    data.get("hours", 0.0))))
                ), 1)
        except Exception as e:
            logger.debug("Failed to parse arm.json: %s", e)

    def _parse_thread_usage(self, state: StaubliLogState, text: str) -> None:
        """Parse thread_usage.json for controller CPU load."""
        if not text:
            return
        try:
            data = json.loads(text)
            if isinstance(data, dict):
                # CPU load might be at top level or nested
                load = data.get("cpuLoad",
                       data.get("cpu_load",
                       data.get("totalLoad",
                       data.get("load"))))
                if load is not None:
                    state.controller_cpu_load_pct = round(float(load), 1)
                elif "threads" in data and isinstance(data["threads"], list):
                    # Sum thread loads if individual entries
                    total = sum(
                        float(t.get("load", t.get("cpuLoad", 0)))
                        for t in data["threads"]
                        if isinstance(t, dict)
                    )
                    state.controller_cpu_load_pct = round(total, 1)
        except Exception as e:
            logger.debug("Failed to parse thread_usage.json: %s", e)

    async def scrape(self) -> StaubliLogState:
        """Async wrapper — runs blocking FTP in a thread."""
        return await asyncio.to_thread(self._scrape_sync)

    def close(self) -> None:
        """Close FTP connection."""
        self._close_ftp()
