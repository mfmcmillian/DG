"""
Bake every loot weapon into a static model that sits in the native Decentraland
avatar's hand (runs inside Blender):

  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" -b --python scripts/export-native-weapons.py -- [--only id1,id2]

Source: models/roaming/weapons/<id>.glb, each skinned to the Sidekick rig's
single hand joint (hand_r, or hand_l for bows) with the hero's clips baked in.
Target: a mesh with no rig at all, whose origin and axes are the avatar's hand
bone as the renderer hands it out for AvatarAttach (AAPT_RIGHT_HAND /
AAPT_LEFT_HAND): models/native/weapons/<id>.glb, listed in
src/nativeWeapons.json with the hand it goes in.

How: the weapon's vertices are stored in metres at their bind-pose world
position (the T-pose), and the hand joint's own node transform is that bind
pose. Both rigs rest in a T-pose, so the only thing that differs between the two
hands is their rest orientation: the avatar's hand rest R_dcl comes from
Decentraland's BaseMale body (%TEMP%/dcl-rig/BaseMale.glb, fetched by
scripts/retarget-emotes.py), read straight from its glTF nodes so the frame is
the one the renderer sees, not Blender's bone convention.

  v_dcl = R_dcl^-1 . (v_raw - t_sk)

Blender is only the material/texture-preserving importer and exporter here; the
positions are rewritten from the glTF data.
"""
import bpy
import json
import os
import struct
import sys
import numpy as np
from mathutils import Matrix, Quaternion, Vector

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
SRC_DIR = os.path.join(ROOT, 'models', 'roaming', 'weapons')
OUT_DIR = os.path.join(ROOT, 'models', 'native', 'weapons')
MANIFEST = os.path.join(ROOT, 'src', 'nativeWeapons.json')
TARGET = os.path.join(os.environ.get('TEMP', '/tmp'), 'dcl-rig', 'BaseMale.glb')
TARGET_URL = 'https://peer-ec1.decentraland.org/content/contents/bafkreicdlz2ab65lchjrciobzfsjsdjucydb2rudflujk5wxggp3h6443u'
HANDS = {'hand_l': ('l', 'Avatar_LeftHand'), 'hand_r': ('r', 'Avatar_RightHand')}

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ONLY = set(args[args.index('--only') + 1].split(',')) if '--only' in args else None


def log(msg):
    print(f'[weapons] {msg}', flush=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def read_glb(path):
    """The JSON chunk and the binary chunk of a .glb."""
    data = open(path, 'rb').read()
    json_len = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + json_len])
    bin_start = 20 + json_len + 8
    return doc, data[bin_start:]


