"""Byte transports a Flipper can be reached over."""

from __future__ import annotations

import socket
import threading
from dataclasses import dataclass
from typing import Protocol

FLIPPER_VID = 0x0483
FLIPPER_PID = 0x5740


class Transport(Protocol):
    def write(self, data: bytes) -> None: ...

    def read(self, size: int) -> bytes:
        """Block until at least one byte is available; b"" means closed."""

    def close(self) -> None: ...


@dataclass
class PortInfo:
    device: str
    name: str
    serial: str


def find_flippers() -> list[PortInfo]:
    """List USB serial ports that look like a Flipper Zero."""
    from serial.tools import list_ports

    found = []
    for p in list_ports.comports():
        if p.vid == FLIPPER_VID and p.pid == FLIPPER_PID:
            # Flipper reports its name as the USB serial number, e.g. "flip_Anmerku".
            found.append(PortInfo(p.device, p.serial_number or "", p.serial_number or ""))
    return found


class SerialTransport:
    def __init__(self, port: str, baudrate: int = 230400):
        import serial

        self._s = serial.Serial(port, baudrate=baudrate, timeout=0.1)
        self._s.reset_input_buffer()

    def write(self, data: bytes) -> None:
        self._s.write(data)

    def read(self, size: int) -> bytes:
        try:
            while self._s.is_open:
                chunk = self._s.read(max(1, min(size, self._s.in_waiting or 1)))
                if chunk:
                    return chunk
        except (OSError, TypeError, AttributeError):
            pass  # port unplugged, or closed from another thread mid-read
        return b""

    def close(self) -> None:
        self._s.close()


class SocketTransport:
    """TCP transport — used by `iflipper emulate --tcp` and for remote Flippers."""

    def __init__(self, host: str, port: int):
        self._sock = socket.create_connection((host, port))

    @classmethod
    def from_socket(cls, sock: socket.socket) -> SocketTransport:
        t = cls.__new__(cls)
        t._sock = sock
        return t

    def write(self, data: bytes) -> None:
        self._sock.sendall(data)

    def read(self, size: int) -> bytes:
        try:
            return self._sock.recv(size)
        except OSError:
            return b""

    def close(self) -> None:
        try:
            self._sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self._sock.close()


class PipeTransport:
    """One end of an in-memory duplex pipe. Create with `PipeTransport.pair()`."""

    def __init__(self) -> None:
        self._buf = bytearray()
        self._cv = threading.Condition()
        self._closed = False
        self.peer: PipeTransport | None = None

    @classmethod
    def pair(cls) -> tuple[PipeTransport, PipeTransport]:
        a, b = cls(), cls()
        a.peer, b.peer = b, a
        return a, b

    def _feed(self, data: bytes) -> None:
        with self._cv:
            self._buf += data
            self._cv.notify_all()

    def write(self, data: bytes) -> None:
        if self._closed:
            raise ConnectionError("pipe closed")
        assert self.peer is not None
        self.peer._feed(data)

    def read(self, size: int) -> bytes:
        with self._cv:
            self._cv.wait_for(lambda: self._buf or self._closed)
            if not self._buf:
                return b""
            out = bytes(self._buf[:size])
            del self._buf[:size]
            return out

    def _shut(self) -> None:
        with self._cv:
            self._closed = True
            self._cv.notify_all()

    def close(self) -> None:
        self._shut()
        if self.peer:
            self.peer._shut()


def open_transport(target: str) -> Transport:
    """Open `target`: a serial port path, or `tcp://host:port`."""
    if target.startswith("tcp://"):
        host, _, port = target[len("tcp://"):].rpartition(":")
        return SocketTransport(host or "127.0.0.1", int(port))
    return SerialTransport(target)
