#!/usr/bin/env python3
"""
IronSight Status Display -- Multi-page live dashboard for 3.5" touchscreen.

Pages auto-rotate every 5 seconds (or tap to advance on touchscreen):
  Page 1: LIVE -- PLC connection, travel, speed, plates, spacing
  Page 2: ACTIVITY -- Scrolling log of what IronSight is doing
  Page 3: HEALTH -- System health, disk, network, services
  Page 4: REGISTERS -- Live DS register values (when connected)

Renders to Linux framebuffer via Pillow, or falls back to terminal.

Requires: pip3 install Pillow
"""

import os
import sys
import time

# Add scripts/ to path for shared lib
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))

try:
    from PIL import Image, ImageDraw, ImageFont
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

from lib.framebuffer import Framebuffer
from lib.system_status import get_system_status
from lib.display_pages import (
    PAGE_RENDERERS,
    NUM_PAGES,
    render_terminal,
)

# ─────────────────────────────────────────────────────────────
#  Configuration
# ─────────────────────────────────────────────────────────────

REFRESH_INTERVAL = 2       # seconds between display updates
PAGE_ROTATE_INTERVAL = 8   # seconds per page before auto-advancing


# ─────────────────────────────────────────────────────────────
#  Main loop
# ─────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="IronSight Multi-Page Display")
    parser.add_argument("--fb", default="/dev/fb0", help="Framebuffer device")
    parser.add_argument("--terminal", action="store_true", help="Force terminal output")
    parser.add_argument("--once", action="store_true", help="Render once and exit")
    parser.add_argument("--page", type=int, default=-1, help="Lock to specific page (0-3)")
    args = parser.parse_args()

    use_fb = False
    fb = None

    if not args.terminal and HAS_PILLOW:
        for fb_path in [args.fb, "/dev/fb1", "/dev/fb0"]:
            if os.path.exists(fb_path):
                fb = Framebuffer(fb_path)
                if fb.is_available():
                    print(f"Using framebuffer: {fb_path} ({fb.width}x{fb.height} @ {fb.bpp}bpp)")
                    use_fb = True
                    fb.open()
                    break

    if not use_fb and not HAS_PILLOW:
        print("Pillow not installed -- using terminal mode")
        print("Install for screen: pip3 install Pillow")

    current_page = args.page if args.page >= 0 else 0
    page_start_time = time.time()

    try:
        while True:
            # Auto-rotate pages
            if args.page < 0 and time.time() - page_start_time > PAGE_ROTATE_INTERVAL:
                current_page = (current_page + 1) % NUM_PAGES
                page_start_time = time.time()

            if use_fb:
                sys_status = get_system_status()
                img = PAGE_RENDERERS[current_page](fb.width, fb.height, sys_status)
                fb.show(img)
            else:
                render_terminal(current_page)

            if args.once:
                break
            time.sleep(REFRESH_INTERVAL)

    except KeyboardInterrupt:
        print("\nDisplay stopped.")
    finally:
        if fb:
            fb.close()


if __name__ == "__main__":
    main()
