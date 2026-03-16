"""
GPIO pin configuration — reads assignments from config.yaml.

All pin numbers use BCM numbering. This module centralizes pin setup
so that wiring changes only require editing config.yaml.

RPi.GPIO is used for basic I/O (setup, read, write, PWM). Edge detection
uses lgpio (gpiochip interface) because RPi.GPIO's sysfs-based edge
detection is broken on kernel 6.x+.
"""

import logging
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, Optional

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

# lgpio for edge detection (works on kernel 6.x+ where RPi.GPIO sysfs fails)
_lgpio = None  # type: Any
_lgpio_handle = None  # type: Any
_lgpio_callbacks = []  # type: list
_edge_pins = set()  # type: set  # pins claimed by lgpio for edge detection

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


def _init_lgpio() -> None:
    """Open the lgpio chip handle for edge detection."""
    global _lgpio, _lgpio_handle
    try:
        import lgpio
        _lgpio = lgpio
        _lgpio_handle = lgpio.gpiochip_open(0)
        logger.info("lgpio: opened gpiochip0 for edge detection")
    except Exception as e:
        logger.warning("lgpio not available (%s) — edge detection will not work", e)


def add_edge_detect(
    pin: int,
    callback: Callable[[int, int], None],
    edge: str = "both",
    pull: str = "up",
    bouncetime_ms: int = 50,
) -> bool:
    """Register edge detection on a pin using lgpio.

    Args:
        pin: BCM pin number.
        callback: Called as callback(pin, level) where level is 0 or 1.
        edge: "rising", "falling", or "both".
        pull: "up", "down", or "none".
        bouncetime_ms: Software debounce in milliseconds.

    Returns True if registration succeeded, False otherwise.
    """
    if _lgpio is None or _lgpio_handle is None:
        logger.warning("lgpio not initialized — cannot add edge detect on GPIO %d", pin)
        return False

    try:
        pull_flag = {
            "up": _lgpio.SET_PULL_UP,
            "down": _lgpio.SET_PULL_DOWN,
            "none": _lgpio.SET_PULL_NONE,
        }[pull]

        edge_flag = {
            "both": _lgpio.BOTH_EDGES,
            "rising": _lgpio.RISING_EDGE,
            "falling": _lgpio.FALLING_EDGE,
        }[edge]

        _lgpio.gpio_claim_alert(_lgpio_handle, pin, edge_flag, pull_flag)
        _edge_pins.add(pin)

        # Wrap callback with software debounce
        last_time = [0.0]
        lock = threading.Lock()

        def _debounced_cb(_chip, gpio, level, _tick):
            now = time.monotonic()
            with lock:
                if now - last_time[0] < bouncetime_ms / 1000.0:
                    return
                last_time[0] = now
            callback(gpio, level)

        cb = _lgpio.callback(_lgpio_handle, pin, edge_flag, _debounced_cb)
        _lgpio_callbacks.append(cb)
        logger.info("lgpio: edge detection registered on GPIO %d (%s, %dms debounce)",
                     pin, edge, bouncetime_ms)
        return True
    except Exception as e:
        logger.warning("lgpio: failed to add edge detect on GPIO %d: %s", pin, e)
        return False


def read_pin(pin: int) -> int:
    """Read a GPIO pin via lgpio. Returns 0 or 1."""
    if _lgpio is not None and _lgpio_handle is not None:
        return _lgpio.gpio_read(_lgpio_handle, pin)
    return 0


def setup_gpio(config: Dict[str, Any]) -> None:
    """Initialize GPIO pins based on config. No-op if RPi.GPIO is unavailable."""
    if not _HW_GPIO:
        logger.info("Skipping GPIO setup (no hardware)")
        return

    gpio_cfg = config["gpio"]
    GPIO.setmode(GPIO.BCM)
    GPIO.setwarnings(False)

    # Initialize lgpio for edge detection
    _init_lgpio()

    # Button and E-stop pins are set up via lgpio in add_edge_detect(),
    # so skip RPi.GPIO setup for them here.
    button_pin = gpio_cfg.get("button_pin")
    estop_pin = gpio_cfg.get("estop_pin")

    # E-Cat GPIO pins — inputs with pull-down (wire disconnected = 0)
    ecat_pins = gpio_cfg.get("ecat_gpio_pins", {})
    for reg, pin in ecat_pins.items():
        # Skip if same as button_pin (handled by lgpio edge detect)
        if pin == button_pin:
            continue
        GPIO.setup(pin, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)

    # LED outputs
    for pin_key in ["led_green_pin", "led_yellow_pin", "led_red_pin", "led_blue_pin"]:
        GPIO.setup(gpio_cfg[pin_key], GPIO.OUT, initial=GPIO.LOW)

    logger.info("GPIO pins initialized")


def cleanup_gpio() -> None:
    """Release GPIO resources."""
    global _lgpio_handle
    # Clean up lgpio callbacks and handle
    for cb in _lgpio_callbacks:
        try:
            cb.cancel()
        except Exception:
            pass
    _lgpio_callbacks.clear()
    if _lgpio is not None and _lgpio_handle is not None:
        for pin in _edge_pins:
            try:
                _lgpio.gpio_free(_lgpio_handle, pin)
            except Exception:
                pass
        _edge_pins.clear()
        try:
            _lgpio.gpiochip_close(_lgpio_handle)
        except Exception:
            pass
        _lgpio_handle = None
        logger.info("lgpio: chip handle closed")
    if _HW_GPIO:
        GPIO.cleanup()
        logger.info("GPIO cleaned up")
