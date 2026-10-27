"""Render the app icon from the app's own Flipper drawing (dev-time; needs Playwright + Chromium).

    python packaging/render_icon.py
writes src/iflipper/web/icon.png and packaging/iflipper.ico.
"""

import io
import subprocess
import sys
import textwrap
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from iflipper.server import Backend  # noqa: E402

JS = textwrap.dedent("""
    const { chromium } = require('playwright');
    (async () => {
      const b = await chromium.launch();
      const pg = await b.newPage({ viewport: { width: 520, height: 600 }, deviceScaleFactor: 3 });
      await pg.goto(process.argv[1]);
      await pg.waitForTimeout(1500);
      process.stdout.write((await pg.screenshot({ omitBackground: true })).toString('base64'));
      await b.close();
    })();
""")


def squircle(size: int) -> Image.Image:
    s = size * 4
    bg = Image.new("RGBA", (s, s))
    big = Image.linear_gradient("L").resize((2 * s, 2 * s)).rotate(35, resample=Image.BICUBIC)
    grad = big.crop((s // 2, s // 2, s // 2 + s, s // 2 + s))  # centre crop: no empty rotated corners
    top, bot = Image.new("RGBA", (s, s), (58, 61, 70, 255)), Image.new("RGBA", (s, s), (18, 19, 23, 255))
    bg = Image.composite(bot, top, grad)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.23), fill=255)
    gloss = Image.new("L", (s, s), 0)
    ImageDraw.Draw(gloss).ellipse((-s * 0.3, -s * 0.85, s * 1.3, s * 0.42), fill=26)
    bg = Image.composite(Image.new("RGBA", (s, s), (255, 255, 255, 255)), bg, gloss.filter(ImageFilter.GaussianBlur(s * 0.03)))
    bg.putalpha(mask)
    return bg.resize((size, size), Image.LANCZOS)


def main() -> None:
    import base64
    import os

    backend = Backend("tcp://127.0.0.1:1")  # never connects; we only need the static UI
    backend.start()
    node_path = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True).stdout.strip()
    out = subprocess.run(["node", "-e", JS, backend.url + "&icon"], capture_output=True, text=True,
                         env={**os.environ, "NODE_PATH": node_path}, check=True).stdout
    backend.stop()
    shot = Image.open(io.BytesIO(base64.b64decode(out))).convert("RGBA")
    shot = shot.crop(shot.getbbox())
    size = 1024
    icon = squircle(size)
    w = int(size * 0.84)
    shot = shot.resize((w, int(shot.height * w / shot.width)), Image.LANCZOS)
    x, y = (size - shot.width) // 2, (size - shot.height) // 2 + int(size * 0.03)
    shadow = Image.new("RGBA", icon.size, (0, 0, 0, 0))
    a = shot.getchannel("A").point(lambda v: int(v * 0.55))
    shadow.paste(Image.new("RGBA", shot.size, (0, 0, 0, 255)), (x, y + int(size * 0.035)), a)
    shadow = shadow.filter(ImageFilter.GaussianBlur(size * 0.025))
    shadow.putalpha(ImageChops.multiply(shadow.getchannel("A"), icon.getchannel("A")))
    icon = Image.alpha_composite(icon, shadow)
    icon.alpha_composite(shot, (x, y))
    icon.resize((256, 256), Image.LANCZOS).save(ROOT / "src/iflipper/web/icon.png")
    icon.save(ROOT / "packaging/iflipper.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    icon.resize((512, 512), Image.LANCZOS).save(ROOT / "docs/icon.png")
    print("ok")


if __name__ == "__main__":
    main()
