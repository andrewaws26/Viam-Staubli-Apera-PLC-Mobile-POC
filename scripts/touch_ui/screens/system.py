"""
SYSTEM screen — scrollable health dashboard with full component status.
"""

import subprocess
import time
from typing import List, Tuple

from PIL import Image, ImageDraw

from lib.plc_constants import (
    WHITE, GREEN, RED, YELLOW, CYAN,
    LIGHT_GRAY, MID_GRAY, DARK_GRAY,
    OFFLINE_BUFFER_DIR, CAPTURE_BASE_DIR,
)
from touch_ui.constants import W, H, MARGIN, HEADER_H, BACK_BTN_H
from touch_ui.widgets.button import Button, draw_button
from touch_ui.widgets.common import find_font, draw_status_bar, draw_alert_bar, back_button


def _get_service_statuses(sys_status: dict) -> list:
    """Build the full list of health rows for the system page.

    Each entry: (label, ok_bool, detail_str)
    """
    rows: list = []

    # -- Core services --
    rows.append(("viam-server", sys_status["viam_server"],
                 "active" if sys_status["viam_server"] else "STOPPED"))

    rows.append(("PLC", sys_status["plc_reachable"], sys_status["plc_ip"]))

    # plc-sensor module
    plc_sensor_ok = False
    try:
        r = subprocess.run(["pgrep", "-f", "plc_sensor"],
                           capture_output=True, timeout=3)
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
                 sys_status.get("eth0_ip", "") or (
                     "linked" if sys_status["eth0_carrier"] else "NO CARRIER")))

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
    capture_ok = False
    capture_detail = "no data"
    try:
        capture_dir = CAPTURE_BASE_DIR
        if capture_dir.exists():
            prog_files = list(capture_dir.rglob("*.prog"))
            if prog_files:
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
                rows.append(("Offline Buf", True,
                             f"{len(jsonl_files)} files, {total_kb}KB"))
    except Exception:
        pass

    # Discovery daemon
    disc_ok = False
    try:
        r = subprocess.run(["pgrep", "-f", "ironsight-discovery"],
                           capture_output=True, timeout=3)
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
    rows: list = []
    connected = sys_status.get("connected", False)
    tps_on = sys_status.get("tps_power_loop", False)

    # Encoder
    speed = sys_status.get("speed_ftpm", 0.0)
    direction = sys_status.get("encoder_direction", "forward")
    if not connected:
        rows.append(("Encoder", False, "no PLC"))
    elif speed > 0.5:
        dir_arrow = "\u25bc REV" if direction == "reverse" else "\u25b2 FWD"
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
        sp_detail = f'last {last_sp:.1f}"'
        if avg_sp > 0:
            sp_detail += f'  avg {avg_sp:.1f}"'
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


