"""Tests for plc_commands.py — dispatch_command and all 14 handlers.

These tests mock the Modbus client and verify:
- Correct coil/register reads and writes for each action
- Error handling when Modbus calls fail
- Input validation (missing params, out-of-range values)
- Unknown action fallback
- Callback invocation (plate_drop_reset_cb)
"""

import asyncio
import json
import os
import sys
import pytest
from unittest.mock import MagicMock, patch, mock_open

# Ensure src/ is on path for direct imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from plc_commands import dispatch_command


# ── Fixtures ────────────────────────────────────────────────────────────


@pytest.fixture
def client():
    """Mock Modbus client with default successful responses."""
    c = MagicMock()
    c.connect.return_value = True
    c.is_socket_open.return_value = True

    # Discrete inputs: X4 (idx 3) = True → TPS power on
    di = MagicMock()
    di.isError.return_value = False
    di.bits = [False, False, False, True] + [False] * 12  # X4 on
    c.read_discrete_inputs.return_value = di

    # Holding registers: 25 zeros
    hr = MagicMock()
    hr.isError.return_value = False
    hr.registers = [0] * 25
    c.read_holding_registers.return_value = hr

    # Coils: 40 False
    coils = MagicMock()
    coils.isError.return_value = False
    coils.bits = [False] * 40
    c.read_coils.return_value = coils

    # Writes succeed by default
    c.write_coil.return_value = None
    c.write_register.return_value = None

    return c


@pytest.fixture
def client_tps_off(client):
    """Client with TPS power OFF (X4 = False)."""
    di = MagicMock()
    di.isError.return_value = False
    di.bits = [False] * 16
    client.read_discrete_inputs.return_value = di
    return client


# ── Unknown action ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_unknown_action(client):
    result = await dispatch_command(client, {"action": "explode"})
    assert result["status"] == "error"
    assert "Unknown action" in result["message"]
    assert "explode" in result["message"]


@pytest.mark.asyncio
async def test_empty_action(client):
    result = await dispatch_command(client, {})
    assert result["action"] == ""
    assert "Unknown action" in result["message"]


# ── test_eject ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_test_eject_y1(client):
    result = await dispatch_command(client, {"action": "test_eject", "output": "Y1"})
    assert result["status"] == "ok"
    assert "Y1" in result["message"]
    # Should write True then False to coil 8192
    calls = client.write_coil.call_args_list
    assert len(calls) == 2
    assert calls[0].kwargs == {"address": 8192, "value": True}
    assert calls[1].kwargs == {"address": 8192, "value": False}


@pytest.mark.asyncio
async def test_test_eject_y2(client):
    result = await dispatch_command(client, {"action": "test_eject", "output": "Y2"})
    assert result["status"] == "ok"
    calls = client.write_coil.call_args_list
    assert calls[0].kwargs["address"] == 8193


@pytest.mark.asyncio
async def test_test_eject_y3(client):
    result = await dispatch_command(client, {"action": "test_eject", "output": "Y3"})
    assert result["status"] == "ok"
    calls = client.write_coil.call_args_list
    assert calls[0].kwargs["address"] == 8194


@pytest.mark.asyncio
async def test_test_eject_unknown_output(client):
    result = await dispatch_command(client, {"action": "test_eject", "output": "Y9"})
    assert result["status"] == "error"
    assert "Unknown output" in result["message"]


@pytest.mark.asyncio
async def test_test_eject_tps_off(client_tps_off):
    result = await dispatch_command(client_tps_off, {"action": "test_eject", "output": "Y1"})
    assert result["status"] == "error"
    assert "TPS power" in result["message"]
    assert result["tps_power"] is False


@pytest.mark.asyncio
async def test_test_eject_write_fails(client):
    client.write_coil.side_effect = Exception("Modbus timeout")
    result = await dispatch_command(client, {"action": "test_eject", "output": "Y1"})
    assert result["status"] == "error"
    assert "Modbus write failed" in result["message"]


# ── software_eject ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_software_eject(client):
    result = await dispatch_command(client, {"action": "software_eject"})
    assert result["status"] == "ok"
    assert "C29" in result["message"]
    calls = client.write_coil.call_args_list
    assert calls[0].kwargs == {"address": 28, "value": True}
    assert calls[1].kwargs == {"address": 28, "value": False}


@pytest.mark.asyncio
async def test_software_eject_tps_off(client_tps_off):
    result = await dispatch_command(client_tps_off, {"action": "software_eject"})
    assert result["status"] == "error"
    assert "TPS power" in result["message"]


