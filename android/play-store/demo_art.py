#!/usr/bin/env python3
"""Generates the artwork for the fictional demo library used by the Play Store screenshots.

Every title, poster, backdrop, logo and episode still is invented and drawn here from gradients,
silhouettes and type, so the screenshots never show copyrighted material.

    python3 demo_art.py OUT_DIR [--bebas PATH_TO_BEBAS_NEUE]

Writes OUT_DIR/{posters,backdrops,logos,stills}/<id>.png and OUT_DIR/frame.png (a 1920x1080
"video frame" shown behind the player controls). The library itself (names, genres, episodes) lives in
android/app/src/test/.../screenshots/DemoLibrary.kt and uses the same ids.
"""
import argparse
import math
import os
import random
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# id, title, tagline-ish credit line, scene spec
TITLES = {
    "last-lighthouse": dict(name="The Last Lighthouse", motif="lighthouse", sky=("#0b1d33", "#f08a4b"), sun=(0.72, 0.62, 0.07, "#ffd29a"), seed=1),
    "neon-harbor": dict(name="Neon Harbor", motif="city", sky=("#12002b", "#ff2e88"), sun=(0.5, 0.58, 0.16, "#ff7ab8"), seed=2),
    "saltwater-saints": dict(name="Saltwater Saints", motif="waves", sky=("#06141c", "#2f7f8f"), sun=(0.3, 0.3, 0.05, "#e8f4f8"), seed=3),
    "paper-comets": dict(name="Paper Comets", motif="comets", sky=("#14123a", "#5d4bb8"), sun=None, seed=4),
    "glass-orchard": dict(name="The Glass Orchard", motif="orchard", sky=("#2c0f2e", "#f5b7a5"), sun=(0.5, 0.66, 0.12, "#fff1d6"), seed=5),
    "midnight-cartographer": dict(name="Midnight Cartographer", motif="mountains", sky=("#050b1f", "#1d3d6e"), sun=(0.68, 0.22, 0.06, "#f3f0e0"), seed=6),
    "static-bloom": dict(name="Static Bloom", motif="planet", sky=("#03140f", "#0f6b4f"), sun=(0.5, 0.45, 0.22, "#7cf5c4"), seed=7),
    "copper-valley": dict(name="Copper Valley", motif="desert", sky=("#3b1206", "#f2a03d"), sun=(0.35, 0.6, 0.1, "#ffe0a3"), seed=8),
    "orbit-small-things": dict(name="Orbit of Small Things", motif="planet", sky=("#0a0820", "#3a2a6e"), sun=(0.62, 0.5, 0.18, "#f7c873"), seed=9),
    "low-tide-radio": dict(name="Low Tide Radio", motif="waves", sky=("#3a1f3d", "#ffb07a"), sun=(0.5, 0.7, 0.13, "#ffe6b3"), seed=10),
    "hollow-pines": dict(name="Hollow Pines", motif="forest", sky=("#020604", "#2b3f2a"), sun=(0.5, 0.25, 0.08, "#d9e6d0"), seed=11),
    "quiet-engine": dict(name="The Quiet Engine", motif="city", sky=("#05070d", "#2a4766"), sun=(0.25, 0.3, 0.05, "#cfe3ff"), seed=12),
    "summer-of-kites": dict(name="Summer of Kites", motif="kites", sky=("#1e6fbf", "#ffd98a"), sun=(0.8, 0.25, 0.08, "#fff7d6"), seed=13),
    "firewalk-avenue": dict(name="Firewalk Avenue", motif="city", sky=("#1a0503", "#e2481b"), sun=(0.5, 0.75, 0.2, "#ffb347"), seed=14),
    "atlas-station": dict(name="Atlas Station", motif="station", sky=("#020611", "#1f2f5c"), sun=(0.78, 0.3, 0.2, "#86b7ff"), seed=15),
    "kitchen-after-midnight": dict(name="Kitchen After Midnight", motif="city", sky=("#120a05", "#a8541f"), sun=None, seed=16),
    "wilder-files": dict(name="The Wilder Files", motif="forest", sky=("#140606", "#8a3a2a"), sun=(0.3, 0.3, 0.06, "#e9ecf3"), seed=17),
    "moonrise-academy": dict(name="Moonrise Academy", motif="mountains", sky=("#1b1050", "#e56ec0"), sun=(0.5, 0.35, 0.14, "#fff3c4"), seed=18),
}

