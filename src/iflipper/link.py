"""Background connection manager: find → connect → watch → reconnect."""

from __future__ import annotations

import threading
import time
from collections.abc import Callable

from .device import Flipper
from .transport import find_flippers


class Link(threading.Thread):
    """Keeps a Flipper connected and reports what happens through `post(kind, *args)`.

    Events: waiting, connecting(target), connected(snapshot), error(msg), disconnected, power(dict).
    The newest screen frame is in `frame` (and passed to `on_frame`, if given).
    """

    def __init__(self, target: str | None, post: Callable, on_frame: Callable[[bytes], None] | None = None):
        super().__init__(daemon=True)
        self.target, self.post, self.on_frame = target, post, on_frame
        self.f: Flipper | None = None
        self.stopped = threading.Event()
        self.frame: bytes | None = None
        self.snap: dict | None = None

    def run(self) -> None:
        last_power = 0.0
        waiting_sent = False
        while not self.stopped.is_set():
            if self.f is None:
                target = self.target
                if target is None:
                    ports = find_flippers()
                    target = ports[0].device if ports else None
                if target is None:
                    if not waiting_sent:  # only on change: this loop runs every second
                        self.post("waiting")
                        waiting_sent = True
                    self.stopped.wait(1)
                    continue
                waiting_sent = False
                self.post("connecting", target)
                try:
                    f = Flipper.connect(target, timeout=5)
                    self.snap = self.snapshot(f)
                    self.post("connected", self.snap)
                    f.start_screen(self._on_frame)
                    self.f = f
                    last_power = time.monotonic()
                except Exception as e:  # port busy, half-booted device, ...
                    self.post("error", str(e) or type(e).__name__)
                    self.stopped.wait(2)
                continue
            if self.f.rpc.closed:
                self.f = None
                self.snap = None
                self.frame = None
                self.post("disconnected")
                continue
            if time.monotonic() - last_power > 20:
                last_power = time.monotonic()
                try:
                    power = self.f.power()
                    if self.snap:
                        self.snap["power"] = power
                    self.post("power", power)
                except Exception:
                    pass
            self.stopped.wait(0.5)

    def _on_frame(self, fr: bytes) -> None:
        self.frame = fr
        if self.on_frame:
            self.on_frame(fr)

    @staticmethod
    def snapshot(f: Flipper) -> dict:
        storage = {}
        for root in ("/ext", "/int"):
            try:
                storage[root] = f.storage_info(root)
            except Exception:
                pass
        return {"info": f.info(), "power": f.power(), "storage": storage}

    def stop(self) -> None:
        self.stopped.set()
        if self.f:
            try:
                self.f.close()
            except Exception:
                pass
