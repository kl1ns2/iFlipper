"""Full-screen terminal dashboard (`iflipper tui`)."""

from __future__ import annotations

import datetime as dt
import posixpath
from pathlib import Path

from rich.text import Text
from textual import on, work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.screen import ModalScreen
from textual.widgets import Footer, Header, Input, Label, ProgressBar, RichLog, Static, TabbedContent, TabPane, Tree

from . import screen
from .device import Entry, Flipper


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return str(n)


class Prompt(ModalScreen[str]):
    DEFAULT_CSS = """
    Prompt { align: center middle; }
    Prompt > Vertical { width: 70; height: auto; border: round $accent; background: $panel; padding: 1 2; }
    """
    BINDINGS = [Binding("escape", "dismiss('')", "Cancel")]

    def __init__(self, title: str, value: str = ""):
        super().__init__()
        self.title_text, self.value = title, value

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label(self.title_text)
            yield Input(self.value)

    @on(Input.Submitted)
    def done(self, ev: Input.Submitted) -> None:
        self.dismiss(ev.value)


class Display(Static, can_focus=True):
    """The Flipper's screen, mirrored live; arrow keys / enter / backspace drive the device."""

    BINDINGS = [
        Binding("up", "key('up')", "↑", show=False),
        Binding("down", "key('down')", "↓", show=False),
        Binding("left", "key('left')", "←", show=False),
        Binding("right", "key('right')", "→", show=False),
        Binding("enter", "key('ok')", "OK"),
        Binding("backspace", "key('back')", "Back"),
        Binding("shift+enter,L", "key('ok', 'long')", "Long OK", show=False),
        Binding("s", "app.screenshot", "Screenshot"),
    ]
    DEFAULT_CSS = "Display { width: auto; height: auto; border: round $warning; color: black; background: #ff8200; }"

    def show(self, frame: bytes) -> None:
        self.update(Text("\n".join(screen.to_halfblocks(frame))))

    def action_key(self, key: str, kind: str = "short") -> None:
        self.app.press(key, kind)