# Atlas Station: 2 seasons. Stills are generated per episode id.
EPISODES = [f"atlas-s{s}e{e}" for s, n in ((1, 8), (2, 6)) for e in range(1, n + 1)]


def hexrgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def mix(a, b, t):
    return a * (1 - t) + b * t


def vertical_gradient(w, h, top, bottom, horizon=0.75):
    y = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    t = np.clip(y / horizon, 0, 1) ** 1.6
    img = mix(top[None, None, :], bottom[None, None, :], t[..., None])
    return np.broadcast_to(img, (h, w, 3)).copy()


def add_glow(arr, cx, cy, radius, color, strength=1.0):
    h, w, _ = arr.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / max(radius, 1)
    g = np.exp(-d ** 2 * 0.9) * strength
    return arr + g[..., None] * color[None, None, :] * 0.85


def ridge(w, base, amp, rng, roughness=6, smooth=True):
    xs = np.linspace(0, 1, w)
    y = np.full(w, float(base))
    for octave in range(1, roughness + 1):
        f = 2 ** octave * rng.uniform(0.6, 1.2)
        phase = rng.uniform(0, math.tau)
        y += np.sin(xs * f * math.pi + phase) * amp / (octave ** (1.1 if smooth else 0.6))
    return y


def poly_from_ridge(ys, w, h):
    pts = [(x, float(ys[x])) for x in range(0, w, max(1, w // 400))]
    pts += [(w, float(ys[-1])), (w, h), (0, h)]
    return pts


def draw_layers(img, spec, rng, horizon_color):
    w, h = img.size
    motif = spec["motif"]
    d = ImageDraw.Draw(img, "RGBA")
    hc = tuple(int(c) for c in horizon_color)

    def fade(color, t):
        c = hexrgb(color) if isinstance(color, str) else np.array(color, dtype=np.float32)
        return tuple(int(v) for v in mix(c, np.array(hc, dtype=np.float32), t))

    dark = "#05060a"
    if motif in ("mountains", "desert", "orchard", "kites", "forest", "comets"):
        for i, t in enumerate((0.55, 0.32, 0.0)):
            base = h * (0.58 + i * 0.1)
            amp = h * (0.07 if motif != "desert" else 0.03) * (1.3 - i * 0.2)
            ys = ridge(w, base, amp, rng, smooth=motif != "mountains")
            if motif == "desert" and i == 1:
                # Flat-topped mesas.
                ys = np.where(np.sin(np.linspace(0, 7, w) + rng.uniform(0, 6)) > 0.55, base - h * 0.12, base)
                ys = np.convolve(ys, np.ones(9) / 9, mode="same")
            d.polygon(poly_from_ridge(ys, w, h), fill=fade(dark, t))
            if motif in ("forest", "orchard") and i >= 1:
                n = 26 if motif == "forest" else 10
                for _ in range(n):
                    x = rng.uniform(0, w)
                    y0 = ys[min(w - 1, int(x))]
                    th = h * rng.uniform(0.12, 0.3) * (1 if i == 2 else 0.6)
                    tw = th * (0.28 if motif == "forest" else 0.8)
                    col = fade(dark, t)
                    if motif == "forest":
                        for k in range(4):
                            top = y0 - th + k * th * 0.2
                            d.polygon([(x, top), (x - tw * (0.5 + k * 0.18), top + th * 0.45), (x + tw * (0.5 + k * 0.18), top + th * 0.45)], fill=col)
                        d.rectangle([x - tw * 0.06, y0 - th * 0.2, x + tw * 0.06, y0 + 4], fill=col)
                    else:
                        d.rectangle([x - tw * 0.05, y0 - th * 0.5, x + tw * 0.05, y0 + 4], fill=col)
                        d.ellipse([x - tw / 2, y0 - th, x + tw / 2, y0 - th * 0.35], fill=col)
                        # Glass fruit catching the light.
                        for _ in range(5):
                            fx, fy = x + rng.uniform(-tw / 3, tw / 3), y0 - th * rng.uniform(0.45, 0.9)
                            r = max(2, w * 0.006)
                            d.ellipse([fx - r, fy - r, fx + r, fy + r], fill=(255, 236, 220, 220))
    if motif in ("city", "station"):
        for i, t in enumerate((0.6, 0.3, 0.0)):
            x = -rng.uniform(0, w * 0.05)
            ground = h * (0.78 + i * 0.06)
            col = fade(dark, t)
            while x < w:
                bw = w * rng.uniform(0.04, 0.11)
                bh = h * rng.uniform(0.12, 0.42) * (1.15 - i * 0.15)
                d.rectangle([x, ground - bh, x + bw, h], fill=col)
                if rng.random() < 0.25:
                    d.rectangle([x + bw * 0.45, ground - bh - h * 0.05, x + bw * 0.5, ground - bh], fill=col)
                if i >= 1:
                    neon = spec["sun"][3] if spec["sun"] else "#ffcf7a"
                    nc = tuple(int(v) for v in hexrgb(neon)) + (int(rng.uniform(120, 230)),)
                    step = max(4, w * 0.012)
                    for wy in np.arange(ground - bh + step, h - step, step * 1.6):
                        for wx in np.arange(x + step * 0.6, x + bw - step, step * 1.4):
                            if rng.random() < 0.28:
                                d.rectangle([wx, wy, wx + step * 0.55, wy + step * 0.7], fill=nc)
                x += bw + w * rng.uniform(0.0, 0.015)
        if motif == "city":
            # Wet street reflections.
            d.rectangle([0, h * 0.93, w, h], fill=fade(dark, 0.05))
    if motif in ("waves", "lighthouse"):
        sea_top = h * 0.66
        for k in range(40):
            y = sea_top + (h - sea_top) * (k / 40) ** 1.4
            col = fade("#03070d", 0.35 * (1 - k / 40))
            d.rectangle([0, y, w, h], fill=col)
            if spec["sun"]:
                sx = spec["sun"][0] * w
                sw = w * 0.08 * (1 + k / 12) * rng.uniform(0.6, 1.2)
                sc = tuple(int(v) for v in hexrgb(spec["sun"][3])) + (int(90 * (1 - k / 40)),)
                d.rectangle([sx - sw, y, sx + sw, y + max(1, h * 0.003)], fill=sc)
        if motif == "lighthouse":
            # Cliff and tower.
            cliff = [(w * 0.0, h * 0.62), (w * 0.18, h * 0.6), (w * 0.38, h * 0.64), (w * 0.46, h * 0.72), (w * 0.5, h), (0, h)]
            d.polygon(cliff, fill=fade(dark, 0))
            tx, ty, th = w * 0.25, h * 0.6, h * 0.3
            d.polygon([(tx - w * 0.035, ty), (tx + w * 0.035, ty), (tx + w * 0.022, ty - th), (tx - w * 0.022, ty - th)], fill=fade(dark, 0))
            for b in range(3):
                by = ty - th * (0.25 + b * 0.25)
                d.rectangle([tx - w * 0.03, by, tx + w * 0.03, by + th * 0.06], fill=(150, 30, 30, 255))
            d.rectangle([tx - w * 0.018, ty - th - h * 0.04, tx + w * 0.018, ty - th], fill=(255, 226, 150, 255))
            d.polygon([(tx - w * 0.028, ty - th - h * 0.04), (tx, ty - th - h * 0.065), (tx + w * 0.028, ty - th - h * 0.04)], fill=fade(dark, 0))
            spec["_beam"] = (tx, ty - th - h * 0.02)


def scene(w, h, spec, seed, with_stars=None):
    rng = np.random.default_rng(seed)
    top, bottom = hexrgb(spec["sky"][0]), hexrgb(spec["sky"][1])
    arr = vertical_gradient(w, h, top, bottom)
    stars = with_stars if with_stars is not None else spec["motif"] in ("planet", "comets", "station", "mountains", "lighthouse", "forest")
    if stars:
        n = int(w * h / 2500)
        xs, ys = rng.integers(0, w, n), rng.integers(0, int(h * 0.7), n)
        b = rng.uniform(80, 255, n) * (1 - ys / (h * 0.7))
        arr[ys, xs] = np.maximum(arr[ys, xs], b[:, None])
    sun = spec.get("sun")
    if sun:
        sx, sy, sr, sc = sun
        arr = add_glow(arr, sx * w, sy * h, sr * w * 2.6, hexrgb(sc), 0.75)
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(img, "RGBA")
    if sun:
        sx, sy, sr, sc = sun
        r = sr * w * (0.55 if spec["motif"] not in ("planet", "station") else 1.0)
        c = tuple(int(v) for v in hexrgb(sc))
        if spec["motif"] in ("planet", "station"):
            # Banded planet with a ring.
            pl = Image.new("RGBA", img.size, (0, 0, 0, 0))
            pd = ImageDraw.Draw(pl)
            pd.ellipse([sx * w - r, sy * h - r, sx * w + r, sy * h + r], fill=c + (255,))
            for k in range(7):
                yy = sy * h - r + 2 * r * (k + rng.uniform(0.2, 0.8)) / 7
                pd.rectangle([0, yy, w, yy + r * rng.uniform(0.04, 0.1)], fill=tuple(int(v * 0.82) for v in c) + (255,))
            mask = Image.new("L", img.size, 0)
            ImageDraw.Draw(mask).ellipse([sx * w - r, sy * h - r, sx * w + r, sy * h + r], fill=255)
            shade = Image.new("L", img.size, 0)
            ImageDraw.Draw(shade).ellipse([sx * w - r * 0.6, sy * h - r * 1.3, sx * w + r * 1.7, sy * h + r * 1.1], fill=170)
            shade = shade.filter(ImageFilter.GaussianBlur(r * 0.25))
            pl.putalpha(Image.fromarray(np.minimum(np.array(mask), 255 - np.array(shade) // 2).astype(np.uint8)))
            img.paste(pl, (0, 0), pl)
            d = ImageDraw.Draw(img, "RGBA")
            for k in range(3):
                d.ellipse([sx * w - r * (1.9 - k * 0.12), sy * h - r * (0.32 - k * 0.03), sx * w + r * (1.9 - k * 0.12), sy * h + r * (0.32 - k * 0.03)],
                          outline=c + (150 - k * 40,), width=max(2, int(w * 0.004)))
        else:
            d.ellipse([sx * w - r, sy * h - r, sx * w + r, sy * h + r], fill=c + (255,))
    if spec["motif"] == "comets":
        for _ in range(9):
            x, y = rng.uniform(0, w), rng.uniform(0, h * 0.55)
            ln = w * rng.uniform(0.08, 0.22)
            for k in range(30):
                t = k / 30
                d.line([(x - ln * t, y - ln * t * 0.45), (x - ln * (t + 1 / 30), y - ln * (t + 1 / 30) * 0.45)],
                       fill=(255, 240, 220, int(220 * (1 - t))), width=max(1, int(w * 0.006 * (1 - t))))
            d.polygon([(x, y - w * 0.012), (x + w * 0.016, y), (x, y + w * 0.012), (x - w * 0.006, y)], fill=(255, 252, 240, 255))
    if spec["motif"] == "kites":
        for _ in range(5):
            x, y, s = rng.uniform(w * 0.1, w * 0.9), rng.uniform(h * 0.12, h * 0.45), w * rng.uniform(0.035, 0.07)
            col = tuple(int(v) for v in hexrgb(random.Random(int(x)).choice(["#e50914", "#ffcc00", "#00a6ed", "#ff6f91", "#ffffff"])))
            d.polygon([(x, y - s), (x + s * 0.7, y), (x, y + s * 1.3), (x - s * 0.7, y)], fill=col + (255,))
            d.line([(x, y + s * 1.3), (x - s * 0.4, y + s * 4), (x + s * 0.2, y + s * 6.5)], fill=(255, 255, 255, 160), width=max(1, int(w * 0.002)))
    if spec["motif"] == "station":
        # A ring station crossing the planet.
        cx, cy, R = w * 0.38, h * 0.42, w * 0.22
        d.ellipse([cx - R, cy - R * 0.35, cx + R, cy + R * 0.35], outline=(210, 220, 235, 255), width=max(3, int(w * 0.012)))
        d.rectangle([cx - w * 0.008, cy - R * 0.35, cx + w * 0.008, cy + R * 0.35], fill=(190, 200, 215, 255))
        d.ellipse([cx - w * 0.03, cy - w * 0.03, cx + w * 0.03, cy + w * 0.03], fill=(225, 232, 242, 255))
        for k in range(12):
            a = k / 12 * math.tau
            px, py = cx + math.cos(a) * R, cy + math.sin(a) * R * 0.35
            d.ellipse([px - 3, py - 3, px + 3, py + 3], fill=(255, 210, 120, 255))
    horizon_color = mix(bottom, top, 0.15)
    draw_layers(img, spec, rng, horizon_color)
    beam = spec.pop("_beam", None)
    if beam:
        bl = Image.new("RGBA", img.size, (0, 0, 0, 0))
        bd = ImageDraw.Draw(bl)
        bx, by = beam
        bd.polygon([(bx, by), (w * 1.05, by - h * 0.16), (w * 1.05, by + h * 0.06)], fill=(255, 236, 180, 90))
        bl = bl.filter(ImageFilter.GaussianBlur(w * 0.01))
        img.paste(bl, (0, 0), bl)
    # Haze, grain and vignette.
    arr = np.asarray(img).astype(np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    v = ((xx / w - 0.5) ** 2 + (yy / h - 0.5) ** 2)
    arr *= (1 - np.clip(v * 1.2, 0, 0.6))[..., None]
    arr += rng.normal(0, 5, arr.shape[:2])[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def fit_font(path, text, max_w, start):
    size = start
    while size > 10:
        f = ImageFont.truetype(path, size)
        if f.getbbox(text)[2] <= max_w:
            return f
        size -= 4
    return ImageFont.truetype(path, size)


def wrap_title(name):
    words = name.upper().split()
    if len(words) >= 3:
        mid = (len(words) + 1) // 2
        return [" ".join(words[:mid]), " ".join(words[mid:])]
    return [" ".join(words)]


def draw_title(img, name, bebas, box, align="center", shadow=True, color=(255, 255, 255, 255)):
    """Draws a title inside box (x0, y0, x1, y1). Returns the bottom y."""
    x0, y0, x1, y1 = box
    lines = wrap_title(name)
    max_w = x1 - x0
    fonts = [fit_font(bebas, ln, max_w, int((y1 - y0) / len(lines) * 1.1)) for ln in lines]
    size = min(f.size for f in fonts)
    font = ImageFont.truetype(bebas, size)
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    y = y0
    for ln in lines:
        bb = font.getbbox(ln)
        tw = bb[2] - bb[0]
        x = x0 + (max_w - tw) / 2 if align == "center" else x0
        d.text((x - bb[0], y - bb[1]), ln, font=font, fill=color)
        y += (bb[3] - bb[1]) * 1.08
    if shadow:
        sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
        sh.putalpha(layer.getchannel("A").filter(ImageFilter.GaussianBlur(size * 0.08)).point(lambda a: int(a * 0.8)))
        img.paste(sh, (0, 0), sh)
    img.paste(layer, (0, 0), layer)
    return y


def poster(spec, bebas, inter, w=800, h=1200, textless=False):
    img = scene(w, h, dict(spec), spec["seed"]).convert("RGBA")
    if textless:
        # Key art for the home billboard, where the app draws the title logo over it.
        return img.convert("RGB")
    # Darken the bottom for the type block.
    grad = Image.linear_gradient("L").resize((w, h))
    shade = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    shade.putalpha(grad.point(lambda a: int(max(0, a - 120) * 1.4)))
    img.paste(shade, (0, 0), shade)
    bottom = draw_title(img, spec["name"], bebas, (w * 0.08, h * 0.74, w * 0.92, h * 0.9))
    d = ImageDraw.Draw(img)
    small = ImageFont.truetype(inter, int(w * 0.024))
    credit = "A HOME BLOCKBUSTER DEMO PRODUCTION"
    bb = small.getbbox(credit)
    d.text(((w - bb[2]) / 2, min(h * 0.95, bottom + h * 0.02)), credit, font=small, fill=(235, 235, 235, 200))
    # Small red "H" series mark top-left, like a studio badge.
    mark = ImageFont.truetype(bebas, int(w * 0.09))
    d.text((w * 0.05, h * 0.03), "H", font=mark, fill=(229, 9, 20, 255))
    return img.convert("RGB")


def logo(spec, bebas, w=900, h=360):
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw_title(img, spec["name"], bebas, (10, 10, w - 10, h - 10), shadow=False)
    # Soft shadow baked in so the logo reads on any artwork.
    a = img.getchannel("A")
    sh = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sh.putalpha(a.filter(ImageFilter.GaussianBlur(10)).point(lambda v: int(v * 0.7)))
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(sh, (0, 0), sh)
    out.alpha_composite(img)
    return out.crop(out.getbbox())


def find_bebas(explicit):
    if explicit:
        return explicit
    cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".fonts")
    path = os.path.join(cache, "package", "files", "bebas-neue-latin-400-normal.woff")
    if not os.path.exists(path):
        os.makedirs(cache, exist_ok=True)
        # Bebas Neue (SIL Open Font License) from the @fontsource package on npm.
        subprocess.run("npm pack @fontsource/bebas-neue@5.3.0 --silent && tar xzf fontsource-bebas-neue-*.tgz", shell=True, cwd=cache, check=True)
    return path


def find_inter():
    for p in ("/usr/share/fonts/opentype/inter/Inter-SemiBold.otf", "/usr/share/fonts/truetype/inter/Inter-SemiBold.ttf"):
        if os.path.exists(p):
            return p
    return "DejaVuSans.ttf"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--bebas")
    args = ap.parse_args()
    bebas, inter = find_bebas(args.bebas), find_inter()
    for sub in ("posters", "backdrops", "logos", "stills"):
        os.makedirs(os.path.join(args.out, sub), exist_ok=True)
    for tid, spec in TITLES.items():
        print("art:", tid)
        big = tid == "last-lighthouse"  # Billboard title: shown full-bleed on the home screen.
        poster(spec, bebas, inter, *((1120, 1680) if big else (600, 900)), textless=big).save(os.path.join(args.out, "posters", f"{tid}.png"))
        scene(1600, 900, dict(spec), spec["seed"] + 100).save(os.path.join(args.out, "backdrops", f"{tid}.png"))
        logo(spec, bebas).save(os.path.join(args.out, "logos", f"{tid}.png"))
    base = TITLES["atlas-station"]
    motifs = ["station", "planet", "city", "mountains", "station", "comets"]
    skies = [("#020611", "#1f2f5c"), ("#0b0320", "#6a2c70"), ("#03121a", "#14606e"), ("#120d02", "#8a5a12"), ("#04040a", "#33334d")]
    for i, eid in enumerate(EPISODES):
        spec = dict(base, motif=motifs[i % len(motifs)], sky=skies[i % len(skies)],
                    sun=(0.3 + 0.07 * (i % 6), 0.35, 0.12 + 0.02 * (i % 3), ["#86b7ff", "#ffb38a", "#9df2d6", "#f7e27c"][i % 4]))
        scene(640, 360, spec, 500 + i).save(os.path.join(args.out, "stills", f"{eid}.png"))
    # The paused frame behind the player controls.
    frame = dict(TITLES["atlas-station"], sun=(0.7, 0.42, 0.13, "#86b7ff"))
    scene(1920, 1080, frame, 777).save(os.path.join(args.out, "frame.png"))


if __name__ == "__main__":
    main()
