# Builds Bogmaw's sounds (src/dungeonEnemies.ts goblin section, src/dungeon/bogFx.ts),
# synthesised so nothing is borrowed: the Goblin King's gong, a bomb going off, a
# roll of thunder for the lightning, the twang of a goblin bow, and the rain that
# loops over the camp. Run from the repo root: python scripts/build-bog-sounds.py
import numpy as np
from scipy import signal
import wave

RATE = 22050
rng = np.random.default_rng(23)


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


def highpass(x, hz, order=2):
    b, a = signal.butter(order, hz / (RATE / 2), btype='high')
    return signal.lfilter(b, a, x)


def bandpass(x, lo, hi, order=2):
    b, a = signal.butter(order, [lo / (RATE / 2), hi / (RATE / 2)], btype='band')
    return signal.lfilter(b, a, x)


def t_axis(seconds):
    return np.arange(int(RATE * seconds)) / RATE


def gong():
    # Inharmonic partials of a bronze gong, a struck-metal noise burst, a long shimmering decay.
    t = t_axis(4.0)
    partials = [(1.0, 1.0, 2.6), (1.51, 0.6, 2.2), (2.03, 0.45, 1.8), (2.74, 0.35, 1.5), (3.42, 0.25, 1.2), (4.7, 0.18, 0.9), (0.5, 0.5, 3.2)]
    base = 92.0
    out = np.zeros_like(t)
    for ratio, amp, decay in partials:
        f = base * ratio
        # A slow beat between two detuned copies gives the wobble of a real gong.
        out += amp * np.exp(-t / decay) * (np.sin(2 * np.pi * f * t) + 0.6 * np.sin(2 * np.pi * f * 1.006 * t + 0.4))
    strike = bandpass(rng.normal(size=len(t)), 800, 5000) * np.exp(-t / 0.06) * 0.8
    out = out / (np.abs(out).max() + 1e-9) + strike
    out *= np.minimum(1, t / 0.004)
    return 0.9 * out / (np.abs(out).max() + 1e-9)


def explosion():
    t = t_axis(1.8)
    boom = lowpass(rng.normal(size=len(t)), 160) * np.exp(-t / 0.35) * 3
    crack = highpass(rng.normal(size=len(t)), 1200) * np.exp(-t / 0.05) * 1.2
    rumble = lowpass(rng.normal(size=len(t)), 90, 2) * np.exp(-t / 0.9) * 2
    debris = bandpass(rng.normal(size=len(t)), 600, 3000) * np.exp(-(t - 0.25) ** 2 / 0.03) * 0.3 * (t > 0.2)
    out = boom + crack + rumble + debris
    out *= np.minimum(1, t / 0.002)
    return 0.95 * out / (np.abs(out).max() + 1e-9)


def thunder():
    t = t_axis(3.6)
    crack = highpass(rng.normal(size=len(t)), 900) * np.exp(-t / 0.08) * 1.5
    roll = lowpass(rng.normal(size=len(t)), 140, 3)
    # Three rolling swells, each a little later and softer.
    swell = np.zeros_like(t)
    for at, w, a in [(0.15, 0.35, 1.0), (0.9, 0.5, 0.7), (1.9, 0.7, 0.45)]:
        swell += a * np.exp(-((t - at) / w) ** 2)
    out = crack + roll * swell * 3 * np.exp(-t / 2.4)
    return 0.9 * out / (np.abs(out).max() + 1e-9)


def bow():
    # The string's twang (a plucked, quickly damped tone) and the arrow's whisper.
    t = t_axis(0.5)
    string = np.sin(2 * np.pi * 180 * t * (1 + 0.1 * np.exp(-t / 0.02))) * np.exp(-t / 0.07)
    string += 0.4 * np.sin(2 * np.pi * 360 * t) * np.exp(-t / 0.04)
    whisper = bandpass(rng.normal(size=len(t)), 1500, 6000) * np.exp(-((t - 0.08) / 0.1) ** 2) * 0.5
    out = string + whisper
    return 0.8 * out / (np.abs(out).max() + 1e-9)


def rain_loop():
    # Steady rain: broadband hiss with a drizzle of individual drops, tapered to loop.
    t = t_axis(6.0)
    hiss = bandpass(rng.normal(size=len(t)), 900, 7000) * 0.5
    drops = np.zeros_like(t)
    for _ in range(900):
        at = int(rng.uniform(0, len(t) - 400))
        n = int(rng.uniform(60, 300))
        tone = np.sin(2 * np.pi * rng.uniform(1800, 4500) * np.arange(n) / RATE) * np.exp(-np.arange(n) / (n / 4))
        drops[at:at + n] += tone * rng.uniform(0.1, 0.4)
    out = hiss + drops
    fade = int(0.25 * RATE)
    ramp = np.linspace(0, 1, fade)
    out[:fade] *= ramp
    out[-fade:] *= ramp[::-1]
    # Overlap the ends so the loop point is seamless.
    out[:fade] += out[-fade:][::-1] * (1 - ramp)
    return 0.7 * out / (np.abs(out).max() + 1e-9)


write('sounds/gong.wav', gong())
write('sounds/explosion.wav', explosion())
write('sounds/thunder.wav', thunder())
write('sounds/bow.wav', bow())
write('sounds/rain_loop.wav', rain_loop())
