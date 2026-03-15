"""
Matrix Portal S3 — RAIV Digital Twin Status Display

Main entry point for the Adafruit Matrix Portal S3 driving a 64x32 RGB LED
matrix. Connects to WiFi, polls the Pi 5 status API, and renders 6 colored
status blocks (one per subsystem) with scrolling fault messages.

Copy this entire display/ directory to the Matrix Portal S3's CIRCUITPY drive.

CircuitPython libraries required (install via circup or copy from bundle):
  - adafruit_matrixportal
  - adafruit_display_text
  - adafruit_requests
"""

import json
import time

import board
import displayio
import rgbmatrix
import supervisor
import wifi
import socketpool
import ssl

import adafruit_requests

import config
from status_renderer import (
    build_status_display,
    evaluate_subsystems,
    get_fault_message,
)

# Release any previously held displays
displayio.release_displays()

# Initialize the 64x32 RGB LED matrix
matrix = rgbmatrix.RGBMatrix(
    width=config.MATRIX_WIDTH,
    height=config.MATRIX_HEIGHT,
    bit_depth=4,
    rgb_pins=[
        board.MTX_R1, board.MTX_G1, board.MTX_B1,
        board.MTX_R2, board.MTX_G2, board.MTX_B2,
    ],
    addr_pins=[
        board.MTX_ADDRA, board.MTX_ADDRB, board.MTX_ADDRC, board.MTX_ADDRD,
    ],
    clock_pin=board.MTX_CLK,
    latch_pin=board.MTX_LAT,
    output_enable_pin=board.MTX_OE,
)

display = displayio.Display(matrix, auto_refresh=True)

# Connect to WiFi
print(f"Connecting to WiFi: {config.WIFI_SSID}")
try:
    wifi.radio.connect(config.WIFI_SSID, config.WIFI_PASSWORD)
    print(f"Connected! IP: {wifi.radio.ipv4_address}")
except Exception as e:
    print(f"WiFi connection failed: {e}")
    # Show all-red display on WiFi failure
    error_status = [("NET", config.COLOR_RED)] * 6
    display.root_group = build_status_display(display, error_status, "NO WIFI")
    while True:
        time.sleep(10)

# Set up HTTP client
pool = socketpool.SocketPool(wifi.radio)
ssl_context = ssl.create_default_context()
requests = adafruit_requests.Session(pool, ssl_context)

# Default status when API is unreachable
DISCONNECTED_STATUS = {
    "connected": False,
    "system_state": "disconnected",
    "last_fault": "none",
    "temperature_f": 0,
    "pressure_simulated": 512,
    "vibration_x": 0, "vibration_y": 0, "vibration_z": 0,
    "servo2_position": 0,
    "poe_system": False,
}


def fetch_status():
    """Poll the Pi 5 status API and return the status dict."""
    try:
        response = requests.get(config.STATUS_ENDPOINT, timeout=3)
        if response.status_code == 200:
            data = response.json()
            response.close()
            return data
        response.close()
    except Exception as e:
        print(f"API fetch error: {e}")
    return DISCONNECTED_STATUS


# Main loop
scroll_offset = 0
SCROLL_SPEED = 2  # Pixels per frame

print("Starting status display loop")

while True:
    status = fetch_status()
    subsystem_colors = evaluate_subsystems(status)
    fault_text = get_fault_message(status)

    if fault_text:
        scroll_offset = (scroll_offset + SCROLL_SPEED) % (len(fault_text) * 6 + config.MATRIX_WIDTH)
    else:
        scroll_offset = 0

    group = build_status_display(display, subsystem_colors, fault_text, scroll_offset)
    display.root_group = group

    time.sleep(config.POLL_INTERVAL)
