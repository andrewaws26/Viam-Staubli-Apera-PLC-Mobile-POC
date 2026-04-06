"""Shared test fixtures for plc-sensor tests.

These fixtures mock hardware dependencies (Modbus TCP client, PLC registers)
so tests run without any physical hardware or network.
"""

from unittest.mock import MagicMock

import pytest


@pytest.fixture
def mock_modbus_client():
    """Mock pymodbus client returning realistic register values.

    Default behavior:
    - connect() succeeds
    - is_socket_open() returns True
    - read_holding_registers returns 25 zero registers
    - read_discrete_inputs returns 16 False bits
    - read_coils returns 40 False bits
    """
    client = MagicMock()
    client.connect.return_value = True
    client.is_socket_open.return_value = True
    client.close.return_value = None

    # Default holding register response (DS1-DS25 = zeros)
    hr_response = MagicMock()
    hr_response.isError.return_value = False
    hr_response.registers = [0] * 25
    client.read_holding_registers.return_value = hr_response

    # Default discrete input response (X1-X8 + extras)
    di_response = MagicMock()
    di_response.isError.return_value = False
    di_response.bits = [False] * 16
    client.read_discrete_inputs.return_value = di_response

    # Default coil response (C-bits)
    coil_response = MagicMock()
    coil_response.isError.return_value = False
    coil_response.bits = [False] * 40
    client.read_coils.return_value = coil_response

    return client


@pytest.fixture
def modbus_error_client():
    """Mock pymodbus client that returns errors for all reads."""
    client = MagicMock()
    client.connect.return_value = True
    client.is_socket_open.return_value = True

    error_response = MagicMock()
    error_response.isError.return_value = True
    client.read_holding_registers.return_value = error_response
    client.read_discrete_inputs.return_value = error_response
    client.read_coils.return_value = error_response

    return client


@pytest.fixture
def disconnected_modbus_client():
    """Mock pymodbus client that cannot connect."""
    client = MagicMock()
    client.connect.return_value = False
    client.is_socket_open.return_value = False
    return client


@pytest.fixture
def healthy_plc_registers():
    """Register values representing a healthy running TPS system.

    Matches DS register layout:
      DS1  (idx 0):  encoder ignore threshold
      DS2  (idx 1):  adjustable tie spacing (x0.5")
      DS3  (idx 2):  tie spacing (x0.1")
      DS7  (idx 6):  plate count
      DS8  (idx 7):  avg plates/min
      DS10 (idx 9):  encoder next tie (counting down)
    DD1 is read separately from address 16384.
    """
    return {
        "ds1": 5,       # encoder ignore threshold
        "ds2": 39,      # tie spacing (x0.5" = 19.5")
        "ds3": 195,     # tie spacing (x0.1" = 19.5")
        "ds5": 0,       # detector offset bits
        "ds6": 6070,    # detector offset (x0.1" = 607.0")
        "ds7": 1247,    # plate count
        "ds8": 12,      # avg plates/min
        "ds9": 100,     # detector next tie
        "ds10": 87,     # encoder next tie (counting down from 195)
        "ds19": 1,      # HMI screen control
        "dd1": 7,       # raw encoder count (NOT used for distance)
    }


@pytest.fixture
def idle_plc_registers():
    """Register values representing an idle/stopped TPS system."""
    return {
        "ds1": 5,
        "ds2": 39,
        "ds3": 195,
        "ds5": 0,
        "ds6": 6070,
        "ds7": 0,       # no plates counted
        "ds8": 0,       # no plates/min
        "ds9": 0,
        "ds10": 195,    # full countdown (not moving)
        "ds19": 0,
        "dd1": 0,       # encoder at zero
    }


@pytest.fixture
def base_healthy_readings():
    """A complete readings dict representing a healthy running TPS.

    This is the same shape as what plc_sensor.get_readings() returns,
    suitable for passing to diagnostics.evaluate().
    """
    return {
        # Warmup passed
        "total_reads": 100,
        "total_errors": 0,
        # Camera/flipper -- stable, some detections
        "camera_rate_trend": "stable",
        "camera_detections_per_min": 5,
        "camera_signal_duration_s": 0,
        # Encoder -- moving at moderate speed, healthy
        "encoder_speed_ftpm": 15,
        "encoder_count": 500,
        "encoder_noise": 5,
        "dd1_frozen": False,
        "ds10": 100,
        "ds10_frozen": False,
        # Spacing
        "ds2": 39,
        "ds3": 195,
        "avg_drop_spacing_in": 19.5,
        "drop_count_in_window": 0,
        # TPS power -- on, been running a while
        "tps_power_loop": True,
        "tps_power_duration_s": 120,
        # Eject -- working normally
        "eject_rate_per_min": 3,
        "air_eagle_1_feedback": True,
        "air_eagle_2_feedback": True,
        "drop_enable": True,
        # PLC comms -- healthy
        "modbus_response_time_ms": 10,
        # Operation
        "operating_mode": "TPS-1",
        "backup_alarm": False,
    }
