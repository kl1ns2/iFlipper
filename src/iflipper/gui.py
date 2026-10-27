"""Desktop window (`iflipper gui`, and what iFlipper.exe opens).

Waits for a Flipper to be plugged in, connects on its own, shows it with its live
screen and clickable buttons, and reconnects after an unplug.
"""

from __future__ import annotations

import base64
import datetime as dt
import io
import posixpath
import queue
import threading
import time
import tkinter as tk
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk

from . import __version__, screen
from .device import Flipper
from .icon import make_icon
from .transport import find_flippers

BG = "#1b1b1f"
PANEL = "#26262b"
FG = "#e8e8e8"
DIM = "#8a8a93"
ORANGE = "#ff8200"
BODY = "#f2f2f2"
DARK = "#2b2b2b"
SCALE = 3
LONG_PRESS = 0.5


def photo(img) -> tk.PhotoImage:
    """PIL image -> Tk image via PNG (Tk 8.6 reads PNG natively; no PIL.ImageTk needed when frozen)."""
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return tk.PhotoImage(data=base64.b64encode(buf.getvalue()))


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return str(n)


class Link(threading.Thread):
    """Background connection manager: find → connect → watch → reconnect."""

    def __init__(self, target: str | None, post):
        super().__init__(daemon=True)
        self.target, self.post = target, post
        self.f: Flipper | None = None
        self.stopped = threading.Event()
        self.frame: bytes | None = None  # latest frame only; the UI picks it up

    def run(self) -> None:
        last_power = 0.0
        while not self.stopped.is_set():
            if self.f is None:
                target = self.target
                if target is None:
                    ports = find_flippers()
                    target = ports[0].device if ports else None
                if target is None:
                    self.post("waiting")
                    self.stopped.wait(1)
                    continue
                self.post("connecting", target)
                try:
                    f = Flipper.connect(target, timeout=5)
                    self.post("connected", self.snapshot(f))
                    f.start_screen(self._on_frame)
                    self.f = f
                    last_power = time.monotonic()
                except Exception as e:  # port busy, half-booted device, ...
                    self.post("error", str(e) or type(e).__name__)
                    self.stopped.wait(2)
                continue
            if self.f.rpc.closed:
                self.f = None
                self.post("disconnected")
                continue
            if time.monotonic() - last_power > 20:
                last_power = time.monotonic()
                try:
                    self.post("power", self.f.power())
                except Exception:
                    pass
            self.stopped.wait(0.5)

    def _on_frame(self, fr: bytes) -> None:
        self.frame = fr

    @staticmethod
    def snapshot(f: Flipper) -> dict:
        storage = {}
        for root in ("/ext", "/int"):
            try:
                storage[root] = f.storage_info(root)
            except Exception:
                pass
        return {"info": f.info(), "power": f.power(), "storage": storage}

    def stop(self) -> None:
        self.stopped.set()
        if self.f:
            try:
                self.f.close()
            except Exception:
                pass


