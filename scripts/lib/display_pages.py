"""
Individual display pages/screens for IronSight Status Display.

Extracted from ironsight-display.py. Contains:
  - Pillow-rendered page functions (live, activity, health, registers)
  - Terminal fallback renderer
  - Common header and health bar drawing
"""

import os
import time
from typing import Optional

try:
    from PIL import Image, ImageDraw, ImageFont
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

from lib.plc_constants import (
    BLACK, WHITE, GREEN, RED, YELLOW, BLUE, CYAN, ORANGE,
    DARK_GRAY, MID_GRAY, LIGHT_GRAY, DARK_GREEN, DARK_RED,
    LEVEL_COLORS,
)
from lib.system_status import get_system_status, get_activity_history, get_component_status

# ─────────────────────────────────────────────────────────────
#  Configuration
# ─────────────────────────────────────────────────────────────

NUM_PAGES = 4

COMPONENT_COLORS = {
    "watchdog": ORANGE,
    "discovery": CYAN,
    "claude": YELLOW,
    "plc": GREEN,
    "system": BLUE,
    "display": LIGHT_GRAY,
}


# ─────────────────────────────────────────────────────────────
#  Font helper
# ─────────────────────────────────────────────────────────────

_font_cache: dict = {}


def find_font(size: int):
    """Find and cache a TrueType font at the given size."""
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
#  Common drawing helpers
# ─────────────────────────────────────────────────────────────

def _draw_header(draw: "ImageDraw.Draw", width: int, scale: float,
                 page_num: int, page_name: str, status_color: tuple) -> int:
    """Draw the common header bar across all pages. Returns y offset below header."""
    margin = int(10 * scale)
    bar_h = int(28 * scale)
    font_title = find_font(int(16 * scale))
    font_small = find_font(int(9 * scale))

    draw.rectangle([0, 0, width, bar_h], fill=(20, 20, 25))
    draw.text((margin, int(5 * scale)), "IRONSIGHT", fill=BLUE, font=font_title)

    page_w = draw.textlength(page_name, font=font_small)
    center_x = (width - page_w) / 2
    draw.text((center_x, int(9 * scale)), page_name, fill=LIGHT_GRAY, font=font_small)

    dot_r = int(6 * scale)
    dot_x = width - margin - dot_r * 2
    draw.ellipse([dot_x, int(8 * scale), dot_x + dot_r * 2, int(8 * scale) + dot_r * 2],
                 fill=status_color)

    for i in range(NUM_PAGES):
        dx = width - margin - (NUM_PAGES - i) * int(12 * scale)
        dy = bar_h - int(8 * scale)
        r = int(2 * scale)
        color = WHITE if i == page_num else MID_GRAY
        draw.ellipse([dx - r, dy - r, dx + r, dy + r], fill=color)

    return bar_h + int(4 * scale)


def _draw_health_bar(draw: "ImageDraw.Draw", width: int, height: int,
                     scale: float, sys_status: dict) -> None:
    """Draw the health indicator bar at the bottom of any page."""
    margin = int(10 * scale)
    bar_y = height - int(18 * scale)
    font_tiny = find_font(int(8 * scale))

    draw.rectangle([0, bar_y, width, height], fill=(20, 20, 25))

    indicators = [
        ("VIM", sys_status["viam_server"]),
        ("NET", sys_status["internet"]),
        ("PLC", sys_status["plc_reachable"]),
        ("ETH", sys_status["eth0_carrier"]),
        ("DSK", sys_status["disk_pct"] < 90),
    ]

    spacing = (width - margin * 2) // len(indicators)
    for i, (label, ok) in enumerate(indicators):
        x = margin + i * spacing
        color = GREEN if ok else RED
        sq = int(6 * scale)
        draw.rectangle([x, bar_y + int(5 * scale), x + sq, bar_y + int(5 * scale) + sq], fill=color)
        draw.text((x + sq + int(3 * scale), bar_y + int(4 * scale)),
                  label, fill=LIGHT_GRAY, font=font_tiny)

    now_str = time.strftime("%H:%M:%S")
    tw = draw.textlength(now_str, font=font_tiny)
    draw.text((width - margin - tw, bar_y + int(4 * scale)), now_str, fill=LIGHT_GRAY, font=font_tiny)


# ─────────────────────────────────────────────────────────────
#  Page 1: LIVE
# ─────────────────────────────────────────────────────────────

