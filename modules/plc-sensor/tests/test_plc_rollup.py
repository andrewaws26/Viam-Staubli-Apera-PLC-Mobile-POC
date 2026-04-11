"""Tests for the PLC hourly rollup module.

Validates bucket aggregation, ring buffer pruning, JSON serialization,
summary computation, and persistence.
"""

import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from plc_rollup import HourlyBucket, HourlyRollup


class TestHourlyBucket:
    """Tests for individual hour bucket aggregation."""

    def test_empty_bucket(self):
        b = HourlyBucket("2026-04-06T14")
        assert b.count == 0
        d = b.to_dict()
        assert d["hour"] == "2026-04-06T14"
        assert d["count"] == 0

    def test_single_reading(self):
        b = HourlyBucket("2026-04-06T14")
        b.ingest({"encoder_speed_ftpm": 120.5, "tps_power_loop": True})
        assert b.count == 1
        d = b.to_dict()
        assert d["encoder_speed_ftpm_avg"] == 120.5
        assert d["encoder_speed_ftpm_min"] == 120.5
        assert d["encoder_speed_ftpm_max"] == 120.5
        assert d["tps_power_loop_pct"] == 100.0

    def test_multiple_readings(self):
        b = HourlyBucket("2026-04-06T14")
        b.ingest({"encoder_speed_ftpm": 100, "tps_power_loop": True})
        b.ingest({"encoder_speed_ftpm": 200, "tps_power_loop": False})
        b.ingest({"encoder_speed_ftpm": 150, "tps_power_loop": True})
        assert b.count == 3
        d = b.to_dict()
        assert d["encoder_speed_ftpm_min"] == 100
        assert d["encoder_speed_ftpm_max"] == 200
        assert d["encoder_speed_ftpm_avg"] == 150.0
        assert d["tps_power_loop_pct"] == round(2 / 3 * 100, 1)

    def test_missing_fields_ignored(self):
        b = HourlyBucket("2026-04-06T14")
        b.ingest({"some_other_field": 42})
        assert b.count == 1
        d = b.to_dict()
        assert "encoder_speed_ftpm_avg" not in d

    def test_none_values_skipped(self):
        b = HourlyBucket("2026-04-06T14")
        b.ingest({"encoder_speed_ftpm": None})
        assert b.count == 1
        d = b.to_dict()
        assert "encoder_speed_ftpm_avg" not in d


class TestHourlyRollup:
    """Tests for the rollup ring buffer."""

    def test_ingest_creates_bucket(self):
        r = HourlyRollup()
        r.ingest({"encoder_speed_ftpm": 100})
        assert len(r._buckets) == 1

    def test_to_json_returns_valid_json(self):
        r = HourlyRollup()
        r.ingest({"encoder_speed_ftpm": 100})
        j = r.to_json()
        data = json.loads(j)
        assert isinstance(data, list)
        assert len(data) == 1
        assert data[0]["count"] == 1

    def test_summary_has_expected_keys(self):
        r = HourlyRollup()
        r.ingest({"encoder_speed_ftpm": 100, "tps_power_loop": True})
        s = r.to_summary()
        assert s["rollup_hours"] == 1
        assert s["rollup_readings_24h"] == 1
        assert "rollup_encoder_speed_ftpm_max" in s
        assert "rollup_tps_power_loop_pct" in s

    def test_summary_empty_rollup(self):
        r = HourlyRollup()
        s = r.to_summary()
        assert s["rollup_hours"] == 0
        assert s["rollup_readings_24h"] == 0

    def test_prune_respects_max_buckets(self):
        r = HourlyRollup()
        # Manually insert 200 buckets
        for i in range(200):
            key = f"2026-01-{i // 24 + 1:02d}T{i % 24:02d}"
            r._buckets[key] = HourlyBucket(key)
            r._buckets[key].ingest({"encoder_speed_ftpm": i})
        r._prune()
        assert len(r._buckets) <= 168

    def test_persistence_round_trip(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            r1 = HourlyRollup(tmpdir)
            r1.ingest({"encoder_speed_ftpm": 42.0})
            r1._save()

            r2 = HourlyRollup(tmpdir)
            assert len(r2._buckets) == 1
            j = r2.to_json()
            data = json.loads(j)
            assert data[0]["encoder_speed_ftpm_avg"] == 42.0

    def test_persistence_survives_corruption(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            json_path = os.path.join(tmpdir, "plc_rollup.json")
            with open(json_path, "w") as f:
                f.write("not valid json")
            r = HourlyRollup(tmpdir)
            assert len(r._buckets) == 0  # graceful fallback
