"""A virtual Flipper Zero that speaks the real RPC protocol.

Use it to develop and test without hardware:

    iflipper emulate --pty            # prints a /dev/pts/N path to connect to
    iflipper emulate --tcp 7777       # then: iflipper -p tcp://127.0.0.1:7777 info

The SD card (/ext) and internal storage (/int) are backed by real host
directories, so files you push really land on disk.
"""

from __future__ import annotations

import datetime as dt
import errno
import hashlib
import os
import shutil
import socket
import tarfile
import threading
import time
from pathlib import Path

from . import screen
from .proto import application_pb2 as app_pb
from .proto import flipper_pb2 as pb
from .proto import gui_pb2 as gui_pb
from .proto import storage_pb2 as st_pb
from .proto import system_pb2 as sys_pb
from .rpc import CLI_PROMPT, FrameDecoder, frame
from .transport import PipeTransport, SocketTransport, Transport

BANNER = b"\r\n   _.-------.._  iFlipper virtual Zero\r\n  Firmware: emu 1.0.0\r\n\r\n"

DEVICE_INFO = {
    "format_major": "3", "format_minor": "3",
    "hardware_model": "Flipper Zero", "hardware_name": "Emulatr",
    "hardware_uid": "0123456789ABCDEF", "hardware_target": "7", "hardware_ver": "12",
    "hardware_region": "4", "hardware_region_provisioned": "EU",
    "firmware_version": "1.0.0-emu", "firmware_branch": "release", "firmware_commit": "deadbeef",
    "firmware_build_date": "27-10-2026", "firmware_target": "7", "firmware_api_major": "86",
    "firmware_api_minor": "0", "protobuf_version_major": "0", "protobuf_version_minor": "25",
    "radio_alive": "true", "radio_stack_type": "1",
}

MENU = ["Sub-GHz", "125 kHz RFID", "NFC", "Infrared", "GPIO", "iButton", "Bad USB", "U2F", "Apps", "Settings"]


class EmuError(Exception):
    def __init__(self, status: int):
        self.status = status


class FdTransport:
    """Raw file-descriptor transport (the master side of a PTY)."""

    def __init__(self, fd: int):
        self.fd = fd
        self._closed = False

    def write(self, data: bytes) -> None:
        while data:
            try:
                n = os.write(self.fd, data)
            except OSError as e:
                if e.errno == errno.EAGAIN:
                    time.sleep(0.001)
                    continue
                raise
            data = data[n:]

    def read(self, size: int) -> bytes:
        while not self._closed:
            try:
                data = os.read(self.fd, size)
                if data:
                    return data
            except OSError as e:
                if e.errno != errno.EIO:  # EIO: nobody has the slave open yet
                    return b""
            time.sleep(0.02)
        return b""

    def close(self) -> None:
        self._closed = True
        os.close(self.fd)


