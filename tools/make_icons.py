#!/usr/bin/env python3
"""Generate the PNG app icons from the same geometry as assets/icon.svg.

Usage: python tools/make_icons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets"
ACCENT = (37, 99, 235, 255)
INK = (255, 255, 255, 255)
SS = 4  # supersampling


def draw_icon(size: int, rounded: bool) -> Image.Image:
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.225), fill=ACCENT)
    else:
        d.rectangle((0, 0, s, s), fill=ACCENT)

    stroke = int(s * 0.055)
    # chevron
    pts = [(s * 0.30, s * 0.415), (s * 0.435, s * 0.5), (s * 0.30, s * 0.585)]
    d.line(pts, fill=INK, width=stroke, joint="curve")
    for p in (pts[0], pts[-1]):
        r = stroke / 2
        d.ellipse((p[0] - r, p[1] - r, p[0] + r, p[1] + r), fill=INK)
    # underscore
    y = s * 0.60
    d.line([(s * 0.505, y), (s * 0.705, y)], fill=INK, width=stroke)
    for x in (s * 0.505, s * 0.705):
        r = stroke / 2
        d.ellipse((x - r, y - r, x + r, y + r), fill=INK)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    draw_icon(192, rounded=True).save(OUT / "icon-192.png")
    draw_icon(512, rounded=True).save(OUT / "icon-512.png")
    draw_icon(180, rounded=False).save(OUT / "icon-180.png")
    # maskable: full-bleed with the glyph well inside the safe zone
    draw_icon(512, rounded=False).save(OUT / "icon-maskable-512.png")
    print("wrote 4 icons to", OUT)


if __name__ == "__main__":
    main()
