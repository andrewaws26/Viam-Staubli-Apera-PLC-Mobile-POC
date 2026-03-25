#!/usr/bin/env python3
"""
IronSight Touch Command Display — Interactive 3.5" touchscreen interface.

Touch-friendly UI with big buttons for glove operation on the truck.
Renders to Linux framebuffer, reads touch from evdev (ADS7846/XPT2046).

Pages:
  HOME     — Live production dashboard (plates, speed, status) with nav bar
  LIVE     — Real-time PLC data (encoder, plates, speed, spacing)
  COMMANDS — Actionable buttons (restart, test PLC, WiFi, etc.)
  CHAT     — Push-to-talk voice chat with Claude AI
  LOGS     — Scrollable recent activity & incidents
  SYSTEM   — Health dashboard (disk, CPU, network, services)

Requires: pip3 install Pillow evdev anthropic faster-whisper
"""

import json
import os
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Tuple, List

# Add scripts/ to path so lib/ imports work when run from any directory
sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.plc_constants import (
    PLC_HOST, PLC_PORT, OFFLINE_BUFFER_DIR, CAPTURE_DIR, CAPTURE_BASE_DIR,
    DS_SHORT_LABELS, TIE_SPACING_DS2,
    BLACK, WHITE, GREEN, RED, YELLOW, BLUE, CYAN, ORANGE, PURPLE,
    DARK_GRAY, MID_GRAY, LIGHT_GRAY,
    DARK_GREEN, DARK_RED, DARK_BLUE, DARK_CYAN, DARK_ORANGE, DARK_PURPLE,
    LEVEL_COLORS,
)
from lib.buffer_reader import read_latest_entry, read_history, get_data_age_seconds
from lib.framebuffer import Framebuffer
from lib.touch_input import TouchInput, PTTButton
from lib.system_status import get_system_status, get_battery_status, get_activity_history
from lib.command_executor import CommandExecutor
from lib.voice_chat import VoiceChat, ChatMessage

try:
    from PIL import Image, ImageDraw, ImageFont
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

# evdev handled by lib.touch_input
# anthropic handled by diagnose_agent.py

# faster_whisper handled by lib.voice_chat

# ─────────────────────────────────────────────────────────────
#  Configuration
# ─────────────────────────────────────────────────────────────

DATA_REFRESH_INTERVAL = 2.0   # seconds between data fetches
TOUCH_POLL_HZ = 20            # touch polling rate


# Framebuffer imported from lib.framebuffer


# TouchInput and PTTButton imported from lib.touch_input


# ─────────────────────────────────────────────────────────────
#  Button system
# ─────────────────────────────────────────────────────────────

@dataclass
class Button:
    x: int
    y: int
    w: int
    h: int
    label: str
    action: str
    color: tuple = MID_GRAY
    text_color: tuple = WHITE
    icon: str = ""
    enabled: bool = True

    def contains(self, px: int, py: int) -> bool:
        return self.x <= px <= self.x + self.w and self.y <= py <= self.y + self.h


