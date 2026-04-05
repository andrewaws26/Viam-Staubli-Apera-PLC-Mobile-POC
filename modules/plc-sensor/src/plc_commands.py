"""PLC do_command dispatch — remote Modbus write commands.

Extracted from plc_sensor.py to keep the main class as a thin orchestrator.
All functions take the Modbus client and command dict, return a result dict.
"""

import asyncio
import glob
import json
import os
from typing import Any, Dict, Optional

from viam.logging import getLogger

LOGGER = getLogger(__name__)


async def dispatch_command(
    client,
    command: Dict[str, Any],
    *,
    plate_drop_reset_cb=None,
) -> Dict[str, Any]:
    """Route a do_command action to the appropriate handler.

    Args:
        client: Connected ModbusTcpClient.
        command: Dict with at least an "action" key.
        plate_drop_reset_cb: Optional callback to zero the Pi-side plate counter
                             (called on reset_counters).

    Returns:
        Result dict with "action", "status", and "message" keys.
    """
    action = command.get("action", "")
    result: Dict[str, Any] = {"action": action, "status": "error"}

    # Check TPS power for eject commands
    tps_on = False
    try:
        di = client.read_discrete_inputs(address=0, count=8)
        if not di.isError():
            tps_on = bool(di.bits[3])  # X4
    except Exception:
        LOGGER.debug("Failed to read TPS power state from discrete inputs")

    if action == "test_eject":
        await _handle_test_eject(client, command, result, tps_on)

    elif action == "software_eject":
        await _handle_software_eject(client, result, tps_on)

    elif action == "reset_counters":
        await _handle_reset_counters(client, result, plate_drop_reset_cb)

    elif action == "set_mode":
        _handle_set_mode(client, command, result)

    elif action == "set_spacing":
        _handle_set_spacing(client, command, result)

    elif action == "toggle_drop_enable":
        _handle_toggle_coil(client, result, address=15, name="Drop enable", c_label="C16")

    elif action == "toggle_encoder":
        _handle_toggle_coil(client, result, address=27, name="Encoder", c_label="C28")

    elif action == "toggle_lay_ties":
        _handle_toggle_coil(client, result, address=12, name="Lay Ties", c_label="C13")

    elif action == "toggle_drop_ties":
        _handle_toggle_coil(client, result, address=13, name="Drop Ties", c_label="C14")

    elif action == "set_detector_offset":
        _handle_set_detector_offset(client, command, result)

    elif action == "clear_data_counts":
        await _handle_clear_data_counts(client, result)

    elif action == "list_profiles":
        _handle_list_profiles(result)

    elif action == "provision":
        await _handle_provision(client, command, result)

    elif action == "read_config":
        _handle_read_config(client, result)

    else:
        result["message"] = (
            f"Unknown action: {action}. Use: software_eject, reset_counters, "
            "set_mode, set_spacing, toggle_drop_enable, toggle_encoder, "
            "toggle_lay_ties, toggle_drop_ties, set_detector_offset, clear_data_counts, "
            "list_profiles, provision, read_config"
        )

    return result


# ── Individual command handlers ──────────────────────────────────────────


async def _handle_test_eject(client, command, result, tps_on):
    output = command.get("output", "Y1").upper()
    coil_map = {"Y1": 8192, "Y2": 8193, "Y3": 8194}
    addr = coil_map.get(output)
    if addr is None:
        result["message"] = f"Unknown output: {output}. Use Y1, Y2, or Y3."
        return
    if not tps_on:
        result["message"] = "TPS power (X4) must be ON to fire eject. Turn on the TPS main switch first."
        result["tps_power"] = False
        return
    try:
        client.write_coil(address=addr, value=True)
        await asyncio.sleep(0.15)  # 150ms pulse
        client.write_coil(address=addr, value=False)
        result["status"] = "ok"
        result["message"] = f"{output} eject pulse fired (150ms)"
        result["tps_power"] = True
        LOGGER.info("DO_COMMAND: test_eject %s — fired", output)
    except Exception as e:
        result["message"] = f"Modbus write failed: {e}"
        LOGGER.error("DO_COMMAND: test_eject %s — error: %s", output, e, exc_info=True)


