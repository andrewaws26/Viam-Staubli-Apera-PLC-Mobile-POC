"""Tests for the Modbus register map and data encoding."""

import pytest

from src.modbus_server import (
    FAULT_NONE,
    FAULT_VIBRATION,
    PIN_ABORT_STOW,
    PIN_ABORT_STOW_LAMP,
    PIN_BELT_FORWARD,
    PIN_BELT_FORWARD_LAMP,
    PIN_EMAG_STATUS,
    PIN_ESTOP_ENABLE,
    PIN_ESTOP_OFF,
    PIN_PLATE_CYCLE,
    PIN_PLATE_CYCLE_LAMP,
    PIN_POE_SYSTEM,
    PIN_SERVO_DISABLE,
    PIN_SERVO_DISABLE_LAMP,
    PIN_SERVO_POWER_ON,
    PIN_SERVO_POWER_LAMP,
    PLCModbusServer,
    SENSOR_BASE,
    STATE_IDLE,
    STATE_RUNNING,
    _float_to_int16,
)


@pytest.fixture
def config():
    return {
        "modbus": {"host": "127.0.0.1", "port": 5020},  # Non-privileged port for tests
    }


@pytest.fixture
def server(config):
    return PLCModbusServer(config)


class TestRegisterMap:
    """Verify the 25-pin E-Cat cable register layout."""

    def test_command_registers_are_0_through_8(self):
        assert PIN_SERVO_POWER_ON == 0     # Pin 1
        assert PIN_SERVO_DISABLE == 1      # Pin 2
        assert PIN_PLATE_CYCLE == 2        # Pin 3
        assert PIN_ABORT_STOW == 3         # Pin 4
        assert PIN_BELT_FORWARD == 7       # Pin 8

    def test_lamp_registers_are_9_through_17(self):
        assert PIN_SERVO_POWER_LAMP == 9   # Pin 10
        assert PIN_SERVO_DISABLE_LAMP == 10
        assert PIN_PLATE_CYCLE_LAMP == 11
        assert PIN_ABORT_STOW_LAMP == 12
        assert PIN_BELT_FORWARD_LAMP == 16

    def test_system_registers_are_18_through_24(self):
        assert PIN_EMAG_STATUS == 18       # Pin 19
        assert PIN_POE_SYSTEM == 22        # Pin 23
        assert PIN_ESTOP_ENABLE == 23      # Pin 24
        assert PIN_ESTOP_OFF == 24         # Pin 25

    def test_sensor_registers_start_at_100(self):
        assert SENSOR_BASE == 100


class TestModbusServer:
    def test_write_and_read_register(self, server):
        server.write_register(0, 1)
        assert server.read_register(0) == 1
        server.write_register(0, 0)
        assert server.read_register(0) == 0

    def test_initial_state_is_idle(self, server):
        state_reg = SENSOR_BASE + 12  # System state register
        assert server.read_register(state_reg) == STATE_IDLE

    def test_poe_system_on_by_default(self, server):
        assert server.read_register(PIN_POE_SYSTEM) == 1

    def test_write_sensor_data(self, server):
        server.write_sensor_data(
            accel={"accel_x": 0.12, "accel_y": -0.05, "accel_z": 9.81},
            gyro={"gyro_x": 1.5, "gyro_y": -0.3, "gyro_z": 0.0},
            temperature_f=72.5,
            humidity_pct=45.2,
            pressure=512,
            servo1_pos=90.0,
            servo2_pos=0.0,
            cycle_count=47,
            system_state=STATE_RUNNING,
            fault_code=FAULT_NONE,
        )

        # Verify temperature encoding (72.5°F * 10 = 725)
        assert server.read_register(SENSOR_BASE + 6) == 725
        # Verify humidity encoding (45.2% * 10 = 452)
        assert server.read_register(SENSOR_BASE + 7) == 452
        # Verify pressure raw value
        assert server.read_register(SENSOR_BASE + 8) == 512
        # Verify servo positions
        assert server.read_register(SENSOR_BASE + 9) == 90
        assert server.read_register(SENSOR_BASE + 10) == 0
        # Verify cycle count
        assert server.read_register(SENSOR_BASE + 11) == 47
        # Verify system state
        assert server.read_register(SENSOR_BASE + 12) == STATE_RUNNING
        # Verify fault code
        assert server.read_register(SENSOR_BASE + 13) == FAULT_NONE

    def test_lamp_mirrors_commands(self, server):
        """Lamp registers should echo command registers."""
        server.write_register(PIN_SERVO_POWER_ON, 1)
        server.write_register(PIN_PLATE_CYCLE, 1)
        server.update_lamp_registers(STATE_RUNNING)

        assert server.read_register(PIN_SERVO_POWER_LAMP) == 1
        assert server.read_register(PIN_PLATE_CYCLE_LAMP) == 1
        assert server.read_register(PIN_ABORT_STOW_LAMP) == 0


class TestFloatToInt16:
    def test_positive_value(self):
        assert _float_to_int16(9.81) == 981

    def test_negative_value(self):
        # -0.05 * 100 = -5 → stored as 65531 (unsigned representation)
        result = _float_to_int16(-0.05)
        assert result == 65531

    def test_zero(self):
        assert _float_to_int16(0.0) == 0

    def test_clamped_large_positive(self):
        # Value larger than int16 max should clamp to 32767
        assert _float_to_int16(400.0) == 32767

    def test_clamped_large_negative(self):
        # Value more negative than int16 min should clamp to -32768 → 32768 unsigned
        assert _float_to_int16(-400.0) == 32768

    def test_custom_scale(self):
        # 72.5 * 10 = 725
        assert _float_to_int16(72.5, scale=10.0) == 725
