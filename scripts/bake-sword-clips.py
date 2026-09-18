"""
Copy animation clips onto a single-joint weapon GLB.

Weapon parts (e.g. models/roaming/weapons/pride-sword-dusk-combat-v3.glb) are
skinned to one joint, `hand_r`, which sits at the scene root. Their animation
channels therefore hold the *world-space* TRS of hand_r, with the whole parent
chain collapsed in. Blender cannot round-trip that, so this script samples the
hand_r world transform from a full-skeleton body part (core.glb) for every
clip the weapon is missing, and appends the resulting tracks to the weapon.

Usage:
  python scripts/bake-sword-clips.py [--verify]
  python scripts/bake-sword-clips.py --source <core.glb> --target <weapon.glb> [--joint hand_r]
"""
import argparse
import json
import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / 'models/roaming/customization/male/warm/core.glb'
DEFAULT_TARGET = ROOT / 'models/roaming/weapons/pride-sword-dusk-combat-v3.glb'
SAMPLE_FPS = 30.0

COMP = {5126: ('f', 4), 5123: ('H', 2), 5125: ('I', 4), 5121: ('B', 1), 5120: ('b', 1), 5122: ('h', 2)}
NUM = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


# ---------------------------------------------------------------- GLB I/O ---

def load_glb(path):
    data = Path(path).read_bytes()
    magic, version, length = struct.unpack_from('<4sII', data, 0)
    assert magic == b'glTF', f'{path} is not a GLB'
    off = 12
    gltf = None
    bin_ = b''
    while off < length:
        clen, ctype = struct.unpack_from('<I4s', data, off)
        off += 8
        chunk = data[off:off + clen]
        off += clen
        if ctype == b'JSON':
            gltf = json.loads(chunk)
        elif ctype == b'BIN\x00':
            bin_ = chunk
    return gltf, bytearray(bin_)


def pad4(b, fill=b'\x00'):
    while len(b) % 4:
        b += fill
    return b


def save_glb(path, gltf, bin_):
    gltf['buffers'][0]['byteLength'] = len(bin_)
    js = pad4(bytearray(json.dumps(gltf, separators=(',', ':')).encode('utf-8')), b' ')
    bn = pad4(bytearray(bin_))
    total = 12 + 8 + len(js) + 8 + len(bn)
    out = bytearray()
    out += struct.pack('<4sII', b'glTF', 2, total)
    out += struct.pack('<I4s', len(js), b'JSON') + js
    out += struct.pack('<I4s', len(bn), b'BIN\x00') + bn
    Path(path).write_bytes(out)


def read_accessor(gltf, bin_, idx):
    a = gltf['accessors'][idx]
    bv = gltf['bufferViews'][a['bufferView']]
    fmt, size = COMP[a['componentType']]
    n = NUM[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', size * n)
    return [struct.unpack_from('<' + fmt * n, bin_, off + i * stride) for i in range(a['count'])]


def append_accessor(gltf, bin_, values, gltf_type, with_minmax=False):
    n = NUM[gltf_type]
    start = len(bin_)
    for v in values:
        bin_ += struct.pack('<' + 'f' * n, *v)
    pad4(bin_)
    gltf.setdefault('bufferViews', []).append({'buffer': 0, 'byteOffset': start, 'byteLength': len(values) * n * 4})
    acc = {
        'bufferView': len(gltf['bufferViews']) - 1,
        'componentType': 5126,
        'count': len(values),
        'type': gltf_type,
    }
    if with_minmax:
        acc['min'] = [min(v[i] for v in values) for i in range(n)]
        acc['max'] = [max(v[i] for v in values) for i in range(n)]
    gltf.setdefault('accessors', []).append(acc)
    return len(gltf['accessors']) - 1


# ------------------------------------------------------------------- math ---

def quat_mul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    )


def quat_rotate(q, v):
    qx, qy, qz, qw = q
    # v' = q * (v, 0) * q^-1
    ix = qw * v[0] + qy * v[2] - qz * v[1]
    iy = qw * v[1] + qz * v[0] - qx * v[2]
    iz = qw * v[2] + qx * v[1] - qy * v[0]
    iw = -qx * v[0] - qy * v[1] - qz * v[2]
    return (
        ix * qw + iw * -qx + iy * -qz - iz * -qy,
        iy * qw + iw * -qy + iz * -qx - ix * -qz,
        iz * qw + iw * -qz + ix * -qy - iy * -qx,
    )


