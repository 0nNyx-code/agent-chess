#!/usr/bin/env python3
"""Generate Agent Chess launcher icons from the CC0 knight sprite."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "app" / "assets" / "pieces" / "knight-w.png"
RES = ROOT / "android" / "res"
SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}


def radial(size, inner, outer):
    img = Image.new("RGBA", (size, size), outer)
    px = img.load()
    cx = cy = size / 2
    maxd = (size * 0.72)
    for y in range(size):
        for x in range(size):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            t = min(1.0, d / maxd)
            px[x, y] = tuple(int(inner[i] * (1 - t) + outer[i] * t) for i in range(4))
    return img


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return m


def make_icon(size):
    scale = 4
    s = size * scale
    base = radial(s, (46, 22, 26, 255), (12, 7, 9, 255))
    mask = rounded_mask(s, int(s * 0.22))
    base.putalpha(mask)

    # gold rim
    rim = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rim)
    rd.rounded_rectangle(
        (int(s * 0.012), int(s * 0.012), s - int(s * 0.012), s - int(s * 0.012)),
        radius=int(s * 0.21),
        outline=(240, 180, 41, 210),
        width=max(2, int(s * 0.012)),
    )
    base.alpha_composite(rim)

    # warm glow behind the knight
    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse(
        (int(s * 0.18), int(s * 0.14), int(s * 0.82), int(s * 0.78)),
        fill=(240, 180, 41, 46),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(int(s * 0.055)))
    base.alpha_composite(glow)

    sprite = Image.open(SRC).convert("RGBA")
    target = int(s * 0.78)
    sprite = sprite.resize((target, target), Image.LANCZOS)

    shadow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sh = Image.new("RGBA", sprite.size, (0, 0, 0, 0))
    alpha = sprite.getchannel("A").point(lambda a: int(a * 0.55))
    black = Image.new("RGBA", sprite.size, (0, 0, 0, 255))
    black.putalpha(alpha)
    sh.alpha_composite(black)
    sh = sh.filter(ImageFilter.GaussianBlur(int(s * 0.012)))
    ox = (s - target) // 2
    oy = int(s * 0.09)
    shadow.alpha_composite(sh, (ox, oy + int(s * 0.02)))
    base.alpha_composite(shadow)

    base.alpha_composite(sprite, (ox, oy))

    return base.resize((size, size), Image.LANCZOS)


def main():
    for folder, size in SIZES.items():
        out = RES / folder
        out.mkdir(parents=True, exist_ok=True)
        icon = make_icon(size)
        icon.save(out / "ic_launcher.png")
        print("wrote", out / "ic_launcher.png")
    big = make_icon(512)
    big.save(ROOT / "dist" / "icon-512.png")
    print("wrote dist/icon-512.png")


if __name__ == "__main__":
    main()
