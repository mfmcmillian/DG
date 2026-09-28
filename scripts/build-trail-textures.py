"""
The weapon trail's two sprites (src/combatFx.ts fxSlash): a soft haze that runs
the blade's length, and a thin hot core along its edge. U runs hilt -> tip, V
runs along the sweep and ramps softly to nothing at both edges: the ribbon's
segments are laid half over their neighbours, so the ramps sum to a continuous
sheet instead of a fan of hard-edged slats. Both are white; the material tints
them.

Usage: python scripts/build-trail-textures.py
"""
import os

import numpy as np
from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT = os.path.join(ROOT, 'images', 'fx')
W, H = 256, 32


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def save(name, alpha):
    a = np.clip(alpha, 0, 1)
    rgba = np.zeros((H, W, 4), dtype=np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = np.round(np.broadcast_to(a, (H, W)) * 255).astype(np.uint8)
    Image.fromarray(rgba, 'RGBA').save(os.path.join(OUT, name))
    print(name)


u = (np.arange(W) + 0.5) / W
v = (np.arange(H) + 0.5) / H
# Across the sweep: a plateau with ramps that, at half overlap, add up to one.
across = smoothstep(0.0, 0.5, v) * (1 - smoothstep(0.5, 1.0, v))
across = across / across.max()
# Haze: nothing at the hilt, swelling toward the tip, dying out right at the edge so the core reads as the blade.
haze = smoothstep(0.05, 0.7, u) ** 1.4 * 0.85 * (1 - smoothstep(0.94, 1.0, u))
# Speed lines: soft streaks along the blade axis. Constant across the sweep, so
# they run the length of the trail unbroken through every slat (the rays of a
# swing about the hand), and fade toward the tip where the core takes over.
rng = np.random.default_rng(7)
streaks = np.zeros_like(u)
for freq, weight in ((5, 1.0), (9, 0.7), (17, 0.45), (29, 0.25)):
    streaks += weight * np.sin(2 * np.pi * freq * u + rng.uniform(0, 2 * np.pi))
streaks = (streaks - streaks.min()) / (streaks.max() - streaks.min())
streaks = 1 - 0.35 * (1 - streaks) * (1 - smoothstep(0.7, 0.95, u))
save('trail_haze.png', across[:, None] * (haze * streaks)[None, :])
# Core: a bright line where the edge cuts, with a faint glow either side.
core = np.exp(-((u - 0.905) / 0.022) ** 2) + 0.35 * np.exp(-((u - 0.9) / 0.07) ** 2)
save('trail_core.png', across[:, None] * core[None, :])
# Arrow tracer (src/projectiles.ts): brightest at the arrowhead end (u = 1),
# thinning to nothing behind; a hot thread down the middle of the sweep.
thread = np.exp(-((v - 0.5) / 0.09) ** 2)
tracer = (u ** 2.2) * (0.55 * across[:, None] + 0.75 * thread[:, None] * u[None, :] ** 0.5)
save('arrow_streak.png', tracer)