def render_system(
    sys_status: dict,
    scroll_offset: int = 0,
) -> Tuple[Image.Image, List[Button]]:
    """SYSTEM -- scrollable health dashboard with full component status."""
    img = Image.new("RGB", (W, H), DARK_GRAY)
    draw = ImageDraw.Draw(img)
    draw_status_bar(draw, sys_status)

    font = find_font(13)
    font_sm = find_font(12)

    y_top = HEADER_H
    y_top = draw_alert_bar(draw, sys_status, y_top)
    y_top += 4

    # Build all content rows
    all_rows: list = []

    # -- Service/connection status --
    all_rows.append(("section", "COMPUTER SYSTEMS"))
    for label, ok, detail in _get_service_statuses(sys_status):
        all_rows.append(("status", label, ok, detail))

    all_rows.append(("divider",))

    # -- Truck equipment status --
    all_rows.append(("section", "TRUCK EQUIPMENT"))
    for label, ok, detail in _get_truck_statuses(sys_status):
        all_rows.append(("status", label, ok, detail))

    # Individual diagnostics
    diags = [d for d in sys_status.get("diagnostics", []) if isinstance(d, dict)]
    if diags:
        all_rows.append(("divider",))
        all_rows.append(("section", "ACTIVE ALERTS"))
        for d in diags:
            sev = d.get("severity", "info")
            title = d.get("title", "unknown")
            cat = d.get("category", "")
            sev_tag = ("CRIT" if sev == "critical"
                       else "WARN" if sev == "warning" else "INFO")
            all_rows.append(("alert", title, sev, f"[{sev_tag}] {cat}"))

    all_rows.append(("divider",))

    # -- Resource gauges --
    gauges = [
        ("CPU", sys_status["cpu_temp"],
         f"{sys_status['cpu_temp'] * 9/5 + 32:.0f}F",
         GREEN if sys_status["cpu_temp"] < 70
         else YELLOW if sys_status["cpu_temp"] < 80 else RED),
        ("MEM", sys_status["mem_pct"], f"{sys_status['mem_pct']}%",
         GREEN if sys_status["mem_pct"] < 70
         else YELLOW if sys_status["mem_pct"] < 85 else RED),
        ("DISK", sys_status["disk_pct"], f"{sys_status['disk_pct']}%",
         GREEN if sys_status["disk_pct"] < 80
         else YELLOW if sys_status["disk_pct"] < 90 else RED),
    ]
    bat = sys_status.get("battery", {})
    if bat.get("available"):
        pct = bat.get("percent", 0)
        charging = bat.get("charging", False)
        v = bat.get("voltage", 0)
        bat_label = f"{pct:.0f}% {v:.2f}V" + (" CHG" if charging else "")
        bat_color = (CYAN if charging
                     else GREEN if pct > 30
                     else YELLOW if pct > 15 else RED)
        gauges.append(("BAT", pct, bat_label, bat_color))
    for g in gauges:
        all_rows.append(("gauge",) + g)

    all_rows.append(("divider",))

    # -- Info rows --
    uptime = sys_status["uptime"]
    truck = sys_status["truck_id"]
    all_rows.append(("info", f"Uptime: {uptime}   Truck: {truck}"))

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
        elif row[0] in ("status", "alert"):
            row_heights.append(20)
        elif row[0] == "gauge":
            row_heights.append(30)
        elif row[0] == "divider":
            row_heights.append(10)
        elif row[0] == "info":
            row_heights.append(18)
        else:
            row_heights.append(20)

    content_h = H - y_top - BACK_BTN_H - 15
    total_content_h = sum(row_heights)
    needs_scroll = total_content_h > content_h

    max_scroll = max(0, len(all_rows) - 1)
    scroll_offset = min(scroll_offset, max_scroll)

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
            sev_color = (RED if severity == "critical"
                         else YELLOW if severity == "warning" else LIGHT_GRAY)
            sq = 8
            draw.rectangle([MARGIN, y + 4, MARGIN + sq, y + 4 + sq], fill=sev_color)
            max_title_w = W - MARGIN * 2 - sq - 10
            disp_title = title
            while (draw.textlength(disp_title, font=font_sm) > max_title_w
                   and len(disp_title) > 10):
                disp_title = disp_title[:-2] + "\u2026"
            draw.text((MARGIN + sq + 6, y), disp_title, fill=sev_color, font=font_sm)
            y += row_heights[i]

        elif row[0] == "gauge":
            _, label, value, text, color = row
            draw.text((MARGIN, y), label, fill=LIGHT_GRAY, font=font_sm)
            gy = y + 14
            bar_h = 10
            draw.rectangle([MARGIN, gy, MARGIN + bar_w, gy + bar_h], fill=MID_GRAY)
            fill_pct = min(100, max(0,
                                    value if isinstance(value, (int, float)) else 0))
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

    buttons: List[Button] = []

    # Scroll buttons
    if needs_scroll:
        scroll_btn_w = 120
        scroll_btn_h = 50

        if scroll_offset > 0:
            up_btn = Button(
                W - scroll_btn_w - MARGIN, y_top,
                scroll_btn_w, scroll_btn_h,
                "UP", "scroll_up", color=(50, 50, 60)
            )
            buttons.append(up_btn)
            draw_button(draw, up_btn, find_font(14))

        if y > H - BACK_BTN_H - 15:
            dn_btn = Button(
                W - scroll_btn_w - MARGIN,
                H - BACK_BTN_H - scroll_btn_h - 15,
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
