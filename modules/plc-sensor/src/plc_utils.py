"""Standalone utility functions for the PLC sensor module."""

import fcntl
import json
import os
from typing import Any

from viam.logging import getLogger

LOGGER = getLogger(__name__)

# Chat cloud sync — voice_chat.py appends JSONL events here, we read & clear
_CHAT_QUEUE_FILE = "/tmp/ironsight-chat-queue.jsonl"


def _read_chat_queue() -> list:
    """Read and clear pending chat events from the touch UI queue.

    Returns a list of chat event dicts (usually empty). Each event has:
    ts, type ("voice"|"diagnosis"), user, response, severity.
    """
    try:
        if not os.path.exists(_CHAT_QUEUE_FILE):
            return []
        with open(_CHAT_QUEUE_FILE, "r+") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            lines = f.readlines()
            f.seek(0)
            f.truncate()
            fcntl.flock(f, fcntl.LOCK_UN)
        if not lines:
            return []
        events = []
        for line in lines:
            line = line.strip()
            if line:
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    LOGGER.debug("Failed to parse chat queue line")
        return events
    except Exception:
        return []


def _serialise(value: Any) -> Any:
    """Make a value JSON-safe (bools, ints, floats, strings)."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float, str)):
        return value
    return str(value)


def _uint16(value: int) -> int:
    """Ensure a register value is treated as unsigned 16-bit integer.

    Some pymodbus versions may return signed int16 values. This ensures
    all values are in the 0-65535 range.
    """
    return value & 0xFFFF
