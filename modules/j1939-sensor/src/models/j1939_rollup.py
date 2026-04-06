"""Hourly rollup computation for fleet-scale dashboard queries.

Same concept as plc_rollup.py but for J1939 truck engine data. Each Pi Zero
computes hourly summary stats and includes them in every sensor reading so
the dashboard can read one reading and get 7 days of pre-aggregated history.

Usage in j1939_sensor.py:
    from .j1939_rollup import HourlyRollup
    rollup = HourlyRollup("/home/andrew/.viam/rollup")
    # In get_readings():
    rollup.ingest(readings)
    readings.update(rollup.to_summary())
    readings["_hourly_rollup"] = rollup.to_json()
"""

import json
import os
import pickle
import time
from collections import defaultdict
from typing import Any

from viam.logging import getLogger

LOGGER = getLogger(__name__)

MAX_BUCKETS = 168  # 7 days

# Numeric fields to aggregate
ROLLUP_FIELDS = [
    "engine_rpm",
    "coolant_temp_f",
    "oil_temp_f",
    "oil_pressure_psi",
    "battery_voltage_v",
    "vehicle_speed_mph",
    "fuel_level_pct",
    "fuel_rate_gph",
    "boost_pressure_psi",
    "engine_load_pct",
    "intake_manifold_temp_f",
    "dpf_soot_load_pct",
    "def_level_pct",
    "scr_efficiency_pct",
    "active_dtc_count",
]

# Boolean fields → percentage of time true
ROLLUP_BOOL_FIELDS = [
    "protect_lamp",
    "amber_warning_lamp",
    "red_stop_lamp",
]


class HourlyBucket:
    """Accumulates min/max/sum/count for one hour of readings."""

    __slots__ = ("hour_key", "count", "sums", "mins", "maxs", "bool_true_counts")

    def __init__(self, hour_key: str):
        self.hour_key = hour_key
        self.count = 0
        self.sums: dict[str, float] = defaultdict(float)
        self.mins: dict[str, float] = {}
        self.maxs: dict[str, float] = {}
        self.bool_true_counts: dict[str, int] = defaultdict(int)

    def ingest(self, readings: dict[str, Any]) -> None:
        self.count += 1
        for field in ROLLUP_FIELDS:
            val = readings.get(field)
            if val is None or not isinstance(val, (int, float)):
                continue
            self.sums[field] += val
            if field not in self.mins or val < self.mins[field]:
                self.mins[field] = val
            if field not in self.maxs or val > self.maxs[field]:
                self.maxs[field] = val
        for field in ROLLUP_BOOL_FIELDS:
            val = readings.get(field)
            if val is True or val == 1:
                self.bool_true_counts[field] += 1

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"hour": self.hour_key, "count": self.count}
        for field in ROLLUP_FIELDS:
            if field in self.sums and self.count > 0:
                result[f"{field}_avg"] = round(self.sums[field] / self.count, 2)
            if field in self.mins:
                result[f"{field}_min"] = round(self.mins[field], 2)
            if field in self.maxs:
                result[f"{field}_max"] = round(self.maxs[field], 2)
        for field in ROLLUP_BOOL_FIELDS:
            if self.count > 0:
                result[f"{field}_pct"] = round(
                    self.bool_true_counts[field] / self.count * 100, 1
                )
        return result


class HourlyRollup:
    """Ring buffer of hourly summary buckets, persisted to disk."""

    def __init__(self, persist_dir: str | None = None):
        self._buckets: dict[str, HourlyBucket] = {}
        self._persist_path: str | None = None
        self._last_persist = 0.0

        if persist_dir:
            os.makedirs(persist_dir, exist_ok=True)
            self._persist_path = os.path.join(persist_dir, "j1939_rollup.pkl")
            self._load()

    def _current_hour_key(self) -> str:
        return time.strftime("%Y-%m-%dT%H", time.gmtime())

    def ingest(self, readings: dict[str, Any]) -> None:
        key = self._current_hour_key()
        if key not in self._buckets:
            self._buckets[key] = HourlyBucket(key)
            self._prune()
        self._buckets[key].ingest(readings)

        now = time.monotonic()
        if self._persist_path and now - self._last_persist > 600:
            self._save()
            self._last_persist = now

    def to_json(self) -> str:
        sorted_keys = sorted(self._buckets.keys())
        buckets = [self._buckets[k].to_dict() for k in sorted_keys]
        return json.dumps(buckets, separators=(",", ":"))

    def to_summary(self) -> dict[str, Any]:
        sorted_keys = sorted(self._buckets.keys())
        recent_keys = sorted_keys[-24:] if len(sorted_keys) >= 24 else sorted_keys

        total_readings = sum(self._buckets[k].count for k in recent_keys)
        if total_readings == 0:
            return {"rollup_hours": 0, "rollup_readings_24h": 0}

        summary: dict[str, Any] = {
            "rollup_hours": len(sorted_keys),
            "rollup_readings_24h": total_readings,
            "rollup_oldest_hour": sorted_keys[0] if sorted_keys else None,
            "rollup_newest_hour": sorted_keys[-1] if sorted_keys else None,
        }

        for field in ROLLUP_FIELDS:
            mins = [self._buckets[k].mins[field] for k in recent_keys if field in self._buckets[k].mins]
            maxs = [self._buckets[k].maxs[field] for k in recent_keys if field in self._buckets[k].maxs]
            if mins:
                summary[f"rollup_{field}_min"] = round(min(mins), 2)
            if maxs:
                summary[f"rollup_{field}_max"] = round(max(maxs), 2)

        for field in ROLLUP_BOOL_FIELDS:
            true_total = sum(self._buckets[k].bool_true_counts[field] for k in recent_keys)
            summary[f"rollup_{field}_pct"] = round(true_total / total_readings * 100, 1)

        return summary

    def _prune(self) -> None:
        if len(self._buckets) <= MAX_BUCKETS:
            return
        sorted_keys = sorted(self._buckets.keys())
        for key in sorted_keys[: len(sorted_keys) - MAX_BUCKETS]:
            del self._buckets[key]

    def _save(self) -> None:
        if not self._persist_path:
            return
        try:
            tmp = self._persist_path + ".tmp"
            with open(tmp, "wb") as f:
                pickle.dump(self._buckets, f, protocol=pickle.HIGHEST_PROTOCOL)
            os.replace(tmp, self._persist_path)
        except Exception as exc:
            LOGGER.warning("Rollup save failed: %s", exc)

    def _load(self) -> None:
        if not self._persist_path or not os.path.exists(self._persist_path):
            return
        try:
            with open(self._persist_path, "rb") as f:
                self._buckets = pickle.load(f)
            LOGGER.info("Loaded rollup: %d hourly buckets", len(self._buckets))
            self._prune()
        except Exception as exc:
            LOGGER.warning("Rollup load failed (starting fresh): %s", exc)
            self._buckets = {}
