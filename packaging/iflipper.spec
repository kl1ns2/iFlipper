# PyInstaller spec: builds iFlipper.exe (window) and iflipper-cli.exe (console).
#   python packaging/make_icon.py
#   pyinstaller packaging/iflipper.spec
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules

here = Path(SPECPATH)
src = str(here.parent / "src")
icon = str(here / "iflipper.ico") if sys.platform == "win32" else None
common = collect_submodules("iflipper") + ["serial.tools.list_ports"]

gui = Analysis([str(here / "gui_entry.py")], pathex=[src], hiddenimports=common,
               excludes=["textual", "pytest", "grpc_tools"])
gui_exe = EXE(PYZ(gui.pure), gui.scripts, gui.binaries, gui.datas, name="iFlipper",
              console=False, icon=icon, upx=False)

tx_datas, tx_bins, tx_hidden = collect_all("textual")
cli = Analysis([str(here / "cli_entry.py")], pathex=[src], hiddenimports=common + tx_hidden,
               datas=tx_datas, binaries=tx_bins, excludes=["pytest", "grpc_tools"])
cli_exe = EXE(PYZ(cli.pure), cli.scripts, cli.binaries, cli.datas, name="iflipper-cli",
              console=True, icon=icon, upx=False)
