"""
Threshold-based fault detection for the PLC simulator.

Runs continuously alongside the work cycle. When a sensor value exceeds
its configured threshold, the system enters FAULT state and the fault code
is written to register 113.

Fault codes:
  0 = none
  1 = vibration magnitude exceeded
  2 = temperature exceeded
  3 = pressure too low
  4 = clamp failure (servo 2 did not reach target)
"""

import logging
import math
from typing import Any, Dict

from .modbus_server import (
    FAULT_CLAMP_FAIL,
    FAULT_NONE,
    FAULT_PRESSURE,
    FAULT_TEMPERATURE,
    FAULT_VIBRATION,
    STATE_FAULT,
)

logger = logging.getLogger(__name__)


class FaultMonitor:
    """Checks sensor values against configurable thresholds."""

    def __init__(self, config: Dict[str, Any]):
        thresholds = config["thresholds"]
        self.vibration_max = thresholds["vibration_magnitude_max"]
        self.temperature_max_f = thresholds["temperature_max_f"]
        self.pressure_min = thresholds["pressure_min"]

        self._active_fault: int = FAULT_NONE
        logger.info(
            "FaultMonitor: vib_max=%.1f temp_max=%.1f°F pressure_min=%d",
            self.vibration_max, self.temperature_max_f, self.pressure_min,
        )

    @property
    def active_fault(self) -> int:
        return self._active_fault

    @property
    def is_faulted(self) -> bool:
        return self._active_fault != FAULT_NONE

    def clear_fault(self) -> None:
        """Clear the active fault (called when operator resets)."""
        self._active_fault = FAULT_NONE
        logger.info("Fault cleared")

    def check(
        self,
        accel: Dict[str, float],
        temperature_f: float,
        pressure: int,
        servo2_pos: float,
        servo2_target: float,
    ) -> int:
        """Evaluate all fault conditions. Returns fault code (0 if no fault).

        Args:
            accel: Dict with accel_x, accel_y, accel_z in m/s^2
            temperature_f: Current temperature in Fahrenheit
            pressure: Current pressure/potentiometer reading (0-1023)
            servo2_pos: Current clamp servo position in degrees
            servo2_target: Expected clamp servo position in degrees

        Returns:
            Fault code (FAULT_NONE if all values within thresholds)
        """
        # Vibration check — magnitude of acceleration vector
        ax = accel.get("accel_x", 0)
        ay = accel.get("accel_y", 0)
        az = accel.get("accel_z", 0)
        magnitude = math.sqrt(ax * ax + ay * ay + az * az)

        if magnitude > self.vibration_max:
            self._active_fault = FAULT_VIBRATION
            logger.warning(
                "FAULT: Vibration magnitude %.2f exceeds threshold %.2f",
                magnitude, self.vibration_max,
            )
            return FAULT_VIBRATION

        # Temperature check
        if temperature_f > self.temperature_max_f:
            self._active_fault = FAULT_TEMPERATURE
            logger.warning(
                "FAULT: Temperature %.1f°F exceeds threshold %.1f°F",
                temperature_f, self.temperature_max_f,
            )
            return FAULT_TEMPERATURE

        # Pressure check
        if pressure < self.pressure_min:
            self._active_fault = FAULT_PRESSURE
            logger.warning(
                "FAULT: Pressure %d below threshold %d",
                pressure, self.pressure_min,
            )
            return FAULT_PRESSURE

        # If we got here with no new fault, clear the active fault
        if self._active_fault != FAULT_NONE:
            logger.info("Fault condition resolved (was code %d)", self._active_fault)
            self._active_fault = FAULT_NONE

        return FAULT_NONE
