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
from .gpio_config import cleanup_gpio, has_gpio, load_config, setup_gpio
from .modbus_server import (
    PIN_ESTOP_ENABLE,
    PIN_ESTOP_OFF,
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


def setup_estop_callback(config, work_cycle: WorkCycle, modbus: PLCModbusServer):
    """Register GPIO interrupt for the E-stop button."""
    if not has_gpio():
        return

    import RPi.GPIO as GPIO

    estop_pin = config["gpio"]["estop_pin"]

    def estop_handler(channel):
        if GPIO.input(estop_pin):
            # Button pressed — E-stop engaged
            work_cycle.trigger_estop()
            modbus.write_register(PIN_ESTOP_ENABLE, 0)
            modbus.write_register(PIN_ESTOP_OFF, 1)
        else:
            # Button released — E-stop released
            work_cycle.release_estop()
            modbus.write_register(PIN_ESTOP_ENABLE, 1)
            modbus.write_register(PIN_ESTOP_OFF, 0)

    GPIO.add_event_detect(estop_pin, GPIO.BOTH, callback=estop_handler, bouncetime=200)
    logging.getLogger(__name__).info("E-stop interrupt registered on GPIO %d", estop_pin)


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

    # Register E-stop interrupt
    setup_estop_callback(config, work_cycle, modbus)

    # Start Modbus server
    modbus.start()
    logger.info("Modbus TCP server running")

    # Set E-stop enable register (system is ready)
    modbus.write_register(PIN_ESTOP_ENABLE, 1)

    # Start work cycle and LED updater as concurrent tasks
    tasks = [
        asyncio.create_task(work_cycle.run()),
        asyncio.create_task(led_updater(config, work_cycle)),
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
