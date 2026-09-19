"""
Slim the animation data in the roaming GLBs (bodies, hair, armor, weapons) so
the whole scene fits the LAND budget (15 MB per parcel: 36 parcels = 540 MiB).

  python scripts/slim-roaming-clips.py [--check] [paths...]

Blender's exporter and the splice scripts write a translation, rotation and
scale track for every joint in every clip. Most of those never move: a joint's
scale is (1,1,1) in all 34 clips, a finger's translation is its rest offset in
all of them. Each such track still costs its keyframe bytes plus ~250 bytes of
accessor/bufferView/channel JSON, and there are ~6,600 of them per part.

Two lossless passes:
  1. A (joint, path) track that is constant in every clip, at the same value in
     all of them, is removed from all clips and that value written as the
     joint's rest transform. Every clip then poses that joint identically to
     before (nothing ever changed it), and there is no clip in the file that
     could leave a different value behind for another clip to inherit.
  2. Within a clip, channels whose key times are byte-identical share one
     input accessor.
The binary buffer is then repacked with only the referenced bufferViews.

Run it after splice-boss-clips.py / bake-sword-clips.py re-inflate a file; it is
idempotent. --check reports the savings without writing.
"""
import hashlib
import importlib.util
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location('swordbake', ROOT / 'scripts/bake-sword-clips.py')
sb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sb)

COMP = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NUM = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}
EPS = 1e-4
REST_DEFAULT = {'translation': (0.0, 0.0, 0.0), 'rotation': (0.0, 0.0, 0.0, 1.0), 'scale': (1.0, 1.0, 1.0)}