async def _handle_software_eject(client, result, tps_on):
    if not tps_on:
        result["message"] = "TPS power (X4) must be ON for software eject. Turn on the TPS main switch first."
        result["tps_power"] = False
        return
    try:
        client.write_coil(address=28, value=True)  # C29 Software Eject
        await asyncio.sleep(0.2)
        client.write_coil(address=28, value=False)
        result["status"] = "ok"
        result["message"] = "Software eject (C29) pulse fired"
        result["tps_power"] = True
        LOGGER.info("DO_COMMAND: software_eject — fired")
    except Exception as e:
        result["message"] = f"Modbus write failed: {e}"


async def _handle_reset_counters(client, result, plate_drop_reset_cb):
    try:
        client.write_coil(address=0, value=True)  # C1 Reset Plates and Time
        await asyncio.sleep(0.2)
        client.write_coil(address=0, value=False)
        if plate_drop_reset_cb is not None:
            plate_drop_reset_cb()
        result["status"] = "ok"
        result["message"] = "Counters reset (C1 pulsed, Pi plate count zeroed)"
        LOGGER.info("DO_COMMAND: reset_counters — done")
    except Exception as e:
        result["message"] = f"Modbus write failed: {e}"


def _handle_set_mode(client, command, result):
    mode = command.get("mode", "").lower()
    mode_map = {
        "single": (19, "TPS-1 Single"),      # C20
        "double": (20, "TPS-1 Double"),       # C21
        "both": (21, "TPS-2 Both"),           # C22
        "left": (22, "TPS-2 Left"),           # C23
        "right": (23, "TPS-2 Right"),         # C24
        "tie_team": (26, "TPS-2 Tie Team"),   # C27
        "2nd_pass": (30, "TPS-1 2nd Pass"),   # C31
    }
    if mode not in mode_map:
        result["message"] = f"Unknown mode: {mode}. Use: {', '.join(mode_map.keys())}"
        return
    coil_addr, mode_name = mode_map[mode]
    try:
        # Clear all mode bits first
        for addr, _ in mode_map.values():
            client.write_coil(address=addr, value=False)
        # Set the requested mode
        client.write_coil(address=coil_addr, value=True)
        result["status"] = "ok"
        result["message"] = f"Mode set to {mode_name}"
        LOGGER.info("DO_COMMAND: set_mode %s — done", mode_name)
    except Exception as e:
        result["message"] = f"Modbus write failed: {e}"


def _handle_set_spacing(client, command, result):
    value = command.get("value")
    if value is None:
        result["message"] = "Missing 'value' parameter (DS2 in 0.5\" units, e.g. 39 = 19.5\")"
        return
    try:
        value = int(value)
    except (ValueError, TypeError):
        result["message"] = f"Invalid value: {value}. Must be an integer."
        return
    # Bounds: 10" to 30" (DS2 = 20 to 60)
    if value < 20 or value > 60:
        result["message"] = (
            f"Value {value} out of range. "
            f"Must be 20-60 (10.0\"-30.0\"). "
            f"Standard is 39 (19.5\")."
        )
        return
    spacing_in = value * 0.5
    try:
        # Read current value first for logging
        old = client.read_holding_registers(address=1, count=1)
        old_val = old.registers[0] if not old.isError() else "?"
        client.write_register(address=1, value=value)
        result["status"] = "ok"
        result["message"] = (
            f"Tie spacing changed: DS2={old_val} ({float(old_val)*0.5 if old_val != '?' else '?'}\")"
            f" → DS2={value} ({spacing_in}\")"
        )
        LOGGER.warning(
            "DO_COMMAND: set_spacing DS2=%d (%.1f in) — was DS2=%s",
            value, spacing_in, old_val,
        )
    except Exception as e:
        result["message"] = f"Modbus write failed: {e}"


def _handle_toggle_coil(client, result, *, address, name, c_label):
    """Generic toggle for a single coil (read current, write opposite)."""
    try:
        r = client.read_coils(address=address, count=1)
        current = bool(r.bits[0]) if not r.isError() else False
        new_val = not current
        client.write_coil(address=address, value=new_val)
        state = "ENABLED" if new_val else "DISABLED"
        if name in ("Encoder", "Lay Ties", "Drop Ties"):
            state = ("ON" if new_val else "OFF") if name == "Encoder" else ("SET" if new_val else "CLEARED")
        result["status"] = "ok"
        result["message"] = f"{name} ({c_label}) {state}"
        result["value"] = new_val
        LOGGER.info("DO_COMMAND: toggle_%s → %s", name.lower().replace(" ", "_"), state)
    except Exception as e:
        result["message"] = f"Modbus write failed: {e}"


