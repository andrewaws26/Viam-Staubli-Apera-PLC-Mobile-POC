"""
Tests for staubli_log_scraper.py — parsing logic only (no FTP).

Validates log line parsing, JSON parsing, to_dict() prefixing,
and graceful handling of empty/malformed data.
"""

import json
import sys
import os
from datetime import datetime, timedelta, timezone

import pytest

# Add src to path so we can import without installing
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from staubli_log_scraper import StaubliLogScraper, StaubliLogState


@pytest.fixture
def scraper():
    """Create a scraper instance (no actual FTP connection)."""
    return StaubliLogScraper(host="192.168.0.254")


@pytest.fixture
def now_ts():
    """Current UTC timestamp string for building test log lines."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")


@pytest.fixture
def old_ts():
    """Timestamp string 48 hours ago — outside the 24h window."""
    dt = datetime.now(timezone.utc) - timedelta(hours=48)
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


# --- URPS event parsing ---

class TestURPSParsing:
    def test_urps_basic(self, scraper, now_ts):
        state = StaubliLogState()
        log = f"{now_ts} ERROR URPS fault 0x168D detected on joint 3\n"
        scraper._parse_log(state, log)
        assert state.urps_events_24h == 1
        assert "0x168D" in state.urps_last_code
        assert state.urps_last_time != ""

    def test_urps_hex_variant(self, scraper, now_ts):
        state = StaubliLogState()
        log = f"{now_ts} WARN 0x168d protection triggered\n"
        scraper._parse_log(state, log)
        assert state.urps_events_24h == 1

    def test_urps_multiple_events(self, scraper, now_ts):
        state = StaubliLogState()
        log = (
            f"{now_ts} ERROR URPS fault 0x168D joint 1\n"
            f"{now_ts} ERROR URPS fault 0x168D joint 4\n"
            f"{now_ts} WARN URPS warning 0x168D\n"
        )
        scraper._parse_log(state, log)
        assert state.urps_events_24h == 3

    def test_urps_outside_24h_ignored(self, scraper, old_ts, now_ts):
        state = StaubliLogState()
        log = (
            f"{old_ts} ERROR URPS fault 0x168D old event\n"
            f"{now_ts} ERROR URPS fault 0x168D recent event\n"
        )
        scraper._parse_log(state, log)
        assert state.urps_events_24h == 1

    def test_urps_keeps_latest_time(self, scraper):
        state = StaubliLogState()
        dt1 = datetime.now(timezone.utc) - timedelta(hours=2)
        dt2 = datetime.now(timezone.utc) - timedelta(hours=1)
        ts1 = dt1.strftime("%Y-%m-%dT%H:%M:%S")
        ts2 = dt2.strftime("%Y-%m-%dT%H:%M:%S")
        log = (
            f"{ts1} ERROR URPS fault 0x168D first\n"
            f"{ts2} ERROR URPS fault 0x1234 second\n"
        )
        scraper._parse_log(state, log)
        assert state.urps_events_24h == 2
        assert ts2 in state.urps_last_time


# --- EtherCAT event parsing ---

class TestEtherCATparsing:
    def test_ethercat_basic(self, scraper, now_ts):
        state = StaubliLogState()
        log = f"{now_ts} ERROR EtherCAT communication error on slave 2\n"
        scraper._parse_log(state, log)
        assert state.ethercat_events_24h == 1
        assert state.ethercat_last_time != ""

    def test_ethercat_frame_loss(self, scraper, now_ts):
        state = StaubliLogState()
        log = (
            f"{now_ts} ERROR EtherCAT frame loss detected\n"
            f"{now_ts} WARN ECAT lost frame on ring\n"
        )
        scraper._parse_log(state, log)
        assert state.ethercat_events_24h == 2
        assert state.ethercat_frame_loss_24h == 2

    def test_ethercat_ecat_variant(self, scraper, now_ts):
        state = StaubliLogState()
        log = f"{now_ts} WARN ecatError on bus 0\n"
        scraper._parse_log(state, log)
        assert state.ethercat_events_24h == 1


# --- Safety stop parsing ---

class TestSafetyParsing:
    def test_safety_stop(self, scraper, now_ts):
        state = StaubliLogState()
        log = f"{now_ts} WARN safety stop: door opened during cycle\n"
        scraper._parse_log(state, log)
        assert state.safety_stops_24h == 1
        assert "door opened" in state.safety_last_cause

    def test_estop(self, scraper, now_ts):
        state = StaubliLogState()
        log = f"{now_ts} ERROR e_stop activated by operator\n"
        scraper._parse_log(state, log)
        assert state.safety_stops_24h == 1

    def test_protective_stop(self, scraper, now_ts):
        state = StaubliLogState()
        log = f"{now_ts} WARN protective stop: collision detected\n"
        scraper._parse_log(state, log)
        assert state.safety_stops_24h == 1


# --- Servo event parsing ---

class TestServoParsing:
    def test_servo_disable(self, scraper, now_ts):
        state = StaubliLogState()
        log = f"{now_ts} INFO servo off\n{now_ts} INFO servo_disable\n"
        scraper._parse_log(state, log)
        assert state.servo_disable_count_24h == 2

    def test_servo_enable(self, scraper, now_ts):
        state = StaubliLogState()
        log = f"{now_ts} INFO servo on\n{now_ts} INFO servo_enable\n"
        scraper._parse_log(state, log)
        assert state.servo_enable_count_24h == 2


# --- App crash/restart parsing ---

class TestAppParsing:
    def test_crash_detected(self, scraper, now_ts):
        state = StaubliLogState()
        log = f"{now_ts} FATAL crash: segfault in motion planner\n"
        scraper._parse_log(state, log)
        assert state.app_last_crash_time != ""
        assert "segfault" in state.app_last_crash_reason.lower() or "motion" in state.app_last_crash_reason.lower()

    def test_restart_counted(self, scraper, now_ts):
        state = StaubliLogState()
        log = (
            f"{now_ts} INFO application started\n"
            f"{now_ts} INFO app_start complete\n"
        )
        scraper._parse_log(state, log)
        assert state.app_restarts_24h == 2


# --- arm.json parsing ---

class TestArmJsonParsing:
    def test_parse_arm_json_standard(self, scraper):
        state = StaubliLogState()
        data = json.dumps({"totalCycles": 150000, "powerOnHours": 4523.7})
        scraper._parse_arm_json(state, data)
        assert state.arm_total_cycles == 150000
        assert state.arm_power_on_hours == 4523.7

    def test_parse_arm_json_alt_keys(self, scraper):
        state = StaubliLogState()
        data = json.dumps({"nbCycles": 99000, "runHours": 1200.5})
        scraper._parse_arm_json(state, data)
        assert state.arm_total_cycles == 99000
        assert state.arm_power_on_hours == 1200.5

    def test_parse_arm_json_empty(self, scraper):
        state = StaubliLogState()
        scraper._parse_arm_json(state, "")
        assert state.arm_total_cycles == 0
        assert state.arm_power_on_hours == 0.0

    def test_parse_arm_json_malformed(self, scraper):
        state = StaubliLogState()
        scraper._parse_arm_json(state, "not json at all {{{{")
        assert state.arm_total_cycles == 0


# --- thread_usage.json parsing ---

class TestThreadUsageParsing:
    def test_parse_cpu_load_direct(self, scraper):
        state = StaubliLogState()
        data = json.dumps({"cpuLoad": 42.5})
        scraper._parse_thread_usage(state, data)
        assert state.controller_cpu_load_pct == 42.5

    def test_parse_cpu_load_alt_key(self, scraper):
        state = StaubliLogState()
        data = json.dumps({"totalLoad": 88.1})
        scraper._parse_thread_usage(state, data)
        assert state.controller_cpu_load_pct == 88.1

    def test_parse_cpu_load_from_threads(self, scraper):
        state = StaubliLogState()
        data = json.dumps({
            "threads": [
                {"name": "motion", "load": 25.0},
                {"name": "io", "cpuLoad": 15.0},
                {"name": "comm", "load": 10.0},
            ]
        })
        scraper._parse_thread_usage(state, data)
        assert state.controller_cpu_load_pct == 50.0

    def test_parse_thread_usage_empty(self, scraper):
        state = StaubliLogState()
        scraper._parse_thread_usage(state, "")
        assert state.controller_cpu_load_pct == 0.0

    def test_parse_thread_usage_malformed(self, scraper):
        state = StaubliLogState()
        scraper._parse_thread_usage(state, "{{garbage}}")
        assert state.controller_cpu_load_pct == 0.0


# --- to_dict() prefixing ---

class TestToDict:
    def test_all_keys_prefixed(self):
        state = StaubliLogState()
        d = state.to_dict()
        for key in d:
            assert key.startswith("staubli_log_"), f"Key {key} missing prefix"

    def test_values_propagate(self):
        state = StaubliLogState()
        state.urps_events_24h = 5
        state.arm_total_cycles = 123456
        state.controller_cpu_load_pct = 55.5
        state.log_connected = True
        d = state.to_dict()
        assert d["staubli_log_urps_events_24h"] == 5
        assert d["staubli_log_arm_total_cycles"] == 123456
        assert d["staubli_log_controller_cpu_load_pct"] == 55.5
        assert d["staubli_log_log_connected"] is True

    def test_default_values(self):
        state = StaubliLogState()
        d = state.to_dict()
        assert d["staubli_log_log_connected"] is False
        assert d["staubli_log_error"] == ""
        assert d["staubli_log_urps_events_24h"] == 0


# --- Graceful failure handling ---

class TestGracefulFailure:
    def test_empty_log_no_crash(self, scraper):
        state = StaubliLogState()
        scraper._parse_log(state, "")
        assert state.urps_events_24h == 0

    def test_no_timestamp_lines_handled(self, scraper):
        state = StaubliLogState()
        log = "random line with no timestamp and URPS keyword\nanother line\n"
        # Lines without parseable timestamps should not count toward 24h events
        # because _is_within_24h returns False for None timestamps
        scraper._parse_log(state, log)
        assert state.urps_events_24h == 0

    def test_binary_garbage_in_log(self, scraper):
        state = StaubliLogState()
        log = "\x00\x01\x02 URPS \xff\xfe\n"
        scraper._parse_log(state, log)
        # Should not crash — event won't match 24h window without timestamp
        assert state.urps_events_24h == 0

    def test_mixed_valid_and_invalid(self, scraper, now_ts):
        state = StaubliLogState()
        log = (
            "garbage line\n"
            f"{now_ts} ERROR URPS fault 0x168D\n"
            "\x00\x01\x02\n"
            f"{now_ts} WARN EtherCAT error\n"
            "another garbage line\n"
        )
        scraper._parse_log(state, log)
        assert state.urps_events_24h == 1
        assert state.ethercat_events_24h == 1

    def test_arm_json_not_a_dict(self, scraper):
        state = StaubliLogState()
        scraper._parse_arm_json(state, json.dumps([1, 2, 3]))
        assert state.arm_total_cycles == 0

    def test_thread_usage_not_a_dict(self, scraper):
        state = StaubliLogState()
        scraper._parse_thread_usage(state, json.dumps("just a string"))
        assert state.controller_cpu_load_pct == 0.0
