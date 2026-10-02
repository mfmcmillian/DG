# Builds the Crypt's sounds (src/cryptFx.ts, src/dungeonEnemies.ts crypt branches),
# synthesised so nothing is borrowed: the wind that loops under the hill with the
# odd drip and groan, a bell tolled once (the Chapel's, and the Rising's call),
# and the Lich's raising of the dead, a low choir swell with bone rattling in it.
# Run from the repo root: python scripts/build-crypt-sounds.py
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


def lowpass(x, hz, order=4):
    b, a = signal.butter(order, hz / (RATE / 2))
    return signal.lfilter(b, a, x)


def bandpass(x, lo, hi, order=2):
    b, a = signal.butter(order, [lo / (RATE / 2), hi / (RATE / 2)], btype='band')
    return signal.lfilter(b, a, x)


def t_axis(seconds):
    return np.arange(int(RATE * seconds)) / RATE


def seamless(x, fade=0.5):
    """Cross-fade the tail into the head so the loop has no click."""
    n = int(RATE * fade)
    ramp = np.linspace(0, 1, n)
    out = x.copy()
    out[:n] = x[:n] * ramp + x[-n:] * (1 - ramp)
    return out[:-n]


def crypt_loop():
    # Wind through stone: low filtered noise whose band drifts slowly, a deeper
    # moan underneath, three water drips and one distant groan of old hinges.
    t = t_axis(16.0)
    noise = rng.normal(size=len(t))
    drift = 0.5 + 0.5 * np.sin(2 * np.pi * t / 7.3)
    wind = lowpass(noise, 420) * (0.35 + 0.4 * drift) + bandpass(noise, 600, 1400) * 0.08 * (1 - drift)
    moan = 0.12 * np.sin(2 * np.pi * 55 * t + 0.8 * np.sin(2 * np.pi * 0.17 * t)) * (0.6 + 0.4 * np.sin(2 * np.pi * t / 11))
    out = wind + moan
    for when, pitch in [(3.1, 2100), (8.7, 1700), (12.9, 2500)]:
        i = int(when * RATE)
        d = t_axis(0.5)
        drip = np.sin(2 * np.pi * pitch * d * (1 - 0.35 * d)) * np.exp(-d / 0.06) * 0.35
        out[i:i + len(d)] += drip
    i = int(5.6 * RATE)
    g = t_axis(1.6)
    groan = bandpass(rng.normal(size=len(g)), 90, 260) * np.sin(np.pi * g / 1.6) ** 2 * 0.5
    out[i:i + len(g)] += groan
    out = seamless(out, 1.0)
    return 0.8 * out / (np.abs(out).max() + 1e-9)


def bell():
    # One toll of a large bronze bell: hum, prime, tierce, quint and nominal, each with its own decay.
    t = t_axis(5.0)
    base = 110.0
    partials = [(0.5, 0.9, 3.8), (1.0, 1.0, 3.0), (1.2, 0.6, 2.4), (1.5, 0.5, 2.0), (2.0, 0.55, 1.6), (2.5, 0.25, 1.2), (3.0, 0.2, 0.9)]
    out = np.zeros_like(t)
    for ratio, amp, decay in partials:
        f = base * ratio
        out += amp * np.exp(-t / decay) * np.sin(2 * np.pi * f * t + 0.3 * ratio)
    clapper = bandpass(rng.normal(size=len(t)), 1500, 6000) * np.exp(-t / 0.03) * 0.6
    out = out / (np.abs(out).max() + 1e-9) + clapper
    out *= np.minimum(1, t / 0.003)
    return 0.9 * out / (np.abs(out).max() + 1e-9)


def raise_dead():
    # The Lich's call: a swell of low voices (detuned saws through a slow filter), bones
    # clattering out of the ground, and a breath of wind drawn in at the end.
    t = t_axis(2.6)
    env = np.sin(np.pi * np.minimum(1, t / 2.6)) ** 1.5
    choir = np.zeros_like(t)
    for f, amp in [(82.4, 1.0), (98.0, 0.7), (123.5, 0.6), (164.8, 0.45), (41.2, 0.8)]:
        for det in (-0.6, 0, 0.7):
            choir += amp * signal.sawtooth(2 * np.pi * (f + det) * t) / 3
    choir = lowpass(choir, 260 + 500 * env) if False else lowpass(choir, 420) * env * 0.55
    bones = np.zeros_like(t)
    for _ in range(26):
        i = int(rng.uniform(0.2, 2.0) * RATE)
        d = t_axis(0.09)
        click = bandpass(rng.normal(size=len(d)), 900, 4500) * np.exp(-d / 0.012) * rng.uniform(0.2, 0.5)
        bones[i:i + len(d)] += click
    breath = lowpass(rng.normal(size=len(t)), 900) * np.clip((t - 1.6) / 1.0, 0, 1) ** 2 * 0.35
    out = choir + bones + breath
    return 0.9 * out / (np.abs(out).max() + 1e-9)


write('sounds/crypt_loop.wav', crypt_loop())
write('sounds/bell.wav', bell())
write('sounds/raise_dead.wav', raise_dead())
