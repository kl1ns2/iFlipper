# PyInstaller spec: one app folder with iFlipper.exe (window) and iflipper-cli.exe (console).
#   pyinstaller packaging/iflipper.spec      ->  dist/iFlipper/
# A folder build starts much faster than --onefile (nothing is unpacked to %TEMP% on each launch)
# and trips antivirus heuristics far less often.
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules

here = Path(SPECPATH)
root = here.parent
src = str(root / "src")
icon = str(here / "iflipper.ico")
web = [(str(root / "src/iflipper/web"), "iflipper/web")]
common = collect_submodules("iflipper") + ["serial.tools.list_ports"]
excludes = ["pytest", "grpc_tools", "tkinter"]

wv_datas, wv_bins, wv_hidden = collect_all("webview")
gui = Analysis([str(here / "gui_entry.py")], pathex=[src], hiddenimports=common + wv_hidden,
               datas=web + wv_datas, binaries=wv_bins, excludes=excludes + ["textual"])
gui_exe = EXE(PYZ(gui.pure), gui.scripts, [], exclude_binaries=True, name="iFlipper",
              console=False, icon=icon, upx=False, version=str(here / "version_info.txt"))

tx_datas, tx_bins, tx_hidden = collect_all("textual")
cli = Analysis([str(here / "cli_entry.py")], pathex=[src], hiddenimports=common + tx_hidden + wv_hidden,
               datas=web + tx_datas + wv_datas, binaries=tx_bins + wv_bins, excludes=excludes)
cli_exe = EXE(PYZ(cli.pure), cli.scripts, [], exclude_binaries=True, name="iflipper-cli",
              console=True, icon=icon, upx=False, version=str(here / "version_info.txt"))

COLLECT(gui_exe, gui.binaries, gui.datas, cli_exe, cli.binaries, cli.datas, name="iFlipper", upx=False)
