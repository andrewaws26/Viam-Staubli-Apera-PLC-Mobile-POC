"""
COMMANDS screen — actionable buttons (restart, test PLC, WiFi, etc.).
"""

from typing import List, Tuple

from PIL import Image, ImageDraw

from lib.plc_constants import (
    LIGHT_GRAY, DARK_GRAY,
    DARK_GREEN, DARK_RED, DARK_BLUE, DARK_CYAN, DARK_ORANGE,
)
from touch_ui.constants import W, H, MARGIN, HEADER_H, BACK_BTN_H
from touch_ui.widgets.button import Button, draw_button
from touch_ui.widgets.common import find_font, draw_status_bar, draw_alert_bar, back_button


def render_commands(sys_status: dict) -> Tuple[Image.Image, List[Button]]:
    """COMMANDS -- actionable buttons."""
    img = Image.new("RGB", (W, H), DARK_GRAY)
    draw = ImageDraw.Draw(img)
    draw_status_bar(draw, sys_status)

    font = find_font(16)
    font_title = find_font(14)

    y = HEADER_H
    y = draw_alert_bar(draw, sys_status, y)
    y += 4
    draw.text((MARGIN, y), "COMMANDS", fill=LIGHT_GRAY, font=font_title)
    y += 22

    commands = [
        ("Provision PLC", "nav_provision", DARK_GREEN, False),
        ("Fix Connection", "cmd_restart_viam", DARK_ORANGE, True),
        ("Test PLC", "cmd_test_plc", DARK_BLUE, False),
        ("Scan WiFi", "cmd_switch_wifi", DARK_CYAN, False),
        ("Clear Data", "cmd_clear_buffer", DARK_RED, True),
        ("Sync Now", "cmd_force_sync", DARK_GREEN, False),
    ]

    buttons: List[Button] = []
    btn_w = W - MARGIN * 2
    back_top = H - BACK_BTN_H - 5
    available_h = back_top - y - 10
    gap = 6
    btn_h = min(48, (available_h - gap * (len(commands) - 1)) // len(commands))

    for label, action, color, needs_confirm in commands:
        btn_action = f"confirm_{action}" if needs_confirm else action
        btn = Button(MARGIN, y, btn_w, btn_h, label, btn_action, color=color)
        buttons.append(btn)
        draw_button(draw, btn, font)
        y += btn_h + gap

    # Back button
    back = back_button()
    draw_button(draw, back, find_font(16))
    buttons.append(back)

    return img, buttons
