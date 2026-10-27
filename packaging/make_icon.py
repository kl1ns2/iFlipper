"""Render packaging/iflipper.ico from the in-code icon (run before PyInstaller)."""

from pathlib import Path

from iflipper.icon import save_ico

save_ico(str(Path(__file__).with_name("iflipper.ico")))
