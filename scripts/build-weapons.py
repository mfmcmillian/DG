"""
Build every weapon in scripts/weapons-manifest.json from the Synty source packs.

Run inside Blender (any 4.x/5.x):

  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" -b --python scripts/build-weapons.py -- [options]

  --only id1,id2     build just these manifest ids
  --skip-existing    leave weapons whose GLB and icon already exist alone
  --no-icons         models only
  --no-models        icons only

For each weapon:
  1. the FBX and its palette (and emission) texture are pulled out of the pack
     zip in the Downloads folder;
  2. an icon is rendered (flat, unlit, transparent, 256x256) to images/weapons/<id>.png;
  3. the mesh is moved into the hero's right hand with the transform solved from
     the original Pride sword (HAND_FROM_FBX below), exported as a plain GLB,
     then rewritten into the Sidekick weapon format: one mesh skinned to a
     single `hand_r` joint, and every clip of the male core body baked onto
     that joint (scripts/bake-sword-clips.py does the sampling);
  4. the result lands in models/roaming/weapons/<id>.glb and
     src/weaponCatalog.json is regenerated for the whole manifest.

The hand_r node also carries its bind pose as rest TRS, so the same GLB shown
without an Animator (a drop on the dungeon floor) renders at the stored
T-pose position; loot.ts undoes that with DROP_OFFSET from weaponCatalog.json.
"""
import bpy
import importlib.util
import json
import math
import os
import shutil
import struct
import sys
import zipfile
from mathutils import Matrix, Quaternion, Vector

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
MANIFEST = os.path.join(ROOT, 'scripts', 'weapons-manifest.json')
DOWNLOADS = os.path.join(os.path.expanduser('~'), 'Downloads')
WORK = os.path.join(os.environ.get('TEMP', '/tmp'), 'dg-weapons')
MODELS_DIR = os.path.join(ROOT, 'models', 'roaming', 'weapons')
ICONS_DIR = os.path.join(ROOT, 'images', 'weapons')
CATALOG = os.path.join(ROOT, 'src', 'weaponCatalog.json')
CORE_GLB = os.path.join(ROOT, 'models', 'roaming', 'customization', 'male', 'warm', 'core.glb')
TEXTURE_SIZE = 512
ICON_SIZE = 256
# 'FLAT' (unlit palette), 'STUDIO' (studio light), 'STUDIOCAV' (studio light + edge cavity so dark iron reads on a dark card).
ICON_LIGHT = 'STUDIOCAV'

# Blender-import FBX frame (Z up, metres, origin at the grip) -> weapon GLB frame
# (glTF Y up, the hero's T-pose right hand). Solved by matching all 299 vertices
# of SM_Wep_Sword_01 (Pride Weapons) against models/roaming/weapons/pride-sword
# (max residual 1.2e-5 m). Row-major.
HAND_FROM_FBX = Matrix((
    (-0.74256, 0.02177, -0.66943, -0.81071),
    (0.09439, -0.98610, -0.13676, 1.32897),
    (-0.66310, -0.16474, 0.73018, -0.05549),
    (0.0, 0.0, 0.0, 1.0)))

# hand_r inverse bind matrix from the same file (the joint is authored in centimetres).
INVERSE_BIND = Matrix((
    (50.29, -56.5723, -65.3492, 105.282),
    (-81.2492, -5.1479, -58.0695, -58.7914),
    (29.487, 82.2989, -48.5532, -89.1958),
    (0.0, 0.0, 0.0, 1.0)))

# Blender Z-up -> glTF Y-up, for the floor-drop offset.
YUP = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


bake = load_module('bake_sword_clips', os.path.join(ROOT, 'scripts', 'bake-sword-clips.py'))


# ------------------------------------------------------------------ sources ---

def extract(zip_name, member):
    """Pull one file out of a pack zip (cached under WORK)."""
    out = os.path.join(WORK, zip_name.replace('.zip', ''), member.replace('/', os.sep))
    if os.path.exists(out):
        return out
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with zipfile.ZipFile(os.path.join(DOWNLOADS, zip_name)) as z:
        names = z.namelist()
        hit = member if member in names else next((n for n in names if n.lower() == member.lower()), None)
        if hit is None:
            raise FileNotFoundError(f'{member} not in {zip_name}')
        with z.open(hit) as src, open(out, 'wb') as dst:
            shutil.copyfileobj(src, dst)
    return out


# ------------------------------------------------------------------ blender ---

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_weapon(fbx):
    bpy.ops.import_scene.fbx(filepath=fbx)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if not meshes:
        raise RuntimeError(f'no mesh in {fbx}')
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    # Bake the importer's axis conversion and any transform into the vertices.
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return obj