def render_page_live(width: int, height: int, sys_status: dict) -> "Image.Image":
    """Page 1: Live PLC data."""
    scale = min(width, height) / 320
    img = Image.new("RGB", (width, height), DARK_GRAY)
    draw = ImageDraw.Draw(img)
    margin = int(10 * scale)
    font_large = find_font(int(15 * scale))
    font_med = find_font(int(12 * scale))
    font_small = find_font(int(10 * scale))
    font_big = find_font(int(22 * scale))

    status_color = GREEN if sys_status["connected"] else RED
    y = _draw_header(draw, width, scale, 0, "LIVE", status_color)

    plc_ip = sys_status["plc_ip"]
    connected = sys_status["connected"]
    bar_color = DARK_GREEN if connected else DARK_RED
    conn_text = "ONLINE" if connected else "OFFLINE"
    draw.rectangle([0, y, width, y + int(22 * scale)], fill=bar_color)
    draw.text((margin, y + int(3 * scale)), f"PLC {plc_ip}", fill=WHITE, font=font_med)
    cw = draw.textlength(conn_text, font=font_med)
    draw.text((width - margin - cw, y + int(3 * scale)), conn_text, fill=WHITE, font=font_med)
    y += int(26 * scale)

    travel_str = f"{sys_status['travel_ft']:.1f} ft"
    draw.text((margin, y), "TRAVEL", fill=LIGHT_GRAY, font=font_small)
    y += int(14 * scale)
    draw.text((margin, y), travel_str, fill=WHITE, font=font_big)
    y += int(28 * scale)

    mid = width // 2
    draw.text((margin, y), "SPEED", fill=LIGHT_GRAY, font=font_small)
    draw.text((mid, y), "PLATES", fill=LIGHT_GRAY, font=font_small)
    y += int(14 * scale)
    draw.text((margin, y), f"{sys_status['speed_ftpm']:.1f} ft/m", fill=WHITE, font=font_large)
    draw.text((mid, y), f"{sys_status['plate_count']}", fill=WHITE, font=font_large)
    rate_text = f"({sys_status['plates_per_min']:.1f}/min)"
    plates_w = draw.textlength(str(sys_status['plate_count']), font=font_large)
    draw.text((mid + plates_w + int(4 * scale), y + int(4 * scale)),
              rate_text, fill=LIGHT_GRAY, font=font_small)
    y += int(22 * scale)

    y += int(4 * scale)
    draw.line([(margin, y), (width - margin, y)], fill=MID_GRAY, width=1)
    y += int(6 * scale)

    draw.text((margin, y), "SPACING", fill=LIGHT_GRAY, font=font_small)
    y += int(14 * scale)
    last_sp = sys_status["last_spacing_in"]
    avg_sp = sys_status["avg_spacing_in"]
    sp_color = GREEN if abs(last_sp - 19.5) < 2 else (YELLOW if abs(last_sp - 19.5) < 5 else RED)
    if last_sp == 0:
        sp_color = LIGHT_GRAY
    draw.text((margin, y), f"Last: {last_sp:.1f}\"", fill=sp_color, font=font_large)
    draw.text((mid, y), f"Avg: {avg_sp:.1f}\"", fill=WHITE, font=font_large)
    y += int(22 * scale)

    state = sys_status["system_state"]
    state_color = GREEN if state == "running" else YELLOW
    draw.text((margin, y), f"State: {state}", fill=state_color, font=font_med)

    _draw_health_bar(draw, width, height, scale, sys_status)
    return img


# ─────────────────────────────────────────────────────────────
#  Page 2: ACTIVITY
# ─────────────────────────────────────────────────────────────

