"""
Touch calibration mode — interactive crosshair tap sequence.
"""

import time

from PIL import Image, ImageDraw

from lib.plc_constants import BLACK, WHITE, RED, GREEN, LIGHT_GRAY
from lib.framebuffer import Framebuffer
from lib.touch_input import TouchInput
from touch_ui.constants import W, H, MARGIN
from touch_ui.widgets.common import find_font


def run_calibration(fb: Framebuffer, touch: TouchInput) -> None:
    """Interactive touch calibration -- tap crosshairs at screen corners."""
    font = find_font(14)
    font_sm = find_font(11)

    # Temporarily disable coordinate mapping
    touch.cal = {
        "min_x": 0, "max_x": 4095,
        "min_y": 0, "max_y": 4095,
        "swap_xy": False,
        "invert_x": False,
        "invert_y": False,
    }

    targets = [
        (40, 40, "TOP-LEFT"),
        (W - 40, 40, "TOP-RIGHT"),
        (40, H - 40, "BOTTOM-LEFT"),
        (W - 40, H - 40, "BOTTOM-RIGHT"),
    ]

    raw_points: list = []
    touch.start()

    for tx, ty, label in targets:
        img = Image.new("RGB", (W, H), BLACK)
        draw = ImageDraw.Draw(img)
        draw.text((W // 2 - 80, H // 2 - 30),
                  f"Tap the {label}", fill=WHITE, font=font)
        draw.text((W // 2 - 60, H // 2),
                  "crosshair", fill=LIGHT_GRAY, font=font_sm)

        # Draw crosshair
        draw.line([(tx - 15, ty), (tx + 15, ty)], fill=RED, width=2)
        draw.line([(tx, ty - 15), (tx, ty + 15)], fill=RED, width=2)
        draw.ellipse([tx - 5, ty - 5, tx + 5, ty + 5], outline=RED, width=2)

        fb.show(img)

        # Wait for tap
        while True:
            tap = touch.get_tap()
            if tap:
                raw_points.append((touch._raw_x, touch._raw_y))
                break
            time.sleep(0.05)

        time.sleep(0.5)

    touch.stop()

    # Calculate calibration from the 4 corner taps
    tl, tr, bl, br = raw_points

    x_range_horiz = abs(tr[0] - tl[0])
    y_range_horiz = abs(tr[1] - tl[1])
    swap_xy = y_range_horiz > x_range_horiz

    if swap_xy:
        tl = (tl[1], tl[0])
        tr = (tr[1], tr[0])
        bl = (bl[1], bl[0])
        br = (br[1], br[0])

    min_x = min(tl[0], bl[0])
    max_x = max(tr[0], br[0])
    min_y = min(tl[1], tr[1])
    max_y = max(bl[1], br[1])

    invert_x = tl[0] > tr[0]
    invert_y = tl[1] > bl[1]

    if invert_x:
        min_x, max_x = max_x, min_x
        min_x = min(tl[0], bl[0])
        max_x = max(tr[0], br[0])

    if invert_y:
        min_y, max_y = max_y, min_y
        min_y = min(tl[1], tr[1])
        max_y = max(bl[1], br[1])

    touch.cal = {
        "min_x": min(min_x, max_x),
        "max_x": max(min_x, max_x),
        "min_y": min(min_y, max_y),
        "max_y": max(min_y, max_y),
        "swap_xy": swap_xy,
        "invert_x": invert_x,
        "invert_y": invert_y,
    }
    touch.save_calibration()

    # Show result
    img = Image.new("RGB", (W, H), BLACK)
    draw = ImageDraw.Draw(img)
    draw.text((MARGIN, 20), "Calibration saved!", fill=GREEN, font=font)
    draw.text((MARGIN, 50), f"swap_xy: {swap_xy}", fill=WHITE, font=font_sm)
    draw.text((MARGIN, 70),
              f"invert_x: {invert_x}  invert_y: {invert_y}",
              fill=WHITE, font=font_sm)
    draw.text((MARGIN, 90),
              f"X: {touch.cal['min_x']}-{touch.cal['max_x']}",
              fill=WHITE, font=font_sm)
    draw.text((MARGIN, 110),
              f"Y: {touch.cal['min_y']}-{touch.cal['max_y']}",
              fill=WHITE, font=font_sm)
    draw.text((MARGIN, 150), "Starting display in 3s...",
              fill=LIGHT_GRAY, font=font_sm)
    fb.show(img)
    time.sleep(3)
