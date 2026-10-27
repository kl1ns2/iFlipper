"""`iflipper` command line."""

from __future__ import annotations

import datetime as dt
import json
import os
import posixpath
import sys
import time
from pathlib import Path

import click
from rich.console import Console
from rich.progress import BarColumn, DownloadColumn, Progress, TransferSpeedColumn
from rich.table import Table
from rich.tree import Tree

from . import __version__, screen
from .device import Flipper, FlipperError
from .transport import find_flippers

console = Console()
err = Console(stderr=True)


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return str(n)


def transfer_bar() -> Progress:
    return Progress("[progress.description]{task.description}", BarColumn(), DownloadColumn(),
                    TransferSpeedColumn(), console=err, transient=True)


class Ctx:
    def __init__(self, target: str | None):
        self.target = target
        self._f: Flipper | None = None

    @property
    def f(self) -> Flipper:
        if self._f is None:
            try:
                self._f = Flipper.connect(self.target)
            except (ConnectionError, OSError, TimeoutError) as e:
                raise click.ClickException(str(e)) from e
        return self._f

    def close(self) -> None:
        if self._f:
            self._f.close()


pass_ctx = click.make_pass_decorator(Ctx)


class Group(click.Group):
    def invoke(self, ctx):
        try:
            return super().invoke(ctx)
        except (FlipperError, TimeoutError, ConnectionError) as e:
            raise click.ClickException(str(e) or type(e).__name__) from e


@click.group(cls=Group)
@click.option("-p", "--port", envvar="IFLIPPER_PORT", help="Serial port or tcp://host:port (default: autodetect).")
@click.version_option(__version__)
@click.pass_context
def main(ctx: click.Context, port: str | None) -> None:
    """iFlipper — a fast, scriptable companion for Flipper Zero."""
    ctx.obj = Ctx(port)
    ctx.call_on_close(ctx.obj.close)


# -- device ------------------------------------------------------------------


@main.command()
def devices() -> None:
    """List connected Flippers."""
    ports = find_flippers()
    if not ports:
        err.print("[yellow]No Flipper Zero found.[/]")
        return
    for p in ports:
        console.print(f"[bold orange1]{p.name or 'flipper'}[/]  {p.device}")


@main.command()
@click.option("--json", "as_json", is_flag=True)
@pass_ctx
def info(c: Ctx, as_json: bool) -> None:
    """Device, firmware, battery and storage overview."""
    f = c.f
    data = {"device": f.info(), "power": f.power()}
    data["storage"] = {}
    for root in ("/int", "/ext"):
        try:
            total, free = f.storage_info(root)
            data["storage"][root] = {"total": total, "free": free}
        except FlipperError:
            pass
    if as_json:
        console.print_json(json.dumps(data))
        return
    d, p = data["device"], data["power"]
    t = Table.grid(padding=(0, 2))
    t.add_column(style="dim")
    t.add_column()
    t.add_row("Name", f"[bold orange1]{d.get('hardware_name', '?')}[/]")
    t.add_row("Firmware", f"{d.get('firmware_version', '?')} ({d.get('firmware_branch', '?')}, "
                          f"{d.get('firmware_commit', '?')}, {d.get('firmware_build_date', '?')})")
    t.add_row("Hardware", f"{d.get('hardware_model', '?')} v{d.get('hardware_ver', '?')}, "
                          f"region {d.get('hardware_region_provisioned', '?')}")
    t.add_row("UID", d.get("hardware_uid", "?"))
    t.add_row("Battery", f"{p.get('charge_level', '?')}% · {p.get('charge_state', '?')} · "
                         f"{p.get('battery_voltage', '?')} V · health {p.get('battery_health', '?')}%")
    for root, s in data["storage"].items():
        used = s["total"] - s["free"]
        pct = used / s["total"] * 100 if s["total"] else 0
        t.add_row(f"Storage {root}", f"{human(used)} / {human(s['total'])} ({pct:.0f}%)")
    console.print(t)


