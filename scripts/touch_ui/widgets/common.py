"""
Common UI helpers — font cache, status bar, alert bar, back button,
beep feedback, toast overlay, and confirmation dialog.
"""

import os
import subprocess
import time
from typing import List, Tuple

from PIL import Image, ImageDraw, ImageFont

from lib.plc_constants import (
    BLACK, WHITE, GREEN, RED, YELLOW, BLUE, CYAN, ORANGE,
    DARK_GRAY, MID_GRAY, LIGHT_GRAY,
    DARK_GREEN, DARK_RED,
)
from lib.command_executor import CommandExecutor
from touch_ui.constants import W, H, MARGIN, HEADER_H, BACK_BTN_H
from touch_ui.widgets.button import Button, draw_button


# ─────────────────────────────────────────────────────────────
#  Font helper
# ─────────────────────────────────────────────────────────────

_font_cache: dict = {}


def find_font(size: int) -> ImageFont.FreeTypeFont:
    """Load and cache a monospace/bold font at the given pixel size."""
    if size in _font_cache:
        return _font_cache[size]
    font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            font = ImageFont.truetype(fp, size)
            _font_cache[size] = font
            return font
    font = ImageFont.load_default()
    _font_cache[size] = font
    return font


# ─────────────────────────────────────────────────────────────
#  Status bar (always visible at top of every page)
# ─────────────────────────────────────────────────────────────

def draw_status_bar(draw: ImageDraw.ImageDraw, sys_status: dict) -> None:
    """Draw thin status bar at top — always visible."""
    font = find_font(11)
    font_sm = find_font(9)

    draw.rectangle([0, 0, W, HEADER_H], fill=(15, 15, 20))

    # IRONSIGHT - B&B brand
    draw.text((MARGIN, 8), "IRONSIGHT - B&B", fill=BLUE, font=font)

    # Battery indicator (right side)
    bat = sys_status.get("battery", {})
    x_right = W - MARGIN
    if bat.get("available"):
        pct = bat.get("percent", 0)
        charging = bat.get("charging", False)

        # Battery icon: outline rectangle with fill level
        bat_w, bat_h = 24, 12
        bat_x = x_right - bat_w
        bat_y = 10
        # Battery body
        draw.rectangle([bat_x, bat_y, bat_x + bat_w, bat_y + bat_h],
                        outline=LIGHT_GRAY, width=1)
        # Battery tip
        draw.rectangle([bat_x + bat_w, bat_y + 3,
                        bat_x + bat_w + 3, bat_y + bat_h - 3], fill=LIGHT_GRAY)
        # Fill level
        fill_w = max(0, int((bat_w - 2) * pct / 100))
        bat_color = GREEN if pct > 30 else YELLOW if pct > 15 else RED
        if charging:
            bat_color = CYAN
        if fill_w > 0:
            draw.rectangle([bat_x + 1, bat_y + 1,
                            bat_x + 1 + fill_w, bat_y + bat_h - 1], fill=bat_color)
        # Percentage text
        pct_str = f"{pct:.0f}%"
        if charging:
            pct_str = f"+{pct_str}"
        pw = draw.textlength(pct_str, font=font_sm)
        draw.text((bat_x - pw - 4, 9), pct_str, fill=bat_color, font=font_sm)
        x_right = bat_x - pw - 10

    # Connection info (right to left)
    x = x_right

    # iPhone indicator
    if sys_status.get("iphone_connected"):
        iph_str = "iPhone"
        iw = draw.textlength(iph_str, font=font_sm)
        x -= iw + 6
        draw.text((x, 9), iph_str, fill=CYAN, font=font_sm)

    # Active internet connection — show what's actually routing traffic
    active_iface = sys_status.get("active_interface", "")
    ssid = sys_status.get("wifi_ssid", "")
    signal_dbm = sys_status.get("wifi_signal_dbm", 0)

    if active_iface.startswith("wlan"):
        if ssid:
            if signal_dbm >= -40:
                sig_label, sig_color = "Strong", GREEN
            elif signal_dbm >= -55:
                sig_label, sig_color = "Good", GREEN
            elif signal_dbm >= -70:
                sig_label, sig_color = "Fair", YELLOW
            elif signal_dbm >= -80:
                sig_label, sig_color = "Weak", ORANGE
            elif signal_dbm < -80:
                sig_label, sig_color = "Poor", RED
            else:
                sig_label, sig_color = "", LIGHT_GRAY
            wifi_str = f"{ssid} ({sig_label})" if sig_label else ssid
            ww = draw.textlength(wifi_str, font=font_sm)
            x -= ww + 8
            draw.text((x, 9), wifi_str, fill=sig_color, font=font_sm)
        else:
            net_str = "WiFi (no SSID)"
            nw = draw.textlength(net_str, font=font_sm)
            x -= nw + 8
            draw.text((x, 9), net_str, fill=YELLOW, font=font_sm)
    elif active_iface.startswith("eth"):
        try:
            r = subprocess.check_output(
                ["nmcli", "-t", "-f", "NAME,DEVICE", "connection", "show", "--active"],
                text=True, timeout=3
            )
            eth_name = ""
            for line in r.strip().splitlines():
                if active_iface in line:
                    eth_name = line.split(":")[0]
                    break
            net_str = eth_name if eth_name else f"Ethernet ({active_iface})"
        except Exception:
            net_str = f"Ethernet ({active_iface})"
        nw = draw.textlength(net_str, font=font_sm)
        x -= nw + 8
        draw.text((x, 9), net_str, fill=GREEN, font=font_sm)
    elif active_iface:
        net_str = active_iface
        nw = draw.textlength(net_str, font=font_sm)
        x -= nw + 8
        draw.text((x, 9), net_str, fill=CYAN, font=font_sm)
    elif not sys_status.get("iphone_connected"):
        nw_str = "No Network"
        nw = draw.textlength(nw_str, font=font_sm)
        x -= nw + 8
        draw.text((x, 9), nw_str, fill=RED, font=font_sm)

    # Time
    now_str = time.strftime("%I:%M %p")
    tw = draw.textlength(now_str, font=font_sm)
    draw.text((x - tw - 8, 9), now_str, fill=LIGHT_GRAY, font=font_sm)


