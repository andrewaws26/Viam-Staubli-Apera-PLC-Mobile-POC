"""
Main application class and event loop for the IronSight touch display.
"""

import argparse
import os
import sys
import time
from typing import List, Tuple

from PIL import Image, ImageDraw

from lib.framebuffer import Framebuffer
from lib.touch_input import TouchInput, PTTButton
from lib.system_status import get_system_status
from lib.command_executor import CommandExecutor
from lib.voice_chat import VoiceChat, ChatMessage

import touch_ui.constants as const
from touch_ui.widgets.button import Button, find_hit
from touch_ui.widgets.common import (
    beep,
    render_feedback_toast,
    render_confirm_dialog,
)
from touch_ui.screens.home import render_home
from touch_ui.screens.live import render_live
from touch_ui.screens.commands import render_commands
from touch_ui.screens.logs import render_logs
from touch_ui.screens.system import render_system
from touch_ui.screens.chat import render_chat, render_expanded_message
from touch_ui.screens.provision import render_provision
from touch_ui.screens.calibration import run_calibration


def _render_current_page(
    page: str,
    sys_status: dict,
    scroll_offset: int,
    voice_chat: VoiceChat = None,
    log_filter: str = "all",
) -> Tuple[Image.Image, List[Button]]:
    """Render the current page and return (image, buttons)."""
    if page == "home":
        return render_home(sys_status)
    elif page == "live":
        return render_live(sys_status)
    elif page == "commands":
        return render_commands(sys_status)
    elif page == "provision":
        return render_provision(sys_status)
    elif page == "chat" and voice_chat:
        return render_chat(sys_status, voice_chat)
    elif page == "logs":
        return render_logs(sys_status, scroll_offset, log_filter)
    elif page == "system":
        return render_system(sys_status, scroll_offset)
    else:
        return render_home(sys_status)


def _handle_action(
    action: str,
    state: dict,
    voice_chat: VoiceChat,
    executor: CommandExecutor,
) -> None:
    """Process a button action and mutate app state accordingly."""
    now = time.time()

    if action.startswith("nav_"):
        new_page = action.replace("nav_", "")
        if new_page == "chat" and state["current_page"] != "chat":
            voice_chat.scroll_offset = 0
            if voice_chat.state == "error":
                voice_chat.state = "idle"
                voice_chat.state_message = ""
        state["current_page"] = new_page
        state["last_page_change"] = now
        state["expanded_msg_idx"] = -1
        state["scroll_offset"] = 0

    elif action.startswith("confirm_"):
        state["pending_dialog"] = action

    elif action in ("scroll_up", "scroll_down"):
        pass  # handled by hold-to-scroll

    elif action.startswith("log_filter_"):
        state["log_filter"] = action.replace("log_filter_", "")
        state["scroll_offset"] = 0

    elif action.startswith("cmd_"):
        executor.execute(action)

    elif action in ("chat_scroll_up", "chat_scroll_down"):
        pass  # handled by hold-to-scroll

    elif action == "chat_dismiss_error":
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
        if now - state["last_scroll_time"] > 0.4:
            voice_chat.start_recording()

    elif action == "chat_stop_recording":
        voice_chat.stop_recording()

    elif action == "chat_expand":
        # Not used currently — kept for future
        pass

    elif action == "chat_close_expand":
        state["expanded_msg_idx"] = -1


