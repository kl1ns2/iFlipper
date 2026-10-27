import asyncio
import io
import tarfile
import time
from pathlib import Path

import pytest
from click.testing import CliRunner

from iflipper import Flipper, FlipperError, backup, screen, sync, update
from iflipper.emulator import VirtualFlipper
from iflipper.proto import flipper_pb2 as pb
from iflipper.rpc import FrameDecoder, encode_varint, frame


@pytest.fixture
def emu(tmp_path):
    return VirtualFlipper(tmp_path / "device")


@pytest.fixture
def f(emu):
    with Flipper(emu.pipe()) as fl:
        yield fl


def test_framing_roundtrip_split_bytes():
    msgs = [pb.Main(command_id=i, system_ping_request={"data": bytes(i * 50)}) for i in range(1, 6)]
    blob = b"".join(frame(m) for m in msgs)
    dec, out = FrameDecoder(), []
    for b in blob:  # worst case: one byte at a time
        out += dec.feed(bytes([b]))
    assert [pb.Main.FromString(r).command_id for r in out] == [1, 2, 3, 4, 5]
    assert encode_varint(300) == b"\xac\x02"


def test_system(f, emu):
    assert f.ping(b"abc") == b"abc"
    assert f.info()["hardware_name"] == "Emulatr"
    assert f.power()["charge_level"] == "87"
    f.alert()
    assert emu.alerts == 1


def test_storage_roundtrip(f):
    f.mkdir("/ext/a/b", parents=True)
    data = bytes(range(256)) * 13  # several 512-byte chunks, not aligned
    f.write("/ext/a/b/x.bin", data)
    assert f.read("/ext/a/b/x.bin") == data
    assert f.stat("/ext/a/b/x.bin").size == len(data)
    f.write("/ext/a/empty", b"")
    assert f.read("/ext/a/empty") == b""
    f.mv("/ext/a/b/x.bin", "/ext/a/y.bin")
    assert [e.name for e in f.ls("/ext/a")] == ["b", "empty", "y.bin"]
    with pytest.raises(FlipperError, match="DIR_NOT_EMPTY"):
        f.rm("/ext/a")
    f.rm("/ext/a", recursive=True)
    assert f.stat("/ext/a") is None


def test_many_files_listing(f):
    f.mkdir("/ext/many")
    for i in range(20):
        f.write(f"/ext/many/{i:02}.txt", b"x")
    assert len(f.ls("/ext/many")) == 20  # spans several has_next ListResponses


def test_path_escape_rejected(f):
    with pytest.raises(FlipperError):
        f.read("/ext/../../etc/passwd")


def test_sync_push_pull(f, tmp_path):
    src = tmp_path / "src"
    (src / "sub").mkdir(parents=True)
    (src / "a.txt").write_text("one")
    (src / "sub" / "b.txt").write_text("two")
    acts = sync.plan_push(src, "/ext/s", f)
    assert {a.op for a in acts} == {"mkdir", "upload"}
    sync.apply_push(f, src, "/ext/s", acts)
    assert sync.plan_push(src, "/ext/s", f) == []

    (src / "a.txt").write_text("changed")
    (src / "sub" / "b.txt").unlink()
    acts = sync.plan_push(src, "/ext/s", f, delete=True)
    assert [(a.op, a.path) for a in acts] == [("upload", "a.txt"), ("delete", "sub/b.txt")]
    sync.apply_push(f, src, "/ext/s", acts)

    dst = tmp_path / "dst"
    sync.apply_pull(f, "/ext/s", dst, sync.plan_pull("/ext/s", dst, f))
    assert (dst / "a.txt").read_text() == "changed"
    assert (dst / "sub").is_dir()


def test_backup_incremental_and_restore(f, tmp_path):
    f.mkdir("/ext/nfc")
    f.write("/ext/nfc/card.nfc", b"card")
    f.write("/ext/big.bin", b"\x01" * 3000)
    b1, b2 = tmp_path / "b1.tgz", tmp_path / "b2.tgz"
    assert backup.create(f, b1)["files"] == 2
    f.write("/ext/nfc/card.nfc", b"card v2")
    stats = backup.create(f, b2, previous=b1)
    assert stats == {"files": 2, "bytes": 3007, "reused": 1}

    f.rm("/ext/nfc", recursive=True)
    st = backup.restore(f, b2)
    assert st == {"uploaded": 1, "skipped": 1}
    assert f.read("/ext/nfc/card.nfc") == b"card v2"