def render_page_activity(width: int, height: int, sys_status: dict) -> "Image.Image":
    """Page 2: Activity log -- what IronSight is doing."""
    scale = min(width, height) / 320
    img = Image.new("RGB", (width, height), DARK_GRAY)
    draw = ImageDraw.Draw(img)
    margin = int(10 * scale)
    row_h = int(16 * scale)
    font_small = find_font(int(9 * scale))
    font_med = find_font(int(11 * scale))

    status_color = GREEN if sys_status["connected"] else RED
    y = _draw_header(draw, width, scale, 1, "ACTIVITY", status_color)

    components = get_component_status()
    for comp_name, comp_data in components.items():
        phase = comp_data.get("phase", "?")
        msg = comp_data.get("message", "")
        level = comp_data.get("level", "info")

        comp_color = COMPONENT_COLORS.get(comp_name, LIGHT_GRAY)
        text_color = LEVEL_COLORS.get(level, LIGHT_GRAY)

        badge_text = comp_name[:8].upper()
        badge_w = draw.textlength(badge_text, font=font_small) + int(6 * scale)
        draw.rounded_rectangle(
            [margin, y, margin + badge_w, y + row_h - 2],
            radius=int(3 * scale), fill=comp_color
        )
        draw.text((margin + int(3 * scale), y + 1), badge_text, fill=BLACK, font=font_small)

        max_chars = int((width - margin * 2 - badge_w - 10) / (6 * scale))
        display_msg = msg[:max_chars] if len(msg) > max_chars else msg
        draw.text((margin + badge_w + int(6 * scale), y + 1),
                  display_msg, fill=text_color, font=font_small)

        progress = comp_data.get("progress", -1)
        if progress >= 0:
            y += row_h
            bar_w = width - margin * 2
            bar_h_px = int(4 * scale)
            draw.rectangle([margin, y, margin + bar_w, y + bar_h_px], outline=MID_GRAY)
            fill_w = int(bar_w * progress / 100)
            if fill_w > 0:
                draw.rectangle([margin, y, margin + fill_w, y + bar_h_px], fill=comp_color)
            y += bar_h_px + int(2 * scale)
        else:
            y += row_h + int(2 * scale)

        if y > height - int(80 * scale):
            break

    y += int(4 * scale)
    draw.line([(margin, y), (width - margin, y)], fill=MID_GRAY, width=1)
    y += int(6 * scale)

    draw.text((margin, y), "RECENT EVENTS", fill=LIGHT_GRAY, font=font_small)
    y += int(14 * scale)

    history = get_activity_history()
    max_lines = int((height - y - int(30 * scale)) / row_h)
    recent = history[-max_lines:] if len(history) > max_lines else history

    for entry in reversed(recent):
        if y > height - int(30 * scale):
            break
        t = entry.get("time", "??:??")
        comp = entry.get("component", "?")[:6]
        msg = entry.get("message", "")
        level = entry.get("level", "info")

        text_color = LEVEL_COLORS.get(level, LIGHT_GRAY)
        max_chars = int((width - margin * 2 - int(80 * scale)) / (6 * scale))
        display_msg = msg[:max_chars]

        draw.text((margin, y), t, fill=MID_GRAY, font=font_small)
        comp_color = COMPONENT_COLORS.get(comp, LIGHT_GRAY)
        draw.text((margin + int(48 * scale), y), comp[:4], fill=comp_color, font=font_small)
        draw.text((margin + int(76 * scale), y), display_msg, fill=text_color, font=font_small)
        y += row_h

    _draw_health_bar(draw, width, height, scale, sys_status)
    return img


# ─────────────────────────────────────────────────────────────
#  Page 3: HEALTH
# ─────────────────────────────────────────────────────────────

def render_page_health(width: int, height: int, sys_status: dict) -> "Image.Image":
    """Page 3: System health details."""
    scale = min(width, height) / 320
    img = Image.new("RGB", (width, height), DARK_GRAY)
    draw = ImageDraw.Draw(img)
    margin = int(10 * scale)
    row_h = int(20 * scale)
    font_med = find_font(int(12 * scale))
    font_small = find_font(int(10 * scale))

    status_color = GREEN if sys_status["connected"] else RED
    y = _draw_header(draw, width, scale, 2, "HEALTH", status_color)

    health_rows = [
        ("viam-server", sys_status["viam_server"], "active" if sys_status["viam_server"] else "STOPPED"),
        ("PLC", sys_status["plc_reachable"], sys_status["plc_ip"]),
        ("Internet", sys_status["internet"], "connected" if sys_status["internet"] else "OFFLINE"),
        ("Ethernet", sys_status["eth0_carrier"], "linked" if sys_status["eth0_carrier"] else "NO CARRIER"),
        ("WiFi", bool(sys_status["wifi_ssid"]), sys_status["wifi_ssid"] or "disconnected"),
    ]

    for label, ok, detail in health_rows:
        color = GREEN if ok else RED
        sq = int(10 * scale)
        draw.rectangle([margin, y + 3, margin + sq, y + 3 + sq], fill=color)
        draw.text((margin + sq + int(6 * scale), y), label, fill=WHITE, font=font_med)
        dw = draw.textlength(detail, font=font_small)
        draw.text((width - margin - dw, y + int(2 * scale)), detail, fill=LIGHT_GRAY, font=font_small)
        y += row_h

    y += int(8 * scale)
    draw.line([(margin, y), (width - margin, y)], fill=MID_GRAY, width=1)
    y += int(8 * scale)

    gauges = [
        ("CPU", sys_status["cpu_temp"], f"{sys_status['cpu_temp']:.0f}C",
         GREEN if sys_status["cpu_temp"] < 70 else YELLOW if sys_status["cpu_temp"] < 80 else RED),
        ("MEM", sys_status["mem_pct"], f"{sys_status['mem_pct']}%",
         GREEN if sys_status["mem_pct"] < 70 else YELLOW if sys_status["mem_pct"] < 85 else RED),
        ("DISK", sys_status["disk_pct"], f"{sys_status['disk_pct']}%",
         GREEN if sys_status["disk_pct"] < 80 else YELLOW if sys_status["disk_pct"] < 90 else RED),
    ]

    bar_w = width - margin * 2
    for label, value, text, color in gauges:
        draw.text((margin, y), label, fill=LIGHT_GRAY, font=font_small)
        y += int(14 * scale)

        bar_h_px = int(10 * scale)
        draw.rectangle([margin, y, margin + bar_w, y + bar_h_px], fill=MID_GRAY)
        fill_pct = min(100, max(0, value if isinstance(value, (int, float)) else 0))
        if label == "CPU":
            fill_pct = min(100, max(0, (value - 30) / 60 * 100))
        fill_w = int(bar_w * fill_pct / 100)
        if fill_w > 0:
            draw.rectangle([margin, y, margin + fill_w, y + bar_h_px], fill=color)

        tw = draw.textlength(text, font=font_small)
        draw.text((width - margin - tw, y - 1), text, fill=WHITE, font=font_small)
        y += bar_h_px + int(8 * scale)

    y += int(4 * scale)
    draw.text((margin, y), f"Uptime: {sys_status['uptime']}", fill=LIGHT_GRAY, font=font_small)
    truck = sys_status["truck_id"]
    tw = draw.textlength(truck, font=font_small)
    draw.text((width - margin - tw, y), truck, fill=LIGHT_GRAY, font=font_small)

    return img


