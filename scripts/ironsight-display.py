#!/usr/bin/env python3
"""
IronSight Status Display — Shows live system status on a 3.5" touchscreen.

Renders to the Linux framebuffer (/dev/fb0 or /dev/fb1) using Pillow,
or falls back to terminal output if no framebuffer is available.

Displays:
  - Connection status (PLC IP, connected/disconnected)
  - Auto-discovery progress (scanning, found, configuring)
  - Live PLC data summary (DS7 travel, plate drops, speed)
  - System health (viam-server, internet, disk)
  - Error/fault indicators

Screen layout (480x320 or 320x480):
  ┌──────────────────────────────────┐
  │  IRONSIGHT          [status dot] │
  │  truck-dev                       │
  ├──────────────────────────────────┤
  │  PLC: 169.168.10.21  ● ONLINE   │
  │  Travel: 1234.5 ft              │
  │  Speed:  45.2 ft/min            │
  │  Plates: 127  (3.2/min)         │
  ├──────────────────────────────────┤
  │  ■ viam  ■ inet  ■ plc  ■ disk  │
  │  Uptime: 4h 23m                 │
  │  Last discovery: 12:34:05       │
  └──────────────────────────────────┘

Requires: pip3 install Pillow
"""

import json
import mmap
import os
import struct
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional, Tuple

try:
    from PIL import Image, ImageDraw, ImageFont
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

# ─────────────────────────────────────────────────────────────
#  Configuration
# ─────────────────────────────────────────────────────────────

STATUS_FILE = Path("/tmp/ironsight-status.json")
REFRESH_INTERVAL = 2  # seconds between display updates

# Colors (RGB)
BLACK = (0, 0, 0)
WHITE = (255, 255, 255)
GREEN = (0, 200, 80)
RED = (220, 50, 50)
YELLOW = (240, 200, 0)
BLUE = (40, 120, 220)
DARK_GRAY = (30, 30, 35)
MID_GRAY = (60, 60, 70)
LIGHT_GRAY = (180, 180, 190)
ORANGE = (240, 140, 20)

# ─────────────────────────────────────────────────────────────
#  Framebuffer helper
# ─────────────────────────────────────────────────────────────

class Framebuffer:
    """Write PIL Images directly to a Linux framebuffer device."""

    def __init__(self, fb_path: str = "/dev/fb0"):
        self.fb_path = fb_path
        self.width = 0
        self.height = 0
        self.bpp = 0      # bits per pixel
        self.stride = 0    # bytes per line
        self._fb_fd = None
        self._fb_mmap = None
        self._detect()

    def _detect(self):
        """Read framebuffer geometry from sysfs."""
        fb_name = os.path.basename(self.fb_path)
        sysfs = Path(f"/sys/class/graphics/{fb_name}")
        try:
            vsize = (sysfs / "virtual_size").read_text().strip()
            w, h = vsize.split(",")
            self.width = int(w)
            self.height = int(h)
        except Exception:
            # Try fbset
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
                self.bpp = 16  # common default for SPI screens

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
        """Write a PIL Image to the framebuffer."""
        if not self._fb_mmap:
            self.open()

        # Resize if needed
        if image.size != (self.width, self.height):
            image = image.resize((self.width, self.height))

        # Convert to framebuffer pixel format
        if self.bpp == 16:
            # RGB565
            pixels = image.convert("RGB").tobytes()
            fb_data = bytearray(self.width * self.height * 2)
            for i in range(0, len(pixels), 3):
                r, g, b = pixels[i], pixels[i + 1], pixels[i + 2]
                rgb565 = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
                j = (i // 3) * 2
                fb_data[j] = rgb565 & 0xFF
                fb_data[j + 1] = (rgb565 >> 8) & 0xFF
        elif self.bpp == 32:
            # BGRA
            image = image.convert("RGBA")
            pixels = image.tobytes()
            fb_data = bytearray(len(pixels))
            for i in range(0, len(pixels), 4):
                fb_data[i] = pixels[i + 2]      # B
                fb_data[i + 1] = pixels[i + 1]  # G
                fb_data[i + 2] = pixels[i]      # R
                fb_data[i + 3] = pixels[i + 3]  # A
        else:
            # Fallback: try raw RGB
            fb_data = image.convert("RGB").tobytes()

        self._fb_mmap.seek(0)
        self._fb_mmap.write(bytes(fb_data))


# ─────────────────────────────────────────────────────────────
#  Status data collection
# ─────────────────────────────────────────────────────────────

def get_discovery_status() -> dict:
    """Read the auto-discovery status file."""
    try:
        data = json.loads(STATUS_FILE.read_text())
        # Expire old status (>60s old)
        if time.time() - data.get("ts", 0) > 60:
            return {}
        return data
    except Exception:
        return {}


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
        # PLC data
        "connected": False,
        "travel_ft": 0.0,
        "speed_ftpm": 0.0,
        "plate_count": 0,
        "plates_per_min": 0.0,
        "system_state": "unknown",
        "ds7": 0,
    }

    # viam-server status
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

    # Disk usage
    try:
        r = subprocess.check_output(["df", "/", "--output=pcent"],
                                     text=True, timeout=5)
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

    # PLC reachability (quick TCP check)
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

    # Try reading last capture data for live values
    try:
        buf_dir = Path.home() / ".viam" / "offline-buffer"
        if buf_dir.exists():
            jsonl_files = sorted(buf_dir.glob("readings_*.jsonl"))
            if jsonl_files:
                last_file = jsonl_files[-1]
                # Read last line
                with open(last_file, "rb") as f:
                    f.seek(0, 2)
                    pos = f.tell()
                    # Read backwards to find last newline
                    buf = b""
                    while pos > 0:
                        pos = max(0, pos - 1024)
                        f.seek(pos)
                        buf = f.read() + buf
                        lines = buf.strip().split(b"\n")
                        if len(lines) >= 2 or pos == 0:
                            break
                    last_line = lines[-1] if lines else b""
                    if last_line:
                        data = json.loads(last_line)
                        status["travel_ft"] = data.get("encoder_distance_ft", 0)
                        status["speed_ftpm"] = data.get("encoder_speed_ftpm", 0)
                        status["plate_count"] = data.get("plate_drop_count", 0)
                        status["plates_per_min"] = data.get("plates_per_minute", 0)
                        status["system_state"] = data.get("system_state", "unknown")
                        status["ds7"] = data.get("ds7", 0)
                        status["connected"] = data.get("connected", False)
    except Exception:
        pass

    return status


