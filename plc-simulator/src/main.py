#!/usr/bin/env python3
"""
PLC Simulator — main entry point.

Runs on the Pi Zero W. Starts:
  1. Modbus TCP server on port 502 (exposes all registers to remote clients)
  2. Sensor polling loops (MPU6050, DHT22, potentiometer)
  3. Work cycle state machine (automated grinder + clamp sequence)
  4. E-stop GPIO interrupt handler
  5. LED status indicators

Usage:
  python -m src.main                    # uses default config.yaml
  python -m src.main --config my.yaml   # custom config path
"""

import argparse
import asyncio
import logging
import signal
import sys
from pathlib import Path

from .actuators import ServoController
from .fault_monitor import FaultMonitor
from .gpio_config import add_edge_detect, cleanup_gpio, has_gpio, load_config, read_pin, setup_gpio
from .modbus_server import (
    PIN_ESTOP_ENABLE,
    PIN_ESTOP_OFF,
    PIN_PLATE_CYCLE,
    PLCModbusServer,
    STATE_ESTOPPED,
    STATE_IDLE,
    STATE_RUNNING,
    STATE_FAULT,
)
from .sensors import DHT22Sensor, MPU6050, PotentiometerReader
from .work_cycle import WorkCycle


def setup_logging(config):
    level = getattr(logging, config.get("logging", {}).get("level", "INFO"))
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def setup_button_callback(config, work_cycle: WorkCycle, modbus: PLCModbusServer):
    """Register GPIO interrupt for the Fuji AR22F0L push button.

    The button is normally open with an internal pull-up on GPIO 17.
    Pressing the button pulls GPIO 17 LOW; releasing lets it float HIGH.
    50ms debounce is applied to reject contact bounce.
    """
    if not has_gpio():
        return

    button_pin = config["gpio"].get("button_pin")
    if button_pin is None:
        return

    btn_logger = logging.getLogger("plc-simulator.button")

    def button_handler(pin, level):
        if level == 0:
            # Button pressed — active LOW
            btn_logger.info("BUTTON PRESSED  — GPIO %d LOW  — setting register %d=1, coil 0=True",
                            button_pin, PIN_PLATE_CYCLE)
            modbus.write_register(PIN_PLATE_CYCLE, 1)
            modbus.write_coil(0, True)
            work_cycle.trigger_start()
        else:
            # Button released — pulled HIGH by internal pull-up
            btn_logger.info("BUTTON RELEASED — GPIO %d HIGH — setting register %d=0, coil 0=False",
                            button_pin, PIN_PLATE_CYCLE)
            modbus.write_register(PIN_PLATE_CYCLE, 0)
            modbus.write_coil(0, False)

    if not add_edge_detect(button_pin, button_handler, edge="both", pull="up", bouncetime_ms=50):
        btn_logger.warning(
            "Could not register button edge detection on GPIO %d — "
            "push button will not work, but simulator continues", button_pin
        )


def setup_estop_callback(config, work_cycle: WorkCycle, modbus: PLCModbusServer):
    """Register GPIO interrupt for the E-stop button."""
    if not has_gpio():
        return

    estop_pin = config["gpio"].get("estop_pin")
    if estop_pin is None:
        return

    def estop_handler(pin, level):
        if level == 1:
            # Button pressed — E-stop engaged
            work_cycle.trigger_estop()
            modbus.write_register(PIN_ESTOP_ENABLE, 0)
            modbus.write_register(PIN_ESTOP_OFF, 1)
        else:
            # Button released — E-stop released
            work_cycle.release_estop()
            modbus.write_register(PIN_ESTOP_ENABLE, 1)
            modbus.write_register(PIN_ESTOP_OFF, 0)

    if not add_edge_detect(estop_pin, estop_handler, edge="both", pull="down", bouncetime_ms=200):
        logging.getLogger(__name__).warning(
            "Could not register E-stop edge detection on GPIO %d — "
            "E-stop button will not work, but simulator continues", estop_pin
        )