# ─────────────────────────────────────────────────────────────
#  Page 4: REGISTERS
# ─────────────────────────────────────────────────────────────

def render_page_registers(width: int, height: int, sys_status: dict) -> "Image.Image":
    """Page 4: Live DS register values."""
    scale = min(width, height) / 320
    img = Image.new("RGB", (width, height), DARK_GRAY)
    draw = ImageDraw.Draw(img)
    margin = int(10 * scale)
    font_mono = find_font(int(10 * scale))
    font_small = find_font(int(9 * scale))

    status_color = GREEN if sys_status["connected"] else RED
    y = _draw_header(draw, width, scale, 3, "REGISTERS", status_color)

    ds = sys_status.get("ds_registers", {})

    if not ds:
        draw.text((margin, y + int(20 * scale)), "No register data available",
                  fill=LIGHT_GRAY, font=font_mono)
        draw.text((margin, y + int(40 * scale)), "PLC not connected",
                  fill=RED, font=font_mono)
        return img

    known = {
        "ds1": "Enc PPR?",
        "ds2": "Tie Space",
        "ds5": "Enc Cal?",
        "ds6": "Config",
        "ds7": "Travel",
        "ds8": "Countdown?",
        "ds11": "Config",
    }

    col_w = (width - margin * 2) // 2
    row_h = int(14 * scale)
    col = 0
    row = 0

    for i in range(1, 26):
        key = f"ds{i}"
        val = ds.get(key, 0)
        label = known.get(key, "")

        x = margin + col * col_w
        cy = y + row * row_h

        if cy > height - int(20 * scale):
            break

        name_color = CYAN if label else LIGHT_GRAY
        draw.text((x, cy), f"DS{i:2d}", fill=name_color, font=font_mono)

        val_str = str(val)
        val_color = WHITE if val != 0 else MID_GRAY
        draw.text((x + int(32 * scale), cy), f"{val:>6d}", fill=val_color, font=font_mono)

        if label:
            draw.text((x + int(72 * scale), cy), label, fill=CYAN, font=font_small)

        col += 1
        if col >= 2:
            col = 0
            row += 1

    return img


# ─────────────────────────────────────────────────────────────
#  Terminal fallback renderer
# ─────────────────────────────────────────────────────────────

