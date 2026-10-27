"""Desktop app (`iflipper gui`, and what iFlipper.exe opens).

Starts the local backend and shows the desk UI in a native window (WebView2 on
Windows). The window pops to the front when a Flipper gets plugged in. If no
web view is available, the UI opens in the default browser instead.
"""

from __future__ import annotations

import logging
import sys
import threading
import time
import traceback
import webbrowser

from .server import CONFIG, Backend

log = logging.getLogger("iflipper")


def setup_logging() -> None:
    CONFIG.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(filename=CONFIG / "iflipper.log", level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")


def fatal(msg: str) -> None:
    log.error(msg)
    if sys.platform == "win32":
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, msg, "iFlipper", 0x10)
    else:
        print(msg, file=sys.stderr)


def bring_to_front(window) -> None:
    try:
        window.restore()
        window.on_top = True
        time.sleep(0.4)
        window.on_top = False
    except Exception:  # a minimised or closing window must never take the app down
        log.exception("bring_to_front")


def run_window(backend: Backend) -> bool:
    """Show the UI in a native web view; False if none is available."""
    try:
        import webview
    except ImportError:
        return False
    webview.settings["ALLOW_DOWNLOADS"] = True
    window = webview.create_window("iFlipper", backend.url, width=480, height=940, min_size=(380, 620),
                                   background_color="#0e0f12")
    backend.on_connected = lambda: threading.Thread(target=bring_to_front, args=(window,), daemon=True).start()
    try:
        webview.start(gui="edgechromium" if sys.platform == "win32" else None)
    except Exception:
        log.exception("web view failed")
        return False
    return True


def main(target: str | None = None) -> None:
    setup_logging()
    try:
        backend = Backend(target)
        backend.start()
        log.info("backend on %s", backend.url.split("?")[0])
        if not run_window(backend):
            log.info("no web view, opening the browser")
            webbrowser.open(backend.url)
            try:
                while True:
                    time.sleep(3600)
            except KeyboardInterrupt:
                pass
        backend.stop()
    except Exception:
        fatal("iFlipper не смог запуститься:\n\n" + traceback.format_exc(limit=4)
              + f"\nПодробности в {CONFIG / 'iflipper.log'}")