def _package(name="f7-update-1.2.3", extra=None):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        files = {f"{name}/update.fuf": b"Filetype: Flipper firmware upgrade configuration\n",
                 f"{name}/firmware.dfu": b"\x00" * 2000, f"{name}/resources.tar": b"res"}
        files.update(extra or {})
        for path, data in files.items():
            ti = tarfile.TarInfo(path)
            ti.size = len(data)
            tf.addfile(ti, io.BytesIO(data))
    return buf.getvalue()


def test_update_install(f, emu):
    manifest = update.install(f, _package())
    assert manifest == "/ext/update/f7-update-1.2.3/update.fuf"
    assert emu.update_manifest == manifest
    assert f.read("/ext/update/f7-update-1.2.3/firmware.dfu") == b"\x00" * 2000
    time.sleep(0.1)
    assert emu.reboots == [2]  # UPDATE mode


def test_update_rejects_bad_packages():
    with pytest.raises(ValueError):
        update.unpack(_package(extra={"evil/../../x": b""}))


def test_releases_parsing():
    directory = {"channels": [{"id": "release", "versions": [{"version": "1.3.4", "files": [
        {"target": "f7", "type": "full_dfu", "url": "x"},
        {"target": "f7", "type": "update_tgz", "url": "https://u/f7.tgz", "sha256": "ab"}]}]}]}
    r = update.releases(directory)["release"]
    assert (r.version, r.url, r.sha256) == ("1.3.4", "https://u/f7.tgz", "ab")


def test_screen_and_input(f, emu):
    fr = f.screenshot()
    assert len(fr) == 1024
    assert screen.to_frame(screen.pixels(fr)) == fr
    f.press("down")
    f.press("ok")
    assert emu.app == "125 kHz RFID"
    assert f.is_locked()
    f.press("back")
    assert emu.app is None


def test_app_errors(f):
    f.app_start("NFC")
    with pytest.raises(FlipperError, match="SYSTEM_LOCKED"):
        f.app_start("Infrared")
    f.app_exit()


def test_pty_serial_transport(emu):
    path = emu.open_pty()
    with Flipper.connect(path) as fl:
        assert fl.ping() == b"iflipper"
        fl.write("/ext/p.txt", b"via pty")
        assert fl.read("/ext/p.txt") == b"via pty"


def test_cli(emu, tmp_path, monkeypatch):
    from iflipper import cli

    monkeypatch.setattr(Flipper, "connect", classmethod(lambda cls, target=None, **kw: Flipper(emu.pipe())))
    r = CliRunner()
    (tmp_path / "hello.txt").write_text("hi")
    assert r.invoke(cli.main, ["push", str(tmp_path / "hello.txt"), "/ext"]).exit_code == 0
    res = r.invoke(cli.main, ["cat", "/ext/hello.txt"])
    assert res.output == "hi"
    res = r.invoke(cli.main, ["info", "--json"])
    assert '"hardware_name": "Emulatr"' in res.output
    res = r.invoke(cli.main, ["rm", "/ext/missing"])
    assert res.exit_code == 1 and "NOT_EXIST" in res.output
    assert r.invoke(cli.main, ["screenshot", str(tmp_path / "s.png")]).exit_code == 0
    assert (tmp_path / "s.png").stat().st_size > 100


def test_tui(emu, tmp_path):
    from iflipper.tui import IFlipperApp

    (Path(emu.root) / "ext" / "hello.txt").write_text("hi")

    async def run():
        app = IFlipperApp(flipper=Flipper(emu.pipe()))
        async with app.run_test(size=(180, 50)) as pilot:
            for _ in range(50):
                await pilot.pause(0.05)
                if app.last_frame and app.query_one("Tree").root.children[0].children:
                    break
            ext = app.query_one("Tree").root.children[0]
            assert [c.data.name for c in ext.children] == ["hello.txt"]
            assert app.sub_title == "Emulatr"
            await pilot.press("f2", "down", "enter")
            for _ in range(20):
                await pilot.pause(0.05)
                if emu.app:
                    break
            assert emu.app == "125 kHz RFID"

    asyncio.run(run())
