import json
import queue
import urllib.error
import urllib.request

import pytest

from iflipper import link as link_mod
from iflipper import server
from iflipper.device import Flipper
from iflipper.emulator import VirtualFlipper
from iflipper.link import Link


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
    monkeypatch.setattr(link_mod, "find_flippers",
                        lambda: [type("P", (), {"device": "COM3"})()] if plugged[0] else [])
    events = queue.Queue()
    lk = Link(None, lambda *ev: events.put(ev))
    lk.start()
    try:
        wait_for(events, "waiting")  # nothing plugged in yet
        plugged[0] = True
        assert wait_for(events, "connected")[1]["info"]["hardware_name"] == "Emulatr"
        for _ in range(50):
            if lk.frame:
                break
            lk.stopped.wait(0.05)
        assert lk.frame and len(lk.frame) == 1024
        links[-1].close()  # unplug
        wait_for(events, "disconnected")
        wait_for(events, "connected")  # reconnects on its own
        assert len(links) == 2
    finally:
        lk.stop()


@pytest.fixture
def backend(tmp_path, monkeypatch):
    emu = VirtualFlipper(tmp_path / "dev")
    monkeypatch.setattr(Flipper, "connect", classmethod(lambda cls, target=None, **kw: Flipper(emu.pipe())))
    monkeypatch.setattr(server, "CONFIG", tmp_path / "cfg")
    b = server.Backend("emu")
    b.start()
    for _ in range(100):
        if b.link.f:
            break
        b.link.stopped.wait(0.05)
    b.emu = emu
    yield b
    b.stop()


def call(b, path, method="GET", data=None, token=True, host=None, raw=False):
    url = f"http://127.0.0.1:{b.port}/api/{path}"
    body = json.dumps(data).encode() if isinstance(data, (dict, list)) else data
    req = urllib.request.Request(url, data=body, method=method)
    if token:
        req.add_header("X-Token", b.token)
    if host:
        req.add_header("Host", host)
    with urllib.request.urlopen(req, timeout=5) as r:
        out = r.read()
    return out if raw else json.loads(out)


def test_api_requires_token_and_loopback_host(backend):
    with pytest.raises(urllib.error.HTTPError) as e:
        call(backend, "status", token=False)
    assert e.value.code == 403
    with pytest.raises(urllib.error.HTTPError) as e:
        call(backend, "status", host="evil.example:80")  # DNS rebinding
    assert e.value.code == 403


def test_api_device_files_and_input(backend):
    st = call(backend, "status")
    assert st["status"]["state"] == "connected"
    assert st["device"]["info"]["hardware_name"] == "Emulatr"
    call(backend, "file?path=/ext/hello.txt", "POST", b"hi there")
    assert call(backend, "file?path=/ext/hello.txt", raw=True) == b"hi there"
    names = [e["name"] for e in call(backend, "ls?path=/ext")]
    assert "hello.txt" in names
    call(backend, "mkdir", "POST", {"path": "/ext/new"})
    call(backend, "rm", "POST", {"path": "/ext/new"})
    with pytest.raises(urllib.error.HTTPError) as e:
        call(backend, "rm", "POST", {"path": "/ext"})
    assert e.value.code == 400
    call(backend, "press", "POST", {"key": "down", "kind": "short"})
    call(backend, "press", "POST", {"key": "ok", "kind": "short"})
    assert backend.emu.app == "125 kHz RFID"
    with pytest.raises(urllib.error.HTTPError):
        call(backend, "press", "POST", {"key": "nope"})


def test_api_look_roundtrip(backend):
    assert call(backend, "look") == {}
    look = {"body": {"color": "#7c4dff", "finish": "clear"}, "case": {"type": "full"}}
    call(backend, "look", "PUT", look)
    assert call(backend, "look") == look


def test_api_backup_restore(backend):
    call(backend, "file?path=/ext/keep.txt", "POST", b"keep")
    tgz = call(backend, "backup", raw=True)
    assert tgz[:2] == b"\x1f\x8b"
    call(backend, "rm", "POST", {"path": "/ext/keep.txt"})
    st = call(backend, "restore", "POST", tgz)
    assert st["uploaded"] >= 1
    assert call(backend, "file?path=/ext/keep.txt", raw=True) == b"keep"


def test_event_stream_starts_with_state_and_screen(backend):
    req = urllib.request.Request(f"http://127.0.0.1:{backend.port}/api/events?t={backend.token}")
    with urllib.request.urlopen(req, timeout=5) as r:
        seen = []
        for line in r:
            if line.startswith(b"event:"):
                seen.append(line.split(b":", 1)[1].strip().decode())
            if {"status", "device", "frame"} <= set(seen):
                break
    assert seen[:2] == ["status", "device"] and "frame" in seen


def test_static_ui_is_served(backend):
    with urllib.request.urlopen(f"http://127.0.0.1:{backend.port}/", timeout=5) as r:
        assert b"Customization" in r.read()
    with urllib.request.urlopen(f"http://127.0.0.1:{backend.port}/js/main.js", timeout=5) as r:
        assert r.headers["Content-Type"].startswith("text/javascript")
    with pytest.raises(urllib.error.HTTPError):
        urllib.request.urlopen(f"http://127.0.0.1:{backend.port}/../server.py", timeout=5)
