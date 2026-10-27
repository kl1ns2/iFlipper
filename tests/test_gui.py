import queue

import pytest

pytest.importorskip("tkinter")

from iflipper import gui  # noqa: E402
from iflipper.device import Flipper  # noqa: E402
from iflipper.emulator import VirtualFlipper  # noqa: E402


def wait_for(events, kind, timeout=5):
    while True:
        ev = events.get(timeout=timeout)
        if ev[0] == kind:
            return ev


def test_link_waits_connects_and_reconnects(tmp_path, monkeypatch):
    emu = VirtualFlipper(tmp_path)
    links = []
    plugged = [False]

    def connect(cls, target=None, **kw):
        t = emu.pipe()
        links.append(t)
        return Flipper(t)

    monkeypatch.setattr(Flipper, "connect", classmethod(connect))
    monkeypatch.setattr(gui, "find_flippers",
                        lambda: [type("P", (), {"device": "COM3"})()] if plugged[0] else [])

    events = queue.Queue()
    link = gui.Link(None, lambda *ev: events.put(ev))
    link.start()
    try:
        wait_for(events, "waiting")  # nothing plugged in yet
        plugged[0] = True
        snap = wait_for(events, "connected")[1]
        assert snap["info"]["hardware_name"] == "Emulatr"
        for _ in range(50):  # screen stream started
            if link.frame:
                break
            link.stopped.wait(0.05)
        assert link.frame and len(link.frame) == 1024

        links[-1].close()  # unplug
        wait_for(events, "disconnected")
        wait_for(events, "connected")  # still "plugged" -> reconnects on its own
        assert len(links) == 2
    finally:
        link.stop()
