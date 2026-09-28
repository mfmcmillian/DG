"""
Bake the blade's path through every melee swing into src/bladePaths.json, for
the weapon trail (src/bladeTrail.ts).

Every weapon GLB (models/roaming/weapons/<id>.glb, scripts/build-weapons.py) is
one mesh skinned to a single hand joint whose translation/rotation for every
body clip is baked in, in the body's own space (glTF: Y up, the body facing
+Z, the right hand at -X). So the hand's motion through a swing is read
straight off the joint's animation channels of any one weapon, and the blade's
extent in the hand off each weapon's vertices taken into joint space with the
skin's inverse bind matrix. Nothing here needs Blender.

Output:
  clips:   motion -> { t: [...], p: [x,y,z,...], q: [x,y,z,w,...] }  hand joint per key (metres, 30 fps)
  weapons: id -> { hilt: [x,y,z], tip: [x,y,z], len }                   in joint space (the joint's own units)
  scale:   the joint's scale (the joint is authored in centimetres)

Usage: python scripts/bake-blade-paths.py
"""
import json
import os
import struct
import sys

import numpy as np

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
WEAPONS = os.path.join(ROOT, 'models', 'roaming', 'weapons')
OUT = os.path.join(ROOT, 'src', 'bladePaths.json')
REFERENCE = 'pride-sword'
# The swings that leave a trail (src/combatActions.ts isMeleeSwing and the skill flourish).
CLIPS = ['attack_light', 'attack_light2', 'attack_light3', 'attack_heavy', 'flourish_heavy',
         'heavy_combo_a', 'heavy_combo_b', 'heavy_combo_c', 'leap', 'fencing', 'flourish']

TYPES = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
DTYPES = {5126: 'f4', 5123: 'u2', 5121: 'u1', 5125: 'u4', 5122: 'i2', 5120: 'i1'}


def load(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'glTF', path
    ln = struct.unpack_from('<I', b, 12)[0]
    js = json.loads(b[20:20 + ln])
    off = 20 + ln
    bl = struct.unpack_from('<I', b, off)[0]
    return js, b[off + 8: off + 8 + bl]


def accessor(js, bin_, i):
    a = js['accessors'][i]
    bv = js['bufferViews'][a['bufferView']]
    n = TYPES[a['type']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    arr = np.frombuffer(bin_, dtype=DTYPES[a['componentType']], count=a['count'] * n, offset=start)
    return arr.reshape(a['count'], n).astype(np.float64)


def hand_joint(js):
    skin = js['skins'][0]
    return skin['joints'][0], skin


def bake_clips(js, bin_):
    joint, _ = hand_joint(js)
    out = {}
    for anim in js['animations']:
        name = anim['name']
        if name not in CLIPS:
            continue
        channels = {c['target']['path']: anim['samplers'][c['sampler']] for c in anim['channels'] if c['target']['node'] == joint}
        tp = accessor(js, bin_, channels['translation']['input'])[:, 0]
        p0 = accessor(js, bin_, channels['translation']['output'])
        tq = accessor(js, bin_, channels['rotation']['input'])[:, 0]
        q0 = accessor(js, bin_, channels['rotation']['output'])
        # Keep quaternions on one hemisphere so interpolation never takes the long way.
        for i in range(1, len(q0)):
            if np.dot(q0[i], q0[i - 1]) < 0:
                q0[i] = -q0[i]
        # The two channels may be keyed differently (the exporter drops still keys); resample both at 30 fps.
        end = max(tp[-1], tq[-1])
        t = np.arange(0, end + 1e-6, 1 / 30)
        p = np.column_stack([np.interp(t, tp, p0[:, k]) for k in range(3)])
        q = np.column_stack([np.interp(t, tq, q0[:, k]) for k in range(4)])
        q /= np.linalg.norm(q, axis=1, keepdims=True)
        out[name] = {
            't': [round(float(x), 4) for x in t],
            'p': [round(float(x), 4) for x in p.reshape(-1)],
            'q': [round(float(x), 5) for x in q.reshape(-1)],
        }
    missing = [c for c in CLIPS if c not in out]
    assert not missing, f'reference weapon lacks clips: {missing}'
    return out


def blade_extent(js, bin_):
    """Hilt and tip in joint space: the mesh's ends along its longest axis, the hilt the end nearer the hand."""
    joint, skin = hand_joint(js)
    ibm = accessor(js, bin_, skin['inverseBindMatrices'])[0].reshape(4, 4).T  # glTF is column-major
    verts = []
    for mesh in js['meshes']:
        for prim in mesh['primitives']:
            verts.append(accessor(js, bin_, prim['attributes']['POSITION']))
    v = np.vstack(verts)
    vj = (ibm @ np.hstack([v, np.ones((len(v), 1))]).T).T[:, :3]
    centre = vj.mean(axis=0)
    # Principal axis of the mesh: the blade (or haft).
    _, _, vt = np.linalg.svd(vj - centre, full_matrices=False)
    axis = vt[0]
    along = (vj - centre) @ axis
    lo, hi = vj[np.argmin(along)], vj[np.argmax(along)]
    # The end nearer the joint origin (the fist) is the hilt.
    if np.linalg.norm(lo) > np.linalg.norm(hi):
        lo, hi = hi, lo
    # The hilt sits at the fist itself: project the origin onto the axis so the ribbon starts in the hand.
    hilt = centre + axis * (np.dot(-centre, axis))
    return {
        'hilt': [round(float(x), 2) for x in hilt],
        'tip': [round(float(x), 2) for x in hi],
        'len': round(float(np.linalg.norm(hi - hilt)), 2),
    }


def main():
    ref_js, ref_bin = load(os.path.join(WEAPONS, f'{REFERENCE}.glb'))
    joint, _ = hand_joint(ref_js)
    scale = ref_js['nodes'][joint].get('scale', [1, 1, 1])
    clips = bake_clips(ref_js, ref_bin)
    weapons = {}
    skipped = []
    for name in sorted(os.listdir(WEAPONS)):
        if not name.endswith('.glb'):
            continue
        wid = name[:-4]
        js, bin_ = load(os.path.join(WEAPONS, name))
        if not js.get('skins'):
            skipped.append(wid)
            continue
        jname = js['nodes'][js['skins'][0]['joints'][0]].get('name')
        if jname != 'hand_r':
            # Bows ride the left hand and leave no trail.
            skipped.append(wid)
            continue
        weapons[wid] = blade_extent(js, bin_)
    data = {'scale': [round(float(s), 4) for s in scale], 'clips': clips, 'weapons': weapons}
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, separators=(',', ':'))
    lens = sorted((w['len'], k) for k, w in weapons.items())
    print(f'{len(clips)} clips, {len(weapons)} weapons ({len(skipped)} left-hand/unskinned skipped) -> {os.path.relpath(OUT, ROOT)} '
          f'({os.path.getsize(OUT) // 1024} KB)')
    print('shortest', lens[:3], 'longest', lens[-3:])
    for c, d in clips.items():
        print(f'  {c}: {len(d["t"])} keys, {d["t"][-1]:.2f}s')


if __name__ == '__main__':
    sys.exit(main())