class VirtualFlipper:
    def __init__(self, root: str | os.PathLike, name: str = "Emulatr"):
        self.root = Path(root).resolve()
        for sub in ("ext", "int"):
            (self.root / sub).mkdir(parents=True, exist_ok=True)
        self.info = dict(DEVICE_INFO, hardware_name=name)
        self.clock_offset = dt.timedelta()
        self.menu_pos = 0
        self.app: str | None = None
        self.alerts = 0
        self.update_manifest: str | None = None
        self.reboots: list[int] = []

    # -- filesystem --------------------------------------------------------

    def host(self, path: str) -> Path:
        parts = [p for p in path.split("/") if p]
        if not parts or parts[0] not in ("ext", "int", "any"):
            raise EmuError(pb.ERROR_STORAGE_INVALID_NAME)
        if parts[0] == "any":
            parts[0] = "ext"
        p = (self.root / Path(*parts)).resolve()
        if p != self.root and self.root not in p.parents:
            raise EmuError(pb.ERROR_STORAGE_INVALID_NAME)
        return p

    # -- display -----------------------------------------------------------

    def now(self) -> dt.datetime:
        return dt.datetime.now() + self.clock_offset

    def render(self) -> bytes:
        from PIL import Image, ImageDraw

        img = Image.new("1", (screen.W, screen.H), 0)
        d = ImageDraw.Draw(img)
        d.rectangle((0, 0, 127, 10), fill=1)
        d.text((2, 0), self.app or "iFlipper emu", fill=0)
        d.text((98, 0), self.now().strftime("%H:%M"), fill=0)
        if self.app:
            d.text((4, 24), f"Running {self.app}", fill=1)
            d.text((4, 40), "BACK to exit", fill=1)
        else:
            for i in range(-1, 2):
                item = MENU[(self.menu_pos + i) % len(MENU)]
                y = 26 + i * 14
                if i == 0:
                    d.rounded_rectangle((2, y - 2, 125, y + 11), radius=3, outline=1)
                d.text((8, y), item, fill=1)
        rows = [[bool(img.getpixel((x, y))) for x in range(screen.W)] for y in range(screen.H)]
        return screen.to_frame(rows)

    def on_input(self, key: int, kind: int) -> None:
        if kind not in (gui_pb.SHORT, gui_pb.REPEAT):
            return
        if self.app:
            if key == gui_pb.BACK:
                self.app = None
        elif key in (gui_pb.UP, gui_pb.LEFT):
            self.menu_pos = (self.menu_pos - 1) % len(MENU)
        elif key in (gui_pb.DOWN, gui_pb.RIGHT):
            self.menu_pos = (self.menu_pos + 1) % len(MENU)
        elif key == gui_pb.OK:
            self.app = MENU[self.menu_pos]

    # -- serving -----------------------------------------------------------

    def serve(self, t: Transport) -> None:
        """Run CLI/RPC sessions on `t` until the transport closes."""
        try:
            Session(self, t).run()
        except (ConnectionError, OSError):
            pass  # client went away

    def serve_in_thread(self, t: Transport) -> threading.Thread:
        th = threading.Thread(target=self.serve, args=(t,), daemon=True)
        th.start()
        return th

    def pipe(self) -> Transport:
        """Return a client transport connected to this emulator."""
        client, server = PipeTransport.pair()
        self.serve_in_thread(server)
        return client

    def open_pty(self) -> str:
        import tty

        master, slave = os.openpty()
        tty.setraw(slave)
        path = os.ttyname(slave)
        self.serve_in_thread(FdTransport(master))
        self._slave = slave  # keep open so the master never sees EIO between clients
        return path

    def serve_tcp(self, port: int, host: str = "127.0.0.1") -> None:
        srv = socket.create_server((host, port))
        while True:
            conn, _ = srv.accept()
            self.serve_in_thread(SocketTransport.from_socket(conn))