def make_material(base_png, emission_png):
    mat = bpy.data.materials.new('Weapon')
    mat.use_nodes = True
    mat.use_backface_culling = False
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Metallic'].default_value = 0.3
    bsdf.inputs['Roughness'].default_value = 0.5

    def load(path):
        img = bpy.data.images.load(path)
        if max(img.size) > TEXTURE_SIZE:
            img.scale(TEXTURE_SIZE, TEXTURE_SIZE)
        # Synty palettes keep an emission mask in the alpha channel; it is not transparency.
        img.alpha_mode = 'NONE'
        img.pack()
        return img

    base = nt.nodes.new('ShaderNodeTexImage')
    base.image = load(base_png)
    nt.links.new(base.outputs['Color'], bsdf.inputs['Base Color'])
    if emission_png:
        em = nt.nodes.new('ShaderNodeTexImage')
        em.image = load(emission_png)
        nt.links.new(em.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = 1.0
    return mat


def bounds(obj):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def render_icon(obj, path):
    """Flat unlit render of the weapon, tip to the top-left, on transparency."""
    scene = bpy.context.scene
    lo, hi = bounds(obj)
    size = hi - lo
    # Look at the flat side: the thinner of X/Y faces the camera.
    thin_is_x = size.x < size.y
    center = (lo + hi) / 2
    extent = max(size.x, size.y, size.z)
    cam_d = bpy.data.cameras.new('icon-cam')
    cam_d.type = 'ORTHO'
    cam_d.ortho_scale = extent * 1.25
    cam = bpy.data.objects.new('icon-cam', cam_d)
    scene.collection.objects.link(cam)
    scene.camera = cam
    view_dir = Vector((1, 0, 0)) if thin_is_x else Vector((0, 1, 0))
    cam.location = center - view_dir * (extent * 4 + 1)
    # Roll the view 45 degrees so the blade runs bottom-right to top-left.
    quat = view_dir.to_track_quat('-Z', 'Z')
    roll = Quaternion(view_dir, math.radians(-45))
    cam.rotation_euler = (roll @ quat).to_euler()
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'FLAT' if ICON_LIGHT == 'FLAT' else 'STUDIO'
    sh.color_type = 'TEXTURE'
    sh.show_backface_culling = False
    sh.show_shadows = False
    sh.show_cavity = ICON_LIGHT == 'STUDIOCAV'
    if sh.show_cavity:
        sh.cavity_type = 'BOTH'
        sh.cavity_ridge_factor = 1.5
        sh.cavity_valley_factor = 1.0
        sh.curvature_ridge_factor = 1.0
        sh.curvature_valley_factor = 1.0
    scene.render.film_transparent = True
    scene.render.resolution_x = ICON_SIZE
    scene.render.resolution_y = ICON_SIZE
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'Standard'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.cameras.remove(cam_d)


def place_in_hand(obj, grip):
    """Grip point to the origin, then the whole mesh into the hero's hand."""
    shift = Matrix.Translation(Vector((0, 0, -grip))) if grip else Matrix.Identity(4)
    obj.matrix_world = HAND_FROM_FBX @ shift @ obj.matrix_world
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def export_plain_glb(path):
    # export_yup=False: the vertices are already in the weapon GLB frame (HAND_FROM_FBX
    # includes the axis change), so the exporter must not convert them again.
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_yup=False, export_apply=True,
        export_animations=False, export_skins=False, export_morph=False,
        export_materials='EXPORT', export_image_format='AUTO',
        export_texcoords=True, export_normals=True, export_tangents=False,
        export_cameras=False, export_lights=False, export_extras=False
    )


# ------------------------------------------------------------- glb rewrite ---

def to_gltf_matrix(m):
    """Row-major mathutils Matrix -> glTF column-major 16 floats."""
    return [m[r][c] for c in range(4) for r in range(4)]


