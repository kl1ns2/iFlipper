"""Local HTTP backend for the desktop app.

Serves the web UI and a small JSON API on 127.0.0.1. Every API call must carry the
per-launch token (header `X-Token` or `?t=`), and the Host header must be the
loopback address, so web pages in other browsers can't drive the Flipper.
"""

from __future__ import annotations

import base64
import json
import mimetypes
import queue
import secrets
import tempfile
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .link import Link

WEB = Path(__file__).with_name("web")
CONFIG = Path.home() / ".iflipper"
FRAME_INTERVAL = 1 / 30
KEYS = {"up", "down", "left", "right", "ok", "back"}

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")


class Hub:
    """Fans device events out to every connected event stream."""

    def __init__(self) -> None:
        self.clients: list[queue.Queue] = []
        self.lock = threading.Lock()
        self.status = {"state": "waiting"}
        self.frame_seq = 0

    def publish(self, kind: str, data) -> None:
        with self.lock:
            for q in self.clients:
                q.put((kind, data))

    def frame(self, _fr: bytes) -> None:
        self.frame_seq += 1
        with self.lock:
            for q in self.clients:
                if not getattr(q, "frame_pending", False):
                    q.frame_pending = True
                    q.put(("frame", None))

    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue()
        with self.lock:
            self.clients.append(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self.lock:
            if q in self.clients:
                self.clients.remove(q)


class Backend:
    def __init__(self, target: str | None = None, port: int = 0):
        self.token = secrets.token_urlsafe(18)
        self.hub = Hub()
        self.link = Link(target, self._on_link, self.hub.frame)
        self.on_connected = None  # set by the window to pop itself up
        self.job = threading.Lock()  # one long operation (transfer, backup...) at a time
        self.httpd = ThreadingHTTPServer(("127.0.0.1", port), self._handler())
        self.httpd.daemon_threads = True
        self.port = self.httpd.server_address[1]

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/?t={self.token}"

    def start(self) -> None:
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.link.start()

    def stop(self) -> None:
        self.link.stop()
        self.httpd.shutdown()

    # -- link events -------------------------------------------------------

    def _on_link(self, kind: str, *args) -> None:
        if kind == "waiting":
            self.hub.status = {"state": "waiting"}
        elif kind == "connecting":
            self.hub.status = {"state": "connecting", "target": args[0]}
        elif kind == "error":
            self.hub.status = {"state": "error", "message": args[0]}
        elif kind == "disconnected":
            self.hub.status = {"state": "disconnected"}
        elif kind == "connected":
            self.hub.status = {"state": "connected"}
            self.hub.publish("device", args[0])
            if self.on_connected:
                self.on_connected()
        elif kind == "power":
            self.hub.publish("power", args[0])
            return
        self.hub.publish("status", self.hub.status)

    def progress(self, label: str):
        last = [0.0]

        def cb(done: int, total: int) -> None:
            now = time.monotonic()
            if now - last[0] > 0.1 or done >= total:
                last[0] = now
                self.hub.publish("progress", {"label": label, "done": done, "total": total})

        return cb

    @property
    def f(self):
        f = self.link.f
        if f is None:
            raise ApiError(409, "Flipper не подключён")
        return f

    def look_path(self) -> Path:
        return CONFIG / "look.json"

    # -- http --------------------------------------------------------------

    def _handler(self):
        backend = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a) -> None:
                pass

            def send_json(self, obj, code: int = 200) -> None:
                body = json.dumps(obj, ensure_ascii=False).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)

            def send_bytes(self, data: bytes, ctype: str, filename: str | None = None) -> None:
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                if filename:
                    q = urllib.parse.quote(filename)
                    self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{q}")
                self.end_headers()
                self.wfile.write(data)

            def body(self) -> bytes:
                n = int(self.headers.get("Content-Length") or 0)
                return self.rfile.read(n) if n else b""

            def json_body(self) -> dict:
                raw = self.body()
                return json.loads(raw) if raw else {}

            def route(self, method: str) -> None:
                u = urllib.parse.urlparse(self.path)
                q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
                host = (self.headers.get("Host") or "").split(":")[0]
                if host not in ("127.0.0.1", "localhost"):
                    return self.send_json({"error": "bad host"}, 403)
                if not u.path.startswith("/api/"):
                    return self.static(u.path) if method == "GET" else self.send_json({"error": "no"}, 405)
                tok = self.headers.get("X-Token") or q.get("t", "")
                if not secrets.compare_digest(tok, backend.token):
                    return self.send_json({"error": "bad token"}, 403)
                name = f"{method.lower()}_{u.path[5:].replace('/', '_')}"
                if name == "get_events":
                    return backend.stream_events(self)
                fn = getattr(backend, "api_" + name, None)
                if fn is None:
                    return self.send_json({"error": "not found"}, 404)
                try:
                    result = fn(self, q)
                except ApiError as e:
                    return self.send_json({"error": e.msg}, e.code)
                except Exception as e:
                    return self.send_json({"error": str(e) or type(e).__name__}, 500)
                if isinstance(result, tuple):
                    return self.send_bytes(*result)
                self.send_json(result if result is not None else {"ok": True})

            def static(self, path: str) -> None:
                rel = path.lstrip("/") or "index.html"
                p = (WEB / rel).resolve()
                if WEB.resolve() not in p.parents or not p.is_file():
                    return self.send_json({"error": "not found"}, 404)
                ctype = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
                self.send_bytes(p.read_bytes(), ctype)

            def do_GET(self) -> None:
                self.route("GET")

            def do_POST(self) -> None:
                self.route("POST")

            def do_PUT(self) -> None:
                self.route("PUT")

        return Handler

    def stream_events(self, h) -> None:
        h.send_response(200)
        h.send_header("Content-Type", "text/event-stream")
        h.send_header("Cache-Control", "no-store")
        h.send_header("Connection", "keep-alive")
        h.end_headers()
        q = self.hub.subscribe()

        def send(kind: str, data) -> None:
            h.wfile.write(f"event: {kind}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode())
            h.wfile.flush()

        try:
            send("status", self.hub.status)
            if self.link.snap and self.link.f:
                send("device", self.link.snap)
                if self.link.frame:  # the screen only streams changes, so start with what's on it now
                    send("frame", base64.b64encode(self.link.frame).decode())
            last_frame = 0.0
            while True:
                try:
                    kind, data = q.get(timeout=15)
                except queue.Empty:
                    h.wfile.write(b": ping\n\n")
                    h.wfile.flush()
                    continue
                if kind == "frame":
                    # Coalesce: at most ~30 fps, always the newest picture.
                    wait = FRAME_INTERVAL - (time.monotonic() - last_frame)
                    if wait > 0:
                        time.sleep(wait)
                    q.frame_pending = False
                    fr = self.link.frame
                    if fr is None:
                        continue
                    last_frame = time.monotonic()
                    send("frame", base64.b64encode(fr).decode())
                else:
                    send(kind, data)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            self.hub.unsubscribe(q)

    # -- api ---------------------------------------------------------------

    def api_get_status(self, h, q):
        return {"status": self.hub.status, "device": self.link.snap if self.link.f else None}

    def api_post_press(self, h, q):
        b = h.json_body()
        key, kind = b.get("key"), b.get("kind", "short")
        if key not in KEYS or kind not in ("short", "long", "press", "release"):
            raise ApiError(400, "bad key")
        self.f.press(key, kind)

    def api_post_alert(self, h, q):
        self.f.alert()

    def api_post_time(self, h, q):
        self.f.set_datetime()

    def api_get_ls(self, h, q):
        return [{"name": e.name, "dir": e.is_dir, "size": e.size} for e in self.f.ls(q.get("path", "/ext"))]

    def api_get_file(self, h, q):
        path = q["path"]
        with self.locked():
            data = self.f.read(path, self.progress("Скачивание"))
        return data, "application/octet-stream", path.rsplit("/", 1)[-1]

    def api_post_file(self, h, q):
        data = h.body()
        with self.locked():
            self.f.write(q["path"], data, self.progress("Загрузка"))

    def api_post_mkdir(self, h, q):
        self.f.mkdir(h.json_body()["path"])

    def api_post_rm(self, h, q):
        path = h.json_body()["path"]
        if path.rstrip("/") in ("/ext", "/int", ""):
            raise ApiError(400, "нельзя удалить корень")
        self.f.rm(path, recursive=True)

    def api_get_backup(self, h, q):
        from . import backup

        with self.locked(), tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "backup.tar.gz"
            log = lambda s: self.hub.publish("progress", {"label": f"Бэкап: {s}", "done": 0, "total": 0})
            backup.create(self.f, out, log=log)
            name = (self.link.snap or {}).get("info", {}).get("hardware_name", "flipper")
            self.hub.publish("progress", {"label": "", "done": 1, "total": 1})
            return out.read_bytes(), "application/gzip", f"{name}-{time.strftime('%Y%m%d-%H%M%S')}.tar.gz"

    def api_post_restore(self, h, q):
        from . import backup

        data = h.body()
        with self.locked(), tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "restore.tar.gz"
            src.write_bytes(data)
            log = lambda s: self.hub.publish("progress", {"label": f"Восстановление: {s}", "done": 0, "total": 0})
            st = backup.restore(self.f, src, log=log)
            self.hub.publish("progress", {"label": "", "done": 1, "total": 1})
            return st

    def api_post_update(self, h, q):
        from . import update

        data = h.body()
        update.unpack(data)  # validate before touching the device
        with self.locked():
            return {"manifest": update.install(self.f, data, progress=self.progress("Прошивка"))}

    def api_get_look(self, h, q):
        p = self.look_path()
        try:
            return json.loads(p.read_text())
        except (OSError, ValueError):
            return {}

    def api_put_look(self, h, q):
        look = h.json_body()
        p = self.look_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(look, ensure_ascii=False, indent=1))

    def locked(self):
        if not self.job.acquire(blocking=False):
            raise ApiError(409, "Подождите — идёт другая операция")
        return _Release(self.job)


class _Release:
    def __init__(self, lock: threading.Lock):
        self.lock = lock

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.lock.release()


class ApiError(Exception):
    def __init__(self, code: int, msg: str):
        super().__init__(msg)
        self.code, self.msg = code, msg
