#!/usr/bin/env python3
"""
IronSight Discovery — Find, connect to, and reverse-engineer unknown PLCs.

Thin launcher that delegates to the discovery package.
See scripts/discovery/ for implementation.
"""

import os
import sys

# Ensure the scripts directory is on the path so `discovery` is importable
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from discovery.cli import main

if __name__ == "__main__":
    main()