def _handle_set_detector_offset(client, command, result):
    value = command.get("value")
    if value is None:
        result["message"] = "Missing 'value' (DS5 in encoder bits)"
        return
    try:
        value = int(value)
    except (ValueError, TypeError):
        result["message"] = f"Invalid value: {value}. Must be an integer."
        return
    if value < 100 or value > 5000:
        result["message"] = f"Value {value} out of range (100-5000 bits)."
        return
    try:
        old = client.read_holding_registers(address=4, count=1)
        old_val = old.registers[0] if not old.isError() else "?"
        client.write_register(address=4, value=value)
        result["status"] = "ok"
        result["message"] = f"Detector offset: DS5={old_val} → {value} bits"
        LOGGER.warning("DO_COMMAND: set_detector_offset DS5=%d — was %s", value, old_val)
    except Exception as e:
        result["message"] = f"Modbus write failed: {e}"


async def _handle_clear_data_counts(client, result):
    try:
        client.write_coil(address=14, value=True)  # C15 Clear DATA Counts
        await asyncio.sleep(0.2)
        client.write_coil(address=14, value=False)
        result["status"] = "ok"
        result["message"] = "PLC data counts cleared (C15 pulsed)"
        LOGGER.info("DO_COMMAND: clear_data_counts — done")
    except Exception as e:
        result["message"] = f"Modbus write failed: {e}"


def _get_profile_dir():
    """Return the path to the plc-profiles config directory."""
    return os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__)))), "config", "plc-profiles")


def _handle_list_profiles(result):
    profile_dir = _get_profile_dir()
    profiles = []
    for f in sorted(glob.glob(os.path.join(profile_dir, "*.json"))):
        try:
            with open(f) as fh:
                p = json.load(fh)
            profiles.append({
                "file": os.path.basename(f),
                "name": p.get("name", "?"),
                "description": p.get("description", ""),
                "version": p.get("version", "?"),
            })
        except Exception as e:
            profiles.append({"file": os.path.basename(f), "error": str(e)})
    result["status"] = "ok"
    result["profiles"] = profiles
    result["profile_dir"] = profile_dir
    result["message"] = f"Found {len(profiles)} profile(s)"


