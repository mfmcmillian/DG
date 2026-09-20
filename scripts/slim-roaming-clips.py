"""
Slim the animation data in the roaming GLBs (bodies, hair, armor, weapons) so
the whole scene fits the LAND budget (15 MB per parcel: 36 parcels = 540 MiB).

  python scripts/slim-roaming-clips.py [--check] [paths...]

Blender's exporter and the splice scripts write a translation, rotation and
scale track for every joint in every clip. Most of those never move: a joint's
scale is (1,1,1) in all 34 clips, a finger's translation is its rest offset in
all of them. Each such track still costs its keyframe bytes plus ~250 bytes of
accessor/bufferView/channel JSON, and there are ~6,600 of them per part.

Lossless passes:
  1. Joints a part never skins: every part carries the whole rig, but a hair
     piece only deforms with the head chain and a boot with a leg. Channels for
     joints outside the weighted joints and their ancestors are dropped; those
     joints still exist (the skin's joint list is untouched) but nothing looks
     at their pose. Nothing at runtime reads a bone out of a part either:
     weapons are separate GLBs with their own baked hand joint.
  2. Clips a part can never be asked to play: bodies and hair under
     customization/male/ never play the female jump set and vice versa
     (getEquipmentJumpMotion picks by body type). Armor and combat pieces are
     worn by both, so they keep both sets.
  3. A (joint, path) track that is constant in every clip, at the same value in
     all of them, is removed from all clips and that value written as the
     joint's rest transform. Every clip then poses that joint identically to
     before (nothing ever changed it), and there is no clip in the file that
     could leave a different value behind for another clip to inherit.
  4. Within a clip, channels whose key times are byte-identical share one
     input accessor.
The binary buffer is then repacked with only the referenced bufferViews.

One lossy pass, within a tolerance nobody can see:
  5. Keyframe decimation. The clips are baked at 30 fps, so most keys lie on
     the straight line between their neighbours: a key that linear
     interpolation reproduces within the tolerance (rotation 0.0015 per
     quaternion component, about 0.17 degrees; translation 0.5 mm; scale 0.001)
     is dropped. Inputs are per sampler afterwards; identical ones are shared.

Run it after splice-boss-clips.py / bake-sword-clips.py re-inflate a file; it is
idempotent. --check reports the savings without writing.
"""
import hashlib
import importlib.util
import json
import struct
import sys
from pathlib import Path

import numpy as np

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


GENDER_CLIPS = {'male': 'jump_female', 'female': 'jump_male'}


def drop_other_gender_clips(gltf, path):
    """On a gendered body/hair part, remove the other body type's jump clips. Returns names dropped."""
    parts = Path(path).as_posix().split('/')
    if 'customization' not in parts:
        return []
    gender = next((g for g in ('male', 'female') if g in parts), None)
    if gender is None:
        return []
    prefix = GENDER_CLIPS[gender]
    dropped = [a['name'] for a in gltf['animations'] if a['name'].startswith(prefix)]
    gltf['animations'] = [a for a in gltf['animations'] if not a['name'].startswith(prefix)]
    return dropped


def posed_nodes(gltf, bin_):
    """
    Nodes whose transform can move a vertex: joints with a non-zero weight in
    any skinned primitive, plus all their ancestors, plus the mesh nodes and
    their ancestors. None if the file has no skin (leave it alone).
    """
    if not gltf.get('skins'):
        return None
    parent = {}
    for i, n in enumerate(gltf['nodes']):
        for c in n.get('children', []):
            parent[c] = i
    needed = set()
    for i, n in enumerate(gltf['nodes']):
        if 'mesh' not in n:
            continue
        needed.add(i)
        mesh = gltf['meshes'][n['mesh']]
        skin = gltf['skins'][n['skin']] if 'skin' in n else None
        for prim in mesh['primitives']:
            attrs = prim['attributes']
            if skin is None or 'JOINTS_0' not in attrs:
                continue
            joints = accessor_values(gltf, bin_, attrs['JOINTS_0'])
            weights = accessor_values(gltf, bin_, attrs['WEIGHTS_0'])
            used = set()
            for js, ws in zip(joints, weights):
                for j, w in zip(js, ws):
                    if w > 0:
                        used.add(j)
            for j in used:
                needed.add(skin['joints'][j])
    closed = set()
    for n in needed:
        while n is not None and n not in closed:
            closed.add(n)
            n = parent.get(n)
    return closed


def prune_unposed(gltf, bin_):
    """Drop channels that target nodes no skinned vertex follows. Returns the count."""
    keep = posed_nodes(gltf, bin_)
    if keep is None:
        return 0
    dropped = 0
    for an in gltf['animations']:
        kept = []
        for ch in an['channels']:
            if ch['target']['node'] in keep:
                kept.append(ch)
            else:
                dropped += 1
        an['channels'] = kept
    return dropped


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


