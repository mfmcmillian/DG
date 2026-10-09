"""Cut the generated Gravewalk subjects onto transparency and add Start."""

from pathlib import Path
import math

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
source = Image.open(ROOT / "images/gravewatch/board-icons.jpg").convert("RGB")
cell = 256


def cutout(image: Image.Image) -> Image.Image:
    """Remove the near-black generated backdrop and softly fade cell edges."""
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    for y in range(cell):
        for x in range(cell):
            r, g, b, _ = pixels[x, y]
            value = max(r, g, b)
            # The art's subjects and magical glow are substantially brighter
            # than its charcoal studio backdrop.
            subject = max(0.0, min(1.0, (value - 13) / 42))
            dx, dy = (x - cell / 2) / cell, (y - cell / 2) / cell
            radius = math.hypot(dx, dy)
            edge = max(0.0, min(1.0, (0.70 - radius) / 0.14))
            alpha = int(255 * subject * edge)
            # Remove the remaining black fringe from partially transparent pixels.
            if alpha:
                lift = min(1.0, 0.45 + alpha / 255)
                pixels[x, y] = (int(r * lift), int(g * lift), int(b * lift), alpha)
            else:
                pixels[x, y] = (0, 0, 0, 0)
    return rgba


def start_icon() -> Image.Image:
    """A gold cemetery gate: readable as the beginning at board-tile size."""
    image = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
    glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    g.ellipse((48, 25, 208, 229), fill=(255, 169, 35, 105))
    glow = glow.filter(ImageFilter.GaussianBlur(27))
    image = Image.alpha_composite(image, glow)
    draw = ImageDraw.Draw(image)
    dark = (104, 52, 7, 255)
    gold = (245, 174, 44, 255)
    light = (255, 232, 139, 255)
    # Two stone posts and an open arch/gate.
    draw.rounded_rectangle((44, 61, 70, 211), radius=5, fill=dark, outline=gold, width=7)
    draw.rounded_rectangle((186, 61, 212, 211), radius=5, fill=dark, outline=gold, width=7)
    draw.arc((61, 32, 195, 165), 180, 360, fill=light, width=13)
    draw.arc((74, 46, 182, 157), 180, 360, fill=gold, width=8)
    for x in (88, 111, 145, 168):
        draw.line((x, 98, x, 202), fill=gold, width=7)
        draw.polygon(((x - 7, 99), (x, 84), (x + 7, 99)), fill=light)
    draw.line((70, 202, 186, 202), fill=light, width=8)
    # A bright path through the open gate points into the board.
    draw.polygon(((105, 219), (151, 219), (140, 153), (116, 153)), fill=(255, 195, 62, 210))
    return image


# Four columns leave a stable slot for Start and one spare transparent cell.
atlas = Image.new("RGBA", (cell * 4, cell * 2), (0, 0, 0, 0))
start = start_icon()
atlas.paste(start, (0, 0), start)
destinations = [(1, 0), (2, 0), (3, 0), (0, 1), (1, 1), (2, 1)]
for index, (col, row) in enumerate(destinations):
    tile = source.crop(((index % 3) * cell, (index // 3) * cell, (index % 3 + 1) * cell, (index // 3 + 1) * cell))
    icon = cutout(tile)
    atlas.paste(icon, (col * cell, row * cell), icon)

target = ROOT / "images/gravewatch/board-icons.png"
atlas = atlas.resize((512, 256), Image.Resampling.LANCZOS)
alpha = atlas.getchannel("A").point(lambda value: 0 if value < 8 else min(255, round(value / 17) * 17))
compact = atlas.convert("RGB").quantize(colors=160, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGBA")
compact.putalpha(alpha)
compact.save(target, "PNG", optimize=True)
print(f"Built {target.relative_to(ROOT)}")
