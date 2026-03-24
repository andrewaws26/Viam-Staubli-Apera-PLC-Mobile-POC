"""
Linux framebuffer writer for IronSight displays.

Writes PIL Images directly to /dev/fb0 (or other framebuffer device).
Supports 16-bit RGB565 and 32-bit RGBA, with numpy acceleration.

Usage:
    from lib.framebuffer import Framebuffer

    fb = Framebuffer("/dev/fb0")
    if fb.is_available():
        fb.open()
        fb.show(pil_image)
        fb.close()
"""

import mmap
import os
import subprocess
from pathlib import Path


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

    def show(self, image):
        """Write a PIL Image to the framebuffer."""
        if not self._fb_mmap:
            self.open()
        if image.size != (self.width, self.height):
            image = image.resize((self.width, self.height))
        if self.bpp == 16:
            self._write_rgb565(image)
        elif self.bpp == 32:
            self._write_rgba(image)
        else:
            fb_data = image.convert("RGB").tobytes()
            self._fb_mmap.seek(0)
            self._fb_mmap.write(fb_data)

    def _write_rgb565(self, image):
        """Convert RGB to RGB565 — uses numpy if available for speed."""
        pixels = image.convert("RGB").tobytes()
        try:
            import numpy as np
            arr = np.frombuffer(pixels, dtype=np.uint8).reshape(-1, 3)
            r = arr[:, 0].astype(np.uint16)
            g = arr[:, 1].astype(np.uint16)
            b = arr[:, 2].astype(np.uint16)
            rgb565 = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
            fb_data = rgb565.astype(np.uint16).tobytes()
        except ImportError:
            fb_data = bytearray(self.width * self.height * 2)
            for i in range(0, len(pixels), 3):
                r, g, b = pixels[i], pixels[i + 1], pixels[i + 2]
                rgb565 = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
                j = (i // 3) * 2
                fb_data[j] = rgb565 & 0xFF
                fb_data[j + 1] = (rgb565 >> 8) & 0xFF
        self._fb_mmap.seek(0)
        self._fb_mmap.write(bytes(fb_data) if isinstance(fb_data, bytearray) else fb_data)

    def _write_rgba(self, image):
        """Convert RGBA to BGRA for 32-bit framebuffer."""
        pixels = image.convert("RGBA").tobytes()
        try:
            import numpy as np
            arr = np.frombuffer(pixels, dtype=np.uint8).reshape(-1, 4).copy()
            arr[:, [0, 2]] = arr[:, [2, 0]]
            fb_data = arr.tobytes()
        except ImportError:
            fb_data = bytearray(len(pixels))
            for i in range(0, len(pixels), 4):
                fb_data[i] = pixels[i + 2]
                fb_data[i + 1] = pixels[i + 1]
                fb_data[i + 2] = pixels[i]
                fb_data[i + 3] = pixels[i + 3]
        self._fb_mmap.seek(0)
        self._fb_mmap.write(bytes(fb_data) if isinstance(fb_data, bytearray) else fb_data)
