#!/usr/bin/env python3
"""
IronSight Touch Command Display — launcher.

Delegates to the touch_ui package for all UI rendering and event handling.
See touch_ui/ for the full implementation.
"""

import sys
from pathlib import Path

# Add scripts/ to path so lib/ and touch_ui/ imports work from any directory
sys.path.insert(0, str(Path(__file__).resolve().parent))

from touch_ui import main

if __name__ == "__main__":
    main()
