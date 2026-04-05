"""
HOME screen — live production dashboard with big numbers and nav bar.
"""

from typing import List, Tuple

from PIL import Image, ImageDraw

from lib.plc_constants import (
    WHITE, GREEN, RED, YELLOW, LIGHT_GRAY, MID_GRAY, DARK_GRAY,
    DARK_CYAN, DARK_ORANGE, DARK_BLUE, PURPLE,
)
from touch_ui.constants import W, H, MARGIN, HEADER_H
from touch_ui.widgets.button import Button, draw_button
from touch_ui.widgets.common import find_font, draw_status_bar, draw_alert_bar


def _system_subtitle(sys_status: dict) -> str:
    """Build subtitle for SYSTEM button on home screen."""
    bat = sys_status.get("battery", {})
    if bat.get("available"):
        pct = bat.get("percent", 0)
        charging = bat.get("charging", False)
        chg = " CHG" if charging else ""
        return f"BAT {pct:.0f}%{chg} | CPU {sys_status['cpu_temp'] * 9/5 + 32:.0f}F"
    return f"CPU {sys_status['cpu_temp'] * 9/5 + 32:.0f}F | Disk {sys_status['disk_pct']}%"


def render_home(sys_status: dict) -> Tuple[Image.Image, List[Button]]:
    """HOME -- live production dashboard with big numbers and nav bar."""
    img = Image.new("RGB", (W, H), DARK_GRAY)
    draw = ImageDraw.Draw(img)
    draw_status_bar(draw, sys_status)

    buttons: List[Button] = []
    font_huge = find_font(44)
    font_big = find_font(30)
    font_med = find_font(16)
    font_sm = find_font(13)
    font_unit = find_font(12)
    font_nav = find_font(22)

    y = HEADER_H
    y = draw_alert_bar(draw, sys_status, y)

    # --- Derive system status ---
    tps_power = sys_status.get("tps_power_loop", False)
    diagnostics = [d for d in sys_status.get("diagnostics", []) if isinstance(d, dict)]
    has_critical = any(d.get("severity") == "critical" for d in diagnostics)
    has_warning = any(d.get("severity") == "warning" for d in diagnostics)
    connected = sys_status.get("connected", False)

    if has_critical:
        status_text = "FAULT"
        status_color = RED
    elif has_warning:
        status_text = "WARNING"
        status_color = YELLOW
    elif tps_power and connected:
        status_text = "RUNNING"
        status_color = GREEN
    elif connected:
        status_text = "IDLE"
        status_color = LIGHT_GRAY
    else:
        status_text = "OFFLINE"
        status_color = RED

    # --- Primary metrics row (big numbers) ---
    y += 6
    col_plates = MARGIN
    col_speed = 175
    col_status = 320

    # PLATES
    plate_count = sys_status.get("plate_count", 0)
    draw.text((col_plates, y), "PLATES", fill=WHITE, font=font_unit)
    draw.text((col_plates, y + 13), str(plate_count), fill=WHITE, font=font_huge)

    # SPEED + direction arrow
    speed = sys_status.get("speed_ftpm", 0.0)
    direction = sys_status.get("encoder_direction", "forward")
    is_reverse = direction == "reverse"
    draw.text((col_speed, y), "SPEED", fill=WHITE, font=font_unit)
    draw.text((col_speed, y + 13), f"{speed:.1f}", fill=WHITE, font=font_big)
    speed_w = draw.textlength(f"{speed:.1f}", font=font_big)
    if is_reverse:
        draw.text((col_speed + speed_w + 4, y + 18), "\u25bc", fill=RED, font=font_med)
        draw.text((col_speed, y + 45), "ft/min  REV", fill=RED, font=font_unit)
    else:
        draw.text((col_speed + speed_w + 4, y + 18), "\u25b2", fill=GREEN, font=font_med)
        draw.text((col_speed, y + 45), "ft/min", fill=LIGHT_GRAY, font=font_unit)

    # STATUS
    draw.text((col_status, y), "STATUS", fill=WHITE, font=font_unit)
    dot_y = y + 20
    draw.ellipse([col_status, dot_y, col_status + 18, dot_y + 18], fill=status_color)
    draw.text((col_status + 24, y + 18), status_text, fill=status_color, font=font_med)

    ppm = sys_status.get("plates_per_min", 0.0)
    if ppm > 0:
        draw.text((col_status, y + 42), f"{ppm:.1f}/min", fill=WHITE, font=font_sm)

    # --- Secondary stats row ---
    y += 68
    draw.line([(MARGIN, y), (W - MARGIN, y)], fill=MID_GRAY, width=1)
    y += 6

    font_stat = find_font(22)
    eff_x = W // 2

    # Spacing
    last_sp = sys_status.get("last_spacing_in", 0.0)
    sp_str = f'Spacing: {last_sp:.1f}"' if last_sp > 0 else "Spacing: --"
    sp_color = GREEN if last_sp > 0 and abs(last_sp - 19.5) < 2 else (
        YELLOW if last_sp > 0 and abs(last_sp - 19.5) < 5 else (
            RED if last_sp > 0 else LIGHT_GRAY))
    draw.text((MARGIN, y), sp_str, fill=sp_color, font=font_stat)

    # Efficiency
    travel_ft = sys_status.get("travel_ft", 0.0)
    expected = (travel_ft * 12.0 / 19.5) if travel_ft > 0 else 0
    efficiency = (plate_count / expected * 100) if expected > 0 else 0
    eff_str = f"Efficiency: {efficiency:.0f}%" if expected > 0 else "Efficiency: --"
    eff_color = GREEN if efficiency >= 95 else (YELLOW if efficiency >= 85 else LIGHT_GRAY)
    draw.text((eff_x, y), eff_str, fill=eff_color, font=font_stat)

    y += 28

    # Mode + Camera rate
    mode = sys_status.get("tps_mode", "")
    mode_str = f"Mode: {mode}" if mode else "Mode: --"
    draw.text((MARGIN, y), mode_str, fill=WHITE, font=font_stat)

    camera_rate = sys_status.get("camera_rate", 0.0)
    cam_color = GREEN if camera_rate > 5 else (YELLOW if camera_rate > 0 else LIGHT_GRAY)
    cam_str = f"Flipper: {camera_rate:.0f}/min" if camera_rate > 0 else "Flipper: --"
    draw.text((eff_x, y), cam_str, fill=cam_color, font=font_stat)

    # --- Travel distance ---
    y += 28
    travel_str = f"Travel: {travel_ft:.1f} ft"
    draw.text((MARGIN, y), travel_str, fill=WHITE, font=font_stat)
    avg_sp = sys_status.get("avg_spacing_in", 0.0)
    if avg_sp > 0:
        draw.text((eff_x, y), f'Avg spacing: {avg_sp:.1f}"', fill=WHITE, font=font_stat)

    # --- Bottom navigation bar (4 buttons) ---
    nav_h = 74
    nav_y = H - nav_h - 4
    gap = 12
    btn_count = 4
    btn_w = (W - MARGIN * 2 - gap * (btn_count - 1)) // btn_count

    nav_items = [
        ("SYSTEM", "nav_system", DARK_CYAN),
        ("COMMANDS", "nav_commands", DARK_ORANGE),
        ("DIAGNOSE", "nav_chat", PURPLE),
        ("LOGS", "nav_logs", DARK_BLUE),
    ]

    for i, (label, action, color) in enumerate(nav_items):
        bx = MARGIN + i * (btn_w + gap)
        btn = Button(bx, nav_y, btn_w, nav_h, label, action, color=color)
        buttons.append(btn)
        draw_button(draw, btn, font_nav)

    return img, buttons