# ── reset_counters ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_reset_counters(client):
    cb = MagicMock()
    result = await dispatch_command(client, {"action": "reset_counters"}, plate_drop_reset_cb=cb)
    assert result["status"] == "ok"
    assert "reset" in result["message"].lower()
    cb.assert_called_once()
    # C1 pulsed
    calls = client.write_coil.call_args_list
    assert calls[0].kwargs == {"address": 0, "value": True}
    assert calls[1].kwargs == {"address": 0, "value": False}


@pytest.mark.asyncio
async def test_reset_counters_no_callback(client):
    result = await dispatch_command(client, {"action": "reset_counters"})
    assert result["status"] == "ok"


@pytest.mark.asyncio
async def test_reset_counters_write_fails(client):
    client.write_coil.side_effect = Exception("Bus error")
    result = await dispatch_command(client, {"action": "reset_counters"})
    assert result["status"] == "error"
    assert "Modbus write failed" in result["message"]


# ── set_mode ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_set_mode_single(client):
    result = await dispatch_command(client, {"action": "set_mode", "mode": "single"})
    assert result["status"] == "ok"
    assert "TPS-1 Single" in result["message"]


@pytest.mark.asyncio
async def test_set_mode_double(client):
    result = await dispatch_command(client, {"action": "set_mode", "mode": "double"})
    assert result["status"] == "ok"
    assert "TPS-1 Double" in result["message"]


@pytest.mark.asyncio
async def test_set_mode_all_modes(client):
    """Every valid mode should succeed."""
    for mode in ["single", "double", "both", "left", "right", "tie_team", "2nd_pass"]:
        result = await dispatch_command(client, {"action": "set_mode", "mode": mode})
        assert result["status"] == "ok", f"Mode {mode} failed"


@pytest.mark.asyncio
async def test_set_mode_clears_others(client):
    """Setting a mode should clear all other mode coils first."""
    await dispatch_command(client, {"action": "set_mode", "mode": "single"})
    # 7 mode coils cleared (False) + 1 set (True) = 8 write_coil calls
    calls = client.write_coil.call_args_list
    false_calls = [c for c in calls if c.kwargs["value"] is False]
    true_calls = [c for c in calls if c.kwargs["value"] is True]
    assert len(false_calls) == 7
    assert len(true_calls) == 1
    assert true_calls[0].kwargs["address"] == 19  # C20 = Single


@pytest.mark.asyncio
async def test_set_mode_unknown(client):
    result = await dispatch_command(client, {"action": "set_mode", "mode": "turbo"})
    assert result["status"] == "error"
    assert "Unknown mode" in result["message"]


@pytest.mark.asyncio
async def test_set_mode_write_fails(client):
    client.write_coil.side_effect = Exception("Timeout")
    result = await dispatch_command(client, {"action": "set_mode", "mode": "single"})
    assert result["status"] == "error"
    assert "Modbus write failed" in result["message"]


# ── set_spacing ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_set_spacing_valid(client):
    result = await dispatch_command(client, {"action": "set_spacing", "value": 39})
    assert result["status"] == "ok"
    assert "19.5" in result["message"]
    client.write_register.assert_called_once_with(address=1, value=39)


@pytest.mark.asyncio
async def test_set_spacing_missing_value(client):
    result = await dispatch_command(client, {"action": "set_spacing"})
    assert result["status"] == "error"
    assert "Missing" in result["message"]


@pytest.mark.asyncio
async def test_set_spacing_invalid_type(client):
    result = await dispatch_command(client, {"action": "set_spacing", "value": "abc"})
    assert result["status"] == "error"
    assert "Invalid" in result["message"]


@pytest.mark.asyncio
async def test_set_spacing_too_low(client):
    result = await dispatch_command(client, {"action": "set_spacing", "value": 10})
    assert result["status"] == "error"
    assert "out of range" in result["message"]


@pytest.mark.asyncio
async def test_set_spacing_too_high(client):
    result = await dispatch_command(client, {"action": "set_spacing", "value": 100})
    assert result["status"] == "error"
    assert "out of range" in result["message"]


@pytest.mark.asyncio
async def test_set_spacing_boundary_low(client):
    result = await dispatch_command(client, {"action": "set_spacing", "value": 20})
    assert result["status"] == "ok"


@pytest.mark.asyncio
async def test_set_spacing_boundary_high(client):
    result = await dispatch_command(client, {"action": "set_spacing", "value": 60})
    assert result["status"] == "ok"


# ── toggle_coil actions ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_toggle_drop_enable(client):
    result = await dispatch_command(client, {"action": "toggle_drop_enable"})
    assert result["status"] == "ok"
    assert "Drop enable" in result["message"]
    assert result["value"] is True  # Toggled from False


@pytest.mark.asyncio
async def test_toggle_encoder(client):
    result = await dispatch_command(client, {"action": "toggle_encoder"})
    assert result["status"] == "ok"
    assert "Encoder" in result["message"]