def _handle_scroll_hold(
    state: dict,
    voice_chat: VoiceChat,
    cached_buttons: List[Button],
    touch: TouchInput,
) -> bool:
    """Process hold-to-scroll on scroll buttons. Returns True if redraw needed."""
    now = time.time()
    _SCROLL_ACTIONS = frozenset((
        "chat_scroll_up", "chat_scroll_down", "scroll_up", "scroll_down"
    ))

    if not touch.is_touching():
        state["last_scroll_action"] = ""
        return False

    pos = touch.touch_position()
    if not pos or not cached_buttons:
        state["last_scroll_action"] = ""
        return False

    held_hit = find_hit(cached_buttons, pos[0], pos[1])
    if not held_hit or held_hit.action not in _SCROLL_ACTIONS:
        state["last_scroll_action"] = ""
        return False

    if held_hit.action != state["last_scroll_action"]:
        state["last_scroll_action"] = held_hit.action
        state["last_scroll_time"] = 0  # force immediate

    elapsed_ms = (now - state["last_scroll_time"]) * 1000
    if elapsed_ms < const.SCROLL_REPEAT_MS:
        return False

    if state["last_scroll_action"] == "chat_scroll_up":
        voice_chat.scroll_offset += 3
    elif state["last_scroll_action"] == "chat_scroll_down":
        voice_chat.scroll_offset = max(0, voice_chat.scroll_offset - 3)
    elif state["last_scroll_action"] == "scroll_up":
        state["scroll_offset"] = max(0, state["scroll_offset"] - 3)
    elif state["last_scroll_action"] == "scroll_down":
        state["scroll_offset"] += 3

    state["last_scroll_time"] = now
    return True


def main() -> None:
    """Entry point for the IronSight Touch Command Display."""
    parser = argparse.ArgumentParser(
        description="IronSight Touch Command Display"
    )
    parser.add_argument("--fb", default="/dev/fb0",
                        help="Framebuffer device")
    parser.add_argument("--calibrate", action="store_true",
                        help="Run touch calibration")
    parser.add_argument("--no-touch", action="store_true",
                        help="Disable touch (display only)")
    parser.add_argument("--terminal", action="store_true",
                        help="Terminal mode (no framebuffer)")
    args = parser.parse_args()

    try:
        from PIL import Image as _img_check  # noqa: F401
    except ImportError:
        print("ERROR: Pillow is required. Install: pip3 install Pillow")
        sys.exit(1)

    # Set up framebuffer
    fb = None
    for fb_path in [args.fb, "/dev/fb1", "/dev/fb0"]:
        if os.path.exists(fb_path):
            fb = Framebuffer(fb_path)
            if fb.is_available():
                print(f"Framebuffer: {fb_path} "
                      f"({fb.width}x{fb.height} @ {fb.bpp}bpp)")
                fb.open()
                break
            fb = None

    if not fb and not args.terminal:
        print("No framebuffer available. Use --terminal for terminal mode.")
        sys.exit(1)

    # Adjust global dimensions to match actual framebuffer
    if fb:
        const.W = fb.width
        const.H = fb.height

    # Set up touch input
    touch = TouchInput(screen_w=const.W, screen_h=const.H)
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

    # Set up PTT button
    ptt_button = PTTButton()
    ptt_button.start()

    # App state
    state = {
        "current_page": "home",
        "pending_dialog": None,
        "scroll_offset": 0,
        "log_filter": "all",
        "expanded_msg_idx": -1,
        "last_scroll_action": "",
        "last_scroll_time": 0.0,
        "last_page_change": 0.0,
        "error_start_time": 0.0,
    }
    sys_status: dict = {}
    last_data_refresh = 0.0
    needs_redraw = True
    cached_buttons: List[Button] = []

    print("IronSight Touch Display started")
    print(f"Touch: {'enabled' if not args.no_touch and touch.device else 'disabled'}")
    print(f"PTT button: "
          f"{ptt_button.device.name if ptt_button.device else 'not found (use touchscreen)'}")
    print("Whisper: handled by lib.voice_chat")
    print("Claude: via CLI")

    try:
        _event_loop(
            fb, touch, ptt_button, executor, voice_chat,
            state, sys_status, last_data_refresh, needs_redraw, cached_buttons,
        )
    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        touch.stop()
        ptt_button.stop()
        if fb:
            fb.close()


