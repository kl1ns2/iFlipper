"""Firmware updates: official channels or any custom update package (.tgz)."""

from __future__ import annotations

import hashlib
import io
import posixpath
import tarfile
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass

from .device import Flipper, Progress

DIRECTORY_URL = "https://update.flipperzero.one/firmware/directory.json"
UPDATE_DIR = "/ext/update"


@dataclass
class Release:
    channel: str
    version: str
    url: str
    sha256: str
    changelog: str = ""


def fetch_directory(url: str = DIRECTORY_URL) -> dict:
    import json

    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


def releases(directory: dict, target: str = "f7") -> dict[str, Release]:
    """Latest update package per channel (release / release-candidate / development)."""
    out = {}
    for ch in directory.get("channels", []):
        for v in ch.get("versions", [])[:1]:
            for fl in v.get("files", []):
                if fl.get("target") == target and fl.get("type") == "update_tgz":
                    out[ch["id"]] = Release(ch["id"], v["version"], fl["url"], fl.get("sha256", ""),
                                            v.get("changelog", ""))
    return out


def download(url: str, sha256: str = "", progress: Progress | None = None) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as r:
        total = int(r.headers.get("Content-Length") or 0)
        buf = bytearray()
        while chunk := r.read(64 * 1024):
            buf += chunk
            if progress:
                progress(len(buf), total)
    if sha256 and hashlib.sha256(buf).hexdigest() != sha256.lower():
        raise ValueError("update package checksum mismatch")
    return bytes(buf)


def unpack(package: bytes) -> tuple[str, dict[str, bytes]]:
    """Return (package dir name, {relative path: data}) for an update .tgz."""
    with tarfile.open(fileobj=io.BytesIO(package)) as tf:
        files = {m.name: tf.extractfile(m).read() for m in tf.getmembers() if m.isfile()}
    manifests = [p for p in files if posixpath.basename(p) == "update.fuf"]
    if len(manifests) != 1:
        raise ValueError("not a Flipper update package (expected exactly one update.fuf)")
    top = posixpath.dirname(manifests[0])
    if not top or "/" in top:
        raise ValueError("update.fuf must sit in the package's top-level folder")
    for p in files:
        if not p.startswith(top + "/") or ".." in p.split("/"):
            raise ValueError(f"unexpected path in package: {p}")
    return top, {p[len(top) + 1:]: d for p, d in files.items()}


def install(f: Flipper, package: bytes, reboot: bool = True, log: Callable[[str], None] = lambda s: None,
            progress: Progress | None = None) -> str:
    """Upload an update package, register it with the updater and reboot into it."""
    name, files = unpack(package)
    dest = posixpath.join(UPDATE_DIR, name)
    if f.exists(dest):
        f.rm(dest, recursive=True)
    f.mkdir(dest, parents=True)
    total = sum(len(d) for d in files.values())
    sent = 0
    for rel, data in sorted(files.items()):
        path = posixpath.join(dest, rel)
        parent = posixpath.dirname(path)
        if not f.exists(parent):
            f.mkdir(parent, parents=True)
        log(f"↑ {path}")
        base = sent
        f.write(path, data, (lambda done, _t, b=base: progress(b + done, total)) if progress else None)
        sent += len(data)
    manifest = posixpath.join(dest, "update.fuf")
    f.prepare_update(manifest)
    if reboot:
        f.reboot("update")
    return manifest