def render_terminal(page: int, width: int = 55) -> None:
    """Render status to terminal with ANSI color."""
    sys_status = get_system_status()
    os.system("clear" if os.name == "posix" else "cls")

    R = "\033[0m"
    G = "\033[92m"
    Rd = "\033[91m"
    Y = "\033[93m"
    B = "\033[94m"
    C = "\033[96m"
    W = "\033[97m"
    D = "\033[90m"

    def dot(ok: bool) -> str:
        return f"{G}###{R}" if ok else f"{Rd}###{R}"

    page_names = ["LIVE", "ACTIVITY", "HEALTH", "REGISTERS"]
    dots = "".join(f" {W}@{R}" if i == page else f" {D}o{R}" for i in range(NUM_PAGES))

    print(f"  {B}IRONSIGHT{R}  {page_names[page]}{dots}    {D}{time.strftime('%H:%M:%S')}{R}")
    print("=" * width)

    if page == 0:
        conn = f"{G}@ ONLINE{R}" if sys_status["connected"] else f"{Rd}o OFFLINE{R}"
        print(f"  PLC: {sys_status['plc_ip']}  {conn}")
        print(f"\n  {D}TRAVEL{R}")
        print(f"  {W}{sys_status['travel_ft']:.1f} ft{R}")
        print(f"\n  {D}SPEED{R}         {D}PLATES{R}")
        print(f"  {W}{sys_status['speed_ftpm']:.1f} ft/min{R}   {W}{sys_status['plate_count']}{R} ({sys_status['plates_per_min']:.1f}/min)")
        sp = sys_status['last_spacing_in']
        sp_c = G if abs(sp - 19.5) < 2 else (Y if abs(sp - 19.5) < 5 else Rd) if sp > 0 else D
        print(f"\n  {D}SPACING{R}")
        print(f"  Last: {sp_c}{sp:.1f}\"{R}    Avg: {W}{sys_status['avg_spacing_in']:.1f}\"{R}")
        state = sys_status['system_state']
        state_c = G if state == "running" else Y
        print(f"\n  State: {state_c}{state}{R}")

    elif page == 1:
        components = get_component_status()
        for name, data in components.items():
            comp_c = C
            msg = data.get("message", "")[:40]
            print(f"  {comp_c}{name.upper():8s}{R}  {msg}")
            progress = data.get("progress", -1)
            if progress >= 0:
                bar_len = width - 6
                filled = int(bar_len * progress / 100)
                bar = "#" * filled + "-" * (bar_len - filled)
                print(f"  [{bar}] {progress}%")

        print(f"\n  {D}RECENT EVENTS{R}")
        history = get_activity_history()
        for entry in history[-8:]:
            t = entry.get("time", "??:??")
            comp = entry.get("component", "?")[:4]
            msg = entry.get("message", "")[:35]
            level = entry.get("level", "info")
            lc = Rd if level == "error" else Y if level == "warning" else G if level == "success" else D
            print(f"  {D}{t}{R} {C}{comp:4s}{R} {lc}{msg}{R}")

    elif page == 2:
        rows = [
            ("viam-server", sys_status["viam_server"], "active" if sys_status["viam_server"] else "STOPPED"),
            ("PLC", sys_status["plc_reachable"], sys_status["plc_ip"]),
            ("Internet", sys_status["internet"], "connected" if sys_status["internet"] else "OFFLINE"),
            ("Ethernet", sys_status["eth0_carrier"], "linked" if sys_status["eth0_carrier"] else "NO CARRIER"),
            ("WiFi", bool(sys_status["wifi_ssid"]), sys_status["wifi_ssid"] or "disconnected"),
        ]
        for label, ok, detail in rows:
            print(f"  {dot(ok)} {label:12s}  {D}{detail}{R}")

        print(f"\n  CPU:  {sys_status['cpu_temp']:.0f}C")
        print(f"  MEM:  {sys_status['mem_pct']}%")
        print(f"  DISK: {sys_status['disk_pct']}%")
        print(f"\n  Uptime: {sys_status['uptime']}  Truck: {sys_status['truck_id']}")

    elif page == 3:
        ds = sys_status.get("ds_registers", {})
        if not ds:
            print(f"\n  {Rd}No register data -- PLC not connected{R}")
        else:
            known = {"ds1": "Enc PPR?", "ds2": "Tie Spc", "ds5": "Enc Cal?",
                     "ds7": "Travel", "ds8": "Cntdwn?"}
            for i in range(1, 26):
                key = f"ds{i}"
                val = ds.get(key, 0)
                label = known.get(key, "")
                vc = W if val != 0 else D
                lc = C if label else ""
                lr = R if label else ""
                print(f"  DS{i:2d}: {vc}{val:>6d}{R}  {lc}{label}{lr}")

    print("-" * width)
    print(f"  {dot(sys_status['viam_server'])} vim  {dot(sys_status['internet'])} net  "
          f"{dot(sys_status['plc_reachable'])} plc  {dot(sys_status['eth0_carrier'])} eth  "
          f"{dot(sys_status['disk_pct'] < 90)} dsk")


# Page renderers list for use by the main display loop
PAGE_RENDERERS = [render_page_live, render_page_activity, render_page_health, render_page_registers]