# ─────────────────────────────────────────────────────────────
#  Rendering
# ─────────────────────────────────────────────────────────────

def find_font(size: int):
    """Find a usable font, falling back to default."""
    font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            return ImageFont.truetype(fp, size)
    return ImageFont.load_default()


def render_frame(width: int, height: int) -> "Image.Image":
    """Render a single frame of the IronSight status display."""
    # Landscape or portrait — adapt layout
    landscape = width >= height
    img = Image.new("RGB", (width, height), DARK_GRAY)
    draw = ImageDraw.Draw(img)

    # Scale fonts based on screen size
    scale = min(width, height) / 320
    font_title = find_font(int(20 * scale))
    font_large = find_font(int(16 * scale))
    font_med = find_font(int(13 * scale))
    font_small = find_font(int(10 * scale))

    sys_status = get_system_status()
    disc_status = get_discovery_status()

    y = int(8 * scale)
    margin = int(10 * scale)
    row_h = int(22 * scale)

    # ── Header ──
    draw.text((margin, y), "IRONSIGHT", fill=BLUE, font=font_title)

    # Status dot (top right)
    dot_r = int(8 * scale)
    dot_x = width - margin - dot_r * 2
    dot_color = GREEN if sys_status["connected"] else RED
    draw.ellipse([dot_x, y + 4, dot_x + dot_r * 2, y + 4 + dot_r * 2], fill=dot_color)

    # Truck ID
    truck_text = sys_status["truck_id"]
    truck_w = draw.textlength(truck_text, font=font_small)
    draw.text((dot_x - truck_w - int(8 * scale), y + int(4 * scale)),
              truck_text, fill=LIGHT_GRAY, font=font_small)

    y += int(30 * scale)

    # ── Divider ──
    draw.line([(margin, y), (width - margin, y)], fill=MID_GRAY, width=1)
    y += int(8 * scale)

    # ── Discovery status (if active) ──
    if disc_status:
        phase = disc_status.get("phase", "")
        msg = disc_status.get("message", "")
        progress = disc_status.get("progress", 0)
        success = disc_status.get("success")

        if success is True:
            bar_color = GREEN
            text_color = GREEN
        elif success is False:
            bar_color = RED
            text_color = RED
        else:
            bar_color = YELLOW
            text_color = YELLOW

        draw.text((margin, y), "DISCOVERY", fill=text_color, font=font_med)
        y += row_h

        # Progress bar
        bar_w = width - margin * 2
        bar_h = int(8 * scale)
        draw.rectangle([margin, y, margin + bar_w, y + bar_h], outline=MID_GRAY)
        fill_w = int(bar_w * progress / 100)
        if fill_w > 0:
            draw.rectangle([margin, y, margin + fill_w, y + bar_h], fill=bar_color)
        y += bar_h + int(4 * scale)

        # Message (truncate to fit)
        max_chars = int(width / (7 * scale))
        display_msg = msg[:max_chars]
        draw.text((margin, y), display_msg, fill=LIGHT_GRAY, font=font_small)
        y += row_h

        draw.line([(margin, y), (width - margin, y)], fill=MID_GRAY, width=1)
        y += int(8 * scale)

    # ── PLC Status ──
    plc_ip = sys_status["plc_ip"]
    connected = sys_status["connected"]
    conn_text = "ONLINE" if connected else "OFFLINE"
    conn_color = GREEN if connected else RED

    draw.text((margin, y), f"PLC: {plc_ip}", fill=WHITE, font=font_large)
    # Status badge
    badge_w = draw.textlength(conn_text, font=font_med) + int(12 * scale)
    badge_x = width - margin - badge_w
    draw.rounded_rectangle(
        [badge_x, y, badge_x + badge_w, y + row_h - int(4 * scale)],
        radius=int(4 * scale), fill=conn_color
    )
    draw.text((badge_x + int(6 * scale), y + int(2 * scale)),
              conn_text, fill=WHITE, font=font_med)
    y += row_h + int(4 * scale)

    # ── Live data ──
    data_rows = [
        ("Travel", f"{sys_status['travel_ft']:.1f} ft"),
        ("Speed", f"{sys_status['speed_ftpm']:.1f} ft/min"),
        ("Plates", f"{sys_status['plate_count']}  ({sys_status['plates_per_min']:.1f}/min)"),
        ("State", sys_status["system_state"]),
    ]

    for label, value in data_rows:
        draw.text((margin, y), f"{label}:", fill=LIGHT_GRAY, font=font_med)
        draw.text((margin + int(80 * scale), y), value, fill=WHITE, font=font_med)
        y += row_h

    y += int(4 * scale)
    draw.line([(margin, y), (width - margin, y)], fill=MID_GRAY, width=1)
    y += int(8 * scale)

    # ── Health indicators ──
    indicators = [
        ("viam", sys_status["viam_server"]),
        ("inet", sys_status["internet"]),
        ("plc", sys_status["plc_reachable"]),
        ("disk", sys_status["disk_pct"] < 90),
    ]

    indicator_w = (width - margin * 2) // len(indicators)
    for i, (label, ok) in enumerate(indicators):
        x = margin + i * indicator_w
        color = GREEN if ok else RED
        # Square indicator
        sq_size = int(10 * scale)
        draw.rectangle([x, y, x + sq_size, y + sq_size], fill=color)
        draw.text((x + sq_size + int(4 * scale), y), label,
                  fill=LIGHT_GRAY, font=font_small)

    y += row_h

    # ── Footer ──
    draw.text((margin, y), f"Uptime: {sys_status['uptime']}", fill=LIGHT_GRAY, font=font_small)
    now_str = time.strftime("%H:%M:%S")
    time_w = draw.textlength(now_str, font=font_small)
    draw.text((width - margin - time_w, y), now_str, fill=LIGHT_GRAY, font=font_small)

    return img


