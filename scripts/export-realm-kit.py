"""Exports one realm's kit from a Synty source pack, driven by a manifest.

  blender -b --python scripts/export-realm-kit.py -- scripts/realms/<realm>.json [--only id1,id2]

The manifest names the pack zip (looked up in ~/Downloads, like
build-weapons.py), the textures to share, and the modules to export. Nothing
is unzipped by hand: the FBX and textures are pulled out of the zip into a
cache under %TEMP%/dg-realms.

Every module is recentred on its footprint with its base at y = 0 ('top'
anchored pieces: top at y = 0) and its detailed face towards +Z, exactly like
export-kit.py did for the Dark Fortress. One .gltf per module lands in
models/kits/<realm>/ sharing a 1024 px atlas, an emissive map and one tiling
texture; the floor texture is copied alongside. The measured sizes, triangle
counts and placement flags are written to src/dungeon/kits/<realm>.json, which
src/dungeon/kit.ts merges into KIT.

Manifest module fields:
  id        kit id (unique across all realms; prefix with the realm)
  fbx       FBX name without extension, or `parts`: [{fbx, offset:[x,y,z]}]
            (glTF metres) to weld several pieces into one module
  anchor    'base' (default) or 'top'
  rotate    degrees about the vertical axis applied before measuring, for
            pieces whose long side is authored along the wrong axis
  wall      { height, inset }: wall-mounted prop; the layout hangs it at
            `height` metres, `inset` metres in from the wall edge
  collide   false to make the piece walk-through (bones, rugs, rubble)
"""
import bpy, os, sys, json, re, shutil, zipfile, mathutils

args = sys.argv[sys.argv.index("--") + 1:]
MANIFEST = os.path.abspath(args[0])
ONLY = set(args[args.index('--only') + 1].split(',')) if '--only' in args else None

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
DOWNLOADS = os.path.join(os.path.expanduser('~'), 'Downloads')
WORK = os.path.join(os.environ.get('TEMP', '/tmp'), 'dg-realms', 'work')

with open(MANIFEST) as f:
    manifest = json.load(f)
REALM = manifest['realm']
PACK = manifest['pack']
OUT = os.path.join(ROOT, 'models', 'kits', REALM)
KIT_JSON = os.path.join(ROOT, 'src', 'dungeon', 'kits', REALM + '.json')
os.makedirs(OUT, exist_ok=True)
os.makedirs(os.path.dirname(KIT_JSON), exist_ok=True)
TILING_SLOTS = re.compile(manifest.get('tilingSlots', '^$'))
TILING_WORLD = float(manifest.get('tilingWorldSize', 2.5))


def extract(member):
    """Pull one file out of the pack zip (cached under WORK); case-insensitive."""
    out = os.path.join(WORK, PACK.replace('.zip', ''), member.replace('/', os.sep))
    if os.path.exists(out):
        return out
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with zipfile.ZipFile(os.path.join(DOWNLOADS, PACK)) as z:
        names = z.namelist()
        hit = member if member in names else next((n for n in names if n.lower() == member.lower()), None)
        if hit is None:
            # FBX may live in a subfolder (FBX/Props/...); search by basename.
            base = os.path.basename(member).lower()
            hit = next((n for n in names if n.lower().endswith('/' + base) or n.lower() == base), None)
        if hit is None:
            raise FileNotFoundError(f'{member} not in {PACK}')
        with z.open(hit) as src, open(out, 'wb') as dst:
            shutil.copyfileobj(src, dst)
    return out


def fbx_path(name):
    return extract('FBX/' + name + '.fbx')


bpy.ops.wm.read_factory_settings(use_empty=True)


def load_scaled(member, size, name):
    img = bpy.data.images.load(extract(member), check_existing=True)
    img.name = name
    if img.size[0] > size:
        img.scale(size, size)
    img.pack()
    return img


tex = manifest['textures']
atlas = load_scaled(tex['atlas'], 1024, f'{REALM}_atlas')
emis = load_scaled(tex['emissive'], 512, f'{REALM}_emissive') if tex.get('emissive') else None
tiling = load_scaled(tex['tiling'], 1024, f'{REALM}_tiling') if tex.get('tiling') else None


