"""
Servo actuator control via PWM.

SG90 micro servos accept 50Hz PWM with duty cycles:
  - 2.5% ≈ 0 degrees
  - 7.5% ≈ 90 degrees
  - 12.5% ≈ 180 degrees
"""

import logging
import time
from typing import Any, Dict, Optional

from . import gpio_config

logger = logging.getLogger(__name__)

# SG90 PWM parameters
_PWM_FREQ = 50
_DUTY_MIN = 2.5    # 0 degrees
_DUTY_MAX = 12.5   # 180 degrees


def _angle_to_duty(angle: float) -> float:
    """Convert an angle (0-180) to a PWM duty cycle (2.5-12.5)."""
    angle = max(0.0, min(180.0, angle))
    return _DUTY_MIN + (angle / 180.0) * (_DUTY_MAX - _DUTY_MIN)


class ServoController:
    """Controls two SG90 servos via GPIO PWM.

    Servo 1: Grinder head positioning (sweeps 0-180)
    Servo 2: Clamp actuator (open=90°, closed=0°)
    """

    def __init__(self, config: Dict[str, Any]):
        gpio_cfg = config["gpio"]
        self._pin1 = gpio_cfg["servo1_pin"]
        self._pin2 = gpio_cfg["servo2_pin"]
        self._pwm1: Optional[Any] = None
        self._pwm2: Optional[Any] = None
        self._pos1: float = 0.0
        self._pos2: float = 0.0
        self._stopped = False

        if gpio_config.has_gpio():
            import RPi.GPIO as GPIO
            GPIO.setup(self._pin1, GPIO.OUT)
            GPIO.setup(self._pin2, GPIO.OUT)
            self._pwm1 = GPIO.PWM(self._pin1, _PWM_FREQ)
            self._pwm2 = GPIO.PWM(self._pin2, _PWM_FREQ)
            self._pwm1.start(0)
            self._pwm2.start(0)
            logger.info("Servos initialized on GPIO %d and %d",
                        self._pin1, self._pin2)

    @property
    def position1(self) -> float:
        """Current angle of servo 1 (grinder)."""
        return self._pos1

    @property
    def position2(self) -> float:
        """Current angle of servo 2 (clamp)."""
        return self._pos2

    def set_servo1(self, angle: float) -> None:
        """Move servo 1 (grinder) to the specified angle."""
        if self._stopped:
            return
        self._pos1 = max(0.0, min(180.0, angle))
        if self._pwm1 is not None:
            self._pwm1.ChangeDutyCycle(_angle_to_duty(self._pos1))

    def set_servo2(self, angle: float) -> None:
        """Move servo 2 (clamp) to the specified angle."""
        if self._stopped:
            return
        self._pos2 = max(0.0, min(180.0, angle))
        if self._pwm2 is not None:
            self._pwm2.ChangeDutyCycle(_angle_to_duty(self._pos2))

    def stop_all(self) -> None:
        """Immediately stop all servo movement (E-stop)."""
        self._stopped = True
        if self._pwm1 is not None:
            self._pwm1.ChangeDutyCycle(0)
        if self._pwm2 is not None:
            self._pwm2.ChangeDutyCycle(0)
        logger.warning("All servos stopped (E-stop)")

    def resume(self) -> None:
        """Allow servo movement again after E-stop release."""
        self._stopped = False
        logger.info("Servo movement resumed")

    @property
    def is_stopped(self) -> bool:
        return self._stopped

    def close(self) -> None:
        """Stop PWM and release servo pins."""
        if self._pwm1 is not None:
            self._pwm1.stop()
        if self._pwm2 is not None:
            self._pwm2.stop()
        logger.info("Servos shut down")
