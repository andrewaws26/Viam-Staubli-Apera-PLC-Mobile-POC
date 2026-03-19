"""
Status API — lightweight HTTP server for the RAIV Digital Twin POC.

Runs on the Pi 5 alongside viam-server. Reads PLC state from the Click
PLC C0-10DD2E-D via Modbus TCP and exposes it as JSON for the Matrix
Portal S3 display and the CYD touchscreen.

System state is derived from E-Cat signal registers (0, 1, 24), NOT from
register 112, because the Click PLC's ladder logic drives the 25-pin
cable signals directly.

Endpoints:
  GET /status — full system state as JSON
  GET /health — simple health check for connectivity verification

Usage:
  python status_api.py                              # defaults
  python status_api.py --plc-host 192.168.0.10      # custom PLC host
  python status_api.py --port 8080                  # custom API port
"""

import argparse
import logging
import time
from typing import Any, Dict

from flask import Flask, jsonify
from pymodbus.client import ModbusTcpClient

app = Flask(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("status-api")

# Fault code lookups
_FAULT_NAMES = {0: "none", 1: "vibration", 2: "temperature", 3: "pressure", 4: "estop_triggered"}

# Module-level config — set by CLI args at startup
_plc_host = "192.168.0.10"
_plc_port = 502
_client: ModbusTcpClient = None


def _uint16(value: int) -> int:
    """Ensure register value is unsigned 16-bit."""
    return value & 0xFFFF


def _int16_to_float(value: int, scale: float = 100.0) -> float:
    """Convert unsigned Modbus register to signed float."""
    value = _uint16(value)
    if value > 32767:
        value -= 65536
    return round(value / scale, 2)


def _read_plc() -> Dict[str, Any]:
    """Read all registers from the Click PLC and return structured dict."""
    global _client

    try:
        if _client is None or not _client.connected:
            _client = ModbusTcpClient(_plc_host, port=_plc_port, timeout=3)
            if not _client.connect():
                return {"connected": False, "system_state": "disconnected"}

        # Read E-Cat cable registers (0-24) — the authoritative signal source
        ecat_result = _client.read_holding_registers(0, 25)
        if ecat_result.isError():
            return {"connected": False, "system_state": "read_error"}
        ecat = [_uint16(v) for v in ecat_result.registers]

        # Read sensor data registers (100-117) — optional, may be zero on Click PLC
        sensor = [0] * 18
        try:
            sensor_result = _client.read_holding_registers(100, 18)
            if not sensor_result.isError():
                sensor = [_uint16(v) for v in sensor_result.registers]
        except Exception:
            pass  # Click PLC may not have these registers

        # Derive system state from E-Cat signals (not register 112)
        servo_power_on = ecat[0]
        servo_disable = ecat[1]
        estop_off = ecat[24]
        fault_code = sensor[13]

        if estop_off == 1:
            system_state = "e-stopped"
        elif fault_code != 0:
            system_state = "fault"
        elif servo_power_on == 1 and servo_disable == 0:
            system_state = "running"
        else:
            system_state = "idle"

        return {
            "connected": True,
            "fault": system_state == "fault",

            # E-Cat command signals (registers 0-8)
            "servo_power_on": ecat[0],
            "servo_disable": ecat[1],
            "plate_cycle": ecat[2],
            "abort_stow": ecat[3],
            "speed": ecat[4],
            "gripper_lock": ecat[5],
            "clear_position": ecat[6],
            "belt_forward": ecat[7],
            "belt_reverse": ecat[8],

            # E-Cat status lamps (registers 9-17)
            "lamp_servo_power": ecat[9],
            "lamp_servo_disable": ecat[10],
            "lamp_plate_cycle": ecat[11],
            "lamp_abort_stow": ecat[12],
            "lamp_speed": ecat[13],
            "lamp_gripper_lock": ecat[14],
            "lamp_clear_position": ecat[15],
            "lamp_belt_forward": ecat[16],
            "lamp_belt_reverse": ecat[17],

            # E-Cat system state (registers 18-24)
            "emag_status": ecat[18],
            "emag_on": ecat[19],
            "emag_part_detect": ecat[20],
            "emag_malfunction": ecat[21],
            "poe_status": ecat[22],
            "estop_enable": ecat[23],
            "estop_off": ecat[24],

            # Sensor data (zeros on real Click PLC)
            "vibration_x": _int16_to_float(sensor[0]),
            "vibration_y": _int16_to_float(sensor[1]),
            "vibration_z": _int16_to_float(sensor[2]),
            "gyro_x": _int16_to_float(sensor[3]),
            "gyro_y": _int16_to_float(sensor[4]),
            "gyro_z": _int16_to_float(sensor[5]),
            "temperature_f": _int16_to_float(sensor[6], 10.0),
            "humidity_pct": _int16_to_float(sensor[7], 10.0),
            "pressure_simulated": sensor[8],
            "servo1_position": sensor[9],
            "servo2_position": sensor[10],
            "cycle_count": sensor[11],
            "system_state": system_state,
            "last_fault": _FAULT_NAMES.get(fault_code, f"unknown({fault_code})"),

            # Network status
            "network_ok": True,
            "timestamp": time.time(),
        }

    except Exception as e:
        logger.error("PLC read error: %s", e)
        _client = None
        return {"connected": False, "system_state": "error", "error": str(e)}


@app.route("/status")
def status():
    """Return full system state as JSON."""
    data = _read_plc()
    return jsonify(data)


@app.route("/health")
def health():
    """Simple health check — returns ok:true if the API is running."""
    return jsonify({"ok": True})


def main():
    global _plc_host, _plc_port

    parser = argparse.ArgumentParser(description="RAIV Digital Twin Status API")
    parser.add_argument("--plc-host", default="192.168.0.10",
                        help="Click PLC hostname/IP (default: 192.168.0.10)")
    parser.add_argument("--plc-port", type=int, default=502,
                        help="PLC Modbus TCP port (default: 502)")
    parser.add_argument("--port", type=int, default=8080,
                        help="API server port (default: 8080)")
    parser.add_argument("--host", default="0.0.0.0",
                        help="API server bind address (default: 0.0.0.0)")
    args = parser.parse_args()

    _plc_host = args.plc_host
    _plc_port = args.plc_port

    logger.info("Status API starting — PLC at %s:%d, serving on %s:%d",
                _plc_host, _plc_port, args.host, args.port)
    app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    main()