@main.command()
@pass_ctx
def alert(c: Ctx) -> None:
    """Blink, beep and vibrate."""
    c.f.alert()


@main.command()
@click.option("--mode", type=click.Choice(["os", "dfu", "update"]), default="os")
@pass_ctx
def reboot(c: Ctx, mode: str) -> None:
    """Reboot the Flipper."""
    c.f.reboot(mode)
    console.print(f"Rebooting into {mode}…")


@main.command("time")
@click.option("--sync", "do_sync", is_flag=True, help="Set the Flipper clock to this computer's time.")
@pass_ctx
def time_cmd(c: Ctx, do_sync: bool) -> None:
    """Show (or sync) the Flipper's clock."""
    if do_sync:
        c.f.set_datetime()
    t = c.f.get_datetime()
    drift = (t - dt.datetime.now()).total_seconds()
    console.print(f"{t:%Y-%m-%d %H:%M:%S}  (drift {drift:+.0f}s)")


# -- storage -----------------------------------------------------------------


@main.command()
@click.argument("path", default="/ext")
@click.option("-l", "long", is_flag=True, help="Show sizes.")
@pass_ctx
def ls(c: Ctx, path: str, long: bool) -> None:
    """List a directory."""
    for e in c.f.ls(path):
        name = f"[bold blue]{e.name}/[/]" if e.is_dir else e.name
        console.print(f"{'' if e.is_dir else human(e.size):>9}  {name}" if long else name, highlight=False)


@main.command()
@click.argument("path", default="/ext")
@click.option("-d", "--depth", default=3)
@pass_ctx
def tree(c: Ctx, path: str, depth: int) -> None:
    """Show a directory tree."""
    root = Tree(f"[bold orange1]{path}[/]")

    def add(node: Tree, p: str, level: int) -> None:
        for e in c.f.ls(p):
            if e.is_dir:
                child = node.add(f"[bold blue]{e.name}/[/]")
                if level < depth:
                    add(child, posixpath.join(p, e.name), level + 1)
            else:
                node.add(f"{e.name} [dim]{human(e.size)}[/]")

    add(root, path, 1)
    console.print(root)


@main.command()
@click.argument("path")
@pass_ctx
def cat(c: Ctx, path: str) -> None:
    """Print a file to stdout."""
    sys.stdout.buffer.write(c.f.read(path))


@main.command()
@click.argument("path")
@pass_ctx
def md5(c: Ctx, path: str) -> None:
    """MD5 of a file, computed on the Flipper."""
    console.print(c.f.md5(path))


@main.command()
@click.argument("path")
@click.option("-p", "parents", is_flag=True, help="Create parent directories.")
@pass_ctx
def mkdir(c: Ctx, path: str, parents: bool) -> None:
    """Create a directory."""
    c.f.mkdir(path, parents)


@main.command()
@click.argument("paths", nargs=-1, required=True)
@click.option("-r", "recursive", is_flag=True)
@pass_ctx
def rm(c: Ctx, paths: tuple[str, ...], recursive: bool) -> None:
    """Delete files or directories."""
    for p in paths:
        c.f.rm(p, recursive)


@main.command()
@click.argument("src")
@click.argument("dst")
@pass_ctx
def mv(c: Ctx, src: str, dst: str) -> None:
    """Move / rename."""
    c.f.mv(src, dst)


@main.command()
@click.argument("local", type=click.Path(exists=True, path_type=Path))
@click.argument("remote", default="/ext")
@pass_ctx
def push(c: Ctx, local: Path, remote: str) -> None:
    """Upload a file or folder. Folders are synced (unchanged files are skipped)."""
    f = c.f
    if local.is_dir():
        _sync(f, "push", local, posixpath.join(remote, local.name), delete=False, dry_run=False, exclude=())
        return
    st = f.stat(remote)
    dst = posixpath.join(remote, local.name) if st and st.is_dir else remote
    data = local.read_bytes()
    with transfer_bar() as bar:
        task = bar.add_task(local.name, total=len(data))
        f.write(dst, data, lambda done, total: bar.update(task, completed=done))
    console.print(f"[green]✓[/] {dst} ({human(len(data))})")


