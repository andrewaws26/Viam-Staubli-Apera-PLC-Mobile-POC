"""
CHAT / DIAGNOSE screen — AI voice chat interface.
"""

import time
from typing import List, Tuple, TYPE_CHECKING

from PIL import Image, ImageDraw

from lib.plc_constants import (
    BLACK, WHITE, GREEN, RED, YELLOW, CYAN, PURPLE,
    LIGHT_GRAY, MID_GRAY, DARK_GRAY,
    DARK_RED,
)
from lib.voice_chat import ChatMessage
from touch_ui.constants import W, H, MARGIN
from touch_ui.widgets.button import Button, draw_button
from touch_ui.widgets.common import find_font

if TYPE_CHECKING:
    from lib.voice_chat import VoiceChat


def render_expanded_message(msg: ChatMessage) -> Tuple[Image.Image, List[Button]]:
    """Full-screen popup showing an AI message in larger text.

    Tap anywhere to close.
    """
    img = Image.new("RGB", (W, H), (20, 20, 25))
    draw = ImageDraw.Draw(img)
    buttons: List[Button] = []

    font_title = find_font(16)
    font_body = find_font(18)
    font_close = find_font(18)

    # Header bar
    draw.rectangle([0, 0, W, 30], fill=(30, 30, 40))
    draw.text((MARGIN, 6), "AI RESPONSE", fill=PURPLE, font=font_title)

    # Close button (X)
    draw.text((W - 30, 3), "X", fill=WHITE, font=font_close)
    close_btn = Button(W - 50, 0, 50, 36, "", "chat_close_expand")
    buttons.append(close_btn)

    # Text color by severity
    if msg.severity == "critical":
        text_color = RED
    elif msg.severity == "warning":
        text_color = YELLOW
    else:
        text_color = GREEN

    # Word-wrap and draw
    y = 40
    max_chars = 32
    line_h = 24
    max_y = H - 24
    words = msg.text.split()
    line = ""
    for word in words:
        test = (line + " " + word).strip()
        if len(test) > max_chars:
            if line and y < max_y:
                draw.text((MARGIN, y), line, fill=text_color, font=font_body)
            y += line_h
            line = word
        else:
            line = test
    if line and y < max_y:
        draw.text((MARGIN, y), line, fill=text_color, font=font_body)

    # Timestamp
    draw.text((MARGIN, H - 22), msg.timestamp, fill=MID_GRAY, font=find_font(11))

    return img, buttons


