#!/usr/bin/env python3
"""Finishes the raw Robolectric captures for Google Play: draws an Android status bar and gesture handle into
the space the app leaves for them (the test gives the window real status-bar insets), checks each image against Google Play's
rules and writes optimized PNGs.

    python3 finish_screenshots.py RAW_DIR OUT_DIR
"""
import glob
import os
import sys

from PIL import Image, ImageDraw, ImageFont

STATUS_BAR_PX = 72  # 24 dp at xxhdpi, matches STATUS_BAR_PX in PlayStoreScreenshots.kt
NAV_BAR_PX = 48  # 16 dp gesture navigation bar, matches NAV_BAR_PX
INTER = "/usr/share/fonts/opentype/inter/Inter-Medium.otf"


def status_bar(img):
    """A clean status bar: clock on the left, signal / Wi-Fi / battery on the right (white, like the app's dark bars)."""
    w = img.width
    h = STATUS_BAR_PX
    # A soft scrim so the clock and icons stay readable over content scrolled under the bar.
    scrim = Image.new("L", (1, h + 40))
    scrim.putdata([int(170 * min(1.0, (h + 40 - y) / 60)) for y in range(h + 40)])
    img.paste((0, 0, 0), (0, 0, w, h + 40), scrim.resize((w, h + 40)))
    d = ImageDraw.Draw(img, "RGBA")
    font = ImageFont.truetype(INTER, 36) if os.path.exists(INTER) else ImageFont.load_default()
    d.text((54, h / 2), "9:30", font=font, fill=(255, 255, 255, 255), anchor="lm")
    cy = h / 2
    # Battery
    bx = w - 60
    d.rounded_rectangle([bx - 44, cy - 16, bx, cy + 16], radius=6, outline=(255, 255, 255, 255), width=3)
    d.rectangle([bx, cy - 6, bx + 5, cy + 6], fill=(255, 255, 255, 255))
    d.rounded_rectangle([bx - 39, cy - 11, bx - 10, cy + 11], radius=3, fill=(255, 255, 255, 255))
    # Cellular signal: four rising bars
    sx = bx - 120
    for i in range(4):
        bh = 10 + i * 7
        d.rectangle([sx + i * 11, cy + 16 - bh, sx + i * 11 + 7, cy + 16], fill=(255, 255, 255, 255))
    # Wi-Fi: a filled quarter-circle fan
    wx, wy = sx - 46, cy + 15
    d.pieslice([wx - 30, wy - 30, wx + 30, wy + 30], start=225, end=315, fill=(255, 255, 255, 255))
    # Gesture navigation handle
    hy = img.height - NAV_BAR_PX / 2
    d.rounded_rectangle([w / 2 - 54, hy - 5, w / 2 + 54, hy + 5], radius=5, fill=(255, 255, 255, 230))
    return img


def main():
    raw, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    for path in sorted(glob.glob(os.path.join(raw, "*.png"))):
        img = Image.open(path).convert("RGB")
        if img.size == (1080, 1920):
            img = status_bar(img)
        elif img.size != (1920, 1080):
            sys.exit(f"{path}: {img.size} is neither 1080x1920 nor 1920x1080")
        dest = os.path.join(out, os.path.basename(path))
        img.save(dest, optimize=True)
        size = os.path.getsize(dest)
        if size > 8 * 1024 * 1024:
            sys.exit(f"{dest}: {size} bytes is over Google Play's 8 MB limit")
        print(f"{os.path.basename(dest)}: {img.width}x{img.height}, {size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
