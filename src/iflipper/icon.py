"""The iFlipper app icon, drawn in code so there are no binary assets to keep in sync."""

from __future__ import annotations


def make_icon(size: int = 256):
    from PIL import Image, ImageDraw

    s = size / 256
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((8 * s, 8 * s, 248 * s, 248 * s), radius=56 * s, fill=(255, 130, 0))
    # A tiny Flipper: white body, black screen, d-pad.
    d.rounded_rectangle((36 * s, 70 * s, 220 * s, 186 * s), radius=34 * s, fill=(250, 250, 250))
    d.rounded_rectangle((56 * s, 90 * s, 150 * s, 150 * s), radius=8 * s, fill=(255, 130, 0),
                        outline=(30, 30, 30), width=max(1, int(6 * s)))
    d.ellipse((160 * s, 100 * s, 206 * s, 146 * s), outline=(30, 30, 30), width=max(1, int(6 * s)))
    d.ellipse((176 * s, 116 * s, 190 * s, 130 * s), fill=(30, 30, 30))
    return img


def save_ico(path: str) -> None:
    make_icon(256).save(path, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
