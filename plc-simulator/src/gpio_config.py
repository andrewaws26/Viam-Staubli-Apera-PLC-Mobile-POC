"""
GPIO pin configuration — reads assignments from config.yaml.

All pin numbers use BCM numbering. This module centralizes pin setup
so that wiring changes only require editing config.yaml.
"""

import logging
from pathlib import Path
from typing import Any, Dict

import yaml

logger = logging.getLogger(__name__)

DEFAULT_CONFIG_PATH = Path(__file__).parent.parent / "config.yaml"


def load_config(config_path: Path = DEFAULT_CONFIG_PATH) -> Dict[str, Any]:
    """Load and return the full configuration dict from config.yaml."""
    with open(config_path) as f:
        config = yaml.safe_load(f)
    logger.info("Loaded config from %s", config_path)
    return config


# Hardware availability flags — set False when running off-Pi for testing.
_HW_GPIO = True
_HW_I2C = True
_HW_DHT = True

try:
    import RPi.GPIO as GPIO
except (ImportError, RuntimeError):
    GPIO = None  # type: ignore[assignment]
    _HW_GPIO = False
    logger.warning("RPi.GPIO not available — running in simulation mode")

try:
    import smbus2
except ImportError:
    smbus2 = None  # type: ignore[assignment]
    _HW_I2C = False
    logger.warning("smbus2 not available — MPU6050 will return simulated data")

try:
    import adafruit_dht
    import board
except (ImportError, NotImplementedError):
    adafruit_dht = None  # type: ignore[assignment]
    board = None  # type: ignore[assignment]
    _HW_DHT = False
    logger.warning("adafruit_dht not available — DHT22 will return simulated data")


def has_gpio() -> bool:
    return _HW_GPIO


def has_i2c() -> bool:
    return _HW_I2C


def has_dht() -> bool:
    return _HW_DHT


def setup_gpio(config: Dict[str, Any]) -> None:
    """Initialize GPIO pins based on config. No-op if RPi.GPIO is unavailable."""
    if not _HW_GPIO:
        logger.info("Skipping GPIO setup (no hardware)")
        return

    gpio_cfg = config["gpio"]
    GPIO.setmode(GPIO.BCM)
    GPIO.setwarnings(False)

    # Push button — Fuji AR22F0L, NO contact, internal pull-up, active LOW
    button_pin = gpio_cfg.get("button_pin")
    if button_pin is not None:
        GPIO.setup(button_pin, GPIO.IN, pull_up_down=GPIO.PUD_UP)

    # E-stop button — input with pull-down (NO contact, goes HIGH when pressed)
    estop_pin = gpio_cfg.get("estop_pin")
    if estop_pin is not None:
        GPIO.setup(estop_pin, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)

    # E-Cat GPIO pins — inputs with pull-down (wire disconnected = 0)
    ecat_pins = gpio_cfg.get("ecat_gpio_pins", {})
    for reg, pin in ecat_pins.items():
        # Skip if same as button_pin (already set up with pull-up)
        if pin == button_pin:
            continue
        GPIO.setup(pin, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)

    # LED outputs
    for pin_key in ["led_green_pin", "led_yellow_pin", "led_red_pin", "led_blue_pin"]:
        GPIO.setup(gpio_cfg[pin_key], GPIO.OUT, initial=GPIO.LOW)

    logger.info("GPIO pins initialized")


def cleanup_gpio() -> None:
    """Release GPIO resources."""
    if _HW_GPIO:
        GPIO.cleanup()
        logger.info("GPIO cleaned up")
