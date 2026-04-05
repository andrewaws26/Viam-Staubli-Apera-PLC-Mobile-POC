"""
Button widget — dataclass, drawing, and hit detection.
"""

from dataclasses import dataclass
from typing import List, Optional, Tuple

from PIL import ImageDraw

from lib.plc_constants import BLACK, WHITE, MID_GRAY, DARK_GRAY


@dataclass
class Button:
    """A tappable rectangular button on the touchscreen."""

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
        """Return True if the point (px, py) is inside the button bounds."""
        return self.x <= px <= self.x + self.w and self.y <= py <= self.y + self.h


def draw_button(draw: ImageDraw.ImageDraw, btn: Button, font, pressed: bool = False) -> None:
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
