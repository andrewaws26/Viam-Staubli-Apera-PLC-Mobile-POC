#!/usr/bin/env python3
"""
IronSight Status Display — Multi-page live dashboard for 3.5" touchscreen.

Pages auto-rotate every 5 seconds (or tap to advance on touchscreen):
  Page 1: LIVE — PLC connection, travel, speed, plates, spacing
  Page 2: ACTIVITY — Scrolling log of what IronSight is doing
  Page 3: HEALTH — System health, disk, network, services
  Page 4: REGISTERS — Live DS register values (when connected)

Renders to Linux framebuffer via Pillow, or falls back to terminal.

Requires: pip3 install Pillow
"""

import json
import mmap
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

try:
    from PIL import Image, ImageDraw, ImageFont
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

# ─────────────────────────────────────────────────────────────
#  Configuration
# ─────────────────────────────────────────────────────────────

STATUS_FILE = Path("/tmp/ironsight-status.json")
HISTORY_FILE = Path("/tmp/ironsight-history.json")
REFRESH_INTERVAL = 2       # seconds between display updates
PAGE_ROTATE_INTERVAL = 8   # seconds per page before auto-advancing
NUM_PAGES = 4

# Colors (RGB)
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
GREEN = (0, 200, 80)
RED = (220, 50, 50)
YELLOW = (240, 200, 0)
BLUE = (40, 120, 220)
CYAN = (0, 180, 220)
DARK_GRAY = (30, 30, 35)
MID_GRAY = (60, 60, 70)
LIGHT_GRAY = (180, 180, 190)
ORANGE = (240, 140, 20)
DARK_GREEN = (0, 80, 40)
DARK_RED = (80, 20, 20)

LEVEL_COLORS = {
    "info": LIGHT_GRAY,
    "success": GREEN,
    "warning": YELLOW,
    "error": RED,
}

COMPONENT_COLORS = {
    "watchdog": ORANGE,
    "discovery": CYAN,
    "claude": YELLOW,
    "plc": GREEN,
    "system": BLUE,
    "display": LIGHT_GRAY,
}

# ─────────────────────────────────────────────────────────────
#  Framebuffer helper
# ─────────────────────────────────────────────────────────────