DECIMATE_EPS = {'rotation': 0.0015, 'translation': 0.0005, 'scale': 0.001, 'weights': 0.002}
DECIMATE_PASSES = 4


def _append_f32(gltf, bin_, arr, gltf_type, minmax):
    data = np.ascontiguousarray(arr, dtype='<f4').tobytes()
    while len(bin_) % 4:
        bin_ += b'\x00'
    gltf['bufferViews'].append({'buffer': 0, 'byteOffset': len(bin_), 'byteLength': len(data)})
    bin_ += data
    acc = {'bufferView': len(gltf['bufferViews']) - 1, 'componentType': 5126, 'count': int(arr.shape[0]), 'type': gltf_type}
    if minmax:
        acc['min'] = [float(x) for x in arr.min(axis=0)]
        acc['max'] = [float(x) for x in arr.max(axis=0)]
    gltf['accessors'].append(acc)
    return len(gltf['accessors']) - 1


def _keep_mask(t, v, path):
    """Keys of one sampler that linear interpolation cannot reproduce within tolerance."""
    eps = DECIMATE_EPS[path]
    n = len(t)
    keep = np.ones(n, dtype=bool)
    for _ in range(DECIMATE_PASSES):
        idx = np.nonzero(keep)[0]
        if len(idx) < 3:
            break
        prev, cur, nxt = idx[:-2], idx[1:-1], idx[2:]
        a = ((t[cur] - t[prev]) / (t[nxt] - t[prev]))[:, None]
        q0, q1, qc = v[prev], v[nxt], v[cur]
        if path == 'rotation':
            flip = np.sign(np.sum(q0 * q1, axis=1, keepdims=True))
            flip[flip == 0] = 1
            interp = q0 * (1 - a) + q1 * flip * a
            interp /= np.linalg.norm(interp, axis=1, keepdims=True)
            sgn = np.sign(np.sum(interp * qc, axis=1, keepdims=True))
            sgn[sgn == 0] = 1
            err = np.max(np.abs(interp - qc * sgn), axis=1)
        else:
            interp = q0 * (1 - a) + q1 * a
            err = np.max(np.abs(interp - qc), axis=1)
        cand = err <= eps
        drop = np.zeros(len(cur), dtype=bool)
        last = False
        for i in range(len(cur)):
            if cand[i] and not last:
                drop[i] = True
                last = True
            else:
                last = False
        if not drop.any():
            break
        keep[cur[drop]] = False
    return keep


def decimate(gltf, bin_):
    """
    Drop keys that linear interpolation between their neighbours reproduces
    within DECIMATE_EPS, per sampler: a finger's track keeps a handful of keys
    while the arm keeps most of its own. Each decimated sampler gets its own
    timeline (identical ones are shared). Returns (keys before, keys after).
    """
    anims = gltf.get('animations', [])
    before = after = 0
    for an in anims:
        path_of = {ch['sampler']: ch['target']['path'] for ch in an['channels']}
        cache = {}
        for si, smp in enumerate(an['samplers']):
            if smp.get('interpolation', 'LINEAR') != 'LINEAR' or si not in path_of:
                continue
            t = np.array(accessor_values(gltf, bin_, smp['input']), dtype=np.float64)[:, 0]
            v = np.array(accessor_values(gltf, bin_, smp['output']), dtype=np.float64)
            n = len(t)
            before += n
            keep = _keep_mask(t, v, path_of[si])
            kept = int(keep.sum())
            after += kept
            if kept == n:
                continue
            key = hashlib.md5(t[keep].astype('<f4').tobytes()).hexdigest()
            if key not in cache:
                cache[key] = _append_f32(gltf, bin_, t[keep][:, None], 'SCALAR', True)
            smp['input'] = cache[key]
            smp['output'] = _append_f32(gltf, bin_, v[keep], gltf['accessors'][smp['output']]['type'], False)
    return before, after


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
    clips = drop_other_gender_clips(gltf, path)
    unposed = prune_unposed(gltf, bin_)
    dropped = slim(gltf, bin_) + unposed
    keys_before, keys_after = decimate(gltf, bin_)
    notes = []
    if keys_after < keys_before:
        notes.append(f'keys {keys_before} -> {keys_after}')
    if repaired:
        notes.append(f'repaired {repaired} sampler(s) with duplicate key times')
    if clips:
        notes.append(f'dropped clips {", ".join(clips)}')
    if unposed:
        notes.append(f'{unposed} channels on unposed joints')
    for n in notes:
        print(f'  {n}')
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
