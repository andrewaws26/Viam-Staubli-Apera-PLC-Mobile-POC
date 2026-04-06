"""
Shared constants for the touch UI.
"""

# Screen dimensions (updated at runtime to match framebuffer)
W = 480
H = 320

# Layout
MARGIN = 12
HEADER_H = 32
BACK_BTN_H = 48
BACK_BTN_W = 90

# Timing
DATA_REFRESH_INTERVAL = 2.0   # seconds between data fetches
TOUCH_POLL_HZ = 50            # touch polling rate
SCROLL_REPEAT_MS = 150        # hold-to-scroll repeat interval