class IFlipperApp(App):
    TITLE = "iFlipper"
    CSS = """
    #side { width: 38; padding: 0 1; border-right: tall $panel-lighten-1; }
    #side Label { margin-top: 1; }
    #info { height: auto; }
    #tabs { width: 1fr; }
    #files { height: 1fr; }
    #screen { align: center middle; }
    #screen > Display { margin: 1 0; }
    """
    BINDINGS = [
        Binding("f1", "tab('files')", "Files"),
        Binding("f2", "tab('screen')", "Screen"),
        Binding("f3", "tab('log')", "Log"),
        Binding("d", "download", "Download"),
        Binding("u", "upload", "Upload"),
        Binding("n", "mkdir", "New dir"),
        Binding("delete", "delete", "Delete"),
        Binding("r", "refresh", "Refresh"),
        Binding("a", "alert", "Alert", show=False),
        Binding("q", "quit", "Quit"),
    ]

    def __init__(self, target: str | None = None, flipper: Flipper | None = None, start_tab: str = "files"):
        super().__init__()
        self.target, self.f, self.start_tab = target, flipper, start_tab
        self._stop_screen = None
        self.last_frame = b""

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with Horizontal():
            with Vertical(id="side"):
                yield Static("Connecting…", id="info")
                yield Label("Battery")
                yield ProgressBar(total=100, show_eta=False, id="battery")
                yield Label("SD card")
                yield ProgressBar(total=100, show_eta=False, id="sd")
                yield Label("Internal")
                yield ProgressBar(total=100, show_eta=False, id="int")
                yield Label("Transfer")
                yield ProgressBar(total=100, show_eta=False, id="xfer")
            with TabbedContent(initial=self.start_tab, id="tabs"):
                with TabPane("Files", id="files"):
                    yield Tree("/", id="tree")
                with TabPane("Screen", id="screen"):
                    yield Display(id="display")
                with TabPane("Log", id="log"):
                    yield RichLog(id="logview", markup=True)
        yield Footer()

    # -- lifecycle ---------------------------------------------------------

    def on_mount(self) -> None:
        tree = self.query_one(Tree)
        tree.show_root = False
        for root in ("/ext", "/int"):
            tree.root.add(root, data=Entry(root, True), allow_expand=True)
        self.connect()

    def log_line(self, msg: str) -> None:
        self.query_one("#logview", RichLog).write(f"[dim]{dt.datetime.now():%H:%M:%S}[/] {msg}")

    @work(thread=True, exclusive=True, group="connect")
    def connect(self) -> None:
        try:
            if self.f is None:
                self.f = Flipper.connect(self.target)
            info, power = self.f.info(), self.f.power()
            storage = {}
            for root in ("/ext", "/int"):
                try:
                    storage[root] = self.f.storage_info(root)
                except Exception:
                    pass
        except Exception as e:
            self.call_from_thread(self.notify, f"Connection failed: {e}", severity="error", timeout=10)
            self.call_from_thread(self.query_one("#info", Static).update, f"[red]Not connected[/]\n{e}")
            return
        self.call_from_thread(self.show_info, info, power, storage)
        self.call_from_thread(self.expand_root)
        self._stop_screen = self.f.start_screen(lambda fr: self.call_from_thread(self.on_frame, fr))

    def show_info(self, info: dict, power: dict, storage: dict) -> None:
        name = info.get("hardware_name", "?")
        self.sub_title = name
        self.query_one("#info", Static).update(
            f"[bold orange1]{name}[/]\n"
            f"[dim]fw[/]  {info.get('firmware_version', '?')}\n"
            f"[dim]    [/]{info.get('firmware_branch', '')} {info.get('firmware_commit', '')}\n"
            f"[dim]hw[/]  {info.get('hardware_model', '?')} v{info.get('hardware_ver', '?')}"
            f" {info.get('hardware_region_provisioned', '')}\n"
            f"[dim]bat[/] {power.get('battery_voltage', '?')} V, {power.get('charge_state', '?')}"
        )
        self.query_one("#battery", ProgressBar).update(progress=float(power.get("charge_level", 0)))
        for root, wid in (("/ext", "#sd"), ("/int", "#int")):
            if root in storage:
                total, free = storage[root]
                self.query_one(wid, ProgressBar).update(total=total or 1, progress=total - free)
        self.log_line(f"Connected to [bold]{name}[/]")

    def expand_root(self) -> None:
        self.query_one(Tree).root.children[0].expand()

    def on_frame(self, frame: bytes) -> None:
        self.last_frame = frame
        self.query_one(Display).show(frame)

    def on_unmount(self) -> None:
        if self.f:
            try:
                if self._stop_screen:
                    self._stop_screen()
            finally:
                self.f.close()

    # -- file tree ---------------------------------------------------------

    def path_of(self, node) -> str:
        parts = []
        while node is not None and node.data is not None:
            parts.append(node.data.name)
            node = node.parent
        return posixpath.join(*reversed(parts)) if parts else "/"

    @on(Tree.NodeExpanded)
    def expanded(self, ev: Tree.NodeExpanded) -> None:
        self.load_dir(ev.node)

    @work(thread=True)
    def load_dir(self, node) -> None:
        if not self.f:
            return
        path = self.path_of(node)
        try:
            entries = self.f.ls(path)
        except Exception as e:
            self.call_from_thread(self.notify, f"{path}: {e}", severity="error")
            return
        self.call_from_thread(self.fill, node, entries)

    def fill(self, node, entries: list[Entry]) -> None:
        node.remove_children()
        for e in entries:
            if e.is_dir:
                node.add(f"📁 {e.name}", data=e, allow_expand=True)
            else:
                node.add_leaf(Text.assemble(e.name, ("  " + human(e.size), "dim")), data=e)

    def selected(self):
        node = self.query_one(Tree).cursor_node
        if node is None or node.data is None:
            return None, None
        return node, self.path_of(node)

    def action_refresh(self) -> None:
        node, _ = self.selected()
        if node is not None:
            target = node if node.data.is_dir else node.parent
            self.load_dir(target)
        if self.f is None:
            self.connect()

    def _progress(self, done: int, total: int) -> None:
        self.call_from_thread(self.query_one("#xfer", ProgressBar).update, total=total or 1, progress=done)

    def action_download(self) -> None:
        node, path = self.selected()
        if node is None or node.data.is_dir:
            self.notify("Select a file to download")
            return
        default = str(Path.cwd() / node.data.name)
        self.push_screen(Prompt(f"Save {path} to:", default), lambda dst: dst and self.download(path, dst))

    @work(thread=True, group="xfer")
    def download(self, path: str, dst: str) -> None:
        data = self.f.read(path, self._progress)
        Path(dst).expanduser().write_bytes(data)
        self.call_from_thread(self.log_line, f"↓ {path} → {dst} ({human(len(data))})")
        self.call_from_thread(self.notify, f"Downloaded {posixpath.basename(path)}")

    def action_upload(self) -> None:
        node, path = self.selected()
        if node is None:
            return
        folder_node = node if node.data.is_dir else node.parent
        folder = self.path_of(folder_node)
        self.push_screen(Prompt(f"Upload local file into {folder}:"),
                         lambda src: src and self.upload(src, folder, folder_node))

    @work(thread=True, group="xfer")
    def upload(self, src: str, folder: str, folder_node) -> None:
        p = Path(src).expanduser()
        if not p.is_file():
            self.call_from_thread(self.notify, f"{src}: not a file", severity="error")
            return
        dst = posixpath.join(folder, p.name)
        self.f.write(dst, p.read_bytes(), self._progress)
        self.call_from_thread(self.log_line, f"↑ {p} → {dst}")
        self.call_from_thread(self.notify, f"Uploaded {p.name}")
        self.load_dir(folder_node)

    def action_mkdir(self) -> None:
        node, _ = self.selected()
        if node is None:
            return
        folder_node = node if node.data.is_dir else node.parent

        def make(name: str) -> None:
            if name:
                self.f.mkdir(posixpath.join(self.path_of(folder_node), name))
                self.load_dir(folder_node)

        self.push_screen(Prompt("New folder name:"), make)

    def action_delete(self) -> None:
        node, path = self.selected()
        if node is None or node.parent is self.query_one(Tree).root:
            return

        def confirm(answer: str) -> None:
            if answer.lower() in ("y", "yes"):
                self.f.rm(path, recursive=True)
                self.log_line(f"[red]✗[/] {path}")
                self.load_dir(node.parent)

        self.push_screen(Prompt(f"Delete {path}? (y/N)"), confirm)

    # -- screen ------------------------------------------------------------

    @work(thread=True, group="input")
    def press(self, key: str, kind: str = "short") -> None:
        if self.f:
            self.f.press(key, kind)

    def action_screenshot(self) -> None:
        if not self.last_frame:
            return
        out = Path.cwd() / f"flipper-{dt.datetime.now():%Y%m%d-%H%M%S}.png"
        screen.to_image(self.last_frame, 4).save(out)
        self.notify(f"Saved {out.name}")
        self.log_line(f"📸 {out}")

    def action_alert(self) -> None:
        if self.f:
            self.f.alert()

    def action_tab(self, tab: str) -> None:
        self.query_one(TabbedContent).active = tab
        if tab == "screen":
            self.query_one(Display).focus()
