# Builds images/fx/fire_sheet.png, the upgrade pit's flame flipbook (src/pitFire.ts):
# 8 x 8 tiles of 128 px, read left-to-right, top-to-bottom, drawn on black for
# additive blending. Run from the repo root: python scripts/build-fire-sheet.py
# Periodic noise from a filtered random spectrum (so frame 63 flows into frame 0),
# shaped into a tongue of flame and coloured white -> yellow -> orange -> red.
import numpy as np
from PIL import Image

TILE = 128
COLS = ROWS = 8
FRAMES = COLS * ROWS
rng = np.random.default_rng(7)


def periodic_noise(shape, beta=1.6, seed=0):
    """fBm-like noise, periodic on every axis, values ~[0,1]."""
    r = np.random.default_rng(seed)
    spec = r.normal(size=shape) + 1j * r.normal(size=shape)
    freqs = np.meshgrid(*[np.fft.fftfreq(n) * n for n in shape], indexing='ij')
    k = np.sqrt(sum(f ** 2 for f in freqs))
    k[tuple([0] * len(shape))] = 1
    spec = spec / (k ** beta)
    spec[tuple([0] * len(shape))] = 0
    # The slowest modes would tilt the whole flame one way for the whole loop; drop them.
    spec[k < 2.5] = 0
    n = np.real(np.fft.ifftn(spec))
    n = (n - n.min()) / (n.max() - n.min())
    return n


# Two noise volumes (x, y, t): one warps the flame sideways, one breaks it up.
H = TILE
W = TILE
n1 = periodic_noise((W, H, FRAMES), beta=2.6, seed=1)
n2 = periodic_noise((W, H, FRAMES), beta=1.9, seed=2)

ys = np.linspace(0, 1, H)            # 0 at the bottom of the tile
xs = np.linspace(-1, 1, W)
U, V = np.meshgrid(xs, ys, indexing='xy')  # U: x, V: height (row 0 = bottom)


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


sheet = np.zeros((ROWS * TILE, COLS * TILE, 4), dtype=np.uint8)
for f in range(FRAMES):
    # Scroll the noise upward one full tile over the loop, so the flames rise and the loop closes.
    shift = int(round(f * H / FRAMES))
    a = np.roll(n1[:, :, f], -shift, axis=1).T   # (H, W)
    b = np.roll(n2[:, :, f], -shift, axis=1).T
    # Centre the warp so the flame stands up on average instead of leaning with the noise's slow drift.
    a = a - a.mean(axis=1, keepdims=True) + 0.5
    b = b - b.mean() + 0.5
    # Warp grows with height: the base is steady, the tip licks about.
    u = U + (a - 0.5) * 1.6 * (0.1 + V) ** 1.2
    v = V + (b - 0.5) * 0.5 * V
    # The tongue: wide near the bottom third, tapering to the tip; slight pinch at the base.
    radius = 0.5 * np.clip(1 - v / 0.95, 0, 1) ** 0.6 * (0.5 + 0.5 * smooth(v / 0.2))
    d = np.abs(u) / np.maximum(radius, 1e-3)
    body = np.clip(1 - d * d, 0, 1)
    # Break-up: dark eddies eat into the flame more the higher it goes.
    eat = smooth((b - 0.35) * 2.2) * (0.1 + 0.9 * V) ** 1.5
    heat = body * (1 - 0.8 * eat) * np.clip(1.0 - v / 0.95, 0, 1) ** 0.45
    heat = np.clip(heat, 0, 1) * smooth(V / 0.1)
    # Hotter core: a second narrower tongue adds to the middle.
    core = np.clip(1 - (np.abs(u) / np.maximum(radius * 0.5, 1e-3)) ** 2, 0, 1) * np.clip(0.7 - v, 0, 1) ** 0.9
    heat = np.clip(heat + core * 0.6, 0, 1.4)

    # Colour ramp by heat.
    h = heat
    r = np.clip(0.9 * smooth(h * 1.6) + 0.2 * smooth(h), 0, 1)
    g = np.clip(smooth((h - 0.25) * 1.5) * 0.85 + smooth((h - 0.9) * 3) * 0.15, 0, 1)
    bl = np.clip(smooth((h - 0.85) * 3.5), 0, 1) * 0.9
    alpha = smooth(h * 1.3)
    rgba = np.stack([r, g, bl, alpha], axis=-1)
    rgba[..., :3] *= alpha[..., None] ** 0.5  # premultiply a little so the fringe stays dark for additive blending
    tile = np.flipud((rgba * 255).astype(np.uint8))  # row 0 at the top of the image
    row, col = divmod(f, COLS)
    sheet[row * TILE:(row + 1) * TILE, col * TILE:(col + 1) * TILE] = tile

out = 'images/fx/fire_sheet.png'
Image.fromarray(sheet, 'RGBA').save(out, optimize=True)
import os
print('wrote', out, os.path.getsize(out) // 1024, 'KB')
