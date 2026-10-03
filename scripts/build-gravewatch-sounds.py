# Builds Gravewatch's board sounds (src/gravewatch.ts), synthesised so nothing is
# borrowed: dice rattling in a cup before they settle, and the pawn's hop from
# grave to grave. Run from the repo root: python scripts/build-gravewatch-sounds.py
import numpy as np
from scipy import signal
import wave

RATE = 22050
rng = np.random.default_rng(31)


def write(path, data):
    data = np.clip(data, -1, 1)
    pcm = (data * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())
    print('wrote', path, f'{len(data) / RATE:.2f}s')


def bandpass(x, lo, hi, order=2):
    b, a = signal.butter(order, [lo / (RATE / 2), hi / (RATE / 2)], btype='band')
    return signal.lfilter(b, a, x)


def click(length, lo, hi, decay):
    """One bone click: filtered noise with a sharp attack and a fast decay."""
    n = int(length * RATE)
    t = np.arange(n) / RATE
    body = bandpass(rng.normal(size=n), lo, hi) * np.exp(-t * decay)
    return body / (np.abs(body).max() + 1e-9)


def dice():
    """Nine tenths of a second: clicks thick at first, thinning as the dice settle, two firm taps at the end."""
    total = int(0.9 * RATE)
    out = np.zeros(total)
    at = 0.0
    while at < 0.72:
        c = click(0.05, 1800 + rng.uniform(-400, 600), 6500, 90) * rng.uniform(0.35, 0.8)
        i = int(at * RATE)
        end = min(total, i + len(c))
        out[i:end] += c[: end - i]
        at += rng.uniform(0.03, 0.06) * (1 + at * 1.6)
    for when, gain in ((0.76, 0.9), (0.84, 0.7)):
        c = click(0.07, 900, 3200, 60) * gain
        i = int(when * RATE)
        end = min(total, i + len(c))
        out[i:end] += c[: end - i]
    return out * 0.8


def hop():
    """A soft knock of bone on stone, a hundredth of a second of body under it."""
    n = int(0.09 * RATE)
    t = np.arange(n) / RATE
    tap = click(0.09, 700, 2600, 70)
    body = np.sin(2 * np.pi * 160 * t) * np.exp(-t * 45) * 0.5
    out = tap * 0.6 + body
    return out / (np.abs(out).max() + 1e-9) * 0.7


write('sounds/dice.wav', dice())
write('sounds/hop.wav', hop())
