"""Unit tests for utility functions in plc_sensor.py."""

import json
import os
import sys
import time

# Insert source directory so we can import module-internal symbols.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from plc_offline import OfflineBuffer
from plc_utils import _read_chat_queue, _serialise, _uint16

# ---------------------------------------------------------------------------
# _serialise
# ---------------------------------------------------------------------------

class TestSerialise:
    def test_bool_true(self):
        assert _serialise(True) is True

    def test_bool_false(self):
        assert _serialise(False) is False

    def test_bool_not_coerced_to_int(self):
        # bool is a subclass of int; make sure we get bool back, not 1/0
        result = _serialise(True)
        assert isinstance(result, bool)

    def test_int(self):
        assert _serialise(42) == 42
        assert isinstance(_serialise(42), int)

    def test_int_zero(self):
        assert _serialise(0) == 0

    def test_negative_int(self):
        assert _serialise(-7) == -7

    def test_float(self):
        assert _serialise(3.14) == 3.14
        assert isinstance(_serialise(3.14), float)

    def test_string(self):
        assert _serialise("hello") == "hello"
        assert isinstance(_serialise("hello"), str)

    def test_empty_string(self):
        assert _serialise("") == ""

    def test_list_becomes_str(self):
        assert _serialise([1, 2, 3]) == "[1, 2, 3]"

    def test_none_becomes_str(self):
        assert _serialise(None) == "None"

    def test_dict_becomes_str(self):
        result = _serialise({"a": 1})
        assert isinstance(result, str)

    def test_tuple_becomes_str(self):
        assert _serialise((1, 2)) == "(1, 2)"


# ---------------------------------------------------------------------------
# _uint16
# ---------------------------------------------------------------------------

class TestUint16:
    def test_zero(self):
        assert _uint16(0) == 0

    def test_max_unsigned(self):
        assert _uint16(65535) == 65535

    def test_negative_one_wraps(self):
        assert _uint16(-1) == 65535

    def test_overflow_wraps(self):
        assert _uint16(65536) == 0

    def test_negative_32768(self):
        assert _uint16(-32768) == 32768

    def test_positive_32767(self):
        assert _uint16(32767) == 32767

    def test_large_positive(self):
        assert _uint16(0x1FFFF) == 0xFFFF

    def test_midrange(self):
        assert _uint16(1000) == 1000


# ---------------------------------------------------------------------------
# OfflineBuffer
# ---------------------------------------------------------------------------

class TestOfflineBuffer:
    def test_constructor_creates_directory(self, tmp_path):
        buf_dir = str(tmp_path / "newdir" / "buffer")
        OfflineBuffer(buf_dir)
        assert os.path.isdir(buf_dir)

    def test_write_creates_file(self, tmp_path):
        buf = OfflineBuffer(str(tmp_path))
        buf.write({"temp": 42})
        files = [f for f in os.listdir(str(tmp_path)) if f.endswith(".jsonl")]
        assert len(files) == 1

    def test_write_filename_format(self, tmp_path):
        buf = OfflineBuffer(str(tmp_path))
        buf.write({"x": 1})
        files = os.listdir(str(tmp_path))
        today = time.strftime("%Y%m%d")
        assert f"readings_{today}.jsonl" in files

    def test_written_line_is_valid_json(self, tmp_path):
        buf = OfflineBuffer(str(tmp_path))
        buf.write({"speed": 5.5, "count": 10})
        today = time.strftime("%Y%m%d")
        path = os.path.join(str(tmp_path), f"readings_{today}.jsonl")
        with open(path) as f:
            line = f.readline()
        record = json.loads(line)
        assert isinstance(record, dict)

    def test_written_line_has_ts_and_epoch(self, tmp_path):
        buf = OfflineBuffer(str(tmp_path))
        buf.write({"val": 1})
        today = time.strftime("%Y%m%d")
        path = os.path.join(str(tmp_path), f"readings_{today}.jsonl")
        with open(path) as f:
            record = json.loads(f.readline())
        assert "ts" in record
        assert "epoch" in record
        assert isinstance(record["epoch"], float)

    def test_written_line_contains_readings(self, tmp_path):
        buf = OfflineBuffer(str(tmp_path))
        buf.write({"plate_count": 99, "running": True})
        today = time.strftime("%Y%m%d")
        path = os.path.join(str(tmp_path), f"readings_{today}.jsonl")
        with open(path) as f:
            record = json.loads(f.readline())
        assert record["plate_count"] == 99
        assert record["running"] is True

    def test_multiple_writes_append(self, tmp_path):
        buf = OfflineBuffer(str(tmp_path))
        buf.write({"a": 1})
        buf.write({"b": 2})
        buf.write({"c": 3})
        today = time.strftime("%Y%m%d")
        path = os.path.join(str(tmp_path), f"readings_{today}.jsonl")
        with open(path) as f:
            lines = f.readlines()
        assert len(lines) == 3

    def test_prune_removes_oldest_files(self, tmp_path):
        # Create a buffer with a tiny cap (1 byte) so pruning triggers
        buf = OfflineBuffer(str(tmp_path), max_mb=0.000001)
        # Manually create two "old" files with some data
        old_file = os.path.join(str(tmp_path), "readings_20250101.jsonl")
        with open(old_file, "w") as f:
            f.write('{"ts":"old","epoch":0}\n' * 100)
        # Touch the old file to make it older
        os.utime(old_file, (0, 0))
        # Write a new reading — this triggers prune
        buf.write({"x": 1})
        # The old file should be pruned (only today's file remains)
        remaining = [f for f in os.listdir(str(tmp_path)) if f.endswith(".jsonl")]
        assert "readings_20250101.jsonl" not in remaining
        assert len(remaining) >= 1  # today's file still there

    def test_prune_keeps_single_file(self, tmp_path):
        # Even if over cap, the last remaining file is never deleted
        buf = OfflineBuffer(str(tmp_path), max_mb=0.000001)
        buf.write({"big": "x" * 5000})
        remaining = [f for f in os.listdir(str(tmp_path)) if f.endswith(".jsonl")]
        assert len(remaining) == 1