@main.command()
@click.argument("remote")
@click.argument("local", default=".", type=click.Path(path_type=Path))
@pass_ctx
def pull(c: Ctx, remote: str, local: Path) -> None:
    """Download a file or folder."""
    f = c.f
    st = f.stat(remote)
    if st is None:
        raise click.ClickException(f"{remote}: no such file")
    if st.is_dir:
        _sync(f, "pull", local / posixpath.basename(remote.rstrip("/")), remote, delete=False, dry_run=False,
              exclude=())
        return
    dst = local / posixpath.basename(remote) if local.is_dir() else local
    with transfer_bar() as bar:
        task = bar.add_task(posixpath.basename(remote), total=st.size)
        data = f.read(remote, lambda done, total: bar.update(task, completed=done))
    dst.write_bytes(data)
    console.print(f"[green]✓[/] {dst} ({human(len(data))})")


def _sync(f: Flipper, direction: str, local: Path, remote: str, delete: bool, dry_run: bool, exclude) -> None:
    from . import sync

    with console.status("Comparing…"):
        if direction == "push":
            acts = sync.plan_push(local, remote, f, delete, list(exclude))
        else:
            acts = sync.plan_pull(remote, local, f, delete, list(exclude))
    if not acts:
        console.print("[green]✓ Already in sync.[/]")
        return
    icon = {"upload": "[green]↑[/]", "download": "[cyan]↓[/]", "delete": "[red]✗[/]", "mkdir": "[blue]+[/]"}
    for a in acts:
        console.print(f"{icon[a.op]} {a.path}" + (f" [dim]{human(a.size)}[/]" if a.size else ""), highlight=False)
    if dry_run:
        console.print("[yellow](dry run — nothing changed)[/]")
        return
    total = sum(a.size for a in acts)
    with transfer_bar() as bar:
        task = bar.add_task("sync", total=total)
        done_before = [0]
        last = [0]

        def prog(done: int, _t: int) -> None:
            if done < last[0]:
                done_before[0] += last[0]
            last[0] = done
            bar.update(task, completed=done_before[0] + done)

        if direction == "push":
            sync.apply_push(f, local, remote, acts, prog)
        else:
            sync.apply_pull(f, remote, local, acts, prog)
    console.print(f"[green]✓ {len(acts)} change(s) applied.[/]")


@main.command("sync")
@click.argument("direction", type=click.Choice(["push", "pull"]))
@click.argument("local", type=click.Path(path_type=Path))
@click.argument("remote")
@click.option("--delete", is_flag=True, help="Delete files missing on the source side.")
@click.option("-n", "--dry-run", is_flag=True)
@click.option("-x", "--exclude", multiple=True, help="Glob to skip (repeatable).")
@pass_ctx
def sync_cmd(c: Ctx, direction: str, local: Path, remote: str, delete: bool, dry_run: bool, exclude) -> None:
    """Mirror a local folder and a Flipper folder (MD5-based, only changes are transferred).

    \b
      iflipper sync push ./my-subghz /ext/subghz
      iflipper sync pull ./nfc-dump /ext/nfc --delete
    """
    _sync(c.f, direction, local, remote, delete, dry_run, exclude)


# -- backup / update ---------------------------------------------------------


@main.command()
@click.argument("out", required=False, type=click.Path(path_type=Path))
@click.option("--root", "roots", multiple=True, default=["/int", "/ext"], show_default=True)
@click.option("--since", type=click.Path(exists=True, path_type=Path),
              help="Earlier backup: files with identical content are copied from it, not re-downloaded.")