async def _handle_provision(client, command, result):
    profile_name = command.get("profile", "")
    dry_run = command.get("dry_run", False)

    if not profile_name:
        result["message"] = "Missing 'profile' parameter. Use list_profiles to see available profiles."
        return

    profile_dir = _get_profile_dir()
    profile_path = os.path.join(profile_dir, profile_name)

    if not os.path.exists(profile_path):
        result["message"] = f"Profile not found: {profile_name}"
        return

    try:
        with open(profile_path) as f:
            profile = json.load(f)
    except Exception as e:
        result["message"] = f"Failed to read profile: {e}"
        return

    profile_label = profile.get("name", profile_name)
    verify = profile.get("verify_after_write", True)
    steps = []
    errors = []

    LOGGER.warning("PROVISION: Starting profile '%s' (dry_run=%s)", profile_label, dry_run)

    # Write registers
    for reg_name, reg_def in profile.get("registers", {}).items():
        addr = reg_def["address"]
        value = reg_def["value"]
        label = reg_def.get("label", reg_name)
        step = {"type": "register", "name": reg_name, "address": addr,
                "value": value, "label": label, "status": "pending"}

        if dry_run:
            step["status"] = "dry_run"
            steps.append(step)
            continue

        try:
            # Read current value
            old = client.read_holding_registers(address=addr, count=1)
            old_val = old.registers[0] if not old.isError() else None
            step["old_value"] = old_val

            if old_val == value:
                step["status"] = "unchanged"
                step["message"] = f"Already set to {value}"
            else:
                client.write_register(address=addr, value=value)
                step["status"] = "written"
                step["message"] = f"Changed {old_val} → {value}"
                LOGGER.info("PROVISION: %s (addr %d): %s → %s", reg_name, addr, old_val, value)
        except Exception as e:
            step["status"] = "error"
            step["message"] = str(e)
            errors.append(f"{reg_name}: {e}")
            LOGGER.error("PROVISION: %s write failed: %s", reg_name, e, exc_info=True)

        steps.append(step)

    # Write coils
    for coil_name, coil_def in profile.get("coils", {}).items():
        addr = coil_def["address"]
        value = coil_def["value"]
        label = coil_def.get("label", coil_name)
        step = {"type": "coil", "name": coil_name, "address": addr,
                "value": value, "label": label, "status": "pending"}

        if dry_run:
            step["status"] = "dry_run"
            steps.append(step)
            continue

        try:
            # Read current value
            old = client.read_coils(address=addr, count=1)
            old_val = bool(old.bits[0]) if not old.isError() else None
            step["old_value"] = old_val

            if old_val == value:
                step["status"] = "unchanged"
                step["message"] = f"Already {'ON' if value else 'OFF'}"
            else:
                client.write_coil(address=addr, value=value)
                step["status"] = "written"
                step["message"] = f"{'OFF' if old_val else 'ON'} → {'ON' if value else 'OFF'}"
                LOGGER.info("PROVISION: %s (addr %d): %s → %s", coil_name, addr, old_val, value)
        except Exception as e:
            step["status"] = "error"
            step["message"] = str(e)
            errors.append(f"{coil_name}: {e}")
            LOGGER.error("PROVISION: %s write failed: %s", coil_name, e, exc_info=True)

        steps.append(step)

    # Verify if requested
    if verify and not dry_run and not errors:
        await asyncio.sleep(0.3)  # Let PLC process writes
        verify_errors = []

        for step in steps:
            if step["status"] not in ("written", "unchanged"):
                continue
            try:
                if step["type"] == "register":
                    check = client.read_holding_registers(address=step["address"], count=1)
                    actual = check.registers[0] if not check.isError() else None
                    if actual != step["value"]:
                        verify_errors.append(f"{step['name']}: expected {step['value']}, got {actual}")
                        step["verify"] = "FAIL"
                    else:
                        step["verify"] = "OK"
                elif step["type"] == "coil":
                    check = client.read_coils(address=step["address"], count=1)
                    actual = bool(check.bits[0]) if not check.isError() else None
                    if actual != step["value"]:
                        verify_errors.append(f"{step['name']}: expected {step['value']}, got {actual}")
                        step["verify"] = "FAIL"
                    else:
                        step["verify"] = "OK"
            except Exception as e:
                step["verify"] = f"ERROR: {e}"
                verify_errors.append(f"{step['name']}: verify failed: {e}")

        if verify_errors:
            result["status"] = "partial"
            result["verify_errors"] = verify_errors
            LOGGER.error("PROVISION: Verification failed: %s", verify_errors)
        else:
            LOGGER.info("PROVISION: All values verified OK")

    # Summary
    written = sum(1 for s in steps if s["status"] == "written")
    unchanged = sum(1 for s in steps if s["status"] == "unchanged")
    errored = sum(1 for s in steps if s["status"] == "error")

    if not errors:
        result["status"] = "ok" if not dry_run else "dry_run"
    result["profile"] = profile_label
    result["steps"] = steps
    result["summary"] = {
        "written": written,
        "unchanged": unchanged,
        "errors": errored,
        "total": len(steps),
    }
    if dry_run:
        result["message"] = f"Dry run: {len(steps)} steps would be applied for '{profile_label}'"
    elif errors:
        result["message"] = f"Provisioned with {errored} error(s): {', '.join(errors)}"
    else:
        result["message"] = f"'{profile_label}' applied: {written} changed, {unchanged} already set"
    LOGGER.warning("PROVISION: Complete — %s", result["message"])


def _handle_read_config(client, result):
    current = {}
    try:
        regs = client.read_holding_registers(address=0, count=25)
        if not regs.isError():
            reg_names = ["DS1","DS2","DS3","DS4","DS5","DS6","DS7","DS8",
                         "DS9","DS10","DS11","DS12","DS13","DS14","DS15",
                         "DS16","DS17","DS18","DS19","DS20","DS21","DS22",
                         "DS23","DS24","DS25"]
            for i, name in enumerate(reg_names):
                current[name] = regs.registers[i]

        coils = client.read_coils(address=0, count=32)
        if not coils.isError():
            coil_names = {
                12: "C13_LayTies", 13: "C14_DropTies",
                14: "C15_ClearData", 15: "C16_DropEnable",
                19: "C20_TPS1_Single", 20: "C21_TPS1_Double",
                21: "C22_TPS2_Both", 22: "C23_TPS2_Left",
                23: "C24_TPS2_Right", 26: "C27_TieTeam",
                27: "C28_Encoder", 28: "C29_SoftwareEject",
                30: "C31_2ndPass",
            }
            for addr, name in coil_names.items():
                current[name] = bool(coils.bits[addr])

        result["status"] = "ok"
        result["config"] = current
        result["message"] = f"Read {len(current)} PLC values"
    except Exception as e:
        result["message"] = f"Read failed: {e}"
