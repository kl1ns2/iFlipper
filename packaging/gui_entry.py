"""PyInstaller entry point for iFlipper.exe (windowed)."""

import sys

from iflipper.gui import main

main(sys.argv[1] if len(sys.argv) > 1 else None)
