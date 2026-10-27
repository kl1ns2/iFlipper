"""Flipper Zero protobuf RPC over a byte stream.

Wire format: the Flipper CLI is switched into RPC mode with `start_rpc_session\\r`,
after which every message is a varint length prefix followed by a serialized
`PB.Main`. Requests and their responses share a `command_id`; multi-part
messages set `has_next` on every part but the last.
"""

from __future__ import annotations

import itertools
import queue
import threading
import time
from collections.abc import Callable, Iterable, Iterator

from .proto import flipper_pb2 as pb
from .transport import Transport

CLI_PROMPT = b">: "
START_RPC = b"start_rpc_session\r"

_CLOSED = object()


class RpcError(Exception):
    def __init__(self, status: int, command: str = ""):
        self.status = status
        name = pb.CommandStatus.Name(status) if status in pb.CommandStatus.values() else str(status)
        super().__init__(f"{command or 'rpc'}: {name}")
        self.status_name = name


def encode_varint(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def frame(msg: pb.Main) -> bytes:
    body = msg.SerializeToString()
    return encode_varint(len(body)) + body


class FrameDecoder:
    """Incrementally splits a byte stream into length-delimited messages."""

    def __init__(self) -> None:
        self._buf = bytearray()

    def feed(self, data: bytes) -> list[bytes]:
        self._buf += data
        out = []
        while True:
            size, shift, pos = 0, 0, 0
            while pos < len(self._buf):
                b = self._buf[pos]
                size |= (b & 0x7F) << shift
                shift += 7
                pos += 1
                if not b & 0x80:
                    break
            else:
                return out
            if len(self._buf) - pos < size:
                return out
            out.append(bytes(self._buf[pos:pos + size]))
            del self._buf[:pos + size]


class RpcClient:
    def __init__(self, transport: Transport, timeout: float = 10.0):
        self.t = transport
        self.timeout = timeout
        self._ids = itertools.count(1)
        self._pending: dict[int, queue.Queue] = {}
        self._lock = threading.Lock()
        self._wlock = threading.Lock()
        self._listeners: list[Callable[[pb.Main], None]] = []
        self._reader: threading.Thread | None = None
        self.closed = False

    # -- session -----------------------------------------------------------

    def start(self, handshake: bool = True) -> None:
        leftover = self._handshake() if handshake else b""
        self._reader = threading.Thread(target=self._read_loop, args=(leftover,), daemon=True)
        self._reader.start()

    def _read_until(self, buf: bytearray, token: bytes, deadline: float) -> int:
        while (i := buf.find(token)) < 0:
            if time.monotonic() > deadline:
                raise TimeoutError(f"no {token!r} from Flipper CLI")
            chunk = self.t.read(4096)
            if not chunk:
                raise ConnectionError("transport closed during handshake")
            buf += chunk
        return i + len(token)

    def _handshake(self) -> bytes:
        deadline = time.monotonic() + self.timeout
        buf = bytearray()
        # Poke the CLI so it prints a fresh prompt even if the banner already went by.
        self.t.write(b"\r")
        self._read_until(buf, CLI_PROMPT, deadline)
        buf.clear()
        self.t.write(START_RPC)
        # Wait for the echoed command itself: stray prompts from the poke may come first.
        end = self._read_until(buf, START_RPC + b"\n", deadline)
        return bytes(buf[end:])

    def close(self) -> None:
        if self.closed:
            return
        try:
            self.send(pb.Main(stop_session=pb.StopSession()), wait=False)
        except Exception:
            pass
        self.closed = True
        self.t.close()

    # -- plumbing ----------------------------------------------------------

    def _read_loop(self, leftover: bytes) -> None:
        dec = FrameDecoder()
        data = leftover
        try:
            while True:
                for raw in dec.feed(data):
                    msg = pb.Main()
                    msg.ParseFromString(raw)
                    self._dispatch(msg)
                data = self.t.read(4096)
                if not data:
                    break
        finally:
            self.closed = True
            with self._lock:
                for q in self._pending.values():
                    q.put(_CLOSED)

    def _dispatch(self, msg: pb.Main) -> None:
        with self._lock:
            q = self._pending.get(msg.command_id) if msg.command_id else None
        if q is not None:
            q.put(msg)
            return
        for cb in list(self._listeners):
            cb(msg)

    def subscribe(self, cb: Callable[[pb.Main], None]) -> Callable[[], None]:
        """Receive unsolicited messages (screen frames, desktop status...)."""
        self._listeners.append(cb)
        return lambda: self._listeners.remove(cb)

    def _write(self, msg: pb.Main) -> None:
        with self._wlock:
            self.t.write(frame(msg))

    # -- requests ----------------------------------------------------------

    def stream(self, msgs: pb.Main | Iterable[pb.Main], timeout: float | None = None) -> Iterator[pb.Main]:
        """Send one or more request parts and yield every response part."""
        if isinstance(msgs, pb.Main):
            msgs = [msgs]
        cid = next(self._ids)
        q: queue.Queue = queue.Queue()
        with self._lock:
            self._pending[cid] = q
        try:
            # Parts are consumed lazily (one lookahead) so callers can stream big uploads.
            it = iter(msgs)
            cur = next(it, None)
            what = cur.WhichOneof("content") if cur is not None else ""
            while cur is not None:
                nxt = next(it, None)
                cur.command_id = cid
                cur.has_next = nxt is not None
                self._write(cur)
                cur = nxt
            while True:
                try:
                    resp = q.get(timeout=timeout or self.timeout)
                except queue.Empty:
                    raise TimeoutError(f"{what}: no response") from None
                if resp is _CLOSED:
                    raise ConnectionError("Flipper disconnected")
                if resp.command_status != pb.OK:
                    raise RpcError(resp.command_status, what)
                yield resp
                if not resp.has_next:
                    return
        finally:
            with self._lock:
                self._pending.pop(cid, None)

    def send(self, msgs: pb.Main | Iterable[pb.Main], wait: bool = True, timeout: float | None = None) -> pb.Main | None:
        """Send a request and return the (last) response."""
        if not wait:
            for m in [msgs] if isinstance(msgs, pb.Main) else msgs:
                m.command_id = next(self._ids)
                self._write(m)
            return None
        last = None
        for last in self.stream(msgs, timeout):
            pass
        return last