class FlipperView(tk.Canvas):
    """A drawn Flipper Zero: live screen plus clickable d-pad and Back button."""

    W, H = 640, 330

    def __init__(self, master, on_key):
        super().__init__(master, width=self.W, height=self.H, bg=BG, highlightthickness=0)
        self.on_key = on_key
        self._down: dict[str, float] = {}
        self._photo = None
        self.draw()

    def rrect(self, x1, y1, x2, y2, r, **kw):
        pts = [x1 + r, y1, x2 - r, y1, x2, y1, x2, y1 + r, x2, y2 - r, x2, y2,
               x2 - r, y2, x1 + r, y2, x1, y2, x1, y2 - r, x1, y1 + r, x1, y1]
        return self.create_polygon(pts, smooth=True, **kw)

    def draw(self) -> None:
        self.rrect(26, 26, 626, 316, 70, fill="#000000", outline="")  # shadow
        self.rrect(20, 20, 620, 310, 70, fill=BODY, outline="#d0d0d0", width=2)
        self.rrect(50, 52, 470, 278, 18, fill=DARK, outline="")
        sw, sh = screen.W * SCALE, screen.H * SCALE
        self.sx, self.sy = 50 + (420 - sw) // 2, 52 + (226 - sh) // 2
        self.create_rectangle(self.sx, self.sy, self.sx + sw, self.sy + sh, fill=ORANGE, outline="")
        self.screen_item = self.create_image(self.sx, self.sy, anchor="nw")
        self.overlay = self.create_text(self.sx + sw // 2, self.sy + sh // 2, text="", fill="#000000",
                                        font=("Segoe UI", 14, "bold"), justify="center")

        cx, cy, r = 545, 140, 58  # d-pad
        self.create_oval(cx - r, cy - r, cx + r, cy + r, fill="#e4e4e4", outline="#c4c4c4", width=2)
        a, o = 12, 38
        arrows = {
            "up": (cx, cy - o - a, cx - a, cy - o + a // 2, cx + a, cy - o + a // 2),
            "down": (cx, cy + o + a, cx - a, cy + o - a // 2, cx + a, cy + o - a // 2),
            "left": (cx - o - a, cy, cx - o + a // 2, cy - a, cx - o + a // 2, cy + a),
            "right": (cx + o + a, cy, cx + o - a // 2, cy - a, cx + o - a // 2, cy + a),
        }
        for key, pts in arrows.items():
            hit = self.create_oval(*self._zone(cx, cy, key, o), fill="", outline="")
            tri = self.create_polygon(*pts, fill="#555555")
            self._bind_key(key, hit, tri)
        ok = self.create_oval(cx - 20, cy - 20, cx + 20, cy + 20, fill=ORANGE, outline="#d06a00", width=2)
        self._bind_key("ok", ok)
        bx, by = 585, 250  # back
        back = self.create_oval(bx - 20, by - 20, bx + 20, by + 20, fill="#e4e4e4", outline="#c4c4c4", width=2)
        arrow = self.create_text(bx, by, text="↩", font=("Segoe UI", 16, "bold"), fill="#555555")
        self._bind_key("back", back, arrow)
        self.create_text(82, 296, text="iFlipper", anchor="w", fill="#b0b0b0", font=("Segoe UI", 10, "bold"))

    @staticmethod
    def _zone(cx, cy, key, o):
        dx, dy = {"up": (0, -o), "down": (0, o), "left": (-o, 0), "right": (o, 0)}[key]
        return cx + dx - 20, cy + dy - 20, cx + dx + 20, cy + dy + 20

    def _bind_key(self, key: str, *items) -> None:
        for it in items:
            self.tag_bind(it, "<ButtonPress-1>", lambda e, k=key: self.key_down(k))
            self.tag_bind(it, "<ButtonRelease-1>", lambda e, k=key: self.key_up(k))
            self.tag_bind(it, "<Enter>", lambda e: self.config(cursor="hand2"))
            self.tag_bind(it, "<Leave>", lambda e: self.config(cursor=""))

    def key_down(self, key: str) -> None:
        self._down.setdefault(key, time.monotonic())

    def key_up(self, key: str) -> None:
        start = self._down.pop(key, None)
        if start is not None:
            self.on_key(key, "long" if time.monotonic() - start > LONG_PRESS else "short")

    def show_frame(self, frame: bytes) -> None:
        self._photo = photo(screen.to_image(frame, SCALE))
        self.itemconfigure(self.screen_item, image=self._photo)
        self.itemconfigure(self.overlay, text="")

    def show_message(self, text: str) -> None:
        self._photo = None
        self.itemconfigure(self.screen_item, image="")
        self.itemconfigure(self.overlay, text=text)


class IFlipperGUI:
    def __init__(self, target: str | None = None):
        self.root = tk.Tk()
        self.root.title(f"iFlipper {__version__}")
        self.root.configure(bg=BG)
        self.root.minsize(1060, 560)
        self._icon = photo(make_icon(64))
        self.root.iconphoto(True, self._icon)

        self.events: queue.Queue = queue.Queue()
        self.link = Link(target, lambda *ev: self.events.put(ev))
        self.keys = ThreadPoolExecutor(1)  # button presses, strictly in order
        self.tasks = ThreadPoolExecutor(1)  # file operations, backups, ...
        self.last_frame: bytes | None = None
        self.connected = False
        self.ready_text = ""
        self.dots = 0

        self.build()
        self.set_disconnected("Подключите Flipper Zero\nпо USB")
        self.root.protocol("WM_DELETE_WINDOW", self.quit)
        for keysym, key in (("Up", "up"), ("Down", "down"), ("Left", "left"), ("Right", "right"),
                            ("Return", "ok"), ("BackSpace", "back"), ("Escape", "back")):
            self.root.bind(f"<KeyPress-{keysym}>", lambda e, k=key: self.on_global_key(e, k, True))
            self.root.bind(f"<KeyRelease-{keysym}>", lambda e, k=key: self.on_global_key(e, k, False))

    # -- layout ------------------------------------------------------------

    def build(self) -> None:
        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure(".", background=BG, foreground=FG, fieldbackground=PANEL)
        style.configure("TNotebook", background=BG, borderwidth=0, bordercolor=PANEL, lightcolor=BG, darkcolor=BG)
        style.configure("TNotebook.Tab", bordercolor=PANEL, lightcolor=PANEL)
        style.configure("TNotebook.Tab", background=PANEL, foreground=DIM, padding=(14, 6))
        style.map("TNotebook.Tab", background=[("selected", BG)], foreground=[("selected", ORANGE)])
        style.configure("TFrame", background=BG)
        style.configure("TLabel", background=BG, foreground=FG)
        style.configure("Dim.TLabel", foreground=DIM)
        style.configure("Name.TLabel", font=("Segoe UI", 20, "bold"), foreground=ORANGE)
        style.configure("TButton", background=PANEL, foreground=FG, padding=(10, 6), borderwidth=0)
        style.map("TButton", background=[("active", "#34343b"), ("disabled", BG)],
                  foreground=[("disabled", "#55555c")])
        style.configure("Small.TButton", padding=(2, 4))
        style.configure("Accent.TButton", background=ORANGE, foreground="#000000")
        style.map("Accent.TButton", background=[("active", "#ff9a33")])
        style.configure("Orange.Horizontal.TProgressbar", background=ORANGE, troughcolor=PANEL, borderwidth=0)
        style.configure("Treeview", background=PANEL, foreground=FG, fieldbackground=PANEL, rowheight=24,
                        borderwidth=0)
        style.map("Treeview", background=[("selected", ORANGE)], foreground=[("selected", "#000000")])
        style.configure("Treeview.Heading", background=BG, foreground=DIM, borderwidth=0)

        main = ttk.Frame(self.root, padding=16)
        main.pack(fill="both", expand=True)
        left = ttk.Frame(main)
        left.pack(side="left", fill="y")
        self.view = FlipperView(left, self.press)
        self.view.pack()
        hint = "Мышь или клавиатура: ← ↑ → ↓, Enter = OK, Backspace = Назад. Удерживайте для долгого нажатия."
        ttk.Label(left, text=hint, style="Dim.TLabel").pack(pady=(8, 0))

        tabs = ttk.Notebook(main)
        tabs.pack(side="left", fill="both", expand=True, padx=(16, 0))
        self.tabs = tabs
        tabs.add(self.build_device_tab(tabs), text="Устройство")
        tabs.add(self.build_files_tab(tabs), text="Файлы")

        self.status = tk.StringVar()
        bar = tk.Label(self.root, textvariable=self.status, bg=PANEL, fg=DIM, anchor="w", padx=12, pady=4)
        bar.pack(side="bottom", fill="x")

    def build_device_tab(self, parent) -> ttk.Frame:
        f = ttk.Frame(parent, padding=16)
        self.name_var = tk.StringVar(value="—")
        ttk.Label(f, textvariable=self.name_var, style="Name.TLabel").pack(anchor="w")
        self.details_var = tk.StringVar()
        ttk.Label(f, textvariable=self.details_var, style="Dim.TLabel", justify="left").pack(anchor="w", pady=(4, 12))

        self.meters = {}
        for key, title in (("battery", "Батарея"), ("/ext", "SD-карта"), ("/int", "Внутренняя память")):
            row = ttk.Frame(f)
            row.pack(fill="x", pady=4)
            label = tk.StringVar(value=title)
            ttk.Label(row, textvariable=label).pack(anchor="w")
            bar = ttk.Progressbar(row, style="Orange.Horizontal.TProgressbar", maximum=100)
            bar.pack(fill="x", pady=(2, 0))
            self.meters[key] = (title, label, bar)

        grid = ttk.Frame(f)
        grid.pack(fill="x", pady=(18, 0))
        self.action_buttons = []
        actions = [
            ("📸  Скриншот", self.do_screenshot), ("🔔  Найти Flipper", self.do_alert),
            ("🕒  Синхр. время", self.do_time), ("💾  Бэкап всего", self.do_backup),
            ("♻  Восстановить", self.do_restore), ("⬆  Прошивка .tgz", self.do_update),
        ]
        for i, (text, cmd) in enumerate(actions):
            b = ttk.Button(grid, text=text, command=cmd)
            b.grid(row=i // 2, column=i % 2, sticky="ew", padx=4, pady=4)
            self.action_buttons.append(b)
        grid.columnconfigure((0, 1), weight=1)

        self.progress = ttk.Progressbar(f, style="Orange.Horizontal.TProgressbar", maximum=1)
        self.progress.pack(fill="x", pady=(14, 0))
        return f

    def build_files_tab(self, parent) -> ttk.Frame:
        f = ttk.Frame(parent, padding=(0, 12, 0, 0))
        tools = ttk.Frame(f)
        tools.pack(fill="x", pady=(0, 8))
        buttons = (("⬇ Скачать", self.do_download), ("⬆ Загрузить", self.do_upload),
                   ("＋ Папка", self.do_mkdir), ("✕ Удалить", self.do_delete), ("⟳", self.do_refresh))
        for i, (text, cmd) in enumerate(buttons):
            b = ttk.Button(tools, text=text, command=cmd, style="Small.TButton", width=1)
            b.grid(row=0, column=i, sticky="ew", padx=(0, 4))
            tools.columnconfigure(i, weight=0 if text == "⟳" else 1, uniform="" if text == "⟳" else "files")
            self.action_buttons.append(b)
        self.tree = ttk.Treeview(f, columns=("size",), selectmode="browse")
        self.tree.heading("#0", text="Имя", anchor="w")
        self.tree.heading("size", text="Размер", anchor="e")
        self.tree.column("size", width=90, anchor="e", stretch=False)
        self.tree.pack(fill="both", expand=True)
        self.tree.bind("<<TreeviewOpen>>", lambda e: self.load_dir(self.tree.focus()))
        self.tree.bind("<Double-1>", self.on_tree_double)
        self.dirs: set[str] = set()
        return f

    # -- event pump (everything that touches Tk happens here) --------------

    def pump(self) -> None:
        try:
            while True:
                kind, *args = self.events.get_nowait()
                getattr(self, "ev_" + kind)(*args)
        except queue.Empty:
            pass
        fr = self.link.frame
        if fr is not None and fr is not self.last_frame and self.connected:
            self.last_frame = fr
            self.view.show_frame(fr)
        self.root.after(33, self.pump)

    def animate(self) -> None:
        if not self.connected:
            self.dots = (self.dots + 1) % 4
            self.status.set(self._status_base + "." * self.dots)
        self.root.after(500, self.animate)

    def ui(self, fn, *args) -> None:
        """Run `fn` on the Tk thread (callable from workers)."""
        self.events.put(("call", fn, *args))

    def ev_call(self, fn, *args) -> None:
        fn(*args)

    def ev_waiting(self) -> None:
        self.set_disconnected("Подключите Flipper Zero\nпо USB", "Ищу Flipper Zero")

    def ev_connecting(self, target: str) -> None:
        self.view.show_message("Подключаюсь…")
        self._status_base = f"Подключаюсь к {target}"

    def ev_error(self, msg: str) -> None:
        self._status_base = f"Не удалось подключиться: {msg}. Повторяю"

    def ev_disconnected(self) -> None:
        self.set_disconnected("Flipper отключён", "Flipper отключён — жду повторного подключения")

    def ev_connected(self, snap: dict) -> None:
        self.connected = True
        info, power, storage = snap["info"], snap["power"], snap["storage"]
        name = info.get("hardware_name", "Flipper")
        self.root.title(f"iFlipper — {name}")
        self.name_var.set(name)
        self.details_var.set(
            f"Прошивка   {info.get('firmware_version', '?')}  ({info.get('firmware_branch', '?')}, "
            f"{info.get('firmware_commit', '?')}, {info.get('firmware_build_date', '?')})\n"
            f"Железо     {info.get('hardware_model', '?')} v{info.get('hardware_ver', '?')}, "
            f"регион {info.get('hardware_region_provisioned', '?')}\n"
            f"UID        {info.get('hardware_uid', '?')}")
        self.ev_power(power)
        for root, (total, free) in storage.items():
            title, label, bar = self.meters[root]
            used = total - free
            label.set(f"{title}: {human(used)} из {human(total)}")
            bar["value"] = used / total * 100 if total else 0
        self.ready_text = f"Подключено: {name}"
        self.status.set(self.ready_text)
        self.view.show_message("")
        self.set_actions(True)
        self.tree.delete(*self.tree.get_children())
        self.dirs = set()
        for root in ("/ext", "/int"):
            if root in storage:
                self.add_dir("", root, root)
        self.bring_to_front()

    def bring_to_front(self) -> None:
        """Pop the window up when a Flipper appears, even if it was minimized or behind others."""
        self.root.deiconify()
        self.root.lift()
        self.root.attributes("-topmost", True)
        self.root.after(300, lambda: self.root.attributes("-topmost", False))
        self.root.focus_force()

    def ev_power(self, power: dict) -> None:
        title, label, bar = self.meters["battery"]
        level = float(power.get("charge_level", 0) or 0)
        state = {"charging": "заряжается", "discharging": "разряжается", "charged": "заряжен"}.get(
            power.get("charge_state", ""), power.get("charge_state", ""))
        label.set(f"{title}: {level:.0f}% · {state} · {power.get('battery_voltage', '?')} В")
        bar["value"] = level

    def set_disconnected(self, screen_text: str, status: str = "Ищу Flipper Zero") -> None:
        self.connected = False
        self.last_frame = None
        self._status_base = status
        self.view.show_message(screen_text)
        self.root.title(f"iFlipper {__version__}")
        self.name_var.set("Нет устройства")
        self.details_var.set("Подключите Flipper Zero кабелем USB —\niFlipper найдёт его автоматически.")
        for title, label, bar in self.meters.values():
            label.set(title)
            bar["value"] = 0
        self.set_actions(False)
        if hasattr(self, "tree"):
            self.tree.delete(*self.tree.get_children())

    def set_actions(self, enabled: bool) -> None:
        for b in getattr(self, "action_buttons", []):
            b.state(["!disabled"] if enabled else ["disabled"])

    # -- device actions ----------------------------------------------------

    @property
    def f(self) -> Flipper | None:
        return self.link.f

    def on_global_key(self, event, key: str, down: bool) -> None:
        if isinstance(event.widget, (tk.Entry, ttk.Entry, ttk.Treeview)):
            return
        if self.tabs.index("current") != 0:
            return
        (self.view.key_down if down else self.view.key_up)(key)

    def press(self, key: str, kind: str) -> None:
        if self.f:
            self.keys.submit(self._safe, lambda: self.f.press(key, kind))

    def _safe(self, fn) -> None:
        try:
            fn()
        except Exception as e:
            self.ui(self.status.set, f"Ошибка: {e}")

    def run_task(self, label: str, fn, done=None) -> None:
        """Run `fn(progress)` in the background; progress(done, total) drives the bar."""
        if not self.f:
            return

        def progress(d: int, t: int) -> None:
            self.ui(self.set_progress, d, t)

        def job() -> None:
            self.ui(self.status.set, label + "…")
            try:
                result = fn(progress)
            except Exception as e:
                self.ui(messagebox.showerror, "iFlipper", f"{label}: {e}")
                self.ui(self.status.set, f"{label}: ошибка")
            else:
                self.ui(self.status.set, self.ready_text)
                if done:
                    self.ui(done, result)
            finally:
                self.ui(self.set_progress, 0, 1)

        self.tasks.submit(job)

    def set_progress(self, d: int, t: int) -> None:
        self.progress["maximum"] = max(t, 1)
        self.progress["value"] = d

    def do_screenshot(self) -> None:
        if not self.last_frame:
            return
        out = filedialog.asksaveasfilename(defaultextension=".png", filetypes=[("PNG", "*.png")],
                                           initialfile=f"flipper-{dt.datetime.now():%Y%m%d-%H%M%S}.png")
        if out:
            screen.to_image(self.last_frame, 4).save(out)
            self.status.set(f"Скриншот сохранён: {out}")

    def do_alert(self) -> None:
        self.run_task("Сигнал", lambda p: self.f.alert(), lambda _: self.status.set("Flipper мигнул и пискнул 👋"))

    def do_time(self) -> None:
        self.run_task("Синхронизация времени", lambda p: self.f.set_datetime(),
                      lambda _: self.status.set("Время на Flipper синхронизировано"))

    def do_backup(self) -> None:
        from . import backup

        name = self.name_var.get()
        out = filedialog.asksaveasfilename(defaultextension=".tar.gz", filetypes=[("Бэкап", "*.tar.gz")],
                                           initialfile=f"{name}-{dt.datetime.now():%Y%m%d-%H%M%S}.tar.gz")
        if not out:
            return

        def job(progress):
            return backup.create(self.f, Path(out), log=lambda s: self.ui(self.status.set, f"Бэкап: {s}"))

        self.run_task("Бэкап", job, lambda st: self.status.set(
            f"Бэкап готов: {st['files']} файлов, {human(st['bytes'])} → {out}"))

    def do_restore(self) -> None:
        from . import backup

        src = filedialog.askopenfilename(filetypes=[("Бэкап", "*.tar.gz *.tgz")])
        if not src or not messagebox.askyesno("iFlipper", "Восстановить файлы из бэкапа?\n"
                                                           "Изменённые файлы на Flipper будут перезаписаны."):
            return
        self.run_task("Восстановление", lambda p: backup.restore(
            self.f, Path(src), log=lambda s: self.ui(self.status.set, f"Восстановление: {s}")),
            lambda st: self.status.set(f"Готово: загружено {st['uploaded']}, без изменений {st['skipped']}"))

    def do_update(self) -> None:
        from . import update

        src = filedialog.askopenfilename(title="Пакет обновления (.tgz)", filetypes=[("Пакет обновления", "*.tgz")])
        if not src:
            return
        try:
            name, files = update.unpack(Path(src).read_bytes())
        except Exception as e:
            messagebox.showerror("iFlipper", str(e))
            return
        if messagebox.askyesno("iFlipper", f"Установить {name}?\nFlipper перезагрузится для обновления."):
            self.run_task("Загрузка прошивки", lambda p: update.install(self.f, Path(src).read_bytes(), progress=p),
                          lambda _: self.status.set("Прошивка загружена — Flipper обновляется"))

    # -- files -------------------------------------------------------------

    def add_dir(self, parent: str, path: str, label: str) -> None:
        self.tree.insert(parent, "end", iid=path, text="📁 " + label, values=("",))
        self.tree.insert(path, "end", iid=path + "/\0", text="…")  # placeholder so it can expand
        self.dirs.add(path)

    def load_dir(self, path: str) -> None:
        if path not in self.dirs or not self.f:
            return

        def fill(entries) -> None:
            self.tree.delete(*self.tree.get_children(path))
            for e in entries:
                child = posixpath.join(path, e.name)
                if e.is_dir:
                    self.add_dir(path, child, e.name)
                else:
                    self.tree.insert(path, "end", iid=child, text="   " + e.name, values=(human(e.size),))

        self.run_task(f"Чтение {path}", lambda p: self.f.ls(path), fill)

    def selected(self) -> str | None:
        sel = self.tree.focus()
        return sel if sel and not sel.endswith("\0") else None

    def selected_dir(self) -> str | None:
        sel = self.selected()
        if sel is None:
            return None
        return sel if sel in self.dirs else posixpath.dirname(sel)

    def on_tree_double(self, _event) -> None:
        sel = self.selected()
        if sel and sel not in self.dirs:
            self.do_download()

    def do_refresh(self) -> None:
        d = self.selected_dir()
        if d:
            self.load_dir(d)

    def do_download(self) -> None:
        sel = self.selected()
        if not sel or sel in self.dirs:
            messagebox.showinfo("iFlipper", "Выберите файл")
            return
        out = filedialog.asksaveasfilename(initialfile=posixpath.basename(sel))
        if out:
            self.run_task(f"Скачивание {sel}", lambda p: Path(out).write_bytes(self.f.read(sel, p)),
                          lambda _: self.status.set(f"Сохранено: {out}"))

    def do_upload(self) -> None:
        d = self.selected_dir()
        if not d:
            messagebox.showinfo("iFlipper", "Выберите папку на Flipper")
            return
        srcs = filedialog.askopenfilenames(title=f"Загрузить в {d}")
        if not srcs:
            return

        def job(progress):
            for s in srcs:
                self.f.write(posixpath.join(d, Path(s).name), Path(s).read_bytes(), progress)

        self.run_task(f"Загрузка в {d}", job, lambda _: (self.status.set(f"Загружено файлов: {len(srcs)}"),
                                                          self.load_dir(d)))

    def do_mkdir(self) -> None:
        d = self.selected_dir()
        if not d:
            return
        name = simpledialog.askstring("iFlipper", f"Новая папка в {d}:", parent=self.root)
        if name:
            self.run_task("Создание папки", lambda p: self.f.mkdir(posixpath.join(d, name)),
                          lambda _: self.load_dir(d))

    def do_delete(self) -> None:
        sel = self.selected()
        if not sel or sel in ("/ext", "/int"):
            return
        if messagebox.askyesno("iFlipper", f"Удалить {sel}?"):
            parent = posixpath.dirname(sel)
            self.run_task("Удаление", lambda p: self.f.rm(sel, recursive=True), lambda _: self.load_dir(parent))

    # -- lifecycle ---------------------------------------------------------

    def run(self) -> None:
        self.link.start()
        self.root.after(33, self.pump)
        self.root.after(500, self.animate)
        self.root.mainloop()

    def quit(self) -> None:
        self.link.stop()
        self.root.destroy()


def main(target: str | None = None) -> None:
    IFlipperGUI(target).run()
