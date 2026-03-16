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
    PIN_SERVO_POWER_ON,
    PLCModbusServer,
    REG_SYSTEM_STATE,
    SENSOR_BASE,
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
            # Refuse if E-stop is active
            if modbus.read_register(PIN_ESTOP_OFF) == 1:
                btn_logger.info("Servo Power rejected — E-stop active")
                return
            # Latch servo_power_on (register 0) so the monitor sees a persistent change
            btn_logger.info(
                "BUTTON PRESSED  — GPIO %d LOW  — latching register %d=1, "
                "setting register %d=1, coil 0=True",
                button_pin, PIN_SERVO_POWER_ON, PIN_PLATE_CYCLE,
            )
            modbus.write_register(PIN_SERVO_POWER_ON, 1)
            modbus.write_register(PIN_PLATE_CYCLE, 1)
            modbus.write_coil(0, True)
            work_cycle.trigger_start()
        else:
            # Button released — pulled HIGH by internal pull-up
            # plate_cycle and coil 0 clear on release; servo_power_on stays latched
            btn_logger.info(
                "BUTTON RELEASED — GPIO %d HIGH — setting register %d=0, coil 0=False "
                "(servo_power_on latch remains)",
                button_pin, PIN_PLATE_CYCLE,
            )
            modbus.write_register(PIN_PLATE_CYCLE, 0)
            modbus.write_coil(0, False)

    if not add_edge_detect(button_pin, button_handler, edge="both", pull="up", bouncetime_ms=50):
        btn_logger.warning(
            "Could not register button edge detection on GPIO %d — "
            "push button will not work, but simulator continues", button_pin
        )


def setup_estop_callback(config, work_cycle: WorkCycle, modbus: PLCModbusServer):
    """Register GPIO interrupt for the E-stop button.

    Wiring: JZMTE HB38 E-stop with Normally Closed (NC) contact.
      Terminal 11 → GND, Terminal 12 → GPIO 27.
      NOT pressed: NC closed → GPIO 27 pulled LOW through closed contact.
      Pressed (or wire disconnected): NC opens → internal pull-up → GPIO 27 HIGH.
    This is fail-safe: a disconnected wire reads the same as E-stop pressed.
    """
    if not has_gpio():
        return

    estop_pin = config["gpio"].get("estop_pin")
    if estop_pin is None:
        return

    estop_logger = logging.getLogger("plc-simulator.estop")

    def estop_handler(pin, level):
        if level == 1:
            # GPIO HIGH — E-stop pressed or wire disconnected (fail-safe)
            estop_logger.warning(
                "E-STOP ACTIVATED — GPIO %d HIGH — killing servo power, system halted",
                estop_pin,
            )
            modbus.write_register(PIN_SERVO_POWER_ON, 0)
            modbus.write_register(PIN_ESTOP_ENABLE, 0)
            modbus.write_register(PIN_ESTOP_OFF, 1)
            modbus.write_register(SENSOR_BASE + REG_SYSTEM_STATE, STATE_ESTOPPED)
            work_cycle.trigger_estop()
        else:
            # GPIO LOW — E-stop released (twisted to reset), NC contact closed
            estop_logger.info(
                "E-STOP RELEASED — GPIO %d LOW — system ready "
                "(servo power must be re-enabled manually)",
                estop_pin,
            )
            modbus.write_register(PIN_ESTOP_ENABLE, 1)
            modbus.write_register(PIN_ESTOP_OFF, 0)
            work_cycle.release_estop()
            # Do NOT re-enable servo power — operator must press Servo Power button

    if not add_edge_detect(estop_pin, estop_handler, edge="both", pull="up", bouncetime_ms=200):
        estop_logger.warning(
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

    # Read initial E-stop state from GPIO 27 and set registers accordingly.
    # NC wiring: LOW = safe (contact closed), HIGH = E-stop active (contact open).
    estop_pin = config["gpio"].get("estop_pin")
    if estop_pin is not None and has_gpio():
        initial_estop = read_pin(estop_pin)
        if initial_estop == 1:
            logger.warning(
                "E-STOP active at startup (GPIO %d HIGH) — system halted",
                estop_pin,
            )
            modbus.write_register(PIN_ESTOP_ENABLE, 0)
            modbus.write_register(PIN_ESTOP_OFF, 1)
            modbus.write_register(SENSOR_BASE + REG_SYSTEM_STATE, STATE_ESTOPPED)
            work_cycle.trigger_estop()
        else:
            logger.info("E-stop not active at startup (GPIO %d LOW) — system ready", estop_pin)
            modbus.write_register(PIN_ESTOP_ENABLE, 1)
            modbus.write_register(PIN_ESTOP_OFF, 0)
    else:
        # No E-stop pin configured or no GPIO — default to safe state
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