@pytest.mark.asyncio
async def test_toggle_lay_ties(client):
    result = await dispatch_command(client, {"action": "toggle_lay_ties"})
    assert result["status"] == "ok"
    assert "Lay Ties" in result["message"]


@pytest.mark.asyncio
async def test_toggle_drop_ties(client):
    result = await dispatch_command(client, {"action": "toggle_drop_ties"})
    assert result["status"] == "ok"
    assert "Drop Ties" in result["message"]


@pytest.mark.asyncio
async def test_toggle_reads_current_value(client):
    """Toggle should read current coil state and write opposite."""
    # Set current coil to True
    coils = MagicMock()
    coils.isError.return_value = False
    coils.bits = [True] + [False] * 39
    client.read_coils.return_value = coils

    result = await dispatch_command(client, {"action": "toggle_drop_enable"})
    assert result["status"] == "ok"
    assert result["value"] is False  # Toggled from True to False


@pytest.mark.asyncio
async def test_toggle_write_fails(client):
    client.write_coil.side_effect = Exception("Bus error")
    result = await dispatch_command(client, {"action": "toggle_drop_enable"})
    assert result["status"] == "error"
    assert "Modbus write failed" in result["message"]


# ── set_detector_offset ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_set_detector_offset_valid(client):
    result = await dispatch_command(client, {"action": "set_detector_offset", "value": 500})
    assert result["status"] == "ok"
    client.write_register.assert_called_once_with(address=4, value=500)


@pytest.mark.asyncio
async def test_set_detector_offset_missing(client):
    result = await dispatch_command(client, {"action": "set_detector_offset"})
    assert result["status"] == "error"
    assert "Missing" in result["message"]


@pytest.mark.asyncio
async def test_set_detector_offset_too_low(client):
    result = await dispatch_command(client, {"action": "set_detector_offset", "value": 50})
    assert result["status"] == "error"
    assert "out of range" in result["message"]


@pytest.mark.asyncio
async def test_set_detector_offset_too_high(client):
    result = await dispatch_command(client, {"action": "set_detector_offset", "value": 9999})
    assert result["status"] == "error"
    assert "out of range" in result["message"]


@pytest.mark.asyncio
async def test_set_detector_offset_invalid_type(client):
    result = await dispatch_command(client, {"action": "set_detector_offset", "value": "nope"})
    assert result["status"] == "error"
    assert "Invalid" in result["message"]


# ── clear_data_counts ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_clear_data_counts(client):
    result = await dispatch_command(client, {"action": "clear_data_counts"})
    assert result["status"] == "ok"
    assert "C15" in result["message"]
    calls = client.write_coil.call_args_list
    assert calls[0].kwargs == {"address": 14, "value": True}
    assert calls[1].kwargs == {"address": 14, "value": False}


@pytest.mark.asyncio
async def test_clear_data_counts_write_fails(client):
    client.write_coil.side_effect = Exception("Timeout")
    result = await dispatch_command(client, {"action": "clear_data_counts"})
    assert result["status"] == "error"


# ── list_profiles ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_profiles_empty(client, tmp_path):
    with patch("plc_commands._get_profile_dir", return_value=str(tmp_path)):
        result = await dispatch_command(client, {"action": "list_profiles"})
    assert result["status"] == "ok"
    assert result["profiles"] == []
    assert "0 profile" in result["message"]


@pytest.mark.asyncio
async def test_list_profiles_with_files(client, tmp_path):
    profile = {"name": "Standard TPS", "description": "Default config", "version": "1.0"}
    (tmp_path / "standard.json").write_text(json.dumps(profile))
    with patch("plc_commands._get_profile_dir", return_value=str(tmp_path)):
        result = await dispatch_command(client, {"action": "list_profiles"})
    assert result["status"] == "ok"
    assert len(result["profiles"]) == 1
    assert result["profiles"][0]["name"] == "Standard TPS"


# ── provision ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_provision_missing_profile(client):
    result = await dispatch_command(client, {"action": "provision"})
    assert result["status"] == "error"
    assert "Missing" in result["message"]


@pytest.mark.asyncio
async def test_provision_not_found(client, tmp_path):
    with patch("plc_commands._get_profile_dir", return_value=str(tmp_path)):
        result = await dispatch_command(client, {"action": "provision", "profile": "nope.json"})
    assert result["status"] == "error"
    assert "not found" in result["message"]


@pytest.mark.asyncio
async def test_provision_dry_run(client, tmp_path):
    profile = {
        "name": "Test Profile",
        "verify_after_write": False,
        "registers": {"DS2": {"address": 1, "value": 39, "label": "Tie spacing"}},
        "coils": {},
    }
    (tmp_path / "test.json").write_text(json.dumps(profile))
    with patch("plc_commands._get_profile_dir", return_value=str(tmp_path)):
        result = await dispatch_command(client, {"action": "provision", "profile": "test.json", "dry_run": True})
    assert result["status"] == "dry_run"
    assert result["summary"]["total"] == 1
    # No actual writes in dry run
    client.write_register.assert_not_called()