def render_chat(
    sys_status: dict,
    voice_chat: "VoiceChat",
) -> Tuple[Image.Image, List[Button]]:
    """DIAGNOSE / AI Chat page.

    No alert banner. Landing menu lets user choose Talk to AI.
    """
    img = Image.new("RGB", (W, H), DARK_GRAY)
    draw = ImageDraw.Draw(img)

    font = find_font(14)
    font_sm = find_font(12)
    font_btn = find_font(14)

    buttons: List[Button] = []
    state = voice_chat.state
    messages = voice_chat.messages

    # -- Slim top bar: recording indicator only --
    status_h = 24
    if state == "recording":
        draw.rectangle([0, 0, W, status_h], fill=DARK_RED)
        draw.text((MARGIN, 4), "RECORDING -- tap STOP to send",
                  fill=RED, font=font_sm)
        dot_color = RED if int(time.time() * 2) % 2 == 0 else DARK_RED
        draw.ellipse([W - 22, 6, W - 12, 16], fill=dot_color)
    else:
        draw.rectangle([0, 0, W, status_h], fill=(15, 15, 20))
        draw.text((MARGIN, 4), "IRONSIGHT AI", fill=PURPLE, font=font_sm)
        if state == "error":
            err_text = voice_chat.state_message
            ew = draw.textlength(err_text, font=find_font(10))
            draw.text((W - ew - MARGIN, 6), err_text, fill=RED, font=find_font(10))

    # -- Bottom button bar --
    if state == "recording":
        btn_bar_h = 70
        btn_y = H - btn_bar_h
        draw.rectangle([0, btn_y, W, H], fill=(20, 20, 25))
        stop_btn = Button(MARGIN, btn_y + 4, W - MARGIN * 2, 62,
                          "STOP", "chat_stop_recording",
                          color=DARK_RED, text_color=WHITE)
        buttons.append(stop_btn)
        draw_button(draw, stop_btn, find_font(20))
    else:
        btn_bar_h = 54
        btn_y = H - btn_bar_h
        draw.rectangle([0, btn_y, W, H], fill=(20, 20, 25))

        if not messages and state == "idle":
            talk_btn = Button(MARGIN, btn_y + 4, W - MARGIN * 2, 46,
                              "TALK TO AI", "chat_start_voice",
                              color=DARK_RED, text_color=WHITE)
            buttons.append(talk_btn)
            draw_button(draw, talk_btn, font_btn)
        else:
            btn_w = (W - MARGIN * 3) // 2
            back_btn = Button(MARGIN, btn_y + 4, btn_w, 46,
                              "BACK", "nav_home",
                              color=MID_GRAY, text_color=WHITE)
            buttons.append(back_btn)
            draw_button(draw, back_btn, font_btn)

            ask_btn = Button(MARGIN * 2 + btn_w, btn_y + 4, btn_w, 46,
                             "ASK", "chat_start_voice",
                             color=DARK_RED, text_color=WHITE)
            buttons.append(ask_btn)
            draw_button(draw, ask_btn, font_btn)

    # -- Scroll buttons (right edge) --
    scroll_btn_w = 90
    scroll_guard = 30
    scroll_btn_h = (btn_y - status_h - 6 - scroll_guard) // 2
    scroll_top_y = status_h + 2
    scroll_mid_y = scroll_top_y + scroll_btn_h + 2

    # UP button
    draw.rectangle([W - scroll_btn_w, scroll_top_y,
                    W, scroll_top_y + scroll_btn_h], fill=(50, 50, 60))
    up_label = find_font(26)
    draw.text((W - scroll_btn_w // 2 - 10,
               scroll_top_y + scroll_btn_h // 2 - 15),
              "UP", fill=WHITE, font=up_label)
    up_btn = Button(W - scroll_btn_w, scroll_top_y,
                    scroll_btn_w, scroll_btn_h, "", "chat_scroll_up")
    buttons.append(up_btn)

    # DOWN button
    draw.rectangle([W - scroll_btn_w, scroll_mid_y,
                    W, scroll_mid_y + scroll_btn_h], fill=(50, 50, 60))
    draw.text((W - scroll_btn_w // 2 - 14,
               scroll_mid_y + scroll_btn_h // 2 - 15),
              "DN", fill=WHITE, font=up_label)
    dn_btn = Button(W - scroll_btn_w, scroll_mid_y,
                    scroll_btn_w, scroll_btn_h, "", "chat_scroll_down")
    buttons.append(dn_btn)

    # -- Chat area --
    chat_top = status_h + 2
    chat_bottom = btn_y - 2
    chat_h = chat_bottom - chat_top
    line_h = 20
    max_chars = 44

    # Landing screen
    if not messages and state not in ("thinking", "loading", "transcribing"):
        y = chat_top + 30
        title = "IRONSIGHT AI"
        tw = draw.textlength(title, font=find_font(20))
        draw.text(((W - tw) // 2, y), title, fill=PURPLE, font=find_font(20))
        y += 45
        hints = [
            "Tap TALK TO AI to start.",
            "",
            "Ask questions, get advice,",
            "and follow up naturally.",
        ]
        for line in hints:
            if line:
                lw = draw.textlength(line, font=font)
                draw.text(((W - lw) // 2, y), line, fill=MID_GRAY, font=font)
            y += 22
        return img, buttons

    # Word-wrap messages into display lines
    display_lines: list = []
    for msg_idx, msg in enumerate(messages):
        prefix = "You: " if msg.role == "user" else ""
        if msg.role == "user":
            color = CYAN
        elif msg.severity == "critical":
            color = RED
        elif msg.severity == "warning":
            color = YELLOW
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

    # Visible window with scroll
    visible_lines = chat_h // line_h
    total_lines = len(display_lines)
    start = max(0, total_lines - visible_lines - voice_chat.scroll_offset)
    end = start + visible_lines
    visible = display_lines[start:end]

    # Draw messages
    y = chat_top
    for text, color, msg_idx in visible:
        if text:
            draw.text((MARGIN, y), text, fill=color, font=font)
        y += line_h

    return img, buttons
