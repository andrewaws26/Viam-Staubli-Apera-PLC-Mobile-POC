"""
PROVISION screen — PLC configuration profile selection.
"""

import glob
import json
import os
from typing import List, Tuple

from PIL import Image, ImageDraw

from lib.plc_constants import (
    WHITE, GREEN, RED, YELLOW,
    LIGHT_GRAY, MID_GRAY, DARK_GRAY,
    DARK_GREEN, DARK_BLUE, DARK_ORANGE, DARK_PURPLE, DARK_CYAN,
)
from touch_ui.constants import W, H, MARGIN, HEADER_H, BACK_BTN_H
from touch_ui.widgets.button import Button, draw_button
from touch_ui.widgets.common import find_font, draw_status_bar, draw_alert_bar, back_button


def render_provision(
    sys_status: dict,
    executor: object = None,
) -> Tuple[Image.Image, List[Button]]:
    """PROVISION -- PLC configuration profile selection."""
    img = Image.new("RGB", (W, H), DARK_GRAY)
    draw = ImageDraw.Draw(img)
    draw_status_bar(draw, sys_status)

    font = find_font(16)
    font_sm = find_font(12)
    font_title = find_font(14)

    y = HEADER_H
    y = draw_alert_bar(draw, sys_status, y)
    y += 4
    draw.text((MARGIN, y), "PLC PROVISION", fill=LIGHT_GRAY, font=font_title)
    y += 22

    # Show provision progress if running
    if (executor and hasattr(executor, "provision_steps")
            and executor.provision_steps):
        steps = executor.provision_steps
        done = getattr(executor, "provision_done", False)
        profile_name = getattr(executor, "provision_profile", "")

        draw.text((MARGIN, y), profile_name, fill=WHITE, font=font)
        y += 20

        # Progress bar
        total = len(steps)
        completed = sum(1 for s in steps if s["status"] in ("ok", "error"))
        pct = completed / total if total > 0 else 0
        bar_w = W - MARGIN * 2
        draw.rectangle([MARGIN, y, MARGIN + bar_w, y + 12], outline=MID_GRAY)
        bar_color = GREEN if all(
            s["status"] == "ok" for s in steps if s["status"] != "writing"
        ) else YELLOW
        if any(s["status"] == "error" for s in steps):
            bar_color = RED
        draw.rectangle([MARGIN + 1, y + 1,
                        MARGIN + 1 + int(bar_w * pct), y + 11], fill=bar_color)
        draw.text((MARGIN + bar_w + 4, y - 2),
                  f"{int(pct*100)}%", fill=LIGHT_GRAY, font=font_sm)
        y += 18

        # Show steps
        visible_h = H - y - BACK_BTN_H - 15
        lines_visible = visible_h // 14
        for step in steps[-lines_visible:]:
            icon = ("." if step["status"] == "writing"
                    else "+" if step["status"] == "ok" else "X")
            color = (GREEN if step["status"] == "ok"
                     else RED if step["status"] == "error" else YELLOW)
            verified = step.get("verified")
            if verified is True:
                icon = "V"
            elif verified is False:
                icon = "!"
                color = RED
            detail = step.get("detail", "")
            label = step.get("label", "")
            draw.text((MARGIN, y), f"{icon} {label[:25]}",
                      fill=color, font=font_sm)
            if detail:
                draw.text((W - MARGIN - 80, y), detail[:12],
                          fill=MID_GRAY, font=font_sm)
            y += 14

        buttons: List[Button] = []
        back = back_button()
        draw_button(draw, back, font)
        buttons.append(back)
        return img, buttons

    # Normal state: show profile buttons
    profile_dir = (
        "/home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC/config/plc-profiles"
    )
    profiles: list = []
    for f_path in sorted(glob.glob(os.path.join(profile_dir, "*.json"))):
        try:
            with open(f_path) as fh:
                p = json.load(fh)
            profiles.append((
                p.get("name", "?"),
                os.path.basename(f_path),
                p.get("description", "")[:40],
            ))
        except Exception:
            pass

    buttons: List[Button] = []
    btn_w = W - MARGIN * 2
    back_top = H - BACK_BTN_H - 5
    available_h = back_top - y - 10
    gap = 6
    btn_h = min(48, (available_h - gap * (len(profiles) + 1))
                // max(len(profiles) + 1, 1))

    # Read Current Config button
    btn = Button(MARGIN, y, btn_w, btn_h,
                 "Read Current Config", "cmd_provision_read", color=DARK_CYAN)
    buttons.append(btn)
    draw_button(draw, btn, font)
    y += btn_h + gap

    colors = [DARK_GREEN, DARK_BLUE, DARK_ORANGE, DARK_PURPLE]
    for i, (name, filename, desc) in enumerate(profiles):
        color = colors[i % len(colors)]
        action = f"confirm_cmd_provision_{filename}"
        btn = Button(MARGIN, y, btn_w, btn_h, name, action, color=color)
        buttons.append(btn)
        draw_button(draw, btn, font)
        y += btn_h + gap

    back = back_button()
    draw_button(draw, back, font)
    buttons.append(back)

    return img, buttons
