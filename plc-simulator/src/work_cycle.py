"""
Work cycle state machine for the PLC simulator.

State transitions:
  IDLE → (register 3 set OR local trigger) → RUNNING
  RUNNING → (cycle complete) → loops back to RUNNING
  RUNNING → (fault detected) → FAULT
  FAULT → (fault clears AND register 3 set) → RUNNING
  ANY → (E-stop pressed) → E-STOPPED
  E-STOPPED → (E-stop released) → IDLE

The work cycle simulates a grinder positioning and clamp actuation sequence:
  1. Servo 1 sweeps 0→180→0 (~3 seconds) — grinder head positioning
  2. Servo 2 opens to 90°, holds 1 second, closes to 0° — clamp actuation
  3. Cycle count increments on each completion
"""

import asyncio
import logging
import time
from typing import Any, Dict

from .actuators import ServoController
from .fault_monitor import FaultMonitor
from .modbus_server import (
    FAULT_NONE,
    PIN_PLATE_CYCLE,
    PLCModbusServer,
    STATE_ESTOPPED,
    STATE_FAULT,
    STATE_IDLE,
    STATE_RUNNING,
)
from .sensors import DHT22Sensor, MPU6050, PotentiometerReader

logger = logging.getLogger(__name__)


class WorkCycle:
    """Automated work cycle state machine.

    Runs as an asyncio task. Reads sensors, drives servos through a
    repeatable sequence, detects faults, and updates Modbus registers.
    """

    def __init__(
        self,
        config: Dict[str, Any],
        modbus: PLCModbusServer,
        servos: ServoController,
        mpu6050: MPU6050,
        dht22: DHT22Sensor,
        pot: PotentiometerReader,
        fault_monitor: FaultMonitor,
    ):
        self._config = config
        self._modbus = modbus
        self._servos = servos
        self._mpu6050 = mpu6050
        self._dht22 = dht22
        self._pot = pot
        self._fault = fault_monitor

        wc = config["work_cycle"]
        self._sweep_time = wc["servo1_sweep_time_s"]
        self._hold_time = wc["servo2_hold_time_s"]
        self._s1_min = wc["servo1_min_angle"]
        self._s1_max = wc["servo1_max_angle"]
        self._s2_open = wc["servo2_open_angle"]
        self._s2_closed = wc["servo2_closed_angle"]

        self._cycle_count = 0
        self._state = STATE_IDLE
        self._fault_code = FAULT_NONE
        self._running = False

    @property
    def state(self) -> int:
        return self._state

    @property
    def cycle_count(self) -> int:
        return self._cycle_count

    @property
    def fault_code(self) -> int:
        return self._fault_code

    def trigger_estop(self) -> None:
        """Called by the E-stop GPIO handler."""
        self._state = STATE_ESTOPPED
        self._servos.stop_all()
        logger.warning("E-STOP activated — all servos halted")

    def release_estop(self) -> None:
        """Called when the E-stop is released (twisted to reset)."""
        if self._state == STATE_ESTOPPED:
            self._state = STATE_IDLE
            self._servos.resume()
            logger.info("E-STOP released — returning to IDLE")

    async def run(self) -> None:
        """Main loop — runs until stopped."""
        self._running = True
        logger.info("Work cycle task started")

        # Tick interval for the main loop (matches register_update_hz)
        tick = 1.0 / self._config["polling"]["register_update_hz"]

        while self._running:
            # Read sensors
            accel_data = self._mpu6050.read()
            dht_data = self._dht22.read()
            pressure = self._pot.read()

            # Check E-stop state (handled by GPIO callback, but double-check)
            if self._state == STATE_ESTOPPED:
                self._update_registers(accel_data, dht_data, pressure)
                await asyncio.sleep(tick)
                continue

            # Check for start trigger (register 3 = Plate Cycle command)
            plate_cycle_cmd = self._modbus.read_register(PIN_PLATE_CYCLE)

            if self._state == STATE_IDLE and plate_cycle_cmd:
                self._state = STATE_RUNNING
                logger.info("Work cycle started (triggered by register %d)", PIN_PLATE_CYCLE)

            if self._state == STATE_FAULT:
                # Check if fault has cleared
                fault_code = self._fault.check(
                    accel_data,
                    dht_data["temperature_f"],
                    pressure,
                    self._servos.position2,
                    self._s2_closed,
                )
                if fault_code == FAULT_NONE and plate_cycle_cmd:
                    self._state = STATE_RUNNING
                    self._fault_code = FAULT_NONE
                    logger.info("Fault cleared, resuming work cycle")
                self._update_registers(accel_data, dht_data, pressure)
                await asyncio.sleep(tick)
                continue

            if self._state == STATE_RUNNING:
                # Run fault detection
                fault_code = self._fault.check(
                    accel_data,
                    dht_data["temperature_f"],
                    pressure,
                    self._servos.position2,
                    self._s2_closed,
                )
                if fault_code != FAULT_NONE:
                    self._state = STATE_FAULT
                    self._fault_code = fault_code
                    self._update_registers(accel_data, dht_data, pressure)
                    await asyncio.sleep(tick)
                    continue

                # Execute one work cycle
                await self._execute_cycle(accel_data, dht_data, pressure)
                continue

            # IDLE state — just update registers
            self._update_registers(accel_data, dht_data, pressure)
            await asyncio.sleep(tick)

    async def _execute_cycle(
        self,
        accel_data: Dict[str, float],
        dht_data: Dict[str, float],
        pressure: int,
    ) -> None:
        """Run one complete grinder + clamp cycle."""
        tick = 1.0 / self._config["polling"]["register_update_hz"]
        steps = int(self._sweep_time / tick)
        if steps < 1:
            steps = 1

        # Phase 1: Servo 1 sweeps 0 → 180
        for i in range(steps):
            if not self._running or self._state != STATE_RUNNING:
                return
            angle = self._s1_min + (self._s1_max - self._s1_min) * (i / steps)
            self._servos.set_servo1(angle)
            self._poll_and_update(accel_data, dht_data, pressure)
            await asyncio.sleep(tick)

        # Phase 2: Servo 1 sweeps 180 → 0
        for i in range(steps):
            if not self._running or self._state != STATE_RUNNING:
                return
            angle = self._s1_max - (self._s1_max - self._s1_min) * (i / steps)
            self._servos.set_servo1(angle)
            self._poll_and_update(accel_data, dht_data, pressure)
            await asyncio.sleep(tick)

        self._servos.set_servo1(self._s1_min)

        # Phase 3: Servo 2 opens (clamp)
        self._servos.set_servo2(self._s2_open)
        hold_steps = int(self._hold_time / tick)
        for _ in range(hold_steps):
            if not self._running or self._state != STATE_RUNNING:
                return
            self._poll_and_update(accel_data, dht_data, pressure)
            await asyncio.sleep(tick)

        # Phase 4: Servo 2 closes (release clamp)
        self._servos.set_servo2(self._s2_closed)

        # Cycle complete
        self._cycle_count += 1
        logger.info("Work cycle #%d complete", self._cycle_count)
        self._update_registers(accel_data, dht_data, pressure)

    def _poll_and_update(
        self,
        accel_data: Dict[str, float],
        dht_data: Dict[str, float],
        pressure: int,
    ) -> None:
        """Re-read fast sensors and update registers (called during cycle steps)."""
        accel_data = self._mpu6050.read()
        # DHT22 is read in the main loop (slow sensor) — use cached values
        pressure = self._pot.read()

        # Check faults during cycle
        fault_code = self._fault.check(
            accel_data,
            dht_data["temperature_f"],
            pressure,
            self._servos.position2,
            self._s2_closed,
        )
        if fault_code != FAULT_NONE:
            self._state = STATE_FAULT
            self._fault_code = fault_code

        self._update_registers(accel_data, dht_data, pressure)

    def _update_registers(
        self,
        accel_data: Dict[str, float],
        dht_data: Dict[str, float],
        pressure: int,
    ) -> None:
        """Write all current values to Modbus registers."""
        self._modbus.write_sensor_data(
            accel=accel_data,
            gyro=accel_data,  # MPU6050 read returns both in same dict
            temperature_f=dht_data["temperature_f"],
            humidity_pct=dht_data["humidity_pct"],
            pressure=pressure,
            servo1_pos=self._servos.position1,
            servo2_pos=self._servos.position2,
            cycle_count=self._cycle_count,
            system_state=self._state,
            fault_code=self._fault_code,
        )
        self._modbus.update_lamp_registers(self._state)

    def stop(self) -> None:
        """Signal the work cycle to stop."""
        self._running = False
        logger.info("Work cycle stopping")