def make_mat(name, img, emissive=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    t = nodes.new('ShaderNodeTexImage')
    t.image = img
    mat.node_tree.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.9
    bsdf.inputs['Metallic'].default_value = 0.0
    if emissive is not None:
        et = nodes.new('ShaderNodeTexImage')
        et.image = emissive
        mat.node_tree.links.new(et.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = 1.0
    return mat


MAT_ATLAS = make_mat(f'{REALM}_mat', atlas, emis)
MAT_TILING = make_mat(f'{REALM}_tiling_mat', tiling) if tiling else MAT_ATLAS


def import_parts(module):
    """Import the module's FBX (or parts) and return the new mesh objects, transforms applied."""
    parts = module.get('parts') or [{'fbx': module['fbx'], 'offset': [0, 0, 0]}]
    meshes = []
    for part in parts:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.fbx(filepath=fbx_path(part['fbx']))
        objs = [o for o in bpy.data.objects if o not in before]
        part_meshes = [o for o in objs if o.type == 'MESH']
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = part_meshes[0]
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        ox, oy, oz = part.get('offset', [0, 0, 0])  # glTF x, y(up), z -> Blender x, -z?, y
        # glTF (x, y up, z) maps to Blender (x, -z, y) only for handedness flips; the
        # kit export uses export_yup with Blender Y -> glTF -Z. Offsets are given in the
        # module's own glTF frame, so: Blender x = x, Blender y = -z, Blender z = y.
        for o in part_meshes:
            o.location.x += ox
            o.location.y += -oz
            o.location.z += oy
        for o in [o for o in objs if o.type != 'MESH']:
            bpy.data.objects.remove(o)
        meshes.extend(part_meshes)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if module.get('rotate'):
        import math
        for o in meshes:
            o.rotation_euler.z = math.radians(module['rotate'])
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return meshes


def bounds(meshes):
    mn = mathutils.Vector((1e9,) * 3)
    mx = mathutils.Vector((-1e9,) * 3)
    for o in meshes:
        for v in o.bound_box:
            w = o.matrix_world @ mathutils.Vector(v)
            mn = mathutils.Vector(map(min, mn, w))
            mx = mathutils.Vector(map(max, mx, w))
    return mn, mx


report = {}
for module in manifest['modules']:
    out_name = module['id']
    if ONLY and out_name not in ONLY:
        continue
    anchor = module.get('anchor', 'base')
    meshes = import_parts(module)
    mn, mx = bounds(meshes)
    uv_info = {}
    for o in meshes:
        uvl = o.data.uv_layers.active
        project = []  # material indices whose UVs are degenerate and need a world-space projection
        for i, slot in enumerate(o.material_slots):
            nm = slot.material.name if slot.material else slot.name
            rng = None
            if uvl:
                us = [uvl.data[l].uv for p in o.data.polygons if p.material_index == i for l in p.loop_indices]
                if us:
                    rng = [round(min(u.x for u in us), 2), round(max(u.x for u in us), 2), round(min(u.y for u in us), 2), round(max(u.y for u in us), 2)]
                    uv_info[nm] = rng
            spread = rng is not None and (rng[1] - rng[0]) > 0.6
            # A slot parked outside 0..1 or collapsed to a point is a triplanar
            # (world-tiled) surface in Synty's shader; the atlas lookup would be junk.
            parked = rng is not None and (rng[2] < -0.01 or rng[3] > 1.01 or rng[0] < -0.01)
            degenerate = rng is not None and (rng[1] - rng[0]) < 0.05 and (rng[3] - rng[2]) < 0.05
            use_tiling = tiling is not None and (spread or parked or TILING_SLOTS.search(nm) is not None)
            slot.material = MAT_TILING if use_tiling else MAT_ATLAS
            if use_tiling and uvl and (degenerate or parked) and not spread:
                project.append(i)
                continue
            # Synty tiles these slots in world space (triplanar); repeat the texture
            # so a 5 m piece carries the same brick size as a 2.5 m one.
            repeat = round((mx.x - mn.x) / TILING_WORLD)
            if use_tiling and repeat > 1 and uvl and not spread:
                for p in o.data.polygons:
                    if p.material_index == i:
                        for l in p.loop_indices:
                            uvl.data[l].uv = uvl.data[l].uv * repeat
        if project:
            # Box-project those faces at one texture repeat per TILING_WORLD metres,
            # which is what the triplanar shader did at runtime.
            bpy.ops.object.select_all(action='DESELECT')
            o.select_set(True)
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='DESELECT')
            bpy.ops.object.mode_set(mode='OBJECT')
            for p in o.data.polygons:
                p.select = p.material_index in project
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.uv.cube_project(cube_size=TILING_WORLD, correct_aspect=True, scale_to_bounds=False)
            bpy.ops.object.mode_set(mode='OBJECT')
    cx = (mn.x + mx.x) / 2
    cy = (mn.y + mx.y) / 2
    dz = -mn.z if anchor == 'base' else -mx.z
    for o in meshes:
        o.location.x -= cx
        o.location.y -= cy
        o.location.z += dz
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = out_name
    obj.data.calc_loop_triangles()
    entry = {
        'src': f'models/kits/{REALM}/{out_name}.gltf',
        'size': [round(mx.x - mn.x, 3), round(mx.z - mn.z, 3), round(mx.y - mn.y, 3)],
        'tris': len(obj.data.loop_triangles)
    }
    if module.get('wall'):
        entry['wall'] = module['wall']
    if module.get('collide') is False:
        entry['collide'] = False
    report[out_name] = entry
    print(f'{out_name}: {entry["size"]} {entry["tris"]} tris uv={uv_info}')
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, out_name + '.gltf'),
        export_format='GLTF_SEPARATE',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texture_dir='',
        export_image_format='AUTO',
        export_materials='EXPORT',
        export_normals=True,
        export_texcoords=True,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_lights=False,
        export_cameras=False,
    )
    bpy.data.objects.remove(obj)
    for m in list(bpy.data.meshes):
        if m.users == 0:
            bpy.data.meshes.remove(m)

# Floor (and optional ceiling) textures travel with the kit, scaled to 1024.
textures_out = {}
for key in ('floor', 'ceiling'):
    if tex.get(key):
        img = load_scaled(tex[key], 1024, f'{REALM}_{key}')
        dest = os.path.join(OUT, f'{key}.png')
        img.filepath_raw = dest
        img.file_format = 'PNG'
        img.save()
        textures_out[key] = f'models/kits/{REALM}/{key}.png'

# Merge with an existing kit JSON when exporting a subset.
kit = {'realm': REALM, 'textures': textures_out, 'pieces': {}}
if ONLY and os.path.exists(KIT_JSON):
    with open(KIT_JSON) as f:
        kit = json.load(f)
    kit['textures'].update(textures_out)
kit['pieces'].update(report)
with open(KIT_JSON, 'w') as f:
    json.dump(kit, f, indent=2)
    f.write('\n')
print('KIT_DONE', KIT_JSON)