# ---------------------------------------------------------------------------
# _read_chat_queue
# ---------------------------------------------------------------------------

class TestReadChatQueue:
    def test_returns_empty_when_file_missing(self, monkeypatch):
        monkeypatch.setattr(
            "plc_utils._CHAT_QUEUE_FILE", "/tmp/_test_nonexistent_queue.jsonl"
        )
        # Ensure file does not exist
        if os.path.exists("/tmp/_test_nonexistent_queue.jsonl"):
            os.remove("/tmp/_test_nonexistent_queue.jsonl")
        assert _read_chat_queue() == []

    def test_returns_empty_when_file_is_empty(self, tmp_path, monkeypatch):
        queue_file = str(tmp_path / "queue.jsonl")
        with open(queue_file, "w") as f:
            pass  # empty file
        monkeypatch.setattr("plc_utils._CHAT_QUEUE_FILE", queue_file)
        assert _read_chat_queue() == []

    def test_parses_jsonl_lines(self, tmp_path, monkeypatch):
        queue_file = str(tmp_path / "queue.jsonl")
        events = [
            {"ts": "2026-04-05T10:00:00Z", "type": "voice", "user": "hello"},
            {"ts": "2026-04-05T10:00:01Z", "type": "diagnosis", "user": "check"},
        ]
        with open(queue_file, "w") as f:
            for ev in events:
                f.write(json.dumps(ev) + "\n")
        monkeypatch.setattr("plc_utils._CHAT_QUEUE_FILE", queue_file)
        result = _read_chat_queue()
        assert len(result) == 2
        assert result[0]["type"] == "voice"
        assert result[1]["type"] == "diagnosis"

    def test_clears_file_after_reading(self, tmp_path, monkeypatch):
        queue_file = str(tmp_path / "queue.jsonl")
        with open(queue_file, "w") as f:
            f.write(json.dumps({"ts": "now", "type": "voice"}) + "\n")
        monkeypatch.setattr("plc_utils._CHAT_QUEUE_FILE", queue_file)
        _read_chat_queue()
        # File should still exist but be empty (truncated, not deleted)
        assert os.path.exists(queue_file)
        with open(queue_file) as f:
            assert f.read() == ""

    def test_skips_malformed_json_lines(self, tmp_path, monkeypatch):
        queue_file = str(tmp_path / "queue.jsonl")
        with open(queue_file, "w") as f:
            f.write('{"good": true}\n')
            f.write("this is not json\n")
            f.write('{"also_good": true}\n')
        monkeypatch.setattr("plc_utils._CHAT_QUEUE_FILE", queue_file)
        result = _read_chat_queue()
        assert len(result) == 2
        assert result[0]["good"] is True
        assert result[1]["also_good"] is True

    def test_skips_blank_lines(self, tmp_path, monkeypatch):
        queue_file = str(tmp_path / "queue.jsonl")
        with open(queue_file, "w") as f:
            f.write('{"a": 1}\n')
            f.write("\n")
            f.write("   \n")
            f.write('{"b": 2}\n')
        monkeypatch.setattr("plc_utils._CHAT_QUEUE_FILE", queue_file)
        result = _read_chat_queue()
        assert len(result) == 2