def rewrite_as_weapon(path, weapon_id, name):
    gltf, bin_ = bake.load_glb(path)
    mesh_nodes = [i for i, n in enumerate(gltf['nodes']) if 'mesh' in n]
    if len(mesh_nodes) != 1:
        raise RuntimeError(f'{path}: expected one mesh node, found {len(mesh_nodes)}')
    mesh_node = gltf['nodes'][mesh_nodes[0]]
    for key in ('translation', 'rotation', 'scale', 'matrix'):
        mesh_node.pop(key, None)
    mesh_node['name'] = weapon_id
    gltf['nodes'] = [mesh_node]

    # Every vertex rides the single joint.
    mesh = gltf['meshes'][mesh_node['mesh']]
    for prim in mesh['primitives']:
        count = gltf['accessors'][prim['attributes']['POSITION']]['count']
        start = len(bin_)
        bin_ += b'\x00' * (count * 8)
        gltf['bufferViews'].append({'buffer': 0, 'byteOffset': start, 'byteLength': count * 8})
        gltf['accessors'].append({'bufferView': len(gltf['bufferViews']) - 1, 'componentType': 5123, 'count': count, 'type': 'VEC4'})
        prim['attributes']['JOINTS_0'] = len(gltf['accessors']) - 1
        prim['attributes']['WEIGHTS_0'] = bake.append_accessor(gltf, bin_, [(1.0, 0.0, 0.0, 0.0)] * count, 'VEC4')
    mesh['name'] = 'Mesh'

    bind = INVERSE_BIND.inverted()
    t, r, s = bind.decompose()
    gltf['nodes'].append({
        'name': 'hand_r',
        'translation': [t.x, t.y, t.z],
        'rotation': [r.x, r.y, r.z, r.w],
        'scale': [s.x, s.y, s.z]
    })
    ibm_acc = bake.append_accessor(gltf, bin_, [tuple(to_gltf_matrix(INVERSE_BIND))], 'MAT4')
    gltf['skins'] = [{'name': f'{weapon_id} right hand', 'inverseBindMatrices': ibm_acc, 'skeleton': 1, 'joints': [1]}]
    mesh_node['skin'] = 0
    gltf['scenes'] = [{'name': 'Sidekick weapon attachment', 'nodes': [0, 1]}]
    gltf['scene'] = 0
    for mat in gltf.get('materials', []):
        mat['doubleSided'] = True
        mat['name'] = name
    gltf['asset'] = {'version': '2.0', 'generator': 'DG build-weapons; Sidekick single-joint weapon; hand_r rest = bind pose'}
    gltf.pop('animations', None)
    bake.save_glb(path, gltf, bin_)


def drop_offset():
    """Entity transform that stands a stored (T-pose hand) weapon upright at the origin."""
    m = YUP @ HAND_FROM_FBX.inverted()
    t, r, s = m.decompose()
    return {'position': [t.x, t.y, t.z], 'rotation': [r.x, r.y, r.z, r.w]}


# ------------------------------------------------------------------- main ---

def build(weapon, packs, want_models, want_icons):
    pack = packs[weapon['pack']]
    fbx = extract(pack['zip'], pack['fbx'].format(name=weapon['mesh']))
    base = extract(pack['zip'], pack['palettes'][weapon['palette']])
    em_member = pack.get('emission', {}).get(weapon['palette'])
    emission = extract(pack['zip'], em_member) if em_member else None

    reset_scene()
    obj = import_weapon(fbx)
    mat = make_material(base, emission)
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    obj.name = weapon['id']
    lo, hi = bounds(obj)
    info = {'tris': sum(len(p.vertices) - 2 for p in obj.data.polygons),
            'length': round(hi.z - lo.z, 3), 'gripFromPommel': round(-lo.z + weapon.get('grip', 0), 3)}

    icon = os.path.join(ICONS_DIR, f"{weapon['id']}.png")
    if want_icons:
        render_icon(obj, icon)

    if want_models:
        place_in_hand(obj, weapon.get('grip', 0))
        out = os.path.join(MODELS_DIR, f"{weapon['id']}.glb")
        export_plain_glb(out)
        rewrite_as_weapon(out, weapon['id'], weapon['name'])
        bake.run(CORE_GLB, out, 'hand_r', False, None)
        info['bytes'] = os.path.getsize(out)
    return info


def write_catalog(manifest):
    items = []
    for w in manifest['weapons']:
        items.append({
            'id': w['id'], 'name': w['name'], 'slot': 'weapon', 'description': w['description'],
            'icon': f"images/weapons/{w['id']}.png", 'models': [f"models/roaming/weapons/{w['id']}.glb"],
            'weapon': {'class': w['class'], 'rarity': w['rarity'], 'pack': manifest['packs'][w['pack']]['label']}
        })
    json.dump({'schemaVersion': 1, 'dropOffset': drop_offset(), 'items': items}, open(CATALOG, 'w'), indent=1)
    print(f'catalog: {len(items)} weapons -> {os.path.relpath(CATALOG, ROOT)}')


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = set()
    skip_existing = '--skip-existing' in argv
    want_models = '--no-models' not in argv
    want_icons = '--no-icons' not in argv
    if '--only' in argv:
        only = {s for s in argv[argv.index('--only') + 1].split(',') if s}
    manifest = json.load(open(MANIFEST))
    os.makedirs(MODELS_DIR, exist_ok=True)
    os.makedirs(ICONS_DIR, exist_ok=True)
    os.makedirs(WORK, exist_ok=True)
    built = 0
    for weapon in manifest['weapons']:
        if only and weapon['id'] not in only:
            continue
        glb = os.path.join(MODELS_DIR, f"{weapon['id']}.glb")
        icon = os.path.join(ICONS_DIR, f"{weapon['id']}.png")
        if skip_existing and (not want_models or os.path.exists(glb)) and (not want_icons or os.path.exists(icon)):
            continue
        info = build(weapon, manifest['packs'], want_models, want_icons)
        built += 1
        print(f"[weapon] {weapon['id']}: {info}")
    write_catalog(manifest)
    print(f'BUILT {built}')


if __name__ == '__main__':
    main()