@pytest.mark.asyncio
async def test_provision_writes_register(client, tmp_path):
    profile = {
        "name": "Test Profile",
        "verify_after_write": False,
        "registers": {"DS2": {"address": 1, "value": 39}},
        "coils": {},
    }
    (tmp_path / "test.json").write_text(json.dumps(profile))
    # Current value is 0, so it should write
    with patch("plc_commands._get_profile_dir", return_value=str(tmp_path)):
        result = await dispatch_command(client, {"action": "provision", "profile": "test.json"})
    assert result["status"] == "ok"
    assert result["summary"]["written"] == 1
    client.write_register.assert_called_once_with(address=1, value=39)


@pytest.mark.asyncio
async def test_provision_skips_unchanged(client, tmp_path):
    profile = {
        "name": "Test",
        "verify_after_write": False,
        "registers": {"DS2": {"address": 1, "value": 0}},  # Already 0
        "coils": {},
    }
    (tmp_path / "test.json").write_text(json.dumps(profile))
    with patch("plc_commands._get_profile_dir", return_value=str(tmp_path)):
        result = await dispatch_command(client, {"action": "provision", "profile": "test.json"})
    assert result["status"] == "ok"
    assert result["summary"]["unchanged"] == 1
    assert result["summary"]["written"] == 0
    client.write_register.assert_not_called()


@pytest.mark.asyncio
async def test_provision_writes_coils(client, tmp_path):
    profile = {
        "name": "Test",
        "verify_after_write": False,
        "registers": {},
        "coils": {"C16_DropEnable": {"address": 15, "value": True}},
    }
    (tmp_path / "test.json").write_text(json.dumps(profile))
    with patch("plc_commands._get_profile_dir", return_value=str(tmp_path)):
        result = await dispatch_command(client, {"action": "provision", "profile": "test.json"})
    assert result["status"] == "ok"
    client.write_coil.assert_called_once_with(address=15, value=True)


@pytest.mark.asyncio
async def test_provision_verify_pass(client, tmp_path):
    profile = {
        "name": "Test",
        "verify_after_write": True,
        "registers": {"DS2": {"address": 1, "value": 39}},
        "coils": {},
    }
    (tmp_path / "test.json").write_text(json.dumps(profile))

    # After write, read-back returns the new value
    def read_hr_side_effect(address, count):
        r = MagicMock()
        r.isError.return_value = False
        r.registers = [39]  # Written value
        return r

    # First call returns 0 (old), second returns 39 (verify)
    call_count = {"n": 0}
    def read_hr(address, count):
        call_count["n"] += 1
        r = MagicMock()
        r.isError.return_value = False
        r.registers = [0] if call_count["n"] == 1 else [39]
        return r

    client.read_holding_registers.side_effect = read_hr

    with patch("plc_commands._get_profile_dir", return_value=str(tmp_path)):
        result = await dispatch_command(client, {"action": "provision", "profile": "test.json"})
    assert result["status"] == "ok"
    assert result["steps"][0]["verify"] == "OK"


# ── read_config ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_read_config(client):
    hr = MagicMock()
    hr.isError.return_value = False
    hr.registers = list(range(25))
    client.read_holding_registers.return_value = hr

    coils = MagicMock()
    coils.isError.return_value = False
    coils.bits = [False] * 32
    coils.bits[15] = True  # C16 drop enable
    client.read_coils.return_value = coils

    result = await dispatch_command(client, {"action": "read_config"})
    assert result["status"] == "ok"
    assert result["config"]["DS1"] == 0
    assert result["config"]["DS2"] == 1
    assert result["config"]["DS10"] == 9
    assert result["config"]["C16_DropEnable"] is True
    assert result["config"]["C13_LayTies"] is False


@pytest.mark.asyncio
async def test_read_config_modbus_error(client):
    client.read_holding_registers.side_effect = Exception("Timeout")
    result = await dispatch_command(client, {"action": "read_config"})
    assert result["status"] == "error"
    assert "Read failed" in result["message"]


# ── TPS power read failure ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_tps_power_read_error_still_dispatches(client):
    """If reading TPS power fails, command should still execute (tps_on=False)."""
    client.read_discrete_inputs.side_effect = Exception("Bus error")
    # Non-eject command should still work
    result = await dispatch_command(client, {"action": "read_config"})
    assert result["status"] == "ok"


@pytest.mark.asyncio
async def test_dispatch_returns_action_in_result(client):
    """Every result should echo back the action name."""
    result = await dispatch_command(client, {"action": "read_config"})
    assert result["action"] == "read_config"
