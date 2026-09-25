# Builds the upgrade pit's sounds (src/pitFire.ts, src/pitCinematic.ts), synthesised
# so nothing is borrowed: a deep looping roar for the pit itself, the whoosh of the
# fire leaping when a weapon goes in, and the chime of the reveal. Run from the
# repo root: python scripts/build-pit-sounds.py
import numpy as np
from scipy import signal
import wave

RATE = 22050
rng = np.random.default_rng(11)


def write(path, data):
    data = np.clip(data, -1, 1)
    pcm = (data * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())
    print('wrote', path, f'{len(data) / RATE:.2f}s')


def brown(n):
    x = np.cumsum(rng.normal(size=n))
    x -= signal.savgol_filter(x, 2001 if n > 2001 else n // 2 * 2 - 1, 2)
    return x / (np.abs(x).max() + 1e-9)


def lowpass(x, hz, order=4):
    b, a = signal.butter(order, hz / (RATE / 2))
    return signal.lfilter(b, a, x)


def bandpass(x, lo, hi, order=2):
    b, a = signal.butter(order, [lo / (RATE / 2), hi / (RATE / 2)], btype='band')
    return signal.lfilter(b, a, x)


def env(n, attack, release, hold=0.0):
    t = np.arange(n) / RATE
    total = n / RATE
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    r = np.clip((total - t) / max(release, 1e-4), 0, 1)
    return np.minimum(a, r) ** 1.5


# --- pit loop: 4 s of low roar with slow breathing, seamless -------------------------------
n = RATE * 4
t = np.arange(n) / RATE
base = lowpass(brown(n), 180) * 1.6
crackle = bandpass(rng.normal(size=n), 900, 3500) * (rng.random(n) < 0.004) * 0.9
crackle = lowpass(np.abs(crackle), 60) * np.sign(crackle) * 4
breath = 0.75 + 0.25 * np.sin(2 * np.pi * t / 4) * np.sin(2 * np.pi * t * 0.75 + 1)
loop = (base + crackle * 0.35) * breath
# Cross-fade the tail into the head so the loop closes.
fade = int(RATE * 0.25)
ramp = np.linspace(0, 1, fade)
loop[:fade] = loop[:fade] * ramp + loop[-fade:] * (1 - ramp)
loop = loop[:-fade]
write('sounds/pit_loop.wav', loop / (np.abs(loop).max() + 1e-9) * 0.7)

# --- fire flare: a whoosh that swells and roars, 1.8 s ---------------------------------------
n = int(RATE * 1.8)
t = np.arange(n) / RATE
noise = rng.normal(size=n)
# The filter sweeps up as the fire catches, then settles low as it roars.
sweep = 300 + 2600 * np.exp(-((t - 0.35) ** 2) / 0.05) + 200 * np.exp(-t * 2)
out = np.zeros(n)
block = 256
for i in range(0, n, block):
    hz = float(np.clip(sweep[i], 80, RATE / 2 - 100))
    b, a = signal.butter(2, [max(60, hz * 0.4) / (RATE / 2), min(hz * 1.6, RATE / 2 - 50) / (RATE / 2)], btype='band')
    out[i:i + block] = signal.lfilter(b, a, noise[max(0, i - 512):i + block])[-min(block, n - i):]
rumble = lowpass(brown(n), 120) * 2.2
whoosh = out * env(n, 0.18, 0.9) * 1.4 + rumble * env(n, 0.25, 1.2)
write('sounds/fire_flare.wav', whoosh / (np.abs(whoosh).max() + 1e-9) * 0.85)

# --- reveal chime: a rising three-note bell with shimmer, 2.6 s -----------------------------
n = int(RATE * 2.6)
t = np.arange(n) / RATE
chime = np.zeros(n)
for i, (f0, at) in enumerate([(523.25, 0.0), (659.25, 0.16), (783.99, 0.32), (1046.5, 0.5)]):
    tt = np.clip(t - at, 0, None)
    gate = (t >= at).astype(float)
    for k, (mult, amp, decay) in enumerate([(1, 1.0, 1.1), (2.0, 0.45, 0.7), (3.01, 0.22, 0.45), (4.2, 0.12, 0.3)]):
        chime += gate * amp * np.sin(2 * np.pi * f0 * mult * tt) * np.exp(-tt / decay) * (0.8 if i < 3 else 1.1)
shimmer = bandpass(rng.normal(size=n), 4000, 9000) * np.exp(-np.clip(t - 0.5, 0, None) / 0.8) * (t >= 0.5) * 0.12
chime = chime * 0.28 + shimmer
write('sounds/reveal.wav', chime / (np.abs(chime).max() + 1e-9) * 0.8)