def quat_normalize(q):
    m = math.sqrt(sum(c * c for c in q)) or 1.0
    return tuple(c / m for c in q)


def slerp(a, b, t):
    dot = sum(x * y for x, y in zip(a, b))
    if dot < 0:
        b = tuple(-c for c in b)
        dot = -dot
    if dot > 0.9995:
        return quat_normalize(tuple(x + (y - x) * t for x, y in zip(a, b)))
    theta0 = math.acos(max(-1.0, min(1.0, dot)))
    theta = theta0 * t
    s0 = math.cos(theta) - dot * math.sin(theta) / math.sin(theta0)
    s1 = math.sin(theta) / math.sin(theta0)
    return tuple(s0 * x + s1 * y for x, y in zip(a, b))


def lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def compose_trs(parent, local):
    """Compose TRS transforms (t, r, s) with uniform-or-axis-aligned scale."""
    pt, pr, ps = parent
    lt, lr, ls = local
    scaled = (lt[0] * ps[0], lt[1] * ps[1], lt[2] * ps[2])
    t = tuple(p + c for p, c in zip(pt, quat_rotate(pr, scaled)))
    r = quat_normalize(quat_mul(pr, lr))
    s = tuple(a * b for a, b in zip(ps, ls))
    return t, r, s


# ---------------------------------------------------------- source rig read ---

class Track:
    def __init__(self, times, values, is_rot):
        self.times = [t[0] for t in times]
        self.values = values
        self.is_rot = is_rot

    def sample(self, t):
        ts = self.times
        if t <= ts[0]:
            return self.values[0]
        if t >= ts[-1]:
            return self.values[-1]
        lo, hi = 0, len(ts) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if ts[mid] <= t:
                lo = mid
            else:
                hi = mid
        span = ts[hi] - ts[lo]
        f = 0.0 if span <= 0 else (t - ts[lo]) / span
        return slerp(self.values[lo], self.values[hi], f) if self.is_rot else lerp(self.values[lo], self.values[hi], f)


def node_rest(node):
    return (
        tuple(node.get('translation', [0, 0, 0])),
        tuple(node.get('rotation', [0, 0, 0, 1])),
        tuple(node.get('scale', [1, 1, 1])),
    )


def chain_to(gltf, joint_name):
    names = [n.get('name') for n in gltf['nodes']]
    parent = {}
    for i, n in enumerate(gltf['nodes']):
        for ch in n.get('children', []):
            parent[ch] = i
    idx = names.index(joint_name)
    chain = []
    while idx is not None:
        chain.append(idx)
        idx = parent.get(idx)
    chain.reverse()
    return chain


def clip_tracks(gltf, bin_, anim, node_ids):
    tracks = {i: {} for i in node_ids}
    duration = 0.0
    for ch in anim['channels']:
        node = ch['target']['node']
        if node not in tracks:
            continue
        s = anim['samplers'][ch['sampler']]
        times = read_accessor(gltf, bin_, s['input'])
        values = read_accessor(gltf, bin_, s['output'])
        duration = max(duration, times[-1][0])
        tracks[node][ch['target']['path']] = Track(times, values, ch['target']['path'] == 'rotation')
    return tracks, duration


def sample_world(gltf, chain, tracks, t):
    world = ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0), (1.0, 1.0, 1.0))
    for node_id in chain:
        rt, rr, rs = node_rest(gltf['nodes'][node_id])
        tr = tracks.get(node_id, {})
        lt = tr['translation'].sample(t) if 'translation' in tr else rt
        lr = tr['rotation'].sample(t) if 'rotation' in tr else rr
        ls = tr['scale'].sample(t) if 'scale' in tr else rs
        world = compose_trs(world, (lt, lr, ls))
    return world


