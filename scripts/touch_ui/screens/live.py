"""
LIVE screen — real-time PLC data (encoder, plates, speed, spacing).
"""

from typing import List, Tuple

from PIL import Image, ImageDraw

from lib.plc_constants import (
    WHITE, GREEN, RED, YELLOW, LIGHT_GRAY, MID_GRAY, DARK_GRAY,
    DARK_GREEN, DARK_RED,
)
from touch_ui.constants import W, H, MARGIN, HEADER_H
from touch_ui.widgets.button import Button, draw_button
from touch_ui.widgets.common import find_font, draw_status_bar, draw_alert_bar, back_button


def render_live(sys_status: dict) -> Tuple[Image.Image, List[Button]]:
    """LIVE -- real-time PLC data."""
    img = Image.new("RGB", (W, H), DARK_GRAY)
    draw = ImageDraw.Draw(img)
    draw_status_bar(draw, sys_status)

    font_big = find_font(30)
    font_lg = find_font(20)
    font_med = find_font(16)
    font_sm = find_font(13)

    y = HEADER_H
    y = draw_alert_bar(draw, sys_status, y)
    y += 4

    # PLC connection bar
    connected = sys_status["connected"]
    bar_color = DARK_GREEN if connected else DARK_RED
    conn_text = "ONLINE" if connected else "OFFLINE"
    draw.rectangle([0, y, W, y + 22], fill=bar_color)
    draw.text((MARGIN, y + 3), f"PLC {sys_status['plc_ip']}", fill=WHITE, font=font_sm)
    cw = draw.textlength(conn_text, font=font_sm)
    draw.text((W - MARGIN - cw, y + 3), conn_text, fill=WHITE, font=font_sm)
    y += 26

    # Big travel number
    draw.text((MARGIN, y), "TRAVEL", fill=LIGHT_GRAY, font=font_sm)
    y += 14
    travel_str = f"{sys_status['travel_ft']:.1f} ft"
    draw.text((MARGIN, y), travel_str, fill=WHITE, font=font_big)
    y += 34

    # Speed + Plates side by side
    mid = W // 2
    draw.text((MARGIN, y), "SPEED", fill=LIGHT_GRAY, font=font_sm)
    draw.text((mid, y), "PLATES", fill=LIGHT_GRAY, font=font_sm)
    y += 14
    draw.text((MARGIN, y), f"{sys_status['speed_ftpm']:.1f} ft/m", fill=WHITE, font=font_lg)
    draw.text((mid, y), str(sys_status['plate_count']), fill=WHITE, font=font_lg)
    rate_text = f"({sys_status['plates_per_min']:.1f}/min)"
    plates_w = draw.textlength(str(sys_status['plate_count']), font=font_lg)
    draw.text((mid + plates_w + 6, y + 4), rate_text, fill=LIGHT_GRAY, font=font_sm)
    y += 26

    # Spacing
    draw.line([(MARGIN, y), (W - MARGIN, y)], fill=MID_GRAY, width=1)
    y += 6
    draw.text((MARGIN, y), "SPACING", fill=LIGHT_GRAY, font=font_sm)
    y += 14
    last_sp = sys_status["last_spacing_in"]
    avg_sp = sys_status["avg_spacing_in"]
    sp_color = GREEN if abs(last_sp - 19.5) < 2 else (
        YELLOW if abs(last_sp - 19.5) < 5 else RED)
    if last_sp == 0:
        sp_color = LIGHT_GRAY
    draw.text((MARGIN, y), f'Last: {last_sp:.1f}"', fill=sp_color, font=font_lg)
    draw.text((mid, y), f'Avg: {avg_sp:.1f}"', fill=WHITE, font=font_lg)
    y += 24

    # State
    state = sys_status["system_state"]
    state_color = GREEN if state == "running" else YELLOW
    draw.text((MARGIN, y), f"State: {state}", fill=state_color, font=font_med)

    # Back button
    back = back_button()
    draw_button(draw, back, find_font(16))

    return img, [back]
