"""Reads a Synty demo scene out of a .unitypackage and writes its placements as
JSON: every prefab instance resolved to its mesh name, with world position,
rotation (quaternion) and scale in Unity's frame, which is Decentraland's frame
too (Y up, left-handed, metres). The scene YAML is parsed with regexes; it
only needs Transforms, PrefabInstances and the GUID table of the package.

  python scripts/unity-scene-dump.py <pack.unitypackage> <Scenes/Demo_Crypt_01.unity> <out.json>

The output lists {mesh, prefab, pos, rot, scale, name, group}; `group` is the
chain of empties above the piece (Synty groups their demos by area), which
is what makes the clusters liftable one at a time.
"""
import json, math, os, re, sys, tarfile

pack_path, scene_suffix, out_path = sys.argv[1], sys.argv[2], sys.argv[3]

# --- the package: GUID -> asset path, and the scene text -------------------------------
tar = tarfile.open(pack_path, 'r:gz')
members = {}
for m in tar:
    base, leaf = os.path.split(m.name)
    members.setdefault(base, {})[leaf] = m
guid_path = {}
scene_text = None
for base, parts in members.items():
    if 'pathname' not in parts:
        continue
    path = tar.extractfile(parts['pathname']).read().decode('utf-8', 'ignore').split('\n')[0]
    guid_path[os.path.basename(base)] = path
    if path.endswith(scene_suffix) and 'asset' in parts:
        scene_text = tar.extractfile(parts['asset']).read().decode('utf-8', 'ignore')
if scene_text is None:
    sys.exit(f'no scene ending in {scene_suffix} in {pack_path}')

# --- the documents ------------------------------------------------------------------------
DOC = re.compile(r'^--- !u!(\d+) &(-?\d+)( stripped)?\s*$', re.M)
docs = []
heads = list(DOC.finditer(scene_text))
for i, h in enumerate(heads):
    end = heads[i + 1].start() if i + 1 < len(heads) else len(scene_text)
    docs.append((int(h.group(1)), int(h.group(2)), bool(h.group(3)), scene_text[h.end():end]))


def vec(body, key):
    m = re.search(r'^\s*' + key + r': \{x: ([-\d.e]+), y: ([-\d.e]+), z: ([-\d.e]+)(?:, w: ([-\d.e]+))?\}', body, re.M)
    if not m:
        return None
    return [float(v) for v in m.groups() if v is not None]


def ref(body, key):
    m = re.search(r'^\s*' + key + r': \{fileID: (-?\d+)', body, re.M)
    return int(m.group(1)) if m else 0


transforms = {}     # transform id -> {pos, rot, scale, parent, go}
go_names = {}       # game object id -> name
stripped = {}       # stripped transform id -> prefab instance id
instances = {}      # prefab instance id -> {guid, parent, pos, rot, scale, name}

for kind, fid, is_stripped, body in docs:
    if kind == 4:
        if is_stripped:
            stripped[fid] = ref(body, 'm_PrefabInstance')
        else:
            transforms[fid] = {
                'pos': vec(body, 'm_LocalPosition') or [0, 0, 0],
                'rot': vec(body, 'm_LocalRotation') or [0, 0, 0, 1],
                'scale': vec(body, 'm_LocalScale') or [1, 1, 1],
                'parent': ref(body, 'm_Father'),
                'go': ref(body, 'm_GameObject')
            }
    elif kind == 1:
        m = re.search(r'^\s*m_Name: (.*)$', body, re.M)
        go_names[fid] = m.group(1).strip() if m else ''
    elif kind == 1001:
        guid = re.search(r'guid: ([0-9a-f]{32})', body)
        inst = {'guid': guid.group(1) if guid else '', 'parent': ref(body, 'm_TransformParent'),
                'pos': [0, 0, 0], 'rot': [0, 0, 0, 1], 'scale': [1, 1, 1], 'name': ''}
        vals = {}
        for mm in re.finditer(r'propertyPath: ([\w.]+)\s+value: ([^\n]*)', body):
            vals[mm.group(1)] = mm.group(2).strip()
        for axis_set, key in (('pos', 'm_LocalPosition'), ('rot', 'm_LocalRotation'), ('scale', 'm_LocalScale')):
            comps = ['x', 'y', 'z'] + (['w'] if axis_set == 'rot' else [])
            if any(f'{key}.{c}' in vals for c in comps):
                inst[axis_set] = [float(vals.get(f'{key}.{c}', '0' if c != 'w' and axis_set != 'scale' else '1')) for c in comps]
        inst['name'] = vals.get('m_Name', '')
        instances[fid] = inst