def bake_clip(src, src_bin, anim, chain):
    tracks, duration = clip_tracks(src, src_bin, anim, chain)
    steps = max(1, int(round(duration * SAMPLE_FPS)))
    times = []
    ts, rs, ss = [], [], []
    prev_r = None
    for i in range(steps + 1):
        t = min(duration, i / SAMPLE_FPS)
        wt, wr, ws = sample_world(src, chain, tracks, t)
        if prev_r is not None and sum(a * b for a, b in zip(prev_r, wr)) < 0:
            wr = tuple(-c for c in wr)  # keep quaternion hemisphere continuous
        prev_r = wr
        times.append((t,))
        ts.append(wt)
        rs.append(wr)
        ss.append(ws)
    return times, ts, rs, ss


# ------------------------------------------------------------------ main ---

def run(source, target, joint, verify_only, only=None):
    src, src_bin = load_glb(source)
    dst, dst_bin = load_glb(target)

    chain = chain_to(src, joint)
    dst_names = [n.get('name') for n in dst['nodes']]
    dst_node = dst_names.index(joint)
    existing = {a['name'] for a in dst.get('animations', [])}
    src_clips = {a['name']: a for a in src.get('animations', [])}

    if verify_only:
        # Compare our world-space sampling against a clip the weapon already has.
        worst = 0.0
        for anim in dst['animations'][:3]:
            name = anim['name']
            if name not in src_clips:
                continue
            times, ts, rs, ss = bake_clip(src, src_bin, src_clips[name], chain)
            tr = {}
            for ch in anim['channels']:
                s = anim['samplers'][ch['sampler']]
                tr[ch['target']['path']] = Track(read_accessor(dst, dst_bin, s['input']), read_accessor(dst, dst_bin, s['output']), ch['target']['path'] == 'rotation')
            dt = max(max(abs(a - b) for a, b in zip(tr['translation'].sample(t[0]), v)) for t, v in zip(times, ts))
            dr = max(1 - abs(sum(a * b for a, b in zip(tr['rotation'].sample(t[0]), v))) for t, v in zip(times, rs))
            worst = max(worst, dt, dr)
            print(f'verify {name}: translation maxdiff={dt:.5f} m, rotation 1-|dot|={dr:.6f}')
        print('OK' if worst < 1e-3 else 'MISMATCH')
        return

    added = 0
    for name, anim in src_clips.items():
        if name in existing or (only and name not in only):
            continue
        times, ts, rs, ss = bake_clip(src, src_bin, anim, chain)
        t_acc = append_accessor(dst, dst_bin, times, 'SCALAR', with_minmax=True)
        tr_acc = append_accessor(dst, dst_bin, ts, 'VEC3')
        ro_acc = append_accessor(dst, dst_bin, rs, 'VEC4')
        sc_acc = append_accessor(dst, dst_bin, ss, 'VEC3')
        samplers = [
            {'input': t_acc, 'output': tr_acc, 'interpolation': 'LINEAR'},
            {'input': t_acc, 'output': ro_acc, 'interpolation': 'LINEAR'},
            {'input': t_acc, 'output': sc_acc, 'interpolation': 'LINEAR'},
        ]
        channels = [
            {'sampler': 0, 'target': {'node': dst_node, 'path': 'translation'}},
            {'sampler': 1, 'target': {'node': dst_node, 'path': 'rotation'}},
            {'sampler': 2, 'target': {'node': dst_node, 'path': 'scale'}},
        ]
        dst.setdefault('animations', []).append({'name': name, 'samplers': samplers, 'channels': channels})
        added += 1
        print(f'  + {name}: {len(times)} keys, {times[-1][0]:.3f}s')

    if added:
        save_glb(target, dst, dst_bin)
    print(f'{Path(target).name}: added {added} clip(s), {len(dst["animations"])} total, {Path(target).stat().st_size} bytes')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', default=str(DEFAULT_SOURCE))
    ap.add_argument('--target', default=str(DEFAULT_TARGET))
    ap.add_argument('--joint', default='hand_r')
    ap.add_argument('--verify', action='store_true', help='only check sampling against clips the target already has')
    ap.add_argument('--only', default='', help='comma-separated clip names to copy (default: every clip the target lacks)')
    args = ap.parse_args()
    run(args.source, args.target, args.joint, args.verify, {c for c in args.only.split(',') if c})
