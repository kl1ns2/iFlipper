"""Decoding and rendering of the Flipper's 128x64 monochrome display."""

from __future__ import annotations

W, H = 128, 64
ORANGE = (255, 130, 0)
INK = (0, 0, 0)


def pixels(frame: bytes) -> list[list[bool]]:
    """Frame bytes (u8g2 page layout: 8 rows per byte, LSB on top) -> rows of booleans."""
    rows = [[False] * W for _ in range(H)]
    for page in range(H // 8):
        for x in range(W):
            b = frame[page * W + x] if page * W + x < len(frame) else 0
            for bit in range(8):
                if b >> bit & 1:
                    rows[page * 8 + bit][x] = True
    return rows


def to_frame(rows: list[list[bool]]) -> bytes:
    """Inverse of `pixels`."""
    out = bytearray(W * H // 8)
    for y in range(H):
        for x in range(W):
            if rows[y][x]:
                out[(y // 8) * W + x] |= 1 << (y % 8)
    return bytes(out)


def to_image(frame: bytes, scale: int = 4, fg=INK, bg=ORANGE):
    from PIL import Image

    img = Image.new("RGB", (W, H), bg)
    px = img.load()
    for y, row in enumerate(pixels(frame)):
        for x, on in enumerate(row):
            if on:
                px[x, y] = fg
    return img.resize((W * scale, H * scale), Image.NEAREST) if scale != 1 else img


def to_halfblocks(frame: bytes) -> list[str]:
    """128x32 lines of ▀▄█ — full resolution in a terminal (2 pixels per cell)."""
    rows = pixels(frame)
    glyph = {(False, False): " ", (True, False): "▀", (False, True): "▄", (True, True): "█"}
    return ["".join(glyph[rows[y][x], rows[y + 1][x]] for x in range(W)) for y in range(0, H, 2)]


def to_braille(frame: bytes) -> list[str]:
    """64x16 lines of braille — compact preview (8 pixels per cell)."""
    rows = pixels(frame)
    dots = ((0, 0, 0x01), (0, 1, 0x02), (0, 2, 0x04), (1, 0, 0x08),
            (1, 1, 0x10), (1, 2, 0x20), (0, 3, 0x40), (1, 3, 0x80))
    lines = []
    for cy in range(0, H, 4):
        line = []
        for cx in range(0, W, 2):
            code = sum(bit for dx, dy, bit in dots if rows[cy + dy][cx + dx])
            line.append(chr(0x2800 + code))
        lines.append("".join(line))
    return lines