# ─────────────────────────────────────────────────────────────
#  Back button
# ─────────────────────────────────────────────────────────────

def back_button() -> Button:
    """Standard back button for sub-pages — full width, easy to hit with gloves."""
    return Button(
        x=MARGIN, y=H - BACK_BTN_H - 5,
        w=W - MARGIN * 2, h=BACK_BTN_H,
        label="< BACK", action="nav_home",
        color=MID_GRAY, text_color=WHITE
    )


# ─────────────────────────────────────────────────────────────
#  Alert bar
# ─────────────────────────────────────────────────────────────

def draw_alert_bar(draw: ImageDraw.ImageDraw, sys_status: dict, y_start: int) -> int:
    """Draw a persistent alert bar if there are active diagnostics.

    Returns the Y position after the bar (content below should shift down).
    """
    diagnostics = sys_status.get("diagnostics", [])
    if not diagnostics:
        return y_start
    diagnostics = [d for d in diagnostics if isinstance(d, dict)]
    if not diagnostics:
        return y_start

    has_critical = any(d.get("severity") == "critical" for d in diagnostics)
    has_warning = any(d.get("severity") == "warning" for d in diagnostics)

    if not has_critical and not has_warning:
        return y_start

    bar_h = 24
    if has_critical:
        bg = (160, 30, 30)
        text_color = WHITE
        icon = "!!"
    else:
        bg = (160, 130, 0)
        text_color = BLACK
        icon = "!"

    draw.rectangle([0, y_start, W, y_start + bar_h], fill=bg)

    font = find_font(10)
    first = diagnostics[0]
    title = first.get("title", first.get("message", "Alert"))
    count = len(diagnostics)
    suffix = f"  (+{count - 1} more)" if count > 1 else ""
    display = f" {icon} {title}{suffix}"
    max_chars = 55
    if len(display) > max_chars:
        display = display[:max_chars - 3] + "..."
    draw.text((MARGIN, y_start + 5), display, fill=text_color, font=font)

    return y_start + bar_h


# ─────────────────────────────────────────────────────────────
#  Beep
# ─────────────────────────────────────────────────────────────