class Framebuffer:
    """Write PIL Images directly to a Linux framebuffer device."""

    def __init__(self, fb_path: str = "/dev/fb0"):
        self.fb_path = fb_path
        self.width = 0
        self.height = 0
        self.bpp = 0
        self.stride = 0
        self._fb_fd = None
        self._fb_mmap = None
        self._detect()

    def _detect(self):
        fb_name = os.path.basename(self.fb_path)
        sysfs = Path(f"/sys/class/graphics/{fb_name}")
        try:
            vsize = (sysfs / "virtual_size").read_text().strip()
            w, h = vsize.split(",")
            self.width = int(w)
            self.height = int(h)
        except Exception:
            try:
                out = subprocess.check_output(
                    ["fbset", "-fb", self.fb_path, "-s"],
                    text=True, timeout=5
                )
                for line in out.splitlines():
                    if "geometry" in line:
                        parts = line.split()
                        self.width = int(parts[1])
                        self.height = int(parts[2])
                        self.bpp = int(parts[5])
            except Exception:
                pass

        try:
            self.bpp = int((sysfs / "bits_per_pixel").read_text().strip())
        except Exception:
            if self.bpp == 0:
                self.bpp = 16

        try:
            self.stride = int((sysfs / "stride").read_text().strip())
        except Exception:
            self.stride = self.width * (self.bpp // 8)

    def is_available(self) -> bool:
        return self.width > 0 and self.height > 0 and os.path.exists(self.fb_path)

    def open(self):
        self._fb_fd = os.open(self.fb_path, os.O_RDWR)
        fb_size = self.stride * self.height
        self._fb_mmap = mmap.mmap(self._fb_fd, fb_size)

    def close(self):
        if self._fb_mmap:
            self._fb_mmap.close()
        if self._fb_fd is not None:
            os.close(self._fb_fd)

    def show(self, image: "Image.Image"):
        if not self._fb_mmap:
            self.open()
        if image.size != (self.width, self.height):
            image = image.resize((self.width, self.height))
        if self.bpp == 16:
            pixels = image.convert("RGB").tobytes()
            fb_data = bytearray(self.width * self.height * 2)
            for i in range(0, len(pixels), 3):
                r, g, b = pixels[i], pixels[i + 1], pixels[i + 2]
                rgb565 = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
                j = (i // 3) * 2
                fb_data[j] = rgb565 & 0xFF
                fb_data[j + 1] = (rgb565 >> 8) & 0xFF
        elif self.bpp == 32:
            image = image.convert("RGBA")
            pixels = image.tobytes()
            fb_data = bytearray(len(pixels))
            for i in range(0, len(pixels), 4):
                fb_data[i] = pixels[i + 2]
                fb_data[i + 1] = pixels[i + 1]
                fb_data[i + 2] = pixels[i]
                fb_data[i + 3] = pixels[i + 3]
        else:
            fb_data = image.convert("RGB").tobytes()
        self._fb_mmap.seek(0)
        self._fb_mmap.write(bytes(fb_data))


# ─────────────────────────────────────────────────────────────
#  Data sources
# ─────────────────────────────────────────────────────────────

def get_component_status() -> dict:
    """Read status from all IronSight components."""
    try:
        data = json.loads(STATUS_FILE.read_text())
        return data.get("components", {})
    except Exception:
        return {}


def get_activity_history() -> list:
    """Read the activity log."""
    try:
        return json.loads(HISTORY_FILE.read_text())
    except Exception:
        return []


def get_system_status() -> dict:
    """Gather live system health."""
    status = {
        "viam_server": False,
        "plc_reachable": False,
        "plc_ip": "unknown",
        "internet": False,
        "disk_pct": 0,
        "uptime": "",
        "truck_id": "unknown",
        "connected": False,
        "travel_ft": 0.0,
        "speed_ftpm": 0.0,
        "plate_count": 0,
        "plates_per_min": 0.0,
        "system_state": "unknown",
        "last_spacing_in": 0.0,
        "avg_spacing_in": 0.0,
        "ds_registers": {},
        "eth0_carrier": False,
        "wifi_ssid": "",
        "cpu_temp": 0.0,
        "mem_pct": 0,
    }

    # viam-server
    try:
        r = subprocess.run(["systemctl", "is-active", "viam-server"],
                          capture_output=True, text=True, timeout=5)
        status["viam_server"] = r.stdout.strip() == "active"
    except Exception:
        pass

    # Internet
    try:
        r = subprocess.run(["ping", "-c", "1", "-W", "2", "8.8.8.8"],
                          capture_output=True, timeout=5)
        status["internet"] = r.returncode == 0
    except Exception:
        pass

    # Disk
    try:
        r = subprocess.check_output(["df", "/", "--output=pcent"], text=True, timeout=5)
        for line in r.strip().splitlines():
            line = line.strip()
            if line.endswith("%"):
                status["disk_pct"] = int(line.rstrip("%"))
    except Exception:
        pass

    # Uptime
    try:
        up = float(Path("/proc/uptime").read_text().split()[0])
        hours = int(up // 3600)
        mins = int((up % 3600) // 60)
        status["uptime"] = f"{hours}h {mins}m"
    except Exception:
        status["uptime"] = "?"

    # eth0 carrier
    try:
        status["eth0_carrier"] = Path("/sys/class/net/eth0/carrier").read_text().strip() == "1"
    except Exception:
        pass

    # WiFi SSID
    try:
        r = subprocess.check_output(["iwgetid", "-r"], text=True, timeout=5)
        status["wifi_ssid"] = r.strip()
    except Exception:
        pass

    # CPU temp
    try:
        temp = float(Path("/sys/class/thermal/thermal_zone0/temp").read_text().strip())
        status["cpu_temp"] = temp / 1000.0
    except Exception:
        pass

    # Memory
    try:
        mem = Path("/proc/meminfo").read_text()
        total = avail = 0
        for line in mem.splitlines():
            if line.startswith("MemTotal:"):
                total = int(line.split()[1])
            elif line.startswith("MemAvailable:"):
                avail = int(line.split()[1])
        if total > 0:
            status["mem_pct"] = int(100 * (total - avail) / total)
    except Exception:
        pass

    # PLC config
    try:
        config_path = Path(__file__).resolve().parent.parent / "config" / "viam-server.json"
        config = json.loads(config_path.read_text())
        for comp in config.get("components", []):
            if comp.get("name") == "plc-monitor":
                status["plc_ip"] = comp["attributes"]["host"]
                status["truck_id"] = comp["attributes"].get("truck_id", "unknown")
    except Exception:
        pass

    # PLC reachability
    try:
        import socket
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        result = sock.connect_ex((status["plc_ip"], 502))
        sock.close()
        status["plc_reachable"] = result == 0
        status["connected"] = result == 0
    except Exception:
        pass

    # Latest reading from offline buffer
    try:
        buf_dir = Path.home() / ".viam" / "offline-buffer"
        if buf_dir.exists():
            jsonl_files = sorted(buf_dir.glob("readings_*.jsonl"))
            if jsonl_files:
                with open(jsonl_files[-1], "rb") as f:
                    f.seek(0, 2)
                    pos = f.tell()
                    buf = b""
                    while pos > 0:
                        pos = max(0, pos - 1024)
                        f.seek(pos)
                        buf = f.read() + buf
                        lines = buf.strip().split(b"\n")
                        if len(lines) >= 2 or pos == 0:
                            break
                    if lines:
                        data = json.loads(lines[-1])
                        status["travel_ft"] = data.get("encoder_distance_ft", 0)
                        status["speed_ftpm"] = data.get("encoder_speed_ftpm", 0)
                        status["plate_count"] = data.get("plate_drop_count", 0)
                        status["plates_per_min"] = data.get("plates_per_minute", 0)
                        status["system_state"] = data.get("system_state", "unknown")
                        status["last_spacing_in"] = data.get("last_drop_spacing_in", 0)
                        status["avg_spacing_in"] = data.get("avg_drop_spacing_in", 0)
                        status["connected"] = data.get("connected", False)
                        # Grab all DS registers
                        for i in range(1, 26):
                            key = f"ds{i}"
                            if key in data:
                                status["ds_registers"][key] = data[key]
    except Exception:
        pass

    return status


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


# ─────────────────────────────────────────────────────────────
#  Page renderers (Pillow)
# ─────────────────────────────────────────────────────────────

def _draw_header(draw, width, scale, page_num, page_name, status_color):
    """Draw the common header bar across all pages."""
    margin = int(10 * scale)
    bar_h = int(28 * scale)
    font_title = find_font(int(16 * scale))
    font_small = find_font(int(9 * scale))

    # Header background
    draw.rectangle([0, 0, width, bar_h], fill=(20, 20, 25))

    # IRONSIGHT brand
    draw.text((margin, int(5 * scale)), "IRONSIGHT", fill=BLUE, font=font_title)

    # Page name
    page_w = draw.textlength(page_name, font=font_small)
    center_x = (width - page_w) / 2
    draw.text((center_x, int(9 * scale)), page_name, fill=LIGHT_GRAY, font=font_small)

    # Status dot
    dot_r = int(6 * scale)
    dot_x = width - margin - dot_r * 2
    draw.ellipse([dot_x, int(8 * scale), dot_x + dot_r * 2, int(8 * scale) + dot_r * 2],
                 fill=status_color)

    # Page dots (bottom-right of header)
    for i in range(NUM_PAGES):
        dx = width - margin - (NUM_PAGES - i) * int(12 * scale)
        dy = bar_h - int(8 * scale)
        r = int(2 * scale)
        color = WHITE if i == page_num else MID_GRAY
        draw.ellipse([dx - r, dy - r, dx + r, dy + r], fill=color)

    return bar_h + int(4 * scale)


def render_page_live(width: int, height: int, sys_status: dict) -> "Image.Image":
    """Page 1: Live PLC data."""
    scale = min(width, height) / 320
    img = Image.new("RGB", (width, height), DARK_GRAY)
    draw = ImageDraw.Draw(img)
    margin = int(10 * scale)
    row_h = int(20 * scale)
    font_large = find_font(int(15 * scale))
    font_med = find_font(int(12 * scale))
    font_small = find_font(int(10 * scale))
    font_big = find_font(int(22 * scale))

    status_color = GREEN if sys_status["connected"] else RED
    y = _draw_header(draw, width, scale, 0, "LIVE", status_color)

    # PLC connection bar
    plc_ip = sys_status["plc_ip"]
    connected = sys_status["connected"]
    bar_color = DARK_GREEN if connected else DARK_RED
    conn_text = "ONLINE" if connected else "OFFLINE"
    draw.rectangle([0, y, width, y + int(22 * scale)], fill=bar_color)
    draw.text((margin, y + int(3 * scale)), f"PLC {plc_ip}", fill=WHITE, font=font_med)
    cw = draw.textlength(conn_text, font=font_med)
    draw.text((width - margin - cw, y + int(3 * scale)), conn_text, fill=WHITE, font=font_med)
    y += int(26 * scale)

    # Big travel number
    travel_str = f"{sys_status['travel_ft']:.1f} ft"
    draw.text((margin, y), "TRAVEL", fill=LIGHT_GRAY, font=font_small)
    y += int(14 * scale)
    draw.text((margin, y), travel_str, fill=WHITE, font=font_big)
    y += int(28 * scale)

    # Speed + Plates side by side
    mid = width // 2
    draw.text((margin, y), "SPEED", fill=LIGHT_GRAY, font=font_small)
    draw.text((mid, y), "PLATES", fill=LIGHT_GRAY, font=font_small)
    y += int(14 * scale)
    draw.text((margin, y), f"{sys_status['speed_ftpm']:.1f} ft/m", fill=WHITE, font=font_large)
    draw.text((mid, y), f"{sys_status['plate_count']}", fill=WHITE, font=font_large)
    rate_text = f"({sys_status['plates_per_min']:.1f}/min)"
    rate_w = draw.textlength(rate_text, font=font_small)
    plates_w = draw.textlength(str(sys_status['plate_count']), font=font_large)
    draw.text((mid + plates_w + int(4 * scale), y + int(4 * scale)),
              rate_text, fill=LIGHT_GRAY, font=font_small)
    y += int(22 * scale)

    # Spacing
    y += int(4 * scale)
    draw.line([(margin, y), (width - margin, y)], fill=MID_GRAY, width=1)
    y += int(6 * scale)

    draw.text((margin, y), "SPACING", fill=LIGHT_GRAY, font=font_small)
    y += int(14 * scale)
    last_sp = sys_status["last_spacing_in"]
    avg_sp = sys_status["avg_spacing_in"]
    # Color-code spacing: green if close to 19.5", yellow if drifting, red if way off
    sp_color = GREEN if abs(last_sp - 19.5) < 2 else (YELLOW if abs(last_sp - 19.5) < 5 else RED)
    if last_sp == 0:
        sp_color = LIGHT_GRAY
    draw.text((margin, y), f"Last: {last_sp:.1f}\"", fill=sp_color, font=font_large)
    draw.text((mid, y), f"Avg: {avg_sp:.1f}\"", fill=WHITE, font=font_large)
    y += int(22 * scale)

    # State
    state = sys_status["system_state"]
    state_color = GREEN if state == "running" else YELLOW
    draw.text((margin, y), f"State: {state}", fill=state_color, font=font_med)

    # Health bar at bottom
    _draw_health_bar(draw, width, height, scale, sys_status)

    return img


def render_page_activity(width: int, height: int, sys_status: dict) -> "Image.Image":
    """Page 2: Activity log — what IronSight is doing."""
    scale = min(width, height) / 320
    img = Image.new("RGB", (width, height), DARK_GRAY)
    draw = ImageDraw.Draw(img)
    margin = int(10 * scale)
    row_h = int(16 * scale)
    font_small = find_font(int(9 * scale))
    font_med = find_font(int(11 * scale))

    status_color = GREEN if sys_status["connected"] else RED
    y = _draw_header(draw, width, scale, 1, "ACTIVITY", status_color)

    # Component status summary
    components = get_component_status()
    for comp_name, comp_data in components.items():
        phase = comp_data.get("phase", "?")
        msg = comp_data.get("message", "")
        level = comp_data.get("level", "info")

        comp_color = COMPONENT_COLORS.get(comp_name, LIGHT_GRAY)
        text_color = LEVEL_COLORS.get(level, LIGHT_GRAY)

        # Component name badge
        badge_text = comp_name[:8].upper()
        badge_w = draw.textlength(badge_text, font=font_small) + int(6 * scale)
        draw.rounded_rectangle(
            [margin, y, margin + badge_w, y + row_h - 2],
            radius=int(3 * scale), fill=comp_color
        )
        draw.text((margin + int(3 * scale), y + 1), badge_text, fill=BLACK, font=font_small)

        # Message
        max_chars = int((width - margin * 2 - badge_w - 10) / (6 * scale))
        display_msg = msg[:max_chars] if len(msg) > max_chars else msg
        draw.text((margin + badge_w + int(6 * scale), y + 1),
                  display_msg, fill=text_color, font=font_small)

        # Progress bar if present
        progress = comp_data.get("progress", -1)
        if progress >= 0:
            y += row_h
            bar_w = width - margin * 2
            bar_h = int(4 * scale)
            draw.rectangle([margin, y, margin + bar_w, y + bar_h], outline=MID_GRAY)
            fill_w = int(bar_w * progress / 100)
            if fill_w > 0:
                draw.rectangle([margin, y, margin + fill_w, y + bar_h], fill=comp_color)
            y += bar_h + int(2 * scale)
        else:
            y += row_h + int(2 * scale)

        if y > height - int(80 * scale):
            break

    # Divider
    y += int(4 * scale)
    draw.line([(margin, y), (width - margin, y)], fill=MID_GRAY, width=1)
    y += int(6 * scale)

    # Recent activity log
    draw.text((margin, y), "RECENT EVENTS", fill=LIGHT_GRAY, font=font_small)
    y += int(14 * scale)

    history = get_activity_history()
    # Show most recent events that fit
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

    # Resource gauges
    gauges = [
        ("CPU", sys_status["cpu_temp"], f"{sys_status['cpu_temp']:.0f}°C",
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

        # Gauge bar
        bar_h = int(10 * scale)
        draw.rectangle([margin, y, margin + bar_w, y + bar_h], fill=MID_GRAY)
        fill_pct = min(100, max(0, value if isinstance(value, (int, float)) else 0))
        # For temp, scale 30-90°C to 0-100%
        if label == "CPU":
            fill_pct = min(100, max(0, (value - 30) / 60 * 100))
        fill_w = int(bar_w * fill_pct / 100)
        if fill_w > 0:
            draw.rectangle([margin, y, margin + fill_w, y + bar_h], fill=color)

        tw = draw.textlength(text, font=font_small)
        draw.text((width - margin - tw, y - 1), text, fill=WHITE, font=font_small)
        y += bar_h + int(8 * scale)

    # Uptime + Truck ID
    y += int(4 * scale)
    draw.text((margin, y), f"Uptime: {sys_status['uptime']}", fill=LIGHT_GRAY, font=font_small)
    truck = sys_status["truck_id"]
    tw = draw.textlength(truck, font=font_small)
    draw.text((width - margin - tw, y), truck, fill=LIGHT_GRAY, font=font_small)

    return img


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

    # Known register labels
    known = {
        "ds1": "Enc PPR?",
        "ds2": "Tie Space",
        "ds5": "Enc Cal?",
        "ds6": "Config",
        "ds7": "Travel",
        "ds8": "Countdown?",
        "ds11": "Config",
    }

    # Layout: 2 columns of registers
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

        # Register name
        name_color = CYAN if label else LIGHT_GRAY
        draw.text((x, cy), f"DS{i:2d}", fill=name_color, font=font_mono)

        # Value — highlight non-zero
        val_str = str(val)
        val_color = WHITE if val != 0 else MID_GRAY
        draw.text((x + int(32 * scale), cy), f"{val:>6d}", fill=val_color, font=font_mono)

        # Label hint
        if label:
            draw.text((x + int(72 * scale), cy), label, fill=CYAN, font=font_small)

        # Advance grid
        col += 1
        if col >= 2:
            col = 0
            row += 1

    return img


def _draw_health_bar(draw, width, height, scale, sys_status):
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

    # Time
    now_str = time.strftime("%H:%M:%S")
    tw = draw.textlength(now_str, font=font_tiny)
    draw.text((width - margin - tw, bar_y + int(4 * scale)), now_str, fill=LIGHT_GRAY, font=font_tiny)


# ─────────────────────────────────────────────────────────────
#  Terminal fallback (multi-page)
# ─────────────────────────────────────────────────────────────

def render_terminal(page: int, width: int = 55):
    """Render status to terminal with color."""
    sys_status = get_system_status()
    os.system("clear" if os.name == "posix" else "cls")

    R = "\033[0m"  # reset
    G = "\033[92m"  # green
    Rd = "\033[91m"  # red
    Y = "\033[93m"  # yellow
    B = "\033[94m"  # blue
    C = "\033[96m"  # cyan
    W = "\033[97m"  # white
    D = "\033[90m"  # dim

    def dot(ok):
        return f"{G}■{R}" if ok else f"{Rd}■{R}"

    page_names = ["LIVE", "ACTIVITY", "HEALTH", "REGISTERS"]
    dots = "".join(f" {W}●{R}" if i == page else f" {D}○{R}" for i in range(NUM_PAGES))

    print(f"  {B}IRONSIGHT{R}  {page_names[page]}{dots}    {D}{time.strftime('%H:%M:%S')}{R}")
    print("=" * width)

    if page == 0:  # LIVE
        conn = f"{G}● ONLINE{R}" if sys_status["connected"] else f"{Rd}○ OFFLINE{R}"
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

    elif page == 1:  # ACTIVITY
        components = get_component_status()
        for name, data in components.items():
            comp_c = C
            msg = data.get("message", "")[:40]
            print(f"  {comp_c}{name.upper():8s}{R}  {msg}")
            progress = data.get("progress", -1)
            if progress >= 0:
                bar_len = width - 6
                filled = int(bar_len * progress / 100)
                bar = "█" * filled + "░" * (bar_len - filled)
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

    elif page == 2:  # HEALTH
        rows = [
            ("viam-server", sys_status["viam_server"], "active" if sys_status["viam_server"] else "STOPPED"),
            ("PLC", sys_status["plc_reachable"], sys_status["plc_ip"]),
            ("Internet", sys_status["internet"], "connected" if sys_status["internet"] else "OFFLINE"),
            ("Ethernet", sys_status["eth0_carrier"], "linked" if sys_status["eth0_carrier"] else "NO CARRIER"),
            ("WiFi", bool(sys_status["wifi_ssid"]), sys_status["wifi_ssid"] or "disconnected"),
        ]
        for label, ok, detail in rows:
            print(f"  {dot(ok)} {label:12s}  {D}{detail}{R}")

        print(f"\n  CPU:  {sys_status['cpu_temp']:.0f}°C")
        print(f"  MEM:  {sys_status['mem_pct']}%")
        print(f"  DISK: {sys_status['disk_pct']}%")
        print(f"\n  Uptime: {sys_status['uptime']}  Truck: {sys_status['truck_id']}")

    elif page == 3:  # REGISTERS
        ds = sys_status.get("ds_registers", {})
        if not ds:
            print(f"\n  {Rd}No register data — PLC not connected{R}")
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


# ─────────────────────────────────────────────────────────────
#  Main loop
# ─────────────────────────────────────────────────────────────

PAGE_RENDERERS = [render_page_live, render_page_activity, render_page_health, render_page_registers]


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
        print("Pillow not installed — using terminal mode")
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