def accessor_values(gltf, bin_, idx):
    a = gltf['accessors'][idx]
    bv = gltf['bufferViews'][a['bufferView']]
    fmt, size = COMP[a['componentType']]
    n = NUM[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', n * size)
    out = []
    for k in range(a['count']):
        out.append(struct.unpack_from('<' + fmt * n, bin_, off + k * stride))
    return out


def accessor_bytes(gltf, bin_, idx):
    a = gltf['accessors'][idx]
    bv = gltf['bufferViews'][a['bufferView']]
    fmt, size = COMP[a['componentType']]
    n = NUM[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return bytes(bin_[off:off + a['count'] * n * size])


def same(a, b, path):
    if path == 'rotation':
        # q and -q are the same rotation.
        dot = sum(x * y for x, y in zip(a, b))
        return abs(abs(dot) - 1) < 1e-6 or all(abs(x - y) < EPS for x, y in zip(a, b)) or all(abs(x + y) < EPS for x, y in zip(a, b))
    return all(abs(x - y) < EPS for x, y in zip(a, b))


def constant_value(values, path):
    first = values[0]
    for v in values[1:]:
        if not same(first, v, path):
            return None
    return first


def node_rest(node, path):
    return tuple(node.get(path, REST_DEFAULT[path]))


def repair_inputs(gltf, bin_):
    """
    Key times must strictly increase. A composite spliced from trimmed parts
    can land two keys on the same instant at a seam (float rounding onto the
    window edge); the later duplicate is dropped along with its value. Returns
    the number of samplers repaired; appends the fixed accessors to `bin_`.
    """
    repaired = 0
    fixed = {}
    for an in gltf.get('animations', []):
        for s in an['samplers']:
            key = (s['input'], s['output'])
            if key in fixed:
                s['input'], s['output'] = fixed[key]
                continue
            times = accessor_values(gltf, bin_, s['input'])
            keep = [0] + [i for i in range(1, len(times)) if times[i][0] > times[i - 1][0] + 1e-4]
            if len(keep) == len(times):
                continue
            values = accessor_values(gltf, bin_, s['output'])
            out_type = gltf['accessors'][s['output']]['type']
            new_in = sb.append_accessor(gltf, bin_, [times[i] for i in keep], 'SCALAR', with_minmax=True)
            new_out = sb.append_accessor(gltf, bin_, [values[i] for i in keep], out_type)
            fixed[key] = (new_in, new_out)
            s['input'], s['output'] = new_in, new_out
            repaired += 1
    return repaired


def slim(gltf, bin_):
    anims = gltf.get('animations', [])
    if not anims:
        return None
    nodes = gltf['nodes']
    # (node, path) -> {clip index: constant value or None (animated)}
    tracks = {}
    for ai, an in enumerate(anims):
        for ch in an['channels']:
            key = (ch['target']['node'], ch['target']['path'])
            s = an['samplers'][ch['sampler']]
            if s.get('interpolation') == 'CUBICSPLINE':
                tracks.setdefault(key, {})[ai] = None
                continue
            tracks.setdefault(key, {})[ai] = constant_value(accessor_values(gltf, bin_, s['output']), key[1])
    droppable = {}
    for (node, path), per_clip in tracks.items():
        if any(v is None for v in per_clip.values()):
            continue
        value = next(iter(per_clip.values()))
        if not all(same(value, v, path) for v in per_clip.values()):
            continue
        # A clip that does not touch this joint leaves the rest pose; that must be the same value too.
        if len(per_clip) < len(anims) and not same(value, node_rest(nodes[node], path), path):
            continue
        if 'matrix' in nodes[node]:
            continue
        droppable[(node, path)] = value

    dropped = 0
    for (node, path), value in droppable.items():
        v = list(value)
        if path == 'rotation':
            n = sum(x * x for x in v) ** 0.5
            v = [x / n for x in v]
        nodes[node][path] = [float(x) for x in v]
    for an in anims:
        kept = []
        shared = {}
        new_samplers = []
        for ch in an['channels']:
            key = (ch['target']['node'], ch['target']['path'])
            if key in droppable:
                dropped += 1
                continue
            s = dict(an['samplers'][ch['sampler']])
            h = hashlib.md5(accessor_bytes(gltf, bin_, s['input'])).hexdigest()
            s['input'] = shared.setdefault(h, s['input'])
            new_samplers.append(s)
            kept.append({'sampler': len(new_samplers) - 1, 'target': ch['target']})
        an['channels'] = kept
        an['samplers'] = new_samplers
    return dropped


def repack(gltf, bin_):
    """Keep only the accessors and bufferViews something still points at; renumber everything."""
    used_acc = set()
    for mesh in gltf.get('meshes', []):
        for p in mesh['primitives']:
            used_acc.update(p['attributes'].values())
            if 'indices' in p:
                used_acc.add(p['indices'])
            for t in p.get('targets', []):
                used_acc.update(t.values())
    for skin in gltf.get('skins', []):
        if 'inverseBindMatrices' in skin:
            used_acc.add(skin['inverseBindMatrices'])
    for an in gltf.get('animations', []):
        for s in an['samplers']:
            used_acc.add(s['input'])
            used_acc.add(s['output'])
    acc_map = {old: new for new, old in enumerate(sorted(used_acc))}
    accessors = [gltf['accessors'][old] for old in sorted(used_acc)]

    used_bv = {a['bufferView'] for a in accessors if 'bufferView' in a}
    used_bv.update(img['bufferView'] for img in gltf.get('images', []) if 'bufferView' in img)
    out = bytearray()
    bv_map = {}
    views = []
    for old in sorted(used_bv):
        bv = dict(gltf['bufferViews'][old])
        start = bv.get('byteOffset', 0)
        data = bin_[start:start + bv['byteLength']]
        while len(out) % 4:
            out += b'\x00'
        bv['byteOffset'] = len(out)
        bv['buffer'] = 0
        out += data
        bv_map[old] = len(views)
        views.append(bv)
    for a in accessors:
        if 'bufferView' in a:
            a['bufferView'] = bv_map[a['bufferView']]
    for img in gltf.get('images', []):
        if 'bufferView' in img:
            img['bufferView'] = bv_map[img['bufferView']]
    for mesh in gltf.get('meshes', []):
        for p in mesh['primitives']:
            p['attributes'] = {k: acc_map[v] for k, v in p['attributes'].items()}
            if 'indices' in p:
                p['indices'] = acc_map[p['indices']]
            if 'targets' in p:
                p['targets'] = [{k: acc_map[v] for k, v in t.items()} for t in p['targets']]
    for skin in gltf.get('skins', []):
        if 'inverseBindMatrices' in skin:
            skin['inverseBindMatrices'] = acc_map[skin['inverseBindMatrices']]
    for an in gltf.get('animations', []):
        for s in an['samplers']:
            s['input'] = acc_map[s['input']]
            s['output'] = acc_map[s['output']]
    gltf['accessors'] = accessors
    gltf['bufferViews'] = views
    gltf['buffers'] = [{'byteLength': len(out)}]
    return bytes(out)


def process(path, check):
    gltf, bin_ = sb.load_glb(path)
    before = path.stat().st_size
    if not gltf.get('animations'):
        return None
    bin_ = bytearray(bin_)
    repaired = repair_inputs(gltf, bin_)
    dropped = slim(gltf, bin_)
    if repaired:
        print(f'  repaired {repaired} sampler(s) with duplicate key times')
    bin_ = repack(gltf, bin_)
    js = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    after = 12 + 8 + len(js) + (-len(js) % 4) + 8 + len(bin_) + (-len(bin_) % 4)
    if not check:
        sb.save_glb(path, gltf, bin_)
        after = path.stat().st_size
    return before, after, dropped


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    check = '--check' in sys.argv
    paths = [Path(a) for a in args] if args else sorted((ROOT / 'models/roaming').rglob('*.glb'))
    total_before = total_after = 0
    for p in paths:
        r = process(p, check)
        if r is None:
            continue
        before, after, dropped = r
        total_before += before
        total_after += after
        label = p.relative_to(ROOT).as_posix() if p.resolve().is_relative_to(ROOT) else str(p)
        print(f'{label}: {before/1e6:.2f} -> {after/1e6:.2f} MB, {dropped} tracks dropped')
    print(f'{"would save" if check else "saved"} {(total_before - total_after)/1e6:.1f} MB ({total_before/1e6:.1f} -> {total_after/1e6:.1f})')


if __name__ == '__main__':
    main()
