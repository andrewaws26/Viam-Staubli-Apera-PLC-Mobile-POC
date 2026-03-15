"""
Status rendering for the 64x32 RGB LED matrix.

Draws 6 colored status blocks (one per subsystem) and scrolls fault
messages along the bottom rows when a fault is active.
"""

import math
import time

import displayio
import terminalio
from adafruit_display_text.label import Label

import config

# Subsystem row definitions — each gets a 64x5 pixel strip
# Row 0 starts at y=0, Row 5 ends at y=29, leaving 2 rows for scrolling text
SUBSYSTEMS = [
    {"name": "GRIND", "key": "grinder"},
    {"name": "CLAMP", "key": "clamp"},
    {"name": "TEMP",  "key": "temp"},
    {"name": "PRESS", "key": "pressure"},
    {"name": "NET",   "key": "network"},
    {"name": "POWER", "key": "power"},
]

ROW_HEIGHT = 5
SCROLL_Y = 30  # Bottom 2 rows for scrolling text


def _color_to_565(r, g, b):
    """Convert RGB888 to RGB565 for displayio."""
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)


def evaluate_subsystems(status):
    """Evaluate each subsystem and return a list of (name, color) tuples.

    Args:
        status: Dict from the /status API endpoint.

    Returns:
        List of (subsystem_name, color_rgb_tuple) pairs.
    """
    results = []

    # 1. GRINDER — based on servo 1 state + vibration
    vx = status.get("vibration_x", 0)
    vy = status.get("vibration_y", 0)
    vz = status.get("vibration_z", 0)
    vib_mag = math.sqrt(vx * vx + vy * vy + vz * vz)
    sys_state = status.get("system_state", "disconnected")

    if sys_state == "e-stopped" or vib_mag > config.VIBRATION_MAX:
        results.append(("GRIND", config.COLOR_RED))
    elif sys_state == "running":
        results.append(("GRIND", config.COLOR_GREEN))
    elif sys_state == "fault":
        results.append(("GRIND", config.COLOR_YELLOW))
    else:
        results.append(("GRIND", config.COLOR_GRAY))

    # 2. CLAMP — based on servo 2 reaching target position
    servo2 = status.get("servo2_position", 0)
    if sys_state in ("fault", "e-stopped"):
        results.append(("CLAMP", config.COLOR_RED))
    elif sys_state == "running":
        results.append(("CLAMP", config.COLOR_GREEN))
    else:
        results.append(("CLAMP", config.COLOR_GRAY))

    # 3. TEMP — based on temperature thresholds
    temp = status.get("temperature_f", 0)
    if temp > config.TEMP_FAULT_F:
        results.append(("TEMP", config.COLOR_RED))
    elif temp > config.TEMP_WARN_F:
        results.append(("TEMP", config.COLOR_YELLOW))
    else:
        results.append(("TEMP", config.COLOR_GREEN))

    # 4. PRESSURE — based on potentiometer value
    pressure = status.get("pressure_simulated", 512)
    if pressure < config.PRESSURE_MIN:
        results.append(("PRESS", config.COLOR_RED))
    else:
        results.append(("PRESS", config.COLOR_GREEN))

    # 5. NETWORK — based on API connectivity (if we got data, it's connected)
    connected = status.get("connected", False)
    if connected:
        results.append(("NET", config.COLOR_GREEN))
    else:
        results.append(("NET", config.COLOR_RED))

    # 6. POWER — future: UPS HAT status. For now, always green if system is on.
    poe = status.get("poe_system", False)
    if poe:
        results.append(("POWER", config.COLOR_GREEN))
    else:
        results.append(("POWER", config.COLOR_YELLOW))

    return results


def get_fault_message(status):
    """Return a fault message string if any subsystem is faulted, else None."""
    sys_state = status.get("system_state", "disconnected")
    last_fault = status.get("last_fault", "none")

    if sys_state == "e-stopped":
        return "E-STOP ACTIVE"
    elif sys_state == "fault":
        return f"FAULT: {last_fault.upper()}"
    elif sys_state == "disconnected":
        return "PLC DISCONNECTED"
    return None


def build_status_display(display, subsystem_colors, fault_text=None, scroll_offset=0):
    """Build and return a displayio Group with the status blocks and optional scroll text.

    Args:
        display: The matrix display object.
        subsystem_colors: List of (name, color) tuples from evaluate_subsystems().
        fault_text: Optional fault message string to scroll along the bottom.
        scroll_offset: Pixel offset for scrolling text animation.

    Returns:
        A displayio.Group ready to be shown on the display.
    """
    group = displayio.Group()

    for i, (name, color) in enumerate(subsystem_colors):
        # Create a colored rectangle for this subsystem row
        bitmap = displayio.Bitmap(config.MATRIX_WIDTH, ROW_HEIGHT, 2)
        palette = displayio.Palette(2)
        palette[0] = _color_to_565(*config.COLOR_BLACK)
        palette[1] = _color_to_565(*color)

        # Fill the bitmap
        for x in range(config.MATRIX_WIDTH):
            for y in range(ROW_HEIGHT):
                bitmap[x, y] = 1

        tile = displayio.TileGrid(bitmap, pixel_shader=palette, x=0, y=i * ROW_HEIGHT)
        group.append(tile)

        # Add subsystem label
        label = Label(
            terminalio.FONT,
            text=name,
            color=_color_to_565(*config.COLOR_BLACK),
            x=2,
            y=i * ROW_HEIGHT + ROW_HEIGHT // 2,
        )
        group.append(label)

    # Scrolling fault text along the bottom 2 rows
    if fault_text:
        scroll_label = Label(
            terminalio.FONT,
            text=fault_text,
            color=_color_to_565(*config.COLOR_RED),
            x=config.MATRIX_WIDTH - scroll_offset,
            y=SCROLL_Y + 1,
        )
        group.append(scroll_label)

    return group
