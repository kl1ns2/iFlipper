"""rsync-style folder sync between the host and a Flipper, using MD5s to skip unchanged files."""

from __future__ import annotations

import hashlib
import posixpath
from dataclasses import dataclass
from fnmatch import fnmatch
from pathlib import Path

from .device import Flipper, Progress


@dataclass(frozen=True)
class Action:
    op: str  # "upload" | "download" | "delete" | "mkdir"
    path: str  # path relative to the synced roots
    size: int = 0


def _excluded(rel: str, exclude: list[str]) -> bool:
    return any(fnmatch(rel, pat) or fnmatch(posixpath.basename(rel), pat) for pat in exclude)


def remote_tree(f: Flipper, root: str, exclude: list[str] = ()) -> tuple[dict[str, tuple[int, str]], set[str]]:
    """{relative file path: (size, md5)} and the set of relative dirs under `root`."""
    files, dirs = {}, set()

    def visit(path: str, rel: str) -> None:
        for e in f.ls(path, md5=True):
            r = posixpath.join(rel, e.name) if rel else e.name
            if _excluded(r, exclude):
                continue
            if e.is_dir:
                dirs.add(r)
                visit(posixpath.join(path, e.name), r)
            else:
                files[r] = (e.size, e.md5)

    if f.exists(root):
        visit(root, "")
    return files, dirs


def local_tree(root: Path, exclude: list[str] = ()) -> tuple[dict[str, tuple[int, str]], set[str]]:
    files, dirs = {}, set()
    if root.is_dir():
        for p in sorted(root.rglob("*")):
            rel = p.relative_to(root).as_posix()
            if _excluded(rel, exclude):
                continue
            if p.is_dir():
                dirs.add(rel)
            else:
                files[rel] = (p.stat().st_size, hashlib.md5(p.read_bytes()).hexdigest())
    return files, dirs


def plan_push(local: Path, remote: str, f: Flipper, delete: bool = False, exclude: list[str] = ()) -> list[Action]:
    lf, ld = local_tree(local, exclude)
    rf, rd = remote_tree(f, remote, exclude)
    acts = [Action("mkdir", d) for d in sorted(ld - rd)]
    acts += [Action("upload", p, lf[p][0]) for p in sorted(lf) if rf.get(p, (0, ""))[1] != lf[p][1]]
    if delete:
        acts += [Action("delete", p) for p in sorted(set(rf) - set(lf))]
        acts += [Action("delete", d) for d in sorted(rd - ld, reverse=True)]
    return acts


def plan_pull(remote: str, local: Path, f: Flipper, delete: bool = False, exclude: list[str] = ()) -> list[Action]:
    lf, ld = local_tree(local, exclude)
    rf, rd = remote_tree(f, remote, exclude)
    acts = [Action("mkdir", d) for d in sorted(rd - ld)]
    acts += [Action("download", p, rf[p][0]) for p in sorted(rf) if lf.get(p, (0, ""))[1] != rf[p][1]]
    if delete:
        acts += [Action("delete", p) for p in sorted(set(lf) - set(rf))]
        acts += [Action("delete", d) for d in sorted(ld - rd, reverse=True)]
    return acts


def apply_push(f: Flipper, local: Path, remote: str, acts: list[Action], progress: Progress | None = None) -> None:
    if not f.exists(remote):
        f.mkdir(remote, parents=True)
    for a in acts:
        dst = posixpath.join(remote, a.path)
        if a.op == "mkdir":
            f.mkdir(dst)
        elif a.op == "upload":
            f.write(dst, (local / a.path).read_bytes(), progress)
        elif a.op == "delete":
            f.rm(dst, recursive=True)


def apply_pull(f: Flipper, remote: str, local: Path, acts: list[Action], progress: Progress | None = None) -> None:
    local.mkdir(parents=True, exist_ok=True)
    for a in acts:
        dst = local / a.path
        if a.op == "mkdir":
            dst.mkdir(parents=True, exist_ok=True)
        elif a.op == "download":
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(f.read(posixpath.join(remote, a.path), progress))
        elif a.op == "delete":
            if dst.is_dir():
                dst.rmdir()
            else:
                dst.unlink()
