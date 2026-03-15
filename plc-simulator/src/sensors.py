"""
Sensor read functions for GY-521 (MPU6050), DHT22, and potentiometer.

Each sensor has a read function that returns current values. If the hardware
is unavailable (running off-Pi), simulated values are returned with slight
random variation to make the Modbus registers look alive during testing.
"""

import logging
import math
import random
import time
from typing import Any, Dict, Optional, Tuple

from . import gpio_config

logger = logging.getLogger(__name__)

# MPU6050 register addresses
_MPU6050_PWR_MGMT_1 = 0x6B
_MPU6050_ACCEL_XOUT_H = 0x3B
_MPU6050_GYRO_XOUT_H = 0x43
_ACCEL_SCALE = 16384.0   # LSB/g for ±2g range
_GYRO_SCALE = 131.0      # LSB/(°/s) for ±250°/s range


class MPU6050:
    """GY-521 / MPU6050 accelerometer + gyroscope reader."""

    def __init__(self, config: Dict[str, Any]):
        self._bus_num = config["i2c"]["bus"]
        self._addr = config["i2c"]["mpu6050_address"]
        self._bus = None

        if gpio_config.has_i2c():
            import smbus2
            self._bus = smbus2.SMBus(self._bus_num)
            # Wake up MPU6050 (exits sleep mode)
            self._bus.write_byte_data(self._addr, _MPU6050_PWR_MGMT_1, 0x00)
            logger.info("MPU6050 initialized on I2C bus %d addr 0x%02X",
                        self._bus_num, self._addr)

    def read(self) -> Dict[str, float]:
        """Return accel (m/s^2) and gyro (°/s) for all 3 axes."""
        if self._bus is None:
            return self._simulated_read()

        raw = self._bus.read_i2c_block_data(self._addr, _MPU6050_ACCEL_XOUT_H, 14)

        def to_signed(high: int, low: int) -> int:
            val = (high << 8) | low
            return val - 65536 if val > 32767 else val

        ax = to_signed(raw[0], raw[1]) / _ACCEL_SCALE * 9.81
        ay = to_signed(raw[2], raw[3]) / _ACCEL_SCALE * 9.81
        az = to_signed(raw[4], raw[5]) / _ACCEL_SCALE * 9.81
        # raw[6:8] is temperature — skip
        gx = to_signed(raw[8], raw[9]) / _GYRO_SCALE
        gy = to_signed(raw[10], raw[11]) / _GYRO_SCALE
        gz = to_signed(raw[12], raw[13]) / _GYRO_SCALE

        return {
            "accel_x": round(ax, 2),
            "accel_y": round(ay, 2),
            "accel_z": round(az, 2),
            "gyro_x": round(gx, 2),
            "gyro_y": round(gy, 2),
            "gyro_z": round(gz, 2),
        }

    @staticmethod
    def _simulated_read() -> Dict[str, float]:
        """Return realistic-looking simulated IMU data."""
        return {
            "accel_x": round(random.gauss(0.0, 0.05), 2),
            "accel_y": round(random.gauss(0.0, 0.05), 2),
            "accel_z": round(random.gauss(9.81, 0.1), 2),
            "gyro_x": round(random.gauss(0.0, 0.5), 2),
            "gyro_y": round(random.gauss(0.0, 0.5), 2),
            "gyro_z": round(random.gauss(0.0, 0.5), 2),
        }

    def close(self) -> None:
        if self._bus is not None:
            self._bus.close()


class DHT22Sensor:
    """DHT22 temperature + humidity sensor reader."""

    def __init__(self, config: Dict[str, Any]):
        self._pin = config["gpio"]["dht22_pin"]
        self._device = None
        self._last_temp_f: float = 72.0
        self._last_humidity: float = 45.0
        self._last_read_time: float = 0

        if gpio_config.has_dht():
            import adafruit_dht
            import board
            pin_obj = getattr(board, f"D{self._pin}", None)
            if pin_obj:
                self._device = adafruit_dht.DHT22(pin_obj)
                logger.info("DHT22 initialized on GPIO %d", self._pin)
            else:
                logger.warning("Board pin D%d not found, using simulation", self._pin)

    def read(self) -> Dict[str, float]:
        """Return temperature (°F) and humidity (%)."""
        if self._device is None:
            return self._simulated_read()

        try:
            temp_c = self._device.temperature
            humidity = self._device.humidity
            if temp_c is not None and humidity is not None:
                self._last_temp_f = round(temp_c * 9.0 / 5.0 + 32.0, 1)
                self._last_humidity = round(humidity, 1)
                self._last_read_time = time.time()
        except RuntimeError as e:
            # DHT22 frequently throws read errors — use last known values
            logger.debug("DHT22 read error (using cached): %s", e)

        return {
            "temperature_f": self._last_temp_f,
            "humidity_pct": self._last_humidity,
        }

    @staticmethod
    def _simulated_read() -> Dict[str, float]:
        """Return realistic simulated temperature and humidity."""
        return {
            "temperature_f": round(random.gauss(72.0, 1.5), 1),
            "humidity_pct": round(random.gauss(45.0, 3.0), 1),
        }

    def close(self) -> None:
        if self._device is not None:
            self._device.exit()


class PotentiometerReader:
    """Potentiometer reader via MCP3008 ADC, or simulated value.

    NOTE: The Pi Zero W has no built-in ADC. In the real deployment, the
    Click PLC has built-in analog inputs (C0-02DD1-D). For this simulator,
    we either use an MCP3008 SPI ADC if available, or return a configurable
    simulated value from config.yaml.
    """

    def __init__(self, config: Dict[str, Any]):
        adc_cfg = config["adc"]
        self._enabled = adc_cfg.get("enabled", False)
        self._simulated_value = adc_cfg.get("simulated_value", 512)
        self._spi = None

        if self._enabled:
            try:
                import spidev
                self._spi = spidev.SpiDev()
                self._spi.open(adc_cfg["spi_bus"], adc_cfg["spi_device"])
                self._spi.max_speed_hz = 1000000
                self._channel = adc_cfg.get("pot_channel", 0)
                logger.info("MCP3008 ADC initialized on SPI bus %d device %d",
                            adc_cfg["spi_bus"], adc_cfg["spi_device"])
            except (ImportError, FileNotFoundError):
                logger.warning("SPI not available — using simulated potentiometer")
                self._enabled = False

    def read(self) -> int:
        """Return potentiometer value 0-1023."""
        if self._spi is not None and self._enabled:
            cmd = [1, (8 + self._channel) << 4, 0]
            result = self._spi.xfer2(cmd)
            return ((result[1] & 3) << 8) | result[2]

        # Simulated: drift slowly around the configured value
        drift = random.randint(-5, 5)
        self._simulated_value = max(0, min(1023, self._simulated_value + drift))
        return self._simulated_value

    def close(self) -> None:
        if self._spi is not None:
            self._spi.close()
