"""
Status API — lightweight HTTP server for the RAIV Digital Twin POC.

Runs on the Pi 5 alongside viam-server. Reads PLC state from the Pi Zero W
via Modbus TCP and exposes it as JSON for the Matrix Portal S3 display
and the CYD touchscreen.

Endpoints:
  GET /status — full system state as JSON
  GET /health — simple health check for connectivity verification

Usage:
  python status_api.py                              # defaults
  python status_api.py --plc-host raiv-plc.local    # custom PLC host
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

# State and fault code lookups (mirrors plc-simulator/src/modbus_server.py)
_STATE_NAMES = {0: "idle", 1: "running", 2: "fault", 3: "e-stopped"}
_FAULT_NAMES = {0: "none", 1: "vibration", 2: "temperature", 3: "pressure", 4: "clamp_fail"}

# Module-level config — set by CLI args at startup
_plc_host = "raiv-plc.local"
_plc_port = 502
_client: ModbusTcpClient = None


def _int16_to_float(value: int, scale: float = 100.0) -> float:
    """Convert unsigned Modbus register to signed float."""
    if value > 32767:
        value -= 65536
    return round(value / scale, 2)


def _read_plc() -> Dict[str, Any]:
    """Read all registers from the PLC simulator and return structured dict."""
    global _client

    try:
        if _client is None or not _client.connected:
            _client = ModbusTcpClient(_plc_host, port=_plc_port, timeout=3)
            if not _client.connect():
                return {"connected": False, "system_state": "disconnected"}

        # Read E-Cat cable registers (0-24)
        ecat_result = _client.read_holding_registers(0, 25)
        if ecat_result.isError():
            return {"connected": False, "system_state": "read_error"}
        ecat = ecat_result.registers

        # Read sensor data registers (100-113)
        sensor_result = _client.read_holding_registers(100, 14)
        if sensor_result.isError():
            return {"connected": False, "system_state": "read_error"}
        sensor = sensor_result.registers

        state_code = sensor[12]
        fault_code = sensor[13]

        return {
            "connected": True,
            "fault": state_code == 2,

            # E-Cat command signals
            "servo_power_on": bool(ecat[0]),
            "servo_disable": bool(ecat[1]),
            "plate_cycle_active": bool(ecat[2]),
            "abort_stow": bool(ecat[3]),
            "speed_signal": bool(ecat[4]),
            "gripper_lock": bool(ecat[5]),
            "clear_position": bool(ecat[6]),
            "belt_forward": bool(ecat[7]),
            "belt_reverse": bool(ecat[8]),

            # E-Cat status lamps
            "servo_power_lamp": bool(ecat[9]),
            "plate_cycle_lamp": bool(ecat[11]),
            "abort_stow_lamp": bool(ecat[12]),

            # System state
            "emag_status": bool(ecat[18]),
            "emag_malfunction": bool(ecat[21]),
            "poe_system": bool(ecat[22]),
            "estop_enable": bool(ecat[23]),
            "estop_off": bool(ecat[24]),

            # Sensor data
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
            "system_state": _STATE_NAMES.get(state_code, f"unknown({state_code})"),
            "last_fault": _FAULT_NAMES.get(fault_code, f"unknown({fault_code})"),

            # Network status (if we got here, we're connected to the PLC)
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
    parser.add_argument("--plc-host", default="raiv-plc.local",
                        help="PLC simulator hostname/IP (default: raiv-plc.local)")
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