async def ecat_gpio_reader(config, modbus: PLCModbusServer):
    """Read E-Cat GPIO pins and update corresponding Modbus registers.

    For registers 0-24, any pin that is physically wired to a GPIO input
    is read here. If a wire is disconnected, the pull-down ensures the
    register reads 0. Unwired registers keep their simulated values.
    """
    if not has_gpio():
        return

    import RPi.GPIO as GPIO

    ecat_pins = config["gpio"].get("ecat_gpio_pins", {})
    button_pin = config["gpio"].get("button_pin")

    if not ecat_pins:
        return

    gpio_logger = logging.getLogger("plc-simulator.ecat-gpio")
    gpio_logger.info("E-Cat GPIO reader started for %d pin(s)", len(ecat_pins))

    while True:
        for reg_str, pin in ecat_pins.items():
            reg = int(reg_str)
            # Button pin (register 2) is handled by the interrupt callback
            if pin == button_pin:
                continue
            value = GPIO.input(pin)
            modbus.write_register(reg, 1 if value else 0)
        await asyncio.sleep(0.05)  # 50ms polling for GPIO inputs


async def led_updater(config, work_cycle: WorkCycle):
    """Update LED indicators based on system state."""
    if not has_gpio():
        return

    import RPi.GPIO as GPIO

    gpio_cfg = config["gpio"]
    green = gpio_cfg["led_green_pin"]
    yellow = gpio_cfg["led_yellow_pin"]
    red = gpio_cfg["led_red_pin"]
    # Blue LED is managed separately (Modbus connection tracking)

    while True:
        state = work_cycle.state
        GPIO.output(green, GPIO.HIGH if state == STATE_RUNNING else GPIO.LOW)
        GPIO.output(yellow, GPIO.HIGH if state == STATE_FAULT else GPIO.LOW)
        GPIO.output(red, GPIO.HIGH if state == STATE_ESTOPPED else GPIO.LOW)
        await asyncio.sleep(0.25)


async def main_async(config_path: Path):
    config = load_config(config_path)
    setup_logging(config)
    logger = logging.getLogger("plc-simulator")
    logger.info("PLC Simulator starting")

    # Initialize GPIO
    setup_gpio(config)

    # Initialize components
    modbus = PLCModbusServer(config)
    servos = ServoController(config)
    mpu6050 = MPU6050(config)
    dht22 = DHT22Sensor(config)
    pot = PotentiometerReader(config)
    fault_monitor = FaultMonitor(config)

    work_cycle = WorkCycle(
        config=config,
        modbus=modbus,
        servos=servos,
        mpu6050=mpu6050,
        dht22=dht22,
        pot=pot,
        fault_monitor=fault_monitor,
    )

    # Register push button and E-stop interrupts
    setup_button_callback(config, work_cycle, modbus)
    setup_estop_callback(config, work_cycle, modbus)

    # Start Modbus server
    modbus.start()
    logger.info("Modbus TCP server running")

    # Set E-stop enable register (system is ready)
    modbus.write_register(PIN_ESTOP_ENABLE, 1)

    # Start work cycle, LED updater, and E-Cat GPIO reader as concurrent tasks
    tasks = [
        asyncio.create_task(work_cycle.run()),
        asyncio.create_task(led_updater(config, work_cycle)),
        asyncio.create_task(ecat_gpio_reader(config, modbus)),
    ]

    # Handle graceful shutdown
    loop = asyncio.get_running_loop()
    shutdown_event = asyncio.Event()

    def signal_handler():
        logger.info("Shutdown signal received")
        shutdown_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, signal_handler)

    logger.info("PLC Simulator ready — waiting for commands")

    await shutdown_event.wait()

    # Cleanup
    logger.info("Shutting down...")
    work_cycle.stop()
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    servos.close()
    mpu6050.close()
    dht22.close()
    pot.close()
    modbus.stop()
    cleanup_gpio()
    logger.info("PLC Simulator stopped")


def main():
    parser = argparse.ArgumentParser(description="PLC Simulator for RAIV Digital Twin POC")
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(__file__).parent.parent / "config.yaml",
        help="Path to config.yaml (default: plc-simulator/config.yaml)",
    )
    args = parser.parse_args()
    asyncio.run(main_async(args.config))


if __name__ == "__main__":
    main()