def beep() -> None:
    """Short audible beep for tap feedback."""
    try:
        sound = "/usr/share/sounds/freedesktop/stereo/button-pressed.oga"
        if os.path.exists(sound):
            subprocess.Popen(
                ["aplay", "-q", "-D", "default", sound],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
        else:
            subprocess.Popen(
                ["beep", "-f", "1000", "-l", "50"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────
#  Feedback toast
# ─────────────────────────────────────────────────────────────

def render_feedback_toast(draw: ImageDraw.ImageDraw, executor: CommandExecutor) -> None:
    """Draw a feedback toast overlay at the bottom."""
    if not executor.has_feedback:
        return

    font = find_font(12)
    msg = executor.feedback_message
    level = executor.feedback_level

    bg_color = (DARK_GREEN if level == "success"
                else DARK_RED if level == "error"
                else (30, 30, 80))
    text_color = WHITE

    toast_h = 36
    toast_y = H - BACK_BTN_H - toast_h - 10
    draw.rounded_rectangle(
        [MARGIN, toast_y, W - MARGIN, toast_y + toast_h],
        radius=6, fill=bg_color
    )

    display_msg = msg[:55] + ("..." if len(msg) > 55 else "")
    bbox = draw.textbbox((0, 0), display_msg, font=font)
    tw = bbox[2] - bbox[0]
    draw.text(
        ((W - tw) // 2, toast_y + 9),
        display_msg, fill=text_color, font=font
    )


# ─────────────────────────────────────────────────────────────
#  Confirmation dialog
# ─────────────────────────────────────────────────────────────

def render_confirm_dialog(
    base_img: Image.Image, action: str
) -> Tuple[Image.Image, List[Button]]:
    """Overlay a confirmation dialog on the current page."""
    img = base_img.copy()
    draw = ImageDraw.Draw(img)

    font = find_font(16)
    font_sm = find_font(13)

    # Darken background
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 160))
    img.paste(Image.alpha_composite(
        img.convert("RGBA"), overlay
    ).convert("RGB"))
    draw = ImageDraw.Draw(img)

    # Dialog box
    dw, dh = 360, 160
    dx = (W - dw) // 2
    dy = (H - dh) // 2

    draw.rounded_rectangle([dx, dy, dx + dw, dy + dh],
                            radius=12, fill=DARK_GRAY, outline=LIGHT_GRAY)

    # Title
    titles = {
        "confirm_cmd_provision_tps-standard.json": "Apply TPS Standard config?",
        "confirm_cmd_provision_tps-double.json": "Apply TPS Double Drop config?",
        "confirm_cmd_provision_tps-tie-team.json": "Apply TPS Tie Team config?",
        "confirm_cmd_provision_tps-encoder-only.json": "Apply Encoder Only config?",
        "confirm_cmd_restart_viam": "Restart viam-server?",
        "confirm_cmd_clear_buffer": "Clear offline buffer?",
        "confirm_cmd_force_sync": "Force cloud sync?",
    }
    title = titles.get(action, "Confirm action?")
    bbox = draw.textbbox((0, 0), title, font=font)
    tw = bbox[2] - bbox[0]
    draw.text((dx + (dw - tw) // 2, dy + 20), title, fill=WHITE, font=font)

    # Warning message
    warnings = {
        "confirm_cmd_provision_tps-standard.json": "Writes registers + coils over Modbus",
        "confirm_cmd_provision_tps-double.json": "Writes registers + coils over Modbus",
        "confirm_cmd_provision_tps-tie-team.json": "Writes registers + coils over Modbus",
        "confirm_cmd_provision_tps-encoder-only.json": "Writes registers + coils over Modbus",
        "confirm_cmd_restart_viam": "PLC monitoring pauses ~10 sec",
        "confirm_cmd_clear_buffer": "Unsent data will be lost!",
        "confirm_cmd_force_sync": "Restarts viam-server briefly",
    }
    warn = warnings.get(action, "Are you sure?")
    bbox2 = draw.textbbox((0, 0), warn, font=font_sm)
    ww = bbox2[2] - bbox2[0]
    draw.text((dx + (dw - ww) // 2, dy + 50), warn, fill=YELLOW, font=font_sm)

    # Confirm / Cancel buttons
    btn_w = 140
    btn_h = 45
    btn_y = dy + dh - btn_h - 20

    confirm = Button(
        dx + 20, btn_y, btn_w, btn_h,
        "CONFIRM", f"do_{action.replace('confirm_', '')}",
        color=DARK_GREEN, text_color=WHITE
    )
    cancel = Button(
        dx + dw - btn_w - 20, btn_y, btn_w, btn_h,
        "CANCEL", "dialog_cancel",
        color=DARK_RED, text_color=WHITE
    )

    draw_button(draw, confirm, font)
    draw_button(draw, cancel, font)

    return img, [confirm, cancel]
