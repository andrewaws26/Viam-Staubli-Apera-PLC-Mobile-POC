"""
LOGS screen — scrollable event history with filter tabs (All / Software / Truck).
"""

import time
from typing import List, Tuple

from PIL import Image, ImageDraw

from lib.plc_constants import (
    WHITE, BLUE, CYAN, ORANGE,
    LIGHT_GRAY, MID_GRAY, DARK_GRAY,
    LEVEL_COLORS,
)
from lib.system_status import get_activity_history
from touch_ui.constants import W, H, MARGIN, HEADER_H, BACK_BTN_H
from touch_ui.widgets.button import Button, draw_button
from touch_ui.widgets.common import find_font, draw_status_bar, draw_alert_bar, back_button


LOG_FILTERS = ["ALL", "SOFTWARE", "TRUCK"]


def _get_truck_errors(sys_status: dict) -> list:
    """Build truck/equipment error entries from active diagnostics.

    Returns list of dicts matching the activity history format:
      {"time": "HH:MM", "component": "...", "message": "...",
       "level": "...", "source": "truck"}
    """
    entries: list = []
    diags = sys_status.get("diagnostics", [])
    now_str = time.strftime("%H:%M")
    for d in diags:
        if not isinstance(d, dict):
            continue
        sev = d.get("severity", "warning")
        level = "error" if sev == "critical" else sev
        cat = d.get("category", "")[:6] or "diag"
        title = d.get("title", d.get("rule", "unknown"))
        entries.append({
            "time": now_str,
            "component": cat,
            "message": title,
            "level": level,
            "source": "truck",
        })

    # TPS-specific status entries
    if not sys_status.get("tps_power_loop") and sys_status.get("plc_reachable"):
        entries.append({
            "time": now_str, "component": "TPS", "message": "TPS power OFF",
            "level": "warning", "source": "truck",
        })
    if sys_status.get("plc_reachable") and not sys_status.get("connected"):
        entries.append({
            "time": now_str, "component": "PLC",
            "message": "PLC reachable but sensor disconnected",
            "level": "warning", "source": "truck",
        })
    if not sys_status.get("eth0_carrier"):
        entries.append({
            "time": now_str, "component": "ETH",
            "message": "Ethernet NO CARRIER (cable/PLC off)",
            "level": "error", "source": "truck",
        })
    return entries


def render_logs(
    sys_status: dict,
    scroll_offset: int = 0,
    log_filter: str = "all",
) -> Tuple[Image.Image, List[Button]]:
    """LOGS -- scrollable event history with filter tabs."""
    img = Image.new("RGB", (W, H), DARK_GRAY)
    draw = ImageDraw.Draw(img)
    draw_status_bar(draw, sys_status)

    font = find_font(12)
    font_sm = find_font(11)
    font_tab = find_font(13)

    y = HEADER_H
    y = draw_alert_bar(draw, sys_status, y)
    y += 4

    buttons: List[Button] = []

    # Filter tabs
    tab_w = (W - MARGIN * 2 - 8) // 3
    tab_h = 30
    tab_x = MARGIN
    for i, label in enumerate(LOG_FILTERS):
        active = label.lower() == log_filter.lower()
        color = BLUE if active else MID_GRAY
        text_color = WHITE if active else LIGHT_GRAY
        tab_btn = Button(
            tab_x, y, tab_w, tab_h,
            label, f"log_filter_{label.lower()}",
            color=color, text_color=text_color
        )
        buttons.append(tab_btn)
        draw_button(draw, tab_btn, font_tab)
        tab_x += tab_w + 4
    y += tab_h + 6

    # Gather entries based on filter
    software_history = get_activity_history()
    for entry in software_history:
        entry.setdefault("source", "software")

    truck_errors = _get_truck_errors(sys_status)

    if log_filter.lower() == "software":
        history = list(reversed(software_history))
    elif log_filter.lower() == "truck":
        history = list(reversed(truck_errors))
    else:
        combined = software_history + truck_errors
        history = list(reversed(combined))

    row_h = 22
    max_visible = (H - y - BACK_BTN_H - 15) // row_h
    visible = history[scroll_offset:scroll_offset + max_visible]

    for entry in visible:
        if y > H - BACK_BTN_H - 15:
            break
        t = entry.get("time", "??:??")
        comp = entry.get("component", "?")[:6]
        msg = entry.get("message", "")
        level = entry.get("level", "info")
        source = entry.get("source", "software")

        text_color = LEVEL_COLORS.get(level, LIGHT_GRAY)
        src_color = ORANGE if source == "truck" else CYAN
        src_label = comp[:4].upper()

        max_chars = 38
        display_msg = msg[:max_chars] + ("..." if len(msg) > max_chars else "")

        draw.text((MARGIN, y), t, fill=MID_GRAY, font=font_sm)
        draw.text((MARGIN + 55, y), src_label, fill=src_color, font=font_sm)
        draw.text((MARGIN + 95, y), display_msg, fill=text_color, font=font_sm)
        y += row_h

    if not visible:
        draw.text((MARGIN, y + 10), "No events to show", fill=MID_GRAY, font=font)

    # Scroll buttons
    scroll_btn_w = 80
    scroll_btn_h = 50

    if scroll_offset > 0:
        up_btn = Button(
            W - scroll_btn_w - MARGIN, HEADER_H + 38,
            scroll_btn_w, scroll_btn_h,
            "UP", "scroll_up", color=(50, 50, 60)
        )
        buttons.append(up_btn)
        draw_button(draw, up_btn, find_font(14))

    if scroll_offset + max_visible < len(history):
        dn_btn = Button(
            W - scroll_btn_w - MARGIN, H - BACK_BTN_H - scroll_btn_h - 15,
            scroll_btn_w, scroll_btn_h,
            "DN", "scroll_down", color=(50, 50, 60)
        )
        buttons.append(dn_btn)
        draw_button(draw, dn_btn, find_font(14))

    # Back button
    back = back_button()
    draw_button(draw, back, find_font(16))
    buttons.append(back)

    return img, buttons