class Session:
    def __init__(self, dev: VirtualFlipper, t: Transport):
        self.dev, self.t = dev, t
        self.wlock = threading.Lock()
        self.writes: dict[int, bytearray] = {}
        self.streaming = False
        self.last_frame = b""

    def out(self, data: bytes) -> None:
        with self.wlock:
            self.t.write(data)

    def reply(self, cid: int, status: int = pb.OK, has_next: bool = False, **content) -> None:
        if not content:
            content = {"empty": pb.Empty()}
        self.out(frame(pb.Main(command_id=cid, command_status=status, has_next=has_next, **content)))

    def run(self) -> None:
        self.out(BANNER + CLI_PROMPT)
        line = bytearray()
        rpc_buf = b""
        while True:
            data = rpc_buf or self.t.read(4096)
            rpc_buf = b""
            if not data:
                return
            # CLI mode: echo characters, act on CR.
            for i, c in enumerate(data):
                if c == 0x0D:
                    cmd = line.decode(errors="replace").strip()
                    line.clear()
                    self.out(b"\r\n")
                    if cmd == "start_rpc_session":
                        if not self.rpc(data[i + 1:]):
                            return
                        self.out(CLI_PROMPT)
                        break
                    if cmd:
                        self.out(self.cli(cmd).encode() + b"\r\n")
                    self.out(CLI_PROMPT)
                elif c in (0x08, 0x7F):
                    line = line[:-1]
                elif c != 0x0A:
                    line.append(c)
                    self.out(bytes([c]))

    def cli(self, cmd: str) -> str:
        name = cmd.split()[0]
        if name == "device_info":
            return "\r\n".join(f"{k:<28}: {v}" for k, v in self.dev.info.items())
        if name == "uptime":
            return "Uptime: 0h0m42s"
        if name == "help":
            return "Commands: device_info uptime help start_rpc_session"
        return f"`{name}` command not found"

    # -- rpc ---------------------------------------------------------------

    def rpc(self, leftover: bytes) -> bool:
        """Serve RPC; returns False when the transport closed, True on StopSession."""
        dec = FrameDecoder()
        data = leftover
        ticker = threading.Thread(target=self._tick, daemon=True)
        self.alive = True
        ticker.start()
        try:
            while True:
                for raw in dec.feed(data):
                    msg = pb.Main()
                    msg.ParseFromString(raw)
                    if msg.WhichOneof("content") == "stop_session":
                        return True
                    try:
                        self.handle(msg)
                    except EmuError as e:
                        self.writes.pop(msg.command_id, None)
                        self.reply(msg.command_id, e.status)
                    except Exception:
                        self.reply(msg.command_id, pb.ERROR)
                data = self.t.read(4096)
                if not data:
                    return False
        finally:
            self.alive = False
            self.streaming = False

    def _tick(self) -> None:
        while self.alive:
            if self.streaming:
                try:
                    self.push_frame()
                except (ConnectionError, OSError):
                    return
            time.sleep(0.5)

    def push_frame(self, force: bool = False) -> None:
        f = self.dev.render()
        if force or f != self.last_frame:
            self.last_frame = f
            self.out(frame(pb.Main(gui_screen_frame=gui_pb.ScreenFrame(data=f))))

    def handle(self, m: pb.Main) -> None:
        kind = m.WhichOneof("content")
        cid = m.command_id
        dev = self.dev
        h = getattr(self, "h_" + kind, None)
        if h:
            return h(cid, getattr(m, kind), m)

        if kind == "system_ping_request":
            self.reply(cid, system_ping_response=sys_pb.PingResponse(data=m.system_ping_request.data))
        elif kind == "system_device_info_request":
            items = list(dev.info.items())
            for i, (k, v) in enumerate(items):
                self.reply(cid, has_next=i < len(items) - 1,
                           system_device_info_response=sys_pb.DeviceInfoResponse(key=k, value=v))
        elif kind == "system_power_info_request":
            power = {"charge_level": "87", "charge_state": "charging", "battery_voltage": "4.11",
                     "battery_current": "0.21", "battery_temp": "29", "battery_health": "98",
                     "capacity_remain": "1835", "capacity_full": "2100", "capacity_design": "2100"}
            items = list(power.items())
            for i, (k, v) in enumerate(items):
                self.reply(cid, has_next=i < len(items) - 1,
                           system_power_info_response=sys_pb.PowerInfoResponse(key=k, value=v))
        elif kind == "system_protobuf_version_request":
            self.reply(cid, system_protobuf_version_response=sys_pb.ProtobufVersionResponse(major=0, minor=25))
        elif kind == "system_get_datetime_request":
            n = dev.now()
            d = sys_pb.DateTime(year=n.year, month=n.month, day=n.day, hour=n.hour, minute=n.minute,
                                second=n.second, weekday=n.isoweekday())
            self.reply(cid, system_get_datetime_response=sys_pb.GetDateTimeResponse(datetime=d))
        elif kind == "system_set_datetime_request":
            d = m.system_set_datetime_request.datetime
            dev.clock_offset = dt.datetime(d.year, d.month, d.day, d.hour, d.minute, d.second) - dt.datetime.now()
            self.reply(cid)
        elif kind == "system_play_audiovisual_alert_request":
            dev.alerts += 1
            self.reply(cid)
        elif kind == "system_reboot_request":
            dev.reboots.append(m.system_reboot_request.mode)
        elif kind == "system_update_request":
            path = m.system_update_request.update_manifest
            code = sys_pb.UpdateResponse.OK
            if not path.endswith(".fuf"):
                code = sys_pb.UpdateResponse.ManifestPathInvalid
            elif not dev.host(path).is_file():
                code = sys_pb.UpdateResponse.ManifestFolderNotFound
            else:
                dev.update_manifest = path
            self.reply(cid, system_update_response=sys_pb.UpdateResponse(code=code))
        elif kind == "app_start_request":
            if dev.app:
                raise EmuError(pb.ERROR_APP_SYSTEM_LOCKED)
            dev.app = m.app_start_request.name
            self.reply(cid)
        elif kind == "app_exit_request":
            if not dev.app:
                raise EmuError(pb.ERROR_APP_NOT_RUNNING)
            dev.app = None
            self.reply(cid)
        elif kind == "app_lock_status_request":
            self.reply(cid, app_lock_status_response=app_pb.LockStatusResponse(locked=dev.app is not None))
        elif kind == "gui_start_screen_stream_request":
            self.streaming = True
            self.reply(cid)
            self.push_frame(force=True)
        elif kind == "gui_stop_screen_stream_request":
            self.streaming = False
            self.reply(cid)
        elif kind == "gui_send_input_event_request":
            ev = m.gui_send_input_event_request
            dev.on_input(ev.key, ev.type)
            self.reply(cid)
            if self.streaming:
                self.push_frame()
        else:
            raise EmuError(pb.ERROR_NOT_IMPLEMENTED)

    # -- storage handlers --------------------------------------------------

    def h_storage_info_request(self, cid, req, _m):
        u = shutil.disk_usage(self.dev.host(req.path))
        self.reply(cid, storage_info_response=st_pb.InfoResponse(total_space=u.total, free_space=u.free))

    def _file(self, p: Path, md5: bool = False) -> st_pb.File:
        if p.is_dir():
            return st_pb.File(type=st_pb.File.DIR, name=p.name)
        f = st_pb.File(type=st_pb.File.FILE, name=p.name, size=p.stat().st_size)
        if md5:
            f.md5sum = hashlib.md5(p.read_bytes()).hexdigest()
        return f

    def h_storage_list_request(self, cid, req, _m):
        p = self.dev.host(req.path)
        if not p.exists():
            raise EmuError(pb.ERROR_STORAGE_NOT_EXIST)
        files = [self._file(c, req.include_md5) for c in sorted(p.iterdir())]
        batches = [files[i:i + 8] for i in range(0, len(files), 8)] or [[]]
        for i, b in enumerate(batches):
            self.reply(cid, has_next=i < len(batches) - 1, storage_list_response=st_pb.ListResponse(file=b))

    def h_storage_stat_request(self, cid, req, _m):
        p = self.dev.host(req.path)
        if not p.exists():
            raise EmuError(pb.ERROR_STORAGE_NOT_EXIST)
        self.reply(cid, storage_stat_response=st_pb.StatResponse(file=self._file(p)))

    def h_storage_read_request(self, cid, req, _m):
        p = self.dev.host(req.path)
        if not p.is_file():
            raise EmuError(pb.ERROR_STORAGE_NOT_EXIST)
        data = p.read_bytes()
        chunks = [data[i:i + 512] for i in range(0, len(data), 512)] or [b""]
        for i, c in enumerate(chunks):
            self.reply(cid, has_next=i < len(chunks) - 1,
                       storage_read_response=st_pb.ReadResponse(file=st_pb.File(data=c)))

    def h_storage_write_request(self, cid, req, m):
        if len(req.file.data) > 512:
            raise EmuError(pb.ERROR_INVALID_PARAMETERS)
        self.writes.setdefault(cid, bytearray()).extend(req.file.data)
        if m.has_next:
            return
        p = self.dev.host(req.path)
        if not p.parent.is_dir():
            self.writes.pop(cid)
            raise EmuError(pb.ERROR_STORAGE_NOT_EXIST)
        if p.is_dir():
            self.writes.pop(cid)
            raise EmuError(pb.ERROR_STORAGE_INVALID_NAME)
        p.write_bytes(self.writes.pop(cid))
        self.reply(cid)

    def h_storage_mkdir_request(self, cid, req, _m):
        p = self.dev.host(req.path)
        if p.exists():
            raise EmuError(pb.ERROR_STORAGE_EXIST)
        if not p.parent.is_dir():
            raise EmuError(pb.ERROR_STORAGE_NOT_EXIST)
        p.mkdir()
        self.reply(cid)

    def h_storage_delete_request(self, cid, req, _m):
        p = self.dev.host(req.path)
        if p in (self.dev.root / "ext", self.dev.root / "int"):
            raise EmuError(pb.ERROR_STORAGE_DENIED)
        if not p.exists():
            raise EmuError(pb.ERROR_STORAGE_NOT_EXIST)
        if p.is_dir():
            if any(p.iterdir()) and not req.recursive:
                raise EmuError(pb.ERROR_STORAGE_DIR_NOT_EMPTY)
            shutil.rmtree(p)
        else:
            p.unlink()
        self.reply(cid)

    def h_storage_rename_request(self, cid, req, _m):
        src, dst = self.dev.host(req.old_path), self.dev.host(req.new_path)
        if not src.exists():
            raise EmuError(pb.ERROR_STORAGE_NOT_EXIST)
        if dst.exists():
            raise EmuError(pb.ERROR_STORAGE_EXIST)
        src.rename(dst)
        self.reply(cid)

    def h_storage_md5sum_request(self, cid, req, _m):
        p = self.dev.host(req.path)
        if not p.is_file():
            raise EmuError(pb.ERROR_STORAGE_NOT_EXIST)
        self.reply(cid, storage_md5sum_response=st_pb.Md5sumResponse(md5sum=hashlib.md5(p.read_bytes()).hexdigest()))

    def h_storage_tar_extract_request(self, cid, req, _m):
        src, out = self.dev.host(req.tar_path), self.dev.host(req.out_path)
        if not src.is_file():
            raise EmuError(pb.ERROR_STORAGE_NOT_EXIST)
        with tarfile.open(src) as tf:
            tf.extractall(out, filter="data")
        self.reply(cid)
