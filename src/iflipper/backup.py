"""Full-device backups as plain .tar.gz files, with incremental reuse of unchanged files."""

from __future__ import annotations

import datetime as dt
import hashlib
import io
import json
import posixpath
import tarfile
from collections.abc import Callable
from pathlib import Path

from .device import Flipper
from .sync import remote_tree

MANIFEST = "iflipper-backup.json"
DEFAULT_EXCLUDE = ["update", ".Trash*"]

Log = Callable[[str], None]


def _read_previous(prev: Path | None) -> dict[str, bytes]:
    """Map md5 -> content for every file in an earlier backup."""
    if not prev or not prev.exists():
        return {}
    out = {}
    with tarfile.open(prev) as tf:
        for m in tf.getmembers():
            if m.isfile() and m.name != MANIFEST:
                data = tf.extractfile(m).read()
                out[hashlib.md5(data).hexdigest()] = data
    return out


def create(f: Flipper, out: Path, roots: list[str] = ("/int", "/ext"), exclude: list[str] = DEFAULT_EXCLUDE,
           previous: Path | None = None, log: Log = lambda s: None) -> dict:
    """Back up `roots` into `out`. Files whose MD5 matches `previous` are not re-downloaded."""
    reuse = _read_previous(previous)
    manifest = {"created": dt.datetime.now().isoformat(timespec="seconds"), "device": f.info(), "files": {}}
    stats = {"files": 0, "bytes": 0, "reused": 0}
    out.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(out, "w:gz") as tf:
        for root in roots:
            files, dirs = remote_tree(f, root, exclude)
            top = root.strip("/")
            for d in sorted(dirs):
                ti = tarfile.TarInfo(f"{top}/{d}")
                ti.type = tarfile.DIRTYPE
                ti.mode = 0o755
                tf.addfile(ti)
            for rel, (size, md5) in sorted(files.items()):
                path = posixpath.join(root, rel)
                if md5 and md5 in reuse:
                    data = reuse[md5]
                    stats["reused"] += 1
                else:
                    log(f"↓ {path}")
                    data = f.read(path)
                ti = tarfile.TarInfo(f"{top}/{rel}")
                ti.size = len(data)
                ti.mode = 0o644
                tf.addfile(ti, io.BytesIO(data))
                manifest["files"][path] = hashlib.md5(data).hexdigest()
                stats["files"] += 1
                stats["bytes"] += len(data)
        blob = json.dumps(manifest, indent=2).encode()
        ti = tarfile.TarInfo(MANIFEST)
        ti.size = len(blob)
        tf.addfile(ti, io.BytesIO(blob))
    return stats


def restore(f: Flipper, archive: Path, only: str | None = None, dry_run: bool = False,
            log: Log = lambda s: None) -> dict:
    """Upload files from `archive` whose content differs on the device."""
    stats = {"uploaded": 0, "skipped": 0}
    with tarfile.open(archive) as tf:
        members = [m for m in tf.getmembers() if m.name != MANIFEST]
        for m in members:
            path = "/" + m.name.strip("/")
            if only and not (path == only or path.startswith(only.rstrip("/") + "/")):
                continue
            if m.isdir():
                if not dry_run and not f.exists(path):
                    f.mkdir(path, parents=True)
                continue
            data = tf.extractfile(m).read()
            st = f.stat(path)
            if st and st.size == len(data) and f.md5(path) == hashlib.md5(data).hexdigest():
                stats["skipped"] += 1
                continue
            log(f"↑ {path}")
            stats["uploaded"] += 1
            if not dry_run:
                parent = posixpath.dirname(path)
                if not f.exists(parent):
                    f.mkdir(parent, parents=True)
                f.write(path, data)
    return stats
