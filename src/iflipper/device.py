"""High-level Flipper Zero API."""

from __future__ import annotations

import datetime as dt
import posixpath
from collections.abc import Callable, Iterator
from dataclasses import dataclass

from .proto import application_pb2 as app_pb
from .proto import flipper_pb2 as pb
from .proto import gui_pb2 as gui_pb
from .proto import storage_pb2 as st_pb
from .proto import system_pb2 as sys_pb
from .rpc import RpcClient, RpcError
from .transport import Transport, find_flippers, open_transport

CHUNK = 512  # the firmware rejects storage writes with bigger data blocks

FlipperError = RpcError
Progress = Callable[[int, int], None]

KEYS = {k.lower(): v for k, v in gui_pb.InputKey.items()}


@dataclass(frozen=True)
class Entry:
    name: str
    is_dir: bool
    size: int = 0
    md5: str = ""


class Flipper:
    """A connected Flipper Zero.

        with Flipper.connect() as f:
            print(f.info()["hardware_name"])
            f.write("/ext/hello.txt", b"hi")
    """

    def __init__(self, transport: Transport, handshake: bool = True, timeout: float = 10.0):
        self.rpc = RpcClient(transport, timeout)
        self.rpc.start(handshake)

    @classmethod
    def connect(cls, target: str | None = None, **kw) -> Flipper:
        """Connect to `target` (serial port or tcp://host:port), or the first Flipper found."""
        if target is None:
            ports = find_flippers()
            if not ports:
                raise ConnectionError("no Flipper Zero found — is it plugged in and not in DFU mode?")
            target = ports[0].device
        return cls(open_transport(target), **kw)

    def close(self) -> None:
        self.rpc.close()

    def __enter__(self) -> Flipper:
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def _call(self, **content) -> pb.Main:
        return self.rpc.send(pb.Main(**content))

    def _stream(self, **content) -> Iterator[pb.Main]:
        return self.rpc.stream(pb.Main(**content))

    # -- system ------------------------------------------------------------

    def ping(self, data: bytes = b"iflipper") -> bytes:
        return self._call(system_ping_request=sys_pb.PingRequest(data=data)).system_ping_response.data

    def info(self) -> dict[str, str]:
        out = {}
        for m in self._stream(system_device_info_request=sys_pb.DeviceInfoRequest()):
            r = m.system_device_info_response
            if r.key:
                out[r.key] = r.value
        return out

    def power(self) -> dict[str, str]:
        out = {}
        for m in self._stream(system_power_info_request=sys_pb.PowerInfoRequest()):
            r = m.system_power_info_response
            if r.key:
                out[r.key] = r.value
        return out

    def protobuf_version(self) -> tuple[int, int]:
        r = self._call(system_protobuf_version_request=sys_pb.ProtobufVersionRequest())
        return r.system_protobuf_version_response.major, r.system_protobuf_version_response.minor

    def get_datetime(self) -> dt.datetime:
        d = self._call(system_get_datetime_request=sys_pb.GetDateTimeRequest()).system_get_datetime_response.datetime
        return dt.datetime(d.year, d.month, d.day, d.hour, d.minute, d.second)

    def set_datetime(self, when: dt.datetime | None = None) -> None:
        when = when or dt.datetime.now()
        d = sys_pb.DateTime(year=when.year, month=when.month, day=when.day, hour=when.hour,
                            minute=when.minute, second=when.second, weekday=when.isoweekday())
        self._call(system_set_datetime_request=sys_pb.SetDateTimeRequest(datetime=d))

    def alert(self) -> None:
        """Blink, beep and vibrate — handy to find which Flipper is which."""
        self._call(system_play_audiovisual_alert_request=sys_pb.PlayAudiovisualAlertRequest())

    def reboot(self, mode: str = "os") -> None:
        m = {"os": 0, "dfu": 1, "update": 2}[mode]
        self.rpc.send(pb.Main(system_reboot_request=sys_pb.RebootRequest(mode=m)), wait=False)

    def prepare_update(self, manifest_path: str) -> None:
        r = self._call(system_update_request=sys_pb.UpdateRequest(update_manifest=manifest_path))
        code = r.system_update_response.code
        if code != sys_pb.UpdateResponse.OK:
            raise RuntimeError(f"update rejected: {sys_pb.UpdateResponse.UpdateResultCode.Name(code)}")

    # -- storage -----------------------------------------------------------

    def storage_info(self, path: str = "/ext") -> tuple[int, int]:
        r = self._call(storage_info_request=st_pb.InfoRequest(path=path)).storage_info_response
        return r.total_space, r.free_space

    def ls(self, path: str, md5: bool = False) -> list[Entry]:
        out = []
        for m in self._stream(storage_list_request=st_pb.ListRequest(path=path, include_md5=md5)):
            for f in m.storage_list_response.file:
                out.append(Entry(f.name, f.type == st_pb.File.DIR, f.size, f.md5sum))
        return sorted(out, key=lambda e: (not e.is_dir, e.name.lower()))

    def stat(self, path: str) -> Entry | None:
        try:
            f = self._call(storage_stat_request=st_pb.StatRequest(path=path)).storage_stat_response.file
        except RpcError as e:
            if e.status == pb.ERROR_STORAGE_NOT_EXIST:
                return None
            raise
        return Entry(posixpath.basename(path), f.type == st_pb.File.DIR, f.size)

    def exists(self, path: str) -> bool:
        return self.stat(path) is not None

    def walk(self, top: str) -> Iterator[tuple[str, list[Entry], list[Entry]]]:
        """Like os.walk, but over the Flipper's filesystem."""
        entries = self.ls(top)
        dirs = [e for e in entries if e.is_dir]
        files = [e for e in entries if not e.is_dir]
        yield top, dirs, files
        for d in dirs:
            yield from self.walk(posixpath.join(top, d.name))

    def read(self, path: str, progress: Progress | None = None) -> bytes:
        size = 0
        if progress:
            st = self.stat(path)
            size = st.size if st else 0
        data = bytearray()
        for m in self._stream(storage_read_request=st_pb.ReadRequest(path=path)):
            data += m.storage_read_response.file.data
            if progress:
                progress(len(data), size)
        return bytes(data)

    def write(self, path: str, data: bytes, progress: Progress | None = None) -> None:
        total = len(data)

        def parts():
            for off in range(0, max(total, 1), CHUNK):
                chunk = data[off:off + CHUNK]
                yield pb.Main(storage_write_request=st_pb.WriteRequest(path=path, file=st_pb.File(data=chunk)))
                if progress:
                    progress(off + len(chunk), total)

        self.rpc.send(parts(), timeout=max(self.rpc.timeout, total / 2000))

    def mkdir(self, path: str, parents: bool = False) -> None:
        if parents:
            parts = [p for p in path.split("/") if p]
            for i in range(2, len(parts) + 1):  # skip the /ext or /int root
                sub = "/" + "/".join(parts[:i])
                if not self.exists(sub):
                    self.mkdir(sub)
            return
        self._call(storage_mkdir_request=st_pb.MkdirRequest(path=path))

    def rm(self, path: str, recursive: bool = False) -> None:
        self._call(storage_delete_request=st_pb.DeleteRequest(path=path, recursive=recursive))

    def mv(self, src: str, dst: str) -> None:
        self._call(storage_rename_request=st_pb.RenameRequest(old_path=src, new_path=dst))

    def md5(self, path: str) -> str:
        return self._call(storage_md5sum_request=st_pb.Md5sumRequest(path=path)).storage_md5sum_response.md5sum

    def tar_extract(self, tar_path: str, out_path: str) -> None:
        self._call(storage_tar_extract_request=st_pb.TarExtractRequest(tar_path=tar_path, out_path=out_path))

    # -- apps & gui --------------------------------------------------------

    def app_start(self, name: str, args: str = "") -> None:
        self._call(app_start_request=app_pb.StartRequest(name=name, args=args))

    def app_exit(self) -> None:
        self._call(app_exit_request=app_pb.AppExitRequest())

    def app_load_file(self, path: str) -> None:
        self._call(app_load_file_request=app_pb.AppLoadFileRequest(path=path))

    def is_locked(self) -> bool:
        return self._call(app_lock_status_request=app_pb.LockStatusRequest()).app_lock_status_response.locked

    def press(self, key: str, kind: str = "short") -> None:
        """Simulate a button. kind=short sends the full press/short/release sequence."""
        k = KEYS[key.lower()]
        seq = {"short": ["PRESS", "SHORT", "RELEASE"], "long": ["PRESS", "LONG", "RELEASE"]}.get(kind, [kind.upper()])
        for t in seq:
            ev = gui_pb.SendInputEventRequest(key=k, type=gui_pb.InputType.Value(t))
            self._call(gui_send_input_event_request=ev)

    def start_screen(self, on_frame: Callable[[bytes], None]) -> Callable[[], None]:
        """Stream the 128x64 display. Returns a function that stops the stream."""

        def listener(m: pb.Main) -> None:
            if m.WhichOneof("content") == "gui_screen_frame":
                on_frame(m.gui_screen_frame.data)

        unsub = self.rpc.subscribe(listener)
        self._call(gui_start_screen_stream_request=gui_pb.StartScreenStreamRequest())

        def stop() -> None:
            unsub()
            if not self.rpc.closed:
                self._call(gui_stop_screen_stream_request=gui_pb.StopScreenStreamRequest())

        return stop

    def screenshot(self, timeout: float = 3.0) -> bytes:
        import threading

        got: list[bytes] = []
        ev = threading.Event()
        stop = self.start_screen(lambda d: (got.append(d), ev.set()))
        try:
            if not ev.wait(timeout):
                raise TimeoutError("no screen frame received")
        finally:
            stop()
        return got[0]
