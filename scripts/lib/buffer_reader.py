"""
Offline buffer reader for IronSight sensor data.

The plc-sensor module writes 1Hz JSONL readings to the offline buffer.
This module provides the single canonical way to read them — no more
copy-pasting the seek-and-parse pattern across 4 files.

Usage:
    from lib.buffer_reader import read_latest_entry, read_history

    latest = read_latest_entry()  # Most recent reading
    history = read_history(minutes=10)  # Last 10 min of readings
"""

import json
import time
from pathlib import Path
from typing import Optional, List

from lib.plc_constants import OFFLINE_BUFFER_DIR


def read_latest_entry(buf_dir: Path = OFFLINE_BUFFER_DIR) -> Optional[dict]:
    """Read the most recent sensor reading from the offline buffer.

    Seeks to the end of the latest JSONL file and parses backwards
    to find the last complete JSON line. Returns None if no data.
    """
    try:
        if not buf_dir.exists():
            return None
        jsonl_files = sorted(buf_dir.glob("readings_*.jsonl"))
        if not jsonl_files:
            return None

        with open(jsonl_files[-1], "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            if size == 0:
                return None
            f.seek(max(0, size - 4096))
            chunk = f.read()

        for line in reversed(chunk.strip().split(b"\n")):
            try:
                return json.loads(line)
            except (json.JSONDecodeError, ValueError):
                continue

        return None
    except Exception:
        return None


def read_history(minutes: int = 5, buf_dir: Path = OFFLINE_BUFFER_DIR,
                 max_minutes: int = 30) -> List[dict]:
    """Read recent sensor readings from the offline buffer.

    Returns raw reading dicts from the last N minutes.
    Caps at max_minutes to prevent huge memory usage.
    """
    minutes = min(minutes, max_minutes)
    cutoff = time.time() - (minutes * 60)

    try:
        if not buf_dir.exists():
            return []
        jsonl_files = sorted(buf_dir.glob("readings_*.jsonl"))
        if not jsonl_files:
            return []

        readings = []

        # Read from the latest file(s), enough to cover the time window
        for fpath in reversed(jsonl_files[-2:]):
            with open(fpath, "rb") as f:
                f.seek(0, 2)
                size = f.tell()
                # ~500 bytes per reading at 1Hz
                chunk_size = min(size, minutes * 60 * 500)
                f.seek(max(0, size - chunk_size))
                chunk = f.read()

            for line in chunk.strip().split(b"\n"):
                try:
                    data = json.loads(line)
                    epoch = data.get("epoch", 0)
                    if epoch >= cutoff:
                        readings.append(data)
                except (json.JSONDecodeError, ValueError):
                    continue

        return readings
    except Exception:
        return []


def get_data_age_seconds(entry: Optional[dict] = None,
                         buf_dir: Path = OFFLINE_BUFFER_DIR) -> float:
    """Get the age of the latest sensor reading in seconds.

    Returns float('inf') if no data is available.
    """
    if entry is None:
        entry = read_latest_entry(buf_dir)
    if not entry:
        return float("inf")

    ts_str = entry.get("ts", "")
    if not ts_str:
        return float("inf")

    try:
        from datetime import datetime, timezone
        reading_time = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - reading_time).total_seconds()
    except Exception:
        return float("inf")