@click.option("-x", "--exclude", multiple=True)
@pass_ctx
def backup(c: Ctx, out: Path | None, roots, since: Path | None, exclude) -> None:
    """Back up the whole device into a .tar.gz."""
    from . import backup as bk

    f = c.f
    name = f.info().get("hardware_name", "flipper")
    out = out or Path(f"{name}-{dt.datetime.now():%Y%m%d-%H%M%S}.tar.gz")
    with console.status("Backing up…") as status:
        stats = bk.create(f, out, list(roots), list(exclude) or bk.DEFAULT_EXCLUDE, since,
                          log=lambda s: status.update(f"Backing up… {s}"))
    console.print(f"[green]✓[/] {out}: {stats['files']} files, {human(stats['bytes'])}"
                  + (f", {stats['reused']} reused from {since.name}" if since else ""))


@main.command()
@click.argument("archive", type=click.Path(exists=True, path_type=Path))
@click.option("--only", help="Restore only this path (e.g. /ext/nfc).")
@click.option("-n", "--dry-run", is_flag=True)
@pass_ctx
def restore(c: Ctx, archive: Path, only: str | None, dry_run: bool) -> None:
    """Restore a backup (only files that differ are uploaded)."""
    from . import backup as bk

    with console.status("Restoring…") as status:
        stats = bk.restore(c.f, archive, only, dry_run, log=lambda s: (status.update(s), console.print(s)))
    console.print(f"[green]✓[/] {stats['uploaded']} uploaded, {stats['skipped']} unchanged"
                  + (" [yellow](dry run)[/]" if dry_run else ""))


@main.command()
@click.option("--channel", type=click.Choice(["release", "rc", "dev"]), default="release")
@click.option("--file", "pkg_file", type=click.Path(exists=True, path_type=Path),
              help="Install a local update package (.tgz) — e.g. a custom firmware.")
@click.option("--url", help="Install an update package from a URL.")
@click.option("--check", is_flag=True, help="Only show available versions.")
@click.option("-y", "--yes", is_flag=True)
@pass_ctx
def update(c: Ctx, channel: str, pkg_file: Path | None, url: str | None, check: bool, yes: bool) -> None:
    """Update firmware from an official channel or a custom package."""
    from . import update as up

    sha = ""
    if pkg_file is None and url is None:
        with console.status("Fetching firmware directory…"):
            rels = up.releases(up.fetch_directory())
        ids = {"release": "release", "rc": "release-candidate", "dev": "development"}
        if check:
            for r in rels.values():
                console.print(f"[bold]{r.channel:<18}[/] {r.version}")
            console.print(f"[dim]installed:[/] {c.f.info().get('firmware_version', '?')}")
            return
        rel = rels.get(ids[channel])
        if rel is None:
            raise click.ClickException(f"no {channel} build for this target")
        url, sha = rel.url, rel.sha256
        console.print(f"Latest {channel}: [bold]{rel.version}[/] (installed {c.f.info().get('firmware_version')})")
    if pkg_file:
        pkg = pkg_file.read_bytes()
    else:
        with transfer_bar() as bar:
            task = bar.add_task("download", total=None)
            pkg = up.download(url, sha, lambda d, t: bar.update(task, completed=d, total=t or None))
    name, files = up.unpack(pkg)
    if not yes and not click.confirm(f"Install {name} ({len(files)} files)?", default=True):
        return
    with transfer_bar() as bar:
        task = bar.add_task("upload", total=sum(map(len, files.values())))
        up.install(c.f, pkg, progress=lambda d, t: bar.update(task, completed=d))
    console.print("[green]✓ Package uploaded — the Flipper is rebooting to install it.[/]")


# -- screen & input ----------------------------------------------------------