# --- world transforms --------------------------------------------------------------------
def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return [aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz]


def qrot(q, v):
    x, y, z, w = q
    vx, vy, vz = v
    # v' = v + 2w(q x v) + 2(q x (q x v))
    cx, cy, cz = y * vz - z * vy, z * vx - x * vz, x * vy - y * vx
    dx, dy, dz = y * cz - z * cy, z * cx - x * cz, x * cy - y * cx
    return [vx + 2 * (w * cx + dx), vy + 2 * (w * cy + dy), vz + 2 * (w * cz + dz)]


def local_of(tid):
    """Local transform and parent of a transform id, be it a scene empty or a prefab's stripped root."""
    if tid in transforms:
        t = transforms[tid]
        return t['pos'], t['rot'], t['scale'], t['parent'], go_names.get(t['go'], '')
    if tid in stripped:
        inst = instances.get(stripped[tid])
        if inst:
            return inst['pos'], inst['rot'], inst['scale'], inst['parent'], inst['name']
    return None


def world_of(pos, rot, scale, parent):
    chain = []
    seen = set()
    while parent and parent not in seen:
        seen.add(parent)
        loc = local_of(parent)
        if loc is None:
            break
        chain.append(loc)
        parent = loc[3]
    names = [loc[4] for loc in chain if loc[4]]
    wp, wr, ws = list(pos), list(rot), list(scale)
    for ppos, prot, pscale, _, _ in chain:
        wp = [wp[i] * pscale[i] for i in range(3)]
        wp = qrot(prot, wp)
        wp = [wp[i] + ppos[i] for i in range(3)]
        wr = qmul(prot, wr)
        ws = [ws[i] * pscale[i] for i in range(3)]
    return wp, wr, ws, list(reversed(names))


def yaw_of(q):
    x, y, z, w = q
    return math.degrees(math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + x * x)))


out = []
missing = set()
for fid, inst in instances.items():
    path = guid_path.get(inst['guid'])
    if not path or not path.endswith('.prefab'):
        missing.add(inst['guid'])
        continue
    mesh = os.path.splitext(os.path.basename(path))[0]
    wp, wr, ws, group = world_of(inst['pos'], inst['rot'], inst['scale'], inst['parent'])
    out.append({'mesh': mesh, 'prefab': path, 'name': inst['name'] or mesh, 'group': '/'.join(group),
                'pos': [round(v, 3) for v in wp], 'rot': [round(v, 5) for v in wr], 'yaw': round(yaw_of(wr), 1),
                'scale': [round(v, 3) for v in ws]})

xs = [p['pos'][0] for p in out]; zs = [p['pos'][2] for p in out]; ys = [p['pos'][1] for p in out]
json.dump({'scene': scene_suffix, 'count': len(out),
           'bounds': {'x': [min(xs), max(xs)], 'y': [min(ys), max(ys)], 'z': [min(zs), max(zs)]} if out else None,
           'placements': out}, open(out_path, 'w'), indent=1)
from collections import Counter
meshes = Counter(p['mesh'] for p in out)
groups = Counter(p['group'] for p in out)
print(f'{len(out)} placements, {len(meshes)} meshes, {len(missing)} unresolved prefabs; x {min(xs):.1f}..{max(xs):.1f} y {min(ys):.1f}..{max(ys):.1f} z {min(zs):.1f}..{max(zs):.1f}')
print('top meshes:', meshes.most_common(20))
print('groups:', groups.most_common(30))