def accessor(doc, blob, index):
    a = doc['accessors'][index]
    view = doc['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    dt = {5126: np.float32, 5123: np.uint16, 5121: np.uint8, 5125: np.uint32}[a['componentType']]
    off = view.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.frombuffer(blob, dt, a['count'] * n, off).reshape(a['count'], n)


def node_matrix(node):
    if 'matrix' in node:
        m = np.array(node['matrix'], dtype=np.float64).reshape(4, 4).T
        return Matrix([list(r) for r in m])
    t = Vector(node.get('translation', [0, 0, 0]))
    q = node.get('rotation', [0, 0, 0, 1])
    sc = Vector(node.get('scale', [1, 1, 1]))
    return Matrix.Translation(t) @ Quaternion((q[3], q[0], q[1], q[2])).to_matrix().to_4x4() @ Matrix.Diagonal(sc).to_4x4()


def world_matrices(doc):
    """glTF-space world matrix of every node, by index."""
    parent = {}
    for i, node in enumerate(doc['nodes']):
        for c in node.get('children', []):
            parent[c] = i
    cache = {}

    def world(i):
        if i in cache:
            return cache[i]
        m = node_matrix(doc['nodes'][i])
        if i in parent:
            m = world(parent[i]) @ m
        cache[i] = m
        return m
    return {i: world(i) for i in range(len(doc['nodes']))}


def dcl_hand_frames():
    """World rotation of the avatar rig's two hand nodes at rest (glTF Y-up space), by our hand letter."""
    if not os.path.exists(TARGET):
        import urllib.request
        os.makedirs(os.path.dirname(TARGET), exist_ok=True)
        log(f'fetching {TARGET_URL}')
        urllib.request.urlretrieve(TARGET_URL, TARGET)
    doc, _ = read_glb(TARGET)
    worlds = world_matrices(doc)
    frames = {}
    for _, (letter, bone) in HANDS.items():
        index = next(i for i, n in enumerate(doc['nodes']) if n.get('name') == bone)
        frames[letter] = worlds[index].to_quaternion().to_matrix()
        log(f'{bone}: rest at {tuple(round(v, 3) for v in worlds[index].translation)}')
    return frames


def hand_local_positions(path, dcl_frames):
    """Every primitive's positions rewritten into the avatar hand frame (glTF Y-up), plus the hand letter."""
    doc, blob = read_glb(path)
    skin = doc['skins'][0]
    joint = doc['nodes'][skin['joints'][0]]
    letter = HANDS[joint['name']][0]
    ibm = accessor(doc, blob, skin['inverseBindMatrices'])[0].astype(np.float64).reshape(4, 4).T
    bind = np.linalg.inv(ibm)
    t_sk = bind[:3, 3]
    r_dcl_inv = np.array(dcl_frames[letter].inverted(), dtype=np.float64)
    out = []
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            pos = accessor(doc, blob, prim['attributes']['POSITION']).astype(np.float64)
            out.append((pos - t_sk) @ r_dcl_inv.T)
    return letter, out


def bake(weapon_id, dcl_frames):
    path = os.path.join(SRC_DIR, f'{weapon_id}.glb')
    letter, positions = hand_local_positions(path, dcl_frames)
    clear_scene()
    objs = import_glb(path)
    arm = next((o for o in objs if o.type == 'ARMATURE'), None)
    # The skinned mesh only: the importer also drops in an icosphere as the bone's display shape.
    meshes = [o for o in objs if o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers)]
    if arm is None or not meshes:
        log(f'{weapon_id}: no armature or mesh, skipped')
        return None
    for o in objs:
        if o.type == 'MESH' and o not in meshes:
            bpy.data.objects.remove(o, do_unlink=True)
    # Blender's importer merges a mesh's primitives into one object, in file order.
    if len(meshes) != 1:
        log(f'{weapon_id}: {len(meshes)} mesh objects, skipped')
        return None
    o = meshes[0]
    for mod in list(o.modifiers):
        o.modifiers.remove(mod)
    o.parent = None
    o.matrix_world = Matrix.Identity(4)
    while o.vertex_groups:
        o.vertex_groups.remove(o.vertex_groups[0])
    bpy.data.objects.remove(arm, do_unlink=True)

    # Rewrite the vertices: glTF Y-up -> Blender Z-up is (x, -z, y); the exporter undoes it.
    local = np.concatenate(positions, axis=0)
    if len(local) != len(o.data.vertices):
        log(f'{weapon_id}: {len(local)} file vertices vs {len(o.data.vertices)} imported, skipped')
        return None
    flat = np.empty(len(local) * 3, dtype=np.float32)
    flat[0::3] = local[:, 0]
    flat[1::3] = -local[:, 2]
    flat[2::3] = local[:, 1]
    o.data.vertices.foreach_set('co', flat)
    o.data.update()
    o.name = weapon_id

    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, f'{weapon_id}.glb')
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB', use_selection=True, export_animations=False, export_skins=False,
        export_yup=True, export_apply=True, export_materials='EXPORT', export_image_format='AUTO'
    )
    log(f'wrote {os.path.relpath(out, ROOT)} ({letter}) {os.path.getsize(out) // 1024} KB')
    return letter


def main():
    ids = sorted(f[:-4] for f in os.listdir(SRC_DIR) if f.endswith('.glb'))
    if ONLY:
        ids = [i for i in ids if i in ONLY]
    dcl_frames = dcl_hand_frames()
    manifest = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding='utf-8') as f:
            manifest = json.load(f)
    for weapon_id in ids:
        letter = bake(weapon_id, dcl_frames)
        if letter:
            manifest[weapon_id] = {'src': f'models/native/weapons/{weapon_id}.glb', 'hand': letter}
    with open(MANIFEST, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(dict(sorted(manifest.items())), f, indent=2)
        f.write('\n')
    log(f'{len(manifest)} weapons in {os.path.relpath(MANIFEST, ROOT)}')


main()