def _event_loop(
    fb, touch, ptt_button, executor, voice_chat,
    state, sys_status, last_data_refresh, needs_redraw, cached_buttons,
) -> None:
    """Main event loop — polls touch, PTT, data refresh, and redraws."""
    while True:
        now = time.time()

        # Refresh data periodically
        if now - last_data_refresh > const.DATA_REFRESH_INTERVAL:
            sys_status.clear()
            sys_status.update(get_system_status())
            last_data_refresh = now
            needs_redraw = True

        # Poll USB PTT button
        if ptt_button.get_pressed():
            if state["current_page"] != "chat":
                state["current_page"] = "chat"
                state["scroll_offset"] = 0
            voice_chat.start_recording()
            needs_redraw = True
        if ptt_button.get_released() and voice_chat.state == "recording":
            voice_chat.stop_recording()
            needs_redraw = True

        # Drain double-tap queue
        touch.get_double_tap()

        # Auto-clear error state after 5 seconds
        if voice_chat.state == "error":
            if state["error_start_time"] == 0:
                state["error_start_time"] = now
            elif now - state["error_start_time"] > 5.0:
                voice_chat.state = "idle"
                voice_chat.state_message = ""
                state["error_start_time"] = 0
                needs_redraw = True
        else:
            state["error_start_time"] = 0

        # Poll for swipe
        swipe = touch.get_swipe()
        if swipe and state["current_page"] in ("logs", "system"):
            if swipe > 0:
                state["scroll_offset"] += 3
            else:
                state["scroll_offset"] = max(0, state["scroll_offset"] - 3)
            needs_redraw = True
        elif swipe and state["current_page"] == "chat":
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

            if state["expanded_msg_idx"] >= 0:
                exp_idx = state["expanded_msg_idx"]
                exp_msg = (voice_chat.messages[exp_idx]
                           if exp_idx < len(voice_chat.messages) else None)
                if exp_msg:
                    _, exp_buttons = render_expanded_message(exp_msg)
                    find_hit(exp_buttons, tx, ty)
                    beep()
                state["expanded_msg_idx"] = -1

            elif state["pending_dialog"]:
                base_img, _ = _render_current_page(
                    state["current_page"], sys_status,
                    state["scroll_offset"], voice_chat, state["log_filter"])
                _, dialog_buttons = render_confirm_dialog(
                    base_img, state["pending_dialog"])
                hit = find_hit(dialog_buttons, tx, ty)
                if hit:
                    beep()
                    if hit.action == "dialog_cancel":
                        state["pending_dialog"] = None
                    elif hit.action.startswith("do_"):
                        real_action = hit.action.replace("do_", "")
                        executor.execute(real_action)
                        state["pending_dialog"] = None
            else:
                hit = find_hit(cached_buttons, tx, ty)
                # Guard: block taps for 300ms after page navigation
                if (hit
                        and (now - state["last_page_change"]) < 0.3
                        and not hit.action.startswith("nav_")):
                    touch._log("blocked", {
                        "action": hit.action,
                        "reason": "page_change_guard",
                        "page": state["current_page"],
                        "tap": [tx, ty],
                    })
                    hit = None
                if hit:
                    touch._log("hit", {
                        "action": hit.action, "label": hit.label,
                        "page": state["current_page"],
                        "btn": [hit.x, hit.y, hit.w, hit.h],
                        "tap": [tx, ty],
                    })
                    beep()
                    _handle_action(
                        hit.action, state, voice_chat, executor)

        # Hold-to-scroll
        if _handle_scroll_hold(state, voice_chat, cached_buttons, touch):
            needs_redraw = True

        # Redraw if chat is active
        if (state["current_page"] == "chat"
                and voice_chat.state in (
                    "recording", "transcribing", "thinking", "loading")):
            needs_redraw = True

        if needs_redraw and fb:
            img, cached_buttons = _render_current_page(
                state["current_page"], sys_status,
                state["scroll_offset"], voice_chat, state["log_filter"])

            # Expanded message popup
            exp_idx = state["expanded_msg_idx"]
            if 0 <= exp_idx < len(voice_chat.messages):
                img, _ = render_expanded_message(
                    voice_chat.messages[exp_idx])

            if state["pending_dialog"]:
                img, _ = render_confirm_dialog(img, state["pending_dialog"])

            if executor.has_feedback:
                draw = ImageDraw.Draw(img)
                render_feedback_toast(draw, executor)

            fb.show(img)
            needs_redraw = False

        if executor.has_feedback:
            needs_redraw = True

        time.sleep(1.0 / const.TOUCH_POLL_HZ)