def render_terminal(width: int = 50):
    """Fallback: render status to terminal."""
    sys_status = get_system_status()
    disc_status = get_discovery_status()

    os.system("clear" if os.name == "posix" else "cls")

    print("=" * width)
    print("  IRONSIGHT — TPS Monitor".center(width))
    print(f"  {sys_status['truck_id']}".center(width))
    print("=" * width)

    # Discovery status
    if disc_status:
        phase = disc_status.get("phase", "")
        msg = disc_status.get("message", "")
        progress = disc_status.get("progress", 0)
        bar_len = width - 4
        filled = int(bar_len * progress / 100)
        bar = "█" * filled + "░" * (bar_len - filled)
        print(f"\n  DISCOVERY: {phase}")
        print(f"  [{bar}] {progress}%")
        print(f"  {msg}")
        print()

    # PLC status
    conn = "● ONLINE" if sys_status["connected"] else "○ OFFLINE"
    conn_color = "\033[92m" if sys_status["connected"] else "\033[91m"
    reset = "\033[0m"
    print(f"  PLC: {sys_status['plc_ip']}  {conn_color}{conn}{reset}")
    print(f"  Travel:  {sys_status['travel_ft']:.1f} ft")
    print(f"  Speed:   {sys_status['speed_ftpm']:.1f} ft/min")
    print(f"  Plates:  {sys_status['plate_count']}  ({sys_status['plates_per_min']:.1f}/min)")
    print(f"  State:   {sys_status['system_state']}")

    print("\n" + "-" * width)

    # Health
    def dot(ok):
        return f"\033[92m■\033[0m" if ok else f"\033[91m■\033[0m"

    print(f"  {dot(sys_status['viam_server'])} viam  "
          f"{dot(sys_status['internet'])} inet  "
          f"{dot(sys_status['plc_reachable'])} plc  "
          f"{dot(sys_status['disk_pct'] < 90)} disk ({sys_status['disk_pct']}%)")

    print(f"\n  Uptime: {sys_status['uptime']}    {time.strftime('%H:%M:%S')}")
    print("=" * width)


# ─────────────────────────────────────────────────────────────
#  Main loop
# ─────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="IronSight Status Display")
    parser.add_argument("--fb", default="/dev/fb0",
                        help="Framebuffer device (default: /dev/fb0)")
    parser.add_argument("--terminal", action="store_true",
                        help="Force terminal output (no framebuffer)")
    parser.add_argument("--once", action="store_true",
                        help="Render once and exit")
    args = parser.parse_args()

    use_fb = False
    fb = None

    if not args.terminal and HAS_PILLOW:
        # Try to find a working framebuffer
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
        print("Install with: pip3 install Pillow")

    try:
        while True:
            if use_fb:
                img = render_frame(fb.width, fb.height)
                fb.show(img)
            else:
                render_terminal()

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
