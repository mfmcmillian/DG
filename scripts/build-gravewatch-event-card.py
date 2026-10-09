"""Build the HUD event-card thumbnail from the full Gravewatch banner."""

from pathlib import Path

from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
source = Image.open(ROOT / "images/gravewatch/rising-banner.png").convert("RGB")

# A close crop keeps the demon, graveyard and fire readable at the HUD's small size.
card = source.crop((360, 35, 1120, 355))
card = ImageEnhance.Contrast(card).enhance(1.12)
card = ImageEnhance.Color(card).enhance(1.08)

# Bake in a left/bottom vignette for UI text while leaving the event art visible.
shade = Image.new("RGBA", card.size, (0, 0, 0, 0))
pixels = shade.load()
for y in range(shade.height):
    for x in range(shade.width):
        left = max(0.0, 1.0 - x / 470)
        bottom = max(0.0, (y - 185) / 135)
        alpha = int(205 * left + 80 * bottom * (1 - left * 0.45))
        pixels[x, y] = (12, 3, 24, min(225, alpha))

card = Image.alpha_composite(card.convert("RGBA"), shade)
card.save(ROOT / "images/gravewatch/event-card.png", "PNG", optimize=True)
print("Built images/gravewatch/event-card.png")