def draw_button(draw, btn: Button, font, pressed: bool = False):
    """Draw a single button with optional pressed state."""
    if not btn.enabled:
        fill = MID_GRAY
        text_color = DARK_GRAY
    elif pressed:
        fill = WHITE
        text_color = BLACK
    else:
        fill = btn.color
        text_color = btn.text_color

    # Button background with slight rounding
    draw.rounded_rectangle(
        [btn.x, btn.y, btn.x + btn.w, btn.y + btn.h],
        radius=8, fill=fill
    )

    # Center the label text
    label = btn.label
    if btn.icon:
        label = f"{btn.icon}  {label}"

    bbox = draw.textbbox((0, 0), label, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = btn.x + (btn.w - tw) // 2
    ty = btn.y + (btn.h - th) // 2
    draw.text((tx, ty), label, fill=text_color, font=font)


def find_hit(buttons: List[Button], x: int, y: int) -> Optional[Button]:
    """Find which button was tapped."""
    for btn in buttons:
        if btn.enabled and btn.contains(x, y):
            return btn
    return None


# ─────────────────────────────────────────────────────────────
#  Font helper
# ─────────────────────────────────────────────────────────────

_font_cache = {}

def find_font(size: int):
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


# get_system_status, get_battery_status, get_activity_history → lib/system_status.py
# CommandExecutor → lib/command_executor.py
# VoiceChat, ChatMessage → lib/voice_chat.py

# ─────────────────────────────────────────────────────────────

# Screen is 480x320. All rendering is at native resolution.
# Font & button sizes are tuned for glove use and sunlight readability.
W, H = 480, 320
MARGIN = 12
HEADER_H = 32
BACK_BTN_H = 48
BACK_BTN_W = 90


def _draw_status_bar(draw, sys_status):
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
        draw.rectangle([bat_x, bat_y, bat_x + bat_w, bat_y + bat_h], outline=LIGHT_GRAY, width=1)
        # Battery tip
        draw.rectangle([bat_x + bat_w, bat_y + 3, bat_x + bat_w + 3, bat_y + bat_h - 3], fill=LIGHT_GRAY)
        # Fill level
        fill_w = max(0, int((bat_w - 2) * pct / 100))
        bat_color = GREEN if pct > 30 else YELLOW if pct > 15 else RED
        if charging:
            bat_color = CYAN
        if fill_w > 0:
            draw.rectangle([bat_x + 1, bat_y + 1, bat_x + 1 + fill_w, bat_y + bat_h - 1], fill=bat_color)
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
        # WiFi is the active route — show SSID + signal
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
        # Ethernet is the active route — show "Ethernet" or NM connection name
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
        # Some other interface (USB tethering, tailscale, etc.)
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


def _back_button() -> Button:
    """Standard back button for sub-pages — full width, easy to hit with gloves."""
    return Button(
        x=MARGIN, y=H - BACK_BTN_H - 5,
        w=W - MARGIN * 2, h=BACK_BTN_H,
        label="< BACK", action="nav_home",
        color=MID_GRAY, text_color=WHITE
    )


def _draw_alert_bar(draw, sys_status: dict, y_start: int) -> int:
    """Draw a persistent alert bar if there are active diagnostics.

    Returns the Y position after the bar (content below should shift down).
    """
    diagnostics = sys_status.get("diagnostics", [])
    if not diagnostics:
        return y_start
    # Ensure each entry is a dict (data pipeline may serialize as strings)
    diagnostics = [d for d in diagnostics if isinstance(d, dict)]
    if not diagnostics:
        return y_start

    # Find the highest severity
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
    # Show the first diagnostic title, truncated
    first = diagnostics[0]
    title = first.get("title", first.get("message", "Alert"))
    count = len(diagnostics)
    suffix = f"  (+{count - 1} more)" if count > 1 else ""
    display = f" {icon} {title}{suffix}"
    # Truncate to fit
    max_chars = 55
    if len(display) > max_chars:
        display = display[:max_chars - 3] + "..."
    draw.text((MARGIN, y_start + 5), display, fill=text_color, font=font)

    return y_start + bar_h


def _beep():
    """Short audible beep for tap feedback."""
    try:
        # Try the freedesktop button sound first
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
        pass  # No sound device? Skip silently.


def _system_subtitle(sys_status: dict) -> str:
    """Build subtitle for SYSTEM button on home screen."""
    bat = sys_status.get("battery", {})
    if bat.get("available"):
        pct = bat.get("percent", 0)
        charging = bat.get("charging", False)
        chg = " CHG" if charging else ""
        return f"BAT {pct:.0f}%{chg} | CPU {sys_status['cpu_temp'] * 9/5 + 32:.0f}F"
    return f"CPU {sys_status['cpu_temp'] * 9/5 + 32:.0f}F | Disk {sys_status['disk_pct']}%"


def render_home(sys_status: dict) -> Tuple["Image.Image", List[Button]]:
    """HOME — live production dashboard with big numbers and nav bar."""
    img = Image.new("RGB", (W, H), DARK_GRAY)
    draw = ImageDraw.Draw(img)
    _draw_status_bar(draw, sys_status)

    buttons = []
    font_huge = find_font(44)
    font_big = find_font(30)
    font_med = find_font(16)
    font_sm = find_font(13)
    font_unit = find_font(12)
    font_nav = find_font(22)

    y = HEADER_H
    y = _draw_alert_bar(draw, sys_status, y)

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

    # PLATES (biggest number on screen — must be visible from 5 feet in sunlight)
    plate_count = sys_status.get("plate_count", 0)
    draw.text((col_plates, y), "PLATES", fill=WHITE, font=font_unit)
    draw.text((col_plates, y + 13), str(plate_count), fill=WHITE, font=font_huge)

    # SPEED + direction arrow
    speed = sys_status.get("speed_ftpm", 0.0)
    direction = sys_status.get("encoder_direction", "forward")
    is_reverse = direction == "reverse"
    draw.text((col_speed, y), "SPEED", fill=WHITE, font=font_unit)
    draw.text((col_speed, y + 13), f"{speed:.1f}", fill=WHITE, font=font_big)
    # Direction arrow next to speed number (▲ forward green, ▼ reverse red)
    speed_w = draw.textlength(f"{speed:.1f}", font=font_big)
    if is_reverse:
        draw.text((col_speed + speed_w + 4, y + 18), "▼", fill=RED, font=font_med)
        draw.text((col_speed, y + 45), "ft/min  REV", fill=RED, font=font_unit)
    else:
        draw.text((col_speed + speed_w + 4, y + 18), "▲", fill=GREEN, font=font_med)
        draw.text((col_speed, y + 45), "ft/min", fill=LIGHT_GRAY, font=font_unit)

    # STATUS (colored dot + text — bold colors for sunlight)
    draw.text((col_status, y), "STATUS", fill=WHITE, font=font_unit)
    # Colored dot (bigger for visibility)
    dot_y = y + 20
    draw.ellipse([col_status, dot_y, col_status + 18, dot_y + 18], fill=status_color)
    draw.text((col_status + 24, y + 18), status_text, fill=status_color, font=font_med)

    # Plates/min below status
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
    sp_str = f"Spacing: {last_sp:.1f}\"" if last_sp > 0 else "Spacing: --"
    sp_color = GREEN if last_sp > 0 and abs(last_sp - 19.5) < 2 else (
        YELLOW if last_sp > 0 and abs(last_sp - 19.5) < 5 else (
            RED if last_sp > 0 else LIGHT_GRAY))
    draw.text((MARGIN, y), sp_str, fill=sp_color, font=font_stat)

    # Efficiency: plates / expected_plates * 100
    travel_ft = sys_status.get("travel_ft", 0.0)
    expected = (travel_ft * 12.0 / 19.5) if travel_ft > 0 else 0
    efficiency = (plate_count / expected * 100) if expected > 0 else 0
    eff_str = f"Efficiency: {efficiency:.0f}%" if expected > 0 else "Efficiency: --"
    eff_color = GREEN if efficiency >= 95 else (YELLOW if efficiency >= 85 else LIGHT_GRAY)
    draw.text((eff_x, y), eff_str, fill=eff_color, font=font_stat)

    y += 28

    # Mode + Camera rate (bright text for sunlight)
    mode = sys_status.get("tps_mode", "")
    mode_str = f"Mode: {mode}" if mode else "Mode: --"
    draw.text((MARGIN, y), mode_str, fill=WHITE, font=font_stat)

    camera_rate = sys_status.get("camera_rate", 0.0)  # X3 = plate flipper
    cam_color = GREEN if camera_rate > 5 else (YELLOW if camera_rate > 0 else LIGHT_GRAY)
    cam_str = f"Flipper: {camera_rate:.0f}/min" if camera_rate > 0 else "Flipper: --"
    draw.text((eff_x, y), cam_str, fill=cam_color, font=font_stat)

    # --- Travel distance (compact, bright) ---
    y += 28
    travel_str = f"Travel: {travel_ft:.1f} ft"
    draw.text((MARGIN, y), travel_str, fill=WHITE, font=font_stat)
    avg_sp = sys_status.get("avg_spacing_in", 0.0)
    if avg_sp > 0:
        draw.text((eff_x, y), f"Avg spacing: {avg_sp:.1f}\"", fill=WHITE, font=font_stat)

    # --- Bottom navigation bar (4 buttons) ---
    nav_h = 74
    nav_y = H - nav_h - 4
    gap = 5
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


def render_live(sys_status: dict) -> Tuple["Image.Image", List[Button]]:
    """LIVE — real-time PLC data."""
    img = Image.new("RGB", (W, H), DARK_GRAY)
    draw = ImageDraw.Draw(img)
    _draw_status_bar(draw, sys_status)

    font_big = find_font(30)
    font_lg = find_font(20)
    font_med = find_font(16)
    font_sm = find_font(13)

    y = HEADER_H
    y = _draw_alert_bar(draw, sys_status, y)
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
    sp_color = GREEN if abs(last_sp - 19.5) < 2 else (YELLOW if abs(last_sp - 19.5) < 5 else RED)
    if last_sp == 0:
        sp_color = LIGHT_GRAY
    draw.text((MARGIN, y), f"Last: {last_sp:.1f}\"", fill=sp_color, font=font_lg)
    draw.text((mid, y), f"Avg: {avg_sp:.1f}\"", fill=WHITE, font=font_lg)
    y += 24

    # State
    state = sys_status["system_state"]
    state_color = GREEN if state == "running" else YELLOW
    draw.text((MARGIN, y), f"State: {state}", fill=state_color, font=font_med)

    # Back button
    back = _back_button()
    draw_button(draw, back, find_font(16))

    return img, [back]


def render_commands(sys_status: dict) -> Tuple["Image.Image", List[Button]]:
    """COMMANDS — actionable buttons."""
    img = Image.new("RGB", (W, H), DARK_GRAY)
    draw = ImageDraw.Draw(img)
    _draw_status_bar(draw, sys_status)

    font = find_font(16)
    font_title = find_font(14)

    y = HEADER_H
    y = _draw_alert_bar(draw, sys_status, y)
    y += 4
    draw.text((MARGIN, y), "COMMANDS", fill=LIGHT_GRAY, font=font_title)
    y += 22

    commands = [
        ("Fix Connection", "cmd_restart_viam", DARK_ORANGE, True),
        ("Test PLC", "cmd_test_plc", DARK_BLUE, False),
        ("Scan WiFi", "cmd_switch_wifi", DARK_CYAN, False),
        ("Clear Data", "cmd_clear_buffer", DARK_RED, True),
        ("Sync Now", "cmd_force_sync", DARK_GREEN, False),
    ]

    buttons = []
    btn_w = W - MARGIN * 2
    # Calculate button height to fit above the back button without overlap
    back_top = H - BACK_BTN_H - 5
    available_h = back_top - y - 10  # 10px gap above back button
    gap = 6
    btn_h = min(48, (available_h - gap * (len(commands) - 1)) // len(commands))

    for label, action, color, needs_confirm in commands:
        btn_action = f"confirm_{action}" if needs_confirm else action
        btn = Button(MARGIN, y, btn_w, btn_h, label, btn_action, color=color)
        buttons.append(btn)
        draw_button(draw, btn, font)
        y += btn_h + gap

    # Back button (appended last so it draws on top)
    back = _back_button()
    draw_button(draw, back, find_font(16))
    buttons.append(back)

    return img, buttons


def _get_truck_errors(sys_status: dict) -> list:
    """Build truck/equipment error entries from active diagnostics.

    Returns list of dicts matching the activity history format:
      {"time": "HH:MM", "component": "...", "message": "...", "level": "...", "source": "truck"}
    """
    entries = []
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

    # Also add TPS-specific status entries
    if not sys_status.get("tps_power_loop") and sys_status.get("plc_reachable"):
        entries.append({
            "time": now_str, "component": "TPS", "message": "TPS power OFF",
            "level": "warning", "source": "truck",
        })
    if sys_status.get("plc_reachable") and not sys_status.get("connected"):
        entries.append({
            "time": now_str, "component": "PLC", "message": "PLC reachable but sensor disconnected",
            "level": "warning", "source": "truck",
        })
    if not sys_status.get("eth0_carrier"):
        entries.append({
            "time": now_str, "component": "ETH", "message": "Ethernet NO CARRIER (cable/PLC off)",
            "level": "error", "source": "truck",
        })
    return entries


# Log filter modes: "all", "software", "truck"
LOG_FILTERS = ["ALL", "SOFTWARE", "TRUCK"]


def render_logs(sys_status: dict, scroll_offset: int = 0,
                log_filter: str = "all") -> Tuple["Image.Image", List[Button]]:
    """LOGS — scrollable event history with filter tabs (All / Software / Truck)."""
    img = Image.new("RGB", (W, H), DARK_GRAY)
    draw = ImageDraw.Draw(img)
    _draw_status_bar(draw, sys_status)

    font = find_font(12)
    font_sm = find_font(11)
    font_title = find_font(14)
    font_tab = find_font(13)

    y = HEADER_H
    y = _draw_alert_bar(draw, sys_status, y)
    y += 4

    buttons = []

    # Filter tabs — big enough to hit with gloves
    tab_w = (W - MARGIN * 2 - 8) // 3  # 3 tabs with small gaps
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
    # Tag software entries
    for entry in software_history:
        entry.setdefault("source", "software")

    truck_errors = _get_truck_errors(sys_status)

    if log_filter.lower() == "software":
        history = list(reversed(software_history))
    elif log_filter.lower() == "truck":
        history = list(reversed(truck_errors))
    else:
        # All: merge and show newest first
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
        # Source indicator
        src_color = ORANGE if source == "truck" else CYAN
        src_label = comp[:4].upper()

        # Truncate message to fit
        max_chars = 38
        display_msg = msg[:max_chars] + ("..." if len(msg) > max_chars else "")

        draw.text((MARGIN, y), t, fill=MID_GRAY, font=font_sm)
        draw.text((MARGIN + 55, y), src_label, fill=src_color, font=font_sm)
        draw.text((MARGIN + 95, y), display_msg, fill=text_color, font=font_sm)
        y += row_h

    if not visible:
        draw.text((MARGIN, y + 10), "No events to show", fill=MID_GRAY, font=font)

    # Scroll buttons on the right — big for glove use
    scroll_btn_w = 60
    scroll_btn_h = 44

    if scroll_offset > 0:
        up_btn = Button(
            W - scroll_btn_w - MARGIN, HEADER_H + 38,
            scroll_btn_w, scroll_btn_h,
            "UP", "scroll_up", color=MID_GRAY
        )
        buttons.append(up_btn)
        draw_button(draw, up_btn, find_font(12))

    if scroll_offset + max_visible < len(history):
        dn_btn = Button(
            W - scroll_btn_w - MARGIN, H - BACK_BTN_H - scroll_btn_h - 15,
            scroll_btn_w, scroll_btn_h,
            "DN", "scroll_down", color=MID_GRAY
        )
        buttons.append(dn_btn)
        draw_button(draw, dn_btn, find_font(12))

    # Back button
    back = _back_button()
    draw_button(draw, back, find_font(16))
    buttons.append(back)

    return img, buttons


def _get_service_statuses(sys_status: dict) -> list:
    """Build the full list of health rows for the system page.

    Each entry: (label, ok_bool, detail_str)
    """
    rows = []

    # -- Core services --
    rows.append(("viam-server", sys_status["viam_server"],
                 "active" if sys_status["viam_server"] else "STOPPED"))

    rows.append(("PLC", sys_status["plc_reachable"], sys_status["plc_ip"]))

    # plc-sensor module — check if the module process is running
    plc_sensor_ok = False
    try:
        r = subprocess.run(["pgrep", "-f", "plc_sensor"], capture_output=True, timeout=3)
        plc_sensor_ok = r.returncode == 0
    except Exception:
        pass
    rows.append(("plc-sensor", plc_sensor_ok,
                 "running" if plc_sensor_ok else "STOPPED"))

    # TPS power
    tps_on = sys_status.get("tps_power_loop", False)
    tps_mode = sys_status.get("tps_mode", "")
    tps_detail = tps_mode if tps_on and tps_mode else ("ON" if tps_on else "OFF")
    rows.append(("TPS Power", tps_on, tps_detail))

    # -- Network --
    rows.append(("Ethernet", sys_status["eth0_carrier"],
                 sys_status.get("eth0_ip", "") or ("linked" if sys_status["eth0_carrier"] else "NO CARRIER")))

    rows.append(("WiFi", bool(sys_status["wifi_ssid"]),
                 sys_status["wifi_ssid"] or "disconnected"))

    signal = sys_status.get("wifi_signal_dbm", 0)
    if signal and signal < 0:
        rows.append(("  Signal", signal > -70, f"{signal} dBm"))

    rows.append(("Internet", sys_status["internet"],
                 "connected" if sys_status["internet"] else "OFFLINE"))

    tailscale = sys_status.get("tailscale_ip", "")
    ts_ok = bool(tailscale)
    rows.append(("Tailscale", ts_ok, tailscale if ts_ok else "not connected"))

    iphone = sys_status.get("iphone_connected", False)
    if iphone:
        rows.append(("iPhone", True, "tethered"))

    # -- Data pipeline --
    # Cloud sync: check if .prog capture files exist (active capture)
    capture_ok = False
    capture_detail = "no data"
    try:
        capture_dir = CAPTURE_BASE_DIR
        if capture_dir.exists():
            prog_files = list(capture_dir.rglob("*.prog"))
            if prog_files:
                # Check if the newest .prog is growing
                newest = max(prog_files, key=lambda p: p.stat().st_mtime)
                age = time.time() - newest.stat().st_mtime
                if age < 10:
                    capture_ok = True
                    capture_detail = "capturing"
                else:
                    capture_detail = f"stale ({int(age)}s)"
    except Exception:
        pass
    rows.append(("Data Capture", capture_ok, capture_detail))

    # Offline buffer
    try:
        buf_dir = OFFLINE_BUFFER_DIR
        if buf_dir.exists():
            jsonl_files = list(buf_dir.glob("readings_*.jsonl"))
            if jsonl_files:
                total_kb = sum(f.stat().st_size for f in jsonl_files) // 1024
                rows.append(("Offline Buf", True, f"{len(jsonl_files)} files, {total_kb}KB"))
    except Exception:
        pass

    # Discovery daemon
    disc_ok = False
    try:
        r = subprocess.run(["pgrep", "-f", "ironsight-discovery"], capture_output=True, timeout=3)
        disc_ok = r.returncode == 0
    except Exception:
        pass
    rows.append(("Discovery", disc_ok, "running" if disc_ok else "stopped"))

    # Watchdog
    wd_ok = False
    wd_detail = "unknown"
    try:
        r = subprocess.run(
            ["crontab", "-l"], capture_output=True, text=True, timeout=3
        )
        if "watchdog" in r.stdout.lower():
            wd_ok = True
            wd_detail = "active (cron)"
        else:
            wd_detail = "no cron entry"
    except Exception:
        pass
    rows.append(("Watchdog", wd_ok, wd_detail))

    return rows


def _get_truck_statuses(sys_status: dict) -> list:
    """Build truck equipment status rows.

    Each entry: (label, ok_bool, detail_str)
    """
    rows = []
    connected = sys_status.get("connected", False)
    tps_on = sys_status.get("tps_power_loop", False)

    # Encoder
    speed = sys_status.get("speed_ftpm", 0.0)
    direction = sys_status.get("encoder_direction", "forward")
    if not connected:
        rows.append(("Encoder", False, "no PLC"))
    elif speed > 0.5:
        dir_arrow = "▼ REV" if direction == "reverse" else "▲ FWD"
        rows.append(("Encoder", True, f"{speed:.1f} ft/m {dir_arrow}"))
    elif tps_on:
        rows.append(("Encoder", True, "idle (0 ft/m)"))
    else:
        rows.append(("Encoder", True, "standby"))

    # Plate Flipper (camera / X3)
    cam_rate = sys_status.get("camera_rate", 0.0)
    if not connected:
        rows.append(("Plate Flipper", False, "no PLC"))
    elif cam_rate > 5:
        rows.append(("Plate Flipper", True, f"{cam_rate:.0f}/min"))
    elif cam_rate > 0:
        rows.append(("Plate Flipper", True, f"{cam_rate:.0f}/min (slow)"))
    elif tps_on and speed > 0.5:
        rows.append(("Plate Flipper", False, "no detections"))
    else:
        rows.append(("Plate Flipper", True, "standby"))

    # Plate Drop / Production
    plates = sys_status.get("plate_count", 0)
    ppm = sys_status.get("plates_per_min", 0.0)
    if not connected:
        rows.append(("Plate Drop", False, "no PLC"))
    elif plates > 0 and ppm > 0:
        rows.append(("Plate Drop", True, f"{plates} plates ({ppm:.1f}/min)"))
    elif plates > 0:
        rows.append(("Plate Drop", True, f"{plates} plates"))
    elif tps_on:
        rows.append(("Plate Drop", True, "0 plates"))
    else:
        rows.append(("Plate Drop", True, "standby"))

    # Spacing
    last_sp = sys_status.get("last_spacing_in", 0.0)
    avg_sp = sys_status.get("avg_spacing_in", 0.0)
    if last_sp > 0:
        in_tol = abs(last_sp - 19.5) < 2.0
        sp_detail = f"last {last_sp:.1f}\""
        if avg_sp > 0:
            sp_detail += f"  avg {avg_sp:.1f}\""
        rows.append(("Spacing", in_tol, sp_detail))
    elif plates > 0:
        rows.append(("Spacing", True, "no data yet"))
    else:
        rows.append(("Spacing", True, "standby"))

    # Travel
    travel_ft = sys_status.get("travel_ft", 0.0)
    if travel_ft > 0:
        rows.append(("Travel", True, f"{travel_ft:.1f} ft"))

    # Efficiency
    if travel_ft > 10 and plates > 0:
        expected = travel_ft * 12.0 / 19.5
        eff = plates / expected * 100 if expected > 0 else 0
        eff_ok = eff >= 85
        rows.append(("Efficiency", eff_ok, f"{eff:.0f}%"))

    return rows


def render_system(sys_status: dict, scroll_offset: int = 0) -> Tuple["Image.Image", List[Button]]:
    """SYSTEM — scrollable health dashboard with full component status."""
    img = Image.new("RGB", (W, H), DARK_GRAY)
    draw = ImageDraw.Draw(img)
    _draw_status_bar(draw, sys_status)

    font = find_font(13)
    font_sm = find_font(12)
    font_title = find_font(14)

    y_top = HEADER_H
    y_top = _draw_alert_bar(draw, sys_status, y_top)
    y_top += 4

    # Build all content rows (we'll slice them for scrolling)
    # Each row: ("section"|"status"|"gauge"|"info", ...)
    all_rows = []

    # -- Service/connection status --
    all_rows.append(("section", "COMPUTER SYSTEMS"))
    health_rows = _get_service_statuses(sys_status)
    for label, ok, detail in health_rows:
        all_rows.append(("status", label, ok, detail))

    all_rows.append(("divider",))

    # -- Truck equipment status --
    all_rows.append(("section", "TRUCK EQUIPMENT"))
    truck_rows = _get_truck_statuses(sys_status)
    for label, ok, detail in truck_rows:
        all_rows.append(("status", label, ok, detail))

    # Individual diagnostics (expand each alert)
    diags = [d for d in sys_status.get("diagnostics", []) if isinstance(d, dict)]
    if diags:
        all_rows.append(("divider",))
        all_rows.append(("section", "ACTIVE ALERTS"))
        for d in diags:
            sev = d.get("severity", "info")
            title = d.get("title", "unknown")
            cat = d.get("category", "")
            # Use severity to determine ok/not-ok
            is_ok = sev == "info"
            sev_tag = "CRIT" if sev == "critical" else ("WARN" if sev == "warning" else "INFO")
            all_rows.append(("alert", title, sev, f"[{sev_tag}] {cat}"))

    all_rows.append(("divider",))

    # -- Resource gauges --
    gauges = [
        ("CPU", sys_status["cpu_temp"], f"{sys_status['cpu_temp'] * 9/5 + 32:.0f}F",
         GREEN if sys_status["cpu_temp"] < 70 else YELLOW if sys_status["cpu_temp"] < 80 else RED),
        ("MEM", sys_status["mem_pct"], f"{sys_status['mem_pct']}%",
         GREEN if sys_status["mem_pct"] < 70 else YELLOW if sys_status["mem_pct"] < 85 else RED),
        ("DISK", sys_status["disk_pct"], f"{sys_status['disk_pct']}%",
         GREEN if sys_status["disk_pct"] < 80 else YELLOW if sys_status["disk_pct"] < 90 else RED),
    ]
    bat = sys_status.get("battery", {})
    if bat.get("available"):
        pct = bat.get("percent", 0)
        charging = bat.get("charging", False)
        v = bat.get("voltage", 0)
        bat_label = f"{pct:.0f}% {v:.2f}V" + (" CHG" if charging else "")
        bat_color = CYAN if charging else (GREEN if pct > 30 else YELLOW if pct > 15 else RED)
        gauges.append(("BAT", pct, bat_label, bat_color))
    for g in gauges:
        all_rows.append(("gauge",) + g)

    all_rows.append(("divider",))

    # -- Info rows --
    uptime = sys_status["uptime"]
    truck = sys_status["truck_id"]
    all_rows.append(("info", f"Uptime: {uptime}   Truck: {truck}"))

    # Diagnostics summary (quick glance)
    diag_list = [d for d in sys_status.get("diagnostics", []) if isinstance(d, dict)]
    if diag_list:
        crits = sum(1 for d in diag_list if d.get("severity") == "critical")
        warns = sum(1 for d in diag_list if d.get("severity") == "warning")
        all_rows.append(("info", f"Alerts: {crits} critical, {warns} warning"))
    else:
        all_rows.append(("info", "Alerts: all clear"))

    # -- Calculate row heights and apply scroll --
    row_heights = []
    for row in all_rows:
        if row[0] == "section":
            row_heights.append(22)
        elif row[0] == "status":
            row_heights.append(20)
        elif row[0] == "alert":
            row_heights.append(20)
        elif row[0] == "gauge":
            row_heights.append(30)  # label + bar
        elif row[0] == "divider":
            row_heights.append(10)
        elif row[0] == "info":
            row_heights.append(18)
        else:
            row_heights.append(20)

    content_h = H - y_top - BACK_BTN_H - 15
    total_content_h = sum(row_heights)
    needs_scroll = total_content_h > content_h

    # Clamp scroll offset
    max_scroll = max(0, len(all_rows) - 1)
    scroll_offset = min(scroll_offset, max_scroll)

    # Skip rows based on scroll offset
    y = y_top
    bar_w = W - MARGIN * 2
    visible_start = scroll_offset
    for i, row in enumerate(all_rows):
        if i < visible_start:
            continue
        if y > H - BACK_BTN_H - 15:
            break

        if row[0] == "section":
            _, title = row
            draw.text((MARGIN, y + 4), title, fill=CYAN, font=font)
            y += row_heights[i]

        elif row[0] == "status":
            _, label, ok, detail = row
            color = GREEN if ok else RED
            sq = 8
            draw.rectangle([MARGIN, y + 4, MARGIN + sq, y + 4 + sq], fill=color)
            draw.text((MARGIN + sq + 6, y), label, fill=WHITE, font=font_sm)
            dw = draw.textlength(detail, font=font_sm)
            draw.text((W - MARGIN - dw, y + 1), detail, fill=LIGHT_GRAY, font=font_sm)
            y += row_heights[i]

        elif row[0] == "alert":
            _, title, severity, detail = row
            sev_color = RED if severity == "critical" else (YELLOW if severity == "warning" else LIGHT_GRAY)
            sq = 8
            draw.rectangle([MARGIN, y + 4, MARGIN + sq, y + 4 + sq], fill=sev_color)
            # Truncate title to fit (leave room for detail tag)
            max_title_w = W - MARGIN * 2 - sq - 10
            disp_title = title
            while draw.textlength(disp_title, font=font_sm) > max_title_w and len(disp_title) > 10:
                disp_title = disp_title[:-2] + "…"
            draw.text((MARGIN + sq + 6, y), disp_title, fill=sev_color, font=font_sm)
            y += row_heights[i]

        elif row[0] == "gauge":
            _, label, value, text, color = row
            draw.text((MARGIN, y), label, fill=LIGHT_GRAY, font=font_sm)
            gy = y + 14
            bar_h = 10
            draw.rectangle([MARGIN, gy, MARGIN + bar_w, gy + bar_h], fill=MID_GRAY)
            fill_pct = min(100, max(0, value if isinstance(value, (int, float)) else 0))
            if label == "CPU":
                fill_pct = min(100, max(0, (value - 30) / 60 * 100))
            fill_w = int(bar_w * fill_pct / 100)
            if fill_w > 0:
                draw.rectangle([MARGIN, gy, MARGIN + fill_w, gy + bar_h], fill=color)
            tw = draw.textlength(text, font=font_sm)
            draw.text((W - MARGIN - tw, gy - 1), text, fill=WHITE, font=font_sm)
            y += row_heights[i]

        elif row[0] == "divider":
            dy = y + 5
            draw.line([(MARGIN, dy), (W - MARGIN, dy)], fill=MID_GRAY, width=1)
            y += row_heights[i]

        elif row[0] == "info":
            _, text = row
            draw.text((MARGIN, y), text, fill=LIGHT_GRAY, font=font_sm)
            y += row_heights[i]

    buttons = []

    # Scroll buttons — big for glove use
    if needs_scroll:
        scroll_btn_w = 60
        scroll_btn_h = 44

        if scroll_offset > 0:
            up_btn = Button(
                W - scroll_btn_w - MARGIN, y_top,
                scroll_btn_w, scroll_btn_h,
                "UP", "scroll_up", color=MID_GRAY
            )
            buttons.append(up_btn)
            draw_button(draw, up_btn, find_font(12))

        if y > H - BACK_BTN_H - 15:
            dn_btn = Button(
                W - scroll_btn_w - MARGIN, H - BACK_BTN_H - scroll_btn_h - 15,
                scroll_btn_w, scroll_btn_h,
                "DN", "scroll_down", color=MID_GRAY
            )
            buttons.append(dn_btn)
            draw_button(draw, dn_btn, find_font(12))

    # Back button
    back = _back_button()
    draw_button(draw, back, find_font(16))
    buttons.append(back)

    return img, buttons


def render_expanded_message(msg: "ChatMessage", explanation: str = "") -> Tuple["Image.Image", List[Button]]:
    """Full-screen popup showing an AI message in larger text for readability.

    If explanation is provided, shows that instead of the original message.
    """
    img = Image.new("RGB", (W, H), (20, 20, 25))
    draw = ImageDraw.Draw(img)
    buttons = []

    font_title = find_font(16)
    font_body = find_font(18)
    font_close = find_font(18)
    font_btn = find_font(14)

    # Header bar
    draw.rectangle([0, 0, W, 30], fill=(30, 30, 40))
    header_text = "AI EXPLANATION" if explanation else "AI DIAGNOSIS"
    draw.text((MARGIN, 6), header_text, fill=PURPLE, font=font_title)

    # Close button (X) in top right — big tap target
    draw.text((W - 30, 3), "X", fill=WHITE, font=font_close)
    close_btn = Button(W - 50, 0, 50, 36, "", "chat_close_expand")
    buttons.append(close_btn)

    # Determine text color by severity
    if msg.severity == "critical":
        text_color = RED
    elif msg.severity == "warning":
        text_color = YELLOW
    elif msg.severity == "ok":
        text_color = GREEN
    else:
        text_color = GREEN

    # Display text: explanation if available, otherwise original message
    display_text = explanation if explanation else msg.text

    # Reserve space for bottom button
    btn_area_h = 44 if not explanation else 0

    # Word-wrap and draw the message in larger font
    y = 40
    max_chars = 32  # fewer chars per line = bigger text
    line_h = 24
    max_y = H - btn_area_h - 24  # leave room for timestamp and button
    words = display_text.split()
    line = ""
    for word in words:
        test = (line + " " + word).strip()
        if len(test) > max_chars:
            if line:
                if y < max_y:
                    draw.text((MARGIN, y), line, fill=text_color, font=font_body)
                y += line_h
            line = word
        else:
            line = test
    if line and y < max_y:
        draw.text((MARGIN, y), line, fill=text_color, font=font_body)

    # Timestamp + investigation depth indicator
    ts_text = msg.timestamp
    tool_calls = getattr(msg, '_tool_calls', 0)
    if tool_calls > 0:
        ts_text += f"  ({tool_calls} checks performed)"
    draw.text((MARGIN, H - 22), ts_text, fill=MID_GRAY, font=find_font(11))

    # "Explain" button at the bottom (only when showing the original message)
    if not explanation:
        explain_btn = Button(
            MARGIN, H - btn_area_h - 4,
            W - MARGIN * 2, 40,
            "EXPLAIN REASONING", "chat_explain",
            color=DARK_PURPLE, text_color=WHITE
        )
        buttons.append(explain_btn)
        draw_button(draw, explain_btn, font_btn)

    return img, buttons


def render_chat(sys_status: dict, voice_chat: "VoiceChat") -> Tuple["Image.Image", List[Button]]:
    """DIAGNOSE page — instant local check + AI analysis.

    Shows local diagnosis immediately, then upgrades with AI when ready.
    Bottom bar: BACK | TRY AGAIN | ASK (voice). Tap any AI message to enlarge.
    """
    img = Image.new("RGB", (W, H), DARK_GRAY)
    draw = ImageDraw.Draw(img)

    font = find_font(14)
    font_sm = find_font(12)
    font_btn = find_font(14)

    buttons = []
    state = voice_chat.state

    # Alert bar first (before status line)
    alert_y = _draw_alert_bar(draw, sys_status, 0)

    # Status line at top — slim, just shows state
    status_h = 24
    sl_y = alert_y
    if state == "recording":
        draw.rectangle([0, sl_y, W, sl_y + status_h], fill=DARK_RED)
        draw.text((MARGIN, sl_y + 4), "RECORDING -- tap STOP to send", fill=RED, font=font_sm)
        dot_color = RED if int(time.time() * 2) % 2 == 0 else DARK_RED
        draw.ellipse([W - 22, sl_y + 6, W - 12, sl_y + 16], fill=dot_color)
    elif state in ("transcribing", "thinking", "loading"):
        draw.rectangle([0, sl_y, W, sl_y + status_h], fill=DARK_BLUE)
        draw.text((MARGIN, sl_y + 4), voice_chat.state_message, fill=CYAN, font=font_sm)
        dots = "." * (int(time.time() * 3) % 4)
        draw.text((W - 30, sl_y + 4), dots, fill=CYAN, font=font_sm)
    elif state == "error":
        draw.rectangle([0, sl_y, W, sl_y + status_h], fill=DARK_RED)
        draw.text((MARGIN, sl_y + 4), voice_chat.state_message, fill=RED, font=font_sm)
        draw.text((W - 25, sl_y + 4), "X", fill=WHITE, font=font_sm)
        dismiss_btn = Button(W - 40, sl_y, 40, status_h, "", "chat_dismiss_error")
        buttons.append(dismiss_btn)
    else:
        draw.rectangle([0, sl_y, W, sl_y + status_h], fill=(15, 15, 20))
        draw.text((MARGIN, sl_y + 4), "DIAGNOSE", fill=PURPLE, font=font_sm)
        # Tap to enlarge hint
        hint = "tap message to enlarge"
        hw = draw.textlength(hint, font=find_font(10))
        draw.text((W - hw - MARGIN, sl_y + 6), hint, fill=MID_GRAY, font=find_font(10))

    # Bottom button bar — always visible, glove-friendly (50px tall)
    btn_bar_h = 54
    btn_y = H - btn_bar_h
    draw.rectangle([0, btn_y, W, H], fill=(20, 20, 25))

    if state == "recording":
        # While recording: full-width STOP button
        stop_btn = Button(MARGIN, btn_y + 4, W - MARGIN * 2, 46, "STOP", "chat_stop_recording",
                          color=DARK_RED, text_color=WHITE)
        buttons.append(stop_btn)
        draw_button(draw, stop_btn, font_btn)
    else:
        # Three buttons: BACK | TRY AGAIN | ASK
        btn_w = (W - MARGIN * 4) // 3
        gap = MARGIN

        back_btn = Button(gap, btn_y + 4, btn_w, 46, "BACK", "nav_home",
                          color=MID_GRAY, text_color=WHITE)
        buttons.append(back_btn)
        draw_button(draw, back_btn, font_btn)

        retry_btn = Button(gap + btn_w + gap, btn_y + 4, btn_w, 46,
                           "TRY AGAIN", "chat_retry",
                           color=DARK_ORANGE, text_color=WHITE)
        buttons.append(retry_btn)
        draw_button(draw, retry_btn, font_btn)

        ask_btn = Button(gap + (btn_w + gap) * 2, btn_y + 4, btn_w, 46,
                         "ASK", "chat_start_voice",
                         color=DARK_PURPLE, text_color=WHITE)
        buttons.append(ask_btn)
        draw_button(draw, ask_btn, font_btn)

    # Chat area
    chat_top = sl_y + status_h + 2
    chat_bottom = btn_y - 2
    chat_h = chat_bottom - chat_top

    # Render chat messages
    messages = voice_chat.messages
    line_h = 20
    max_chars = 40

    # Word-wrap messages into display lines
    # Each entry: (text, color, msg_index) where msg_index links back to messages[]
    display_lines = []
    for msg_idx, msg in enumerate(messages):
        prefix = "You: " if msg.role == "user" else ""
        if msg.role == "user":
            color = CYAN
        elif msg.severity == "critical":
            color = RED
        elif msg.severity == "warning":
            color = YELLOW
        elif msg.severity == "ok":
            color = GREEN
        else:
            color = GREEN
        full_text = prefix + msg.text
        words = full_text.split()
        line = ""
        for word in words:
            test = (line + " " + word).strip()
            if len(test) > max_chars:
                if line:
                    display_lines.append((line, color, msg_idx))
                line = word
            else:
                line = test
        if line:
            display_lines.append((line, color, msg_idx))
        display_lines.append(("", BLACK, -1))  # spacer

    # Calculate visible window
    visible_lines = chat_h // line_h
    total_lines = len(display_lines)

    # Auto-scroll to bottom unless user scrolled up
    start = max(0, total_lines - visible_lines - voice_chat.scroll_offset)
    end = start + visible_lines
    visible = display_lines[start:end]

    # Draw messages and track Y spans for AI message tap targets
    y = chat_top
    msg_start_y = {}
    msg_end_y = {}
    for text, color, msg_idx in visible:
        if text:
            draw.text((MARGIN, y), text, fill=color, font=font)
            if msg_idx >= 0 and messages[msg_idx].role == "assistant":
                if msg_idx not in msg_start_y:
                    msg_start_y[msg_idx] = y
                msg_end_y[msg_idx] = y + line_h
        y += line_h

    # Add tap targets and "+" icon for each AI message
    font_icon = find_font(14)
    for msg_idx in msg_start_y:
        top_y = msg_start_y[msg_idx]
        bot_y = msg_end_y[msg_idx]
        tap_h = max(bot_y - top_y, 44)  # minimum 44px tap target
        expand_btn = Button(0, top_y, W, tap_h, str(msg_idx), "chat_expand")
        buttons.append(expand_btn)
        draw.text((W - 24, top_y), "+", fill=MID_GRAY, font=font_icon)

    # Empty state — waiting for first diagnosis
    if not messages and state not in ("thinking", "loading"):
        y = chat_top + 40
        title = "DIAGNOSE"
        tw = draw.textlength(title, font=find_font(20))
        draw.text(((W - tw) // 2, y), title, fill=PURPLE, font=find_font(20))
        y += 40
        hints = [
            "Running system check...",
            "Results appear here automatically.",
        ]
        for line in hints:
            lw = draw.textlength(line, font=font)
            draw.text(((W - lw) // 2, y), line, fill=MID_GRAY, font=font)
            y += 26

    # Scroll indicators (bigger tap targets)
    if start > 0:
        draw.text((W - 22, chat_top + 2), "^", fill=LIGHT_GRAY, font=font)
        up_btn = Button(W - 50, chat_top, 50, 40, "", "chat_scroll_up")
        buttons.append(up_btn)

    if end < total_lines:
        draw.text((W - 22, chat_bottom - 20), "v", fill=LIGHT_GRAY, font=font)
        dn_btn = Button(W - 50, chat_bottom - 30, 50, 40, "", "chat_scroll_down")
        buttons.append(dn_btn)

    return img, buttons


def render_confirm_dialog(base_img: "Image.Image", action: str) -> Tuple["Image.Image", List[Button]]:
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

    draw.rounded_rectangle([dx, dy, dx + dw, dy + dh], radius=12, fill=DARK_GRAY, outline=LIGHT_GRAY)

    # Title
    titles = {
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


def render_feedback_toast(draw, executor: CommandExecutor):
    """Draw a feedback toast overlay at the bottom."""
    if not executor.has_feedback:
        return

    font = find_font(12)
    msg = executor.feedback_message
    level = executor.feedback_level

    bg_color = DARK_GREEN if level == "success" else DARK_RED if level == "error" else DARK_BLUE
    text_color = WHITE

    toast_h = 36
    toast_y = H - BACK_BTN_H - toast_h - 10
    draw.rounded_rectangle(
        [MARGIN, toast_y, W - MARGIN, toast_y + toast_h],
        radius=6, fill=bg_color
    )

    # Truncate if needed
    display_msg = msg[:55] + ("..." if len(msg) > 55 else "")
    bbox = draw.textbbox((0, 0), display_msg, font=font)
    tw = bbox[2] - bbox[0]
    draw.text(
        ((W - tw) // 2, toast_y + 9),
        display_msg, fill=text_color, font=font
    )


# ─────────────────────────────────────────────────────────────
#  Calibration mode
# ─────────────────────────────────────────────────────────────

def run_calibration(fb: Framebuffer, touch: TouchInput):
    """Interactive touch calibration — tap crosshairs at screen corners."""
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

    raw_points = []
    touch.start()

    for tx, ty, label in targets:
        # Draw crosshair
        img = Image.new("RGB", (W, H), BLACK)
        draw = ImageDraw.Draw(img)
        draw.text((W // 2 - 80, H // 2 - 30), f"Tap the {label}", fill=WHITE, font=font)
        draw.text((W // 2 - 60, H // 2), "crosshair", fill=LIGHT_GRAY, font=font_sm)

        # Draw crosshair
        draw.line([(tx - 15, ty), (tx + 15, ty)], fill=RED, width=2)
        draw.line([(tx, ty - 15), (tx, ty + 15)], fill=RED, width=2)
        draw.ellipse([tx - 5, ty - 5, tx + 5, ty + 5], outline=RED, width=2)

        fb.show(img)

        # Wait for tap (reading raw coordinates)
        while True:
            # Read raw from the device directly
            tap = touch.get_tap()
            if tap:
                # tap is already mapped through calibration, but since we set
                # cal to identity, raw values pass through
                raw_points.append((touch._raw_x, touch._raw_y))
                break
            time.sleep(0.05)

        time.sleep(0.5)  # brief pause between taps

    touch.stop()

    # Calculate calibration from the 4 corner taps
    # raw_points[0] = top-left, [1] = top-right, [2] = bottom-left, [3] = bottom-right
    tl, tr, bl, br = raw_points

    # Determine if X and Y are swapped by checking which raw axis
    # has more variation horizontally vs vertically
    x_range_horiz = abs(tr[0] - tl[0])
    y_range_horiz = abs(tr[1] - tl[1])
    swap_xy = y_range_horiz > x_range_horiz

    if swap_xy:
        # Swap raw coordinates
        tl = (tl[1], tl[0])
        tr = (tr[1], tr[0])
        bl = (bl[1], bl[0])
        br = (br[1], br[0])

    # min/max from corners
    min_x = min(tl[0], bl[0])
    max_x = max(tr[0], br[0])
    min_y = min(tl[1], tr[1])
    max_y = max(bl[1], br[1])

    # Check if inverted
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
    draw.text((MARGIN, 70), f"invert_x: {invert_x}  invert_y: {invert_y}", fill=WHITE, font=font_sm)
    draw.text((MARGIN, 90), f"X: {touch.cal['min_x']}-{touch.cal['max_x']}", fill=WHITE, font=font_sm)
    draw.text((MARGIN, 110), f"Y: {touch.cal['min_y']}-{touch.cal['max_y']}", fill=WHITE, font=font_sm)
    draw.text((MARGIN, 150), "Starting display in 3s...", fill=LIGHT_GRAY, font=font_sm)
    fb.show(img)
    time.sleep(3)


# ─────────────────────────────────────────────────────────────
#  Main loop
# ─────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="IronSight Touch Command Display")
    parser.add_argument("--fb", default="/dev/fb0", help="Framebuffer device")
    parser.add_argument("--calibrate", action="store_true", help="Run touch calibration")
    parser.add_argument("--no-touch", action="store_true", help="Disable touch (display only)")
    parser.add_argument("--terminal", action="store_true", help="Terminal mode (no framebuffer)")
    args = parser.parse_args()

    if not HAS_PILLOW:
        print("ERROR: Pillow is required. Install: pip3 install Pillow")
        sys.exit(1)

    # Set up framebuffer
    fb = None
    for fb_path in [args.fb, "/dev/fb1", "/dev/fb0"]:
        if os.path.exists(fb_path):
            fb = Framebuffer(fb_path)
            if fb.is_available():
                print(f"Framebuffer: {fb_path} ({fb.width}x{fb.height} @ {fb.bpp}bpp)")
                fb.open()
                break
            fb = None

    if not fb and not args.terminal:
        print("No framebuffer available. Use --terminal for terminal mode.")
        sys.exit(1)

    # Adjust global dimensions to match actual framebuffer
    global W, H
    if fb:
        W, H = fb.width, fb.height

    # Set up touch input
    touch = TouchInput(screen_w=W, screen_h=H)
    if not args.no_touch:
        if args.calibrate:
            run_calibration(fb, touch)
        touch.start()
    else:
        print("Touch input disabled")

    # Set up command executor
    executor = CommandExecutor()

    # Set up voice chat
    voice_chat = VoiceChat(sys_status_fn=get_system_status)

    # Set up PTT button (USB presenter clicker / any USB HID button)
    ptt_button = PTTButton()
    ptt_button.start()

    # App state
    current_page = "home"
    pending_dialog = None  # action string for confirm dialog
    scroll_offset = 0
    log_filter = "all"  # "all", "software", "truck"
    sys_status = {}
    last_data_refresh = 0
    needs_redraw = True
    chat_recording = False  # double-tap toggle state
    expanded_msg_idx = -1   # -1 = no expanded message, 0+ = index into voice_chat.messages
    expanded_explanation = ""  # explanation text from Claude for the expanded message
    error_start_time = 0.0  # when error state started (for auto-clear)

    print("IronSight Touch Display started")
    print(f"Touch: {'enabled' if not args.no_touch and touch.device else 'disabled'}")
    print(f"PTT button: {ptt_button.device.name if ptt_button.device else 'not found (use touchscreen)'}")
    print("Whisper: handled by lib.voice_chat")
    print(f"Claude: via CLI")

    try:
        while True:
            now = time.time()

            # Refresh data periodically
            if now - last_data_refresh > DATA_REFRESH_INTERVAL:
                sys_status = get_system_status()
                last_data_refresh = now
                needs_redraw = True

            # Poll USB PTT button (works from any page — hold style)
            if ptt_button.get_pressed():
                if current_page != "chat":
                    current_page = "chat"
                    scroll_offset = 0
                voice_chat.start_recording()
                needs_redraw = True
            if ptt_button.get_released() and voice_chat.state == "recording":
                voice_chat.stop_recording()
                needs_redraw = True

            # Check for double-tap (toggle recording in chat mode)
            dtap = touch.get_double_tap()
            if dtap and current_page == "chat":
                if not chat_recording and voice_chat.state == "idle":
                    # Start recording
                    chat_recording = True
                    voice_chat.start_recording()
                    needs_redraw = True
                elif chat_recording and voice_chat.state == "recording":
                    # Stop recording and send
                    chat_recording = False
                    voice_chat.stop_recording()
                    needs_redraw = True

            # Reset recording flag when processing finishes
            if chat_recording and voice_chat.state not in ("recording", "idle"):
                chat_recording = False

            # Auto-clear error state after 5 seconds
            if voice_chat.state == "error":
                if error_start_time == 0:
                    error_start_time = now
                elif now - error_start_time > 5.0:
                    voice_chat.state = "idle"
                    voice_chat.state_message = ""
                    error_start_time = 0
                    needs_redraw = True
            else:
                error_start_time = 0

            # Poll for swipe (smooth scrolling on scrollable pages)
            swipe = touch.get_swipe()
            if swipe and current_page in ("logs", "system"):
                if swipe > 0:
                    scroll_offset += 3  # swipe up = scroll down = show more content
                else:
                    scroll_offset = max(0, scroll_offset - 3)
                needs_redraw = True
            elif swipe and current_page == "chat":
                if swipe > 0:
                    voice_chat.scroll_offset += 3
                else:
                    voice_chat.scroll_offset = max(0, voice_chat.scroll_offset - 3)
                needs_redraw = True

            # Poll for touch
            tap = touch.get_tap()
            if tap:
                needs_redraw = True
                tx, ty = tap

                if expanded_msg_idx >= 0:
                    # Expanded message popup is showing — check for button hits
                    exp_msg = voice_chat.messages[expanded_msg_idx] if expanded_msg_idx < len(voice_chat.messages) else None
                    if exp_msg:
                        _, exp_buttons = render_expanded_message(exp_msg, expanded_explanation)
                        exp_hit = find_hit(exp_buttons, tx, ty)
                        _beep()
                        if exp_hit and exp_hit.action == "chat_explain":
                            # Show cached reasoning if available (no API call needed)
                            cached = getattr(exp_msg, '_reasoning', '')
                            if cached:
                                expanded_explanation = cached
                                needs_redraw = True
                            else:
                                # Fallback: ask Claude (Haiku for speed)
                                expanded_explanation = "Getting explanation..."
                                needs_redraw = True
                                def _explain():
                                    nonlocal expanded_explanation, needs_redraw
                                    try:
                                        sys_status = voice_chat._sys_status_fn()
                                        context = voice_chat._build_diagnosis_context(sys_status)
                                        prompt = (
                                            f"{context}\n\n"
                                            f"You previously gave this diagnosis:\n\"{exp_msg.text}\"\n\n"
                                            "Explain in 3-4 sentences: what data led to this conclusion? "
                                            "What should the operator look for at the truck? "
                                            "Plain text only, no markdown."
                                        )
                                        claude_env = {**os.environ, "HOME": "/home/andrew"}
                                        result = subprocess.run(
                                            ["claude", "-p", "--model", "haiku"],
                                            input=prompt,
                                            capture_output=True, text=True, timeout=30,
                                            env=claude_env,
                                        )
                                        if result.returncode == 0 and result.stdout.strip():
                                            expanded_explanation = result.stdout.strip()
                                            # Cache it for next time
                                            exp_msg._reasoning = expanded_explanation
                                        else:
                                            expanded_explanation = "Could not get explanation."
                                    except Exception:
                                        expanded_explanation = "Error getting explanation."
                                    needs_redraw = True
                                threading.Thread(target=_explain, daemon=True).start()
                        else:
                            # Any other tap closes the popup
                            expanded_msg_idx = -1
                            expanded_explanation = ""
                    else:
                        expanded_msg_idx = -1
                        expanded_explanation = ""
                elif pending_dialog:
                    base_img, _ = _render_current_page(
                        current_page, sys_status, scroll_offset, voice_chat, log_filter)
                    _, dialog_buttons = render_confirm_dialog(base_img, pending_dialog)
                    hit = find_hit(dialog_buttons, tx, ty)
                    if hit:
                        _beep()
                        if hit.action == "dialog_cancel":
                            pending_dialog = None
                        elif hit.action.startswith("do_"):
                            real_action = hit.action.replace("do_", "")
                            executor.execute(real_action)
                            pending_dialog = None
                else:
                    _, buttons = _render_current_page(
                        current_page, sys_status, scroll_offset, voice_chat, log_filter)
                    hit = find_hit(buttons, tx, ty)
                    if hit:
                        _beep()
                        action = hit.action
                        if action.startswith("nav_"):
                            new_page = action.replace("nav_", "")
                            if new_page == "chat" and current_page != "chat":
                                # Fresh session every time — clear old chat
                                voice_chat.messages.clear()
                                voice_chat.scroll_offset = 0
                                voice_chat.proactive_diagnosis()
                            current_page = new_page
                            expanded_msg_idx = -1  # close popup on page change
                            expanded_explanation = ""
                            scroll_offset = 0
                        elif action.startswith("confirm_"):
                            pending_dialog = action
                        elif action == "scroll_up":
                            scroll_offset = max(0, scroll_offset - 5)
                        elif action == "scroll_down":
                            scroll_offset += 5
                        elif action.startswith("log_filter_"):
                            log_filter = action.replace("log_filter_", "")
                            scroll_offset = 0
                        elif action.startswith("cmd_"):
                            executor.execute(action)
                        # Chat actions
                        elif action == "chat_scroll_up":
                            voice_chat.scroll_offset += 5
                        elif action == "chat_scroll_down":
                            voice_chat.scroll_offset = max(0, voice_chat.scroll_offset - 5)
                        elif action == "chat_retry":
                            # TRY AGAIN — re-run diagnosis (implies first didn't fix it)
                            voice_chat.proactive_diagnosis(retry=True)
                        elif action == "chat_dismiss_error":
                            # Persist error as a message so user can see it
                            if voice_chat.state_message:
                                err_msg = ChatMessage(
                                    role="assistant",
                                    text=f"Error: {voice_chat.state_message}",
                                    timestamp=time.strftime("%H:%M"),
                                    severity="critical",
                                )
                                voice_chat.messages.append(err_msg)
                            voice_chat.state = "idle"
                            voice_chat.state_message = ""
                        elif action == "chat_start_voice":
                            # ASK button — start voice recording
                            voice_chat.start_recording()
                        elif action == "chat_stop_recording":
                            # STOP button — end recording and send
                            voice_chat.stop_recording()
                        elif action == "chat_expand":
                            # Show expanded message popup
                            expanded_msg_idx = int(hit.label) if hit.label.isdigit() else -1
                        elif action == "chat_close_expand":
                            expanded_msg_idx = -1

            # Redraw if needed, or if chat state is active (recording/thinking)
            if current_page == "chat" and voice_chat.state in ("recording", "transcribing", "thinking", "loading"):
                needs_redraw = True

            if needs_redraw and fb:
                img, _ = _render_current_page(
                    current_page, sys_status, scroll_offset, voice_chat, log_filter)

                # Expanded message popup (overlays chat page)
                if expanded_msg_idx >= 0 and expanded_msg_idx < len(voice_chat.messages):
                    img, _ = render_expanded_message(
                        voice_chat.messages[expanded_msg_idx], expanded_explanation)

                if pending_dialog:
                    img, _ = render_confirm_dialog(img, pending_dialog)

                if executor.has_feedback:
                    draw = ImageDraw.Draw(img)
                    render_feedback_toast(draw, executor)

                fb.show(img)
                needs_redraw = False

            if executor.has_feedback:
                needs_redraw = True

            time.sleep(1.0 / TOUCH_POLL_HZ)

    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        touch.stop()
        ptt_button.stop()
        if fb:
            fb.close()


def _render_current_page(page: str, sys_status: dict,
                         scroll_offset: int,
                         voice_chat: "VoiceChat" = None,
                         log_filter: str = "all") -> Tuple["Image.Image", List[Button]]:
    """Render the current page and return (image, buttons)."""
    if page == "home":
        return render_home(sys_status)
    elif page == "live":
        return render_live(sys_status)
    elif page == "commands":
        return render_commands(sys_status)
    elif page == "chat" and voice_chat:
        return render_chat(sys_status, voice_chat)
    elif page == "logs":
        return render_logs(sys_status, scroll_offset, log_filter)
    elif page == "system":
        return render_system(sys_status, scroll_offset)
    else:
        return render_home(sys_status)


if __name__ == "__main__":
    main()
