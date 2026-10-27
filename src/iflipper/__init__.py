"""iFlipper — a fast, scriptable companion for Flipper Zero."""

from .device import Flipper, FlipperError
from .transport import find_flippers

__version__ = "0.1.0"
__all__ = ["Flipper", "FlipperError", "find_flippers", "__version__"]