@main.command()
@click.argument("out", required=False, type=click.Path(path_type=Path))
@click.option("--scale", default=4, show_default=True)
@click.option("--text", is_flag=True, help="Print to the terminal instead of saving a PNG.")
@pass_ctx
def screenshot(c: Ctx, out: Path | None, scale: int, text: bool) -> None:
    """Grab the Flipper's screen as a PNG."""
    fr = c.f.screenshot()
    if text:
        for line in screen.to_halfblocks(fr):
            console.print(line, style="black on dark_orange", highlight=False, markup=False, soft_wrap=True)
        return
    out = out or Path(f"flipper-{dt.datetime.now():%Y%m%d-%H%M%S}.png")
    screen.to_image(fr, scale).save(out)
    console.print(f"[green]✓[/] {out}")


@main.command()
@click.argument("keys", nargs=-1, required=True)
@click.option("--long", "long_", is_flag=True, help="Long press.")
@click.option("--delay", default=0.15, help="Seconds between keys.")
@pass_ctx
def press(c: Ctx, keys: tuple[str, ...], long_: bool, delay: float) -> None:
    """Press buttons: up down left right ok back (e.g. `press down down ok`)."""
    for k in keys:
        if k.lower() not in ("up", "down", "left", "right", "ok", "back"):
            raise click.BadParameter(f"unknown key {k!r}")
        c.f.press(k, "long" if long_ else "short")
        time.sleep(delay)


@main.group()
def app() -> None:
    """Start / stop applications."""


@app.command("start")
@click.argument("name")
@click.argument("args", default="")
@pass_ctx
def app_start(c: Ctx, name: str, args: str) -> None:
    """Start an app, e.g. `app start "Sub-GHz" /ext/subghz/door.sub`."""
    c.f.app_start(name, args)


@app.command("exit")
@pass_ctx
def app_exit(c: Ctx) -> None:
    c.f.app_exit()


# -- power tools -------------------------------------------------------------


@main.command()
@pass_ctx
def tui(c: Ctx) -> None:
    """Full-screen dashboard: device info, file manager, live screen + remote control."""
    from .tui import IFlipperApp

    IFlipperApp(c.target).run()


@main.command()
@pass_ctx
def gui(c: Ctx) -> None:
    """3D desktop app: finds the plugged-in Flipper by itself, live screen, customization, files."""
    from .gui import main as gui_main

    gui_main(c.target)


@main.command()
@click.argument("script", required=False, type=click.Path(exists=True, path_type=Path))
@pass_ctx
def shell(c: Ctx, script: Path | None) -> None:
    """Python REPL (or run SCRIPT) with a connected Flipper as `f`."""
    ns = {"f": c.f, "Flipper": Flipper, "screen": screen}
    if script:
        exec(compile(script.read_text(), str(script), "exec"), ns)
        return
    import code

    code.interact(banner=f"iFlipper {__version__} — `f` is your Flipper. Try f.info(), f.ls('/ext').", local=ns)


@main.command()
@click.option("--root", default=lambda: os.path.join(Path.home(), ".iflipper", "emulator"),
              type=click.Path(path_type=Path), help="Host folder backing /ext and /int.")
@click.option("--tcp", "tcp_port", type=int, help="Listen on this TCP port.")
@click.option("--pty", "use_pty", is_flag=True, help="Expose as a pseudo serial port (Linux/macOS).")
@click.option("--name", default="Emulatr")
def emulate(root: Path, tcp_port: int | None, use_pty: bool, name: str) -> None:
    """Run a virtual Flipper Zero for development and testing."""
    from .emulator import VirtualFlipper

    emu = VirtualFlipper(root, name)
    console.print(f"[bold orange1]Virtual Flipper '{name}'[/] — storage in {root}")
    if use_pty or not tcp_port:
        path = emu.open_pty()
        console.print(f"Serial port: [bold]{path}[/]   →  iflipper -p {path} info")
    if tcp_port:
        console.print(f"TCP: [bold]tcp://127.0.0.1:{tcp_port}[/]   →  iflipper -p tcp://127.0.0.1:{tcp_port} info")
        emu.serve_tcp(tcp_port)
    else:
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
