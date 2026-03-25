"""
Shared PLC constants for the IronSight system.

All PLC register addresses, labels, network config, and system paths
live here. Import from this file instead of hardcoding values.

Usage:
    from lib.plc_constants import PLC_HOST, DS_LABELS, OFFLINE_BUFFER_DIR
"""

from pathlib import Path

# ─────────────────────────────────────────────────────────────
#  PLC Network
# ─────────────────────────────────────────────────────────────

PLC_HOST = "169.168.10.21"
PLC_PORT = 502

# ─────────────────────────────────────────────────────────────
#  TPS Configuration
# ─────────────────────────────────────────────────────────────

TIE_SPACING_INCHES = 19.5      # Standard tie spacing
TIE_SPACING_DS2 = 39           # DS2 value (x0.5")
TIE_SPACING_DS3 = 195          # DS3 value (x0.1")
DETECTOR_OFFSET_INCHES = 607.0  # DS6 value / 10

# ─────────────────────────────────────────────────────────────
#  File Paths
# ─────────────────────────────────────────────────────────────

OFFLINE_BUFFER_DIR = Path("/home/andrew/.viam/offline-buffer")
CAPTURE_DIR = Path("/home/andrew/.viam/capture/rdk_component_sensor/plc-monitor/Readings")
CAPTURE_BASE_DIR = Path("/home/andrew/.viam/capture")
VIAM_CONFIG_PATH = Path("/home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC/config/viam-server.json")

# ─────────────────────────────────────────────────────────────
#  DS Holding Registers (addr 0-24, FC03)
#  Click PLC DS1-DS25, decoded from .ckp ladder logic
# ─────────────────────────────────────────────────────────────

DS_LABELS = {
    0: "DS1 Encoder Ignore",
    1: "DS2 Tie Spacing (x0.5in)",
    2: "DS3 Tie Spacing (x0.1in)",
    3: "DS4 Tenths Mile Laying",
    4: "DS5 Detector Offset Bits",
    5: "DS6 Detector Offset (x0.1in)",
    6: "DS7 Plate Count",
    7: "DS8 AVG Plates/Min",
    8: "DS9 Detector Next Tie",
    9: "DS10 Encoder Next Tie",
    10: "DS11 Detector Bits",
    11: "DS12 Last Detector Laid Inch",
    12: "DS13 2nd Pass Double Lay",
    13: "DS14 Tie Team Skips",
    14: "DS15 Tie Team Lays",
    15: "DS16 Skip Plus Lay Less 1",
    16: "DS17",
    17: "DS18",
    18: "DS19 HMI Screen",
    19: "DS20",
    20: "DS21",
    21: "DS22",
    22: "DS23",
    23: "DS24",
    24: "DS25",
}

# Short labels for compact display (touchscreen, dashboard)
DS_SHORT_LABELS = {
    "ds1": "Encoder Ignore",
    "ds2": "Tie Spacing (x0.5\")",
    "ds3": "Tie Spacing (x0.1\")",
    "ds4": "Tenths Mile Laying",
    "ds5": "Detector Offset Bits",
    "ds6": "Detector Offset (x0.1\")",
    "ds7": "Plate Count",
    "ds8": "AVG Plates/Min",
    "ds9": "Detector Next Tie",
    "ds10": "Encoder Next Tie",
}

# DS register names list (for iteration by index)
DS_REGISTER_NAMES = [f"ds{i}" for i in range(1, 26)]

# ─────────────────────────────────────────────────────────────
#  DD Registers (32-bit, addr 16384+)
# ─────────────────────────────────────────────────────────────

DD1_ADDR = 16384       # Raw HSC encoder count (2 x 16-bit)
DD1_COUNT = 2          # Read 2 registers for 32-bit value

# ─────────────────────────────────────────────────────────────
#  Application Coils (C1-C34, addr 0-33, FC01)
# ─────────────────────────────────────────────────────────────

COIL_LABELS = {
    0: "C1", 1: "C2", 2: "C3 Camera Positive",
    3: "C4", 4: "C5", 5: "C6",
    6: "C7 First Tie Detected", 7: "C8", 8: "C9", 9: "C10",
    10: "C11", 11: "C12 Lay Ties Set", 12: "C13 Drop Ties",
    13: "C14 Drop Enable", 14: "C15 Drop Enable Latch",
    15: "C16 Software Eject", 16: "C17 Detector Eject",
    17: "C18", 18: "C19",
    19: "C20 TPS 1 Single", 20: "C21 TPS 1 Double",
    21: "C22 TPS 2 Left", 22: "C23 TPS 2 Right",
    23: "C24 TPS 2 Both", 24: "C25 TPS 2 Left Double",
    25: "C26 TPS 2 Right Double", 26: "C27 2nd Pass",
    27: "C28 Encoder Eject", 28: "C29 Encoder Mode",
    29: "C30 Detector Drop", 30: "C31 Backup Alarm",
    31: "C32 Double Lay Trigger", 32: "C33", 33: "C34",
}

# Coil addresses
COIL_APP_ADDR = 0       # C1-C34, read 34
COIL_APP_COUNT = 34
COIL_OUTPUT_ADDR = 8192  # Y1-Y3
COIL_OUTPUT_COUNT = 3
COIL_ENCODER_ADDR = 1998  # C1999-C2000
COIL_ENCODER_COUNT = 2

# ─────────────────────────────────────────────────────────────
#  Discrete Inputs (X1-X8, addr 0-7, FC02)
# ─────────────────────────────────────────────────────────────

INPUT_LABELS = {
    0: "X1 Encoder A",
    1: "X2 Encoder B",
    2: "X3 Camera/Flipper",
    3: "X4 TPS Power Loop",
    4: "X5 Air Eagle 1 Feedback",
    5: "X6 Air Eagle 2 Feedback",
    6: "X7 Air Eagle 3 Enable",
    7: "X8",
}

# ─────────────────────────────────────────────────────────────
#  Output Coils (Y1-Y3, addr 8192-8194)
# ─────────────────────────────────────────────────────────────

OUTPUT_LABELS = {
    0: "Y1 Eject TPS 1 Center",
    1: "Y2 Eject Left TPS 2",
    2: "Y3 Eject Right TPS 2",
}

# ─────────────────────────────────────────────────────────────
#  Timer Registers (TD1-TD12, addr 24576-24587)
# ─────────────────────────────────────────────────────────────

TIMER_ADDR = 24576
TIMER_COUNT = 12

# ─────────────────────────────────────────────────────────────
#  UI Colors (RGB) — high contrast for sunlight on 3.5" screen
# ─────────────────────────────────────────────────────────────

BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
GREEN = (0, 200, 80)
RED = (220, 50, 50)
YELLOW = (240, 200, 0)
BLUE = (40, 120, 220)
CYAN = (0, 180, 220)
DARK_GRAY = (30, 30, 35)
MID_GRAY = (60, 60, 70)
LIGHT_GRAY = (180, 180, 190)
ORANGE = (240, 140, 20)
DARK_GREEN = (0, 80, 40)
DARK_RED = (80, 20, 20)
DARK_BLUE = (20, 50, 100)
DARK_CYAN = (0, 70, 90)
DARK_ORANGE = (100, 55, 10)
PURPLE = (100, 40, 140)
DARK_PURPLE = (55, 20, 80)

LEVEL_COLORS = {
    "info": LIGHT_GRAY,
    "success": GREEN,
    "warning": YELLOW,
    "error": RED,
}
