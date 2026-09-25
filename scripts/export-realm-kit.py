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
  sealed    true for a wall variant with an opening in its mesh (breach,
            doorway); the layout backs it with an invisible full-tile collider
  scale     uniform scale, or [x, y, z] (glTF axes), applied before measuring
            (oversized Synty props; cliffs squashed into wall modules)
  shift     [x, y, z] metres the recentred piece is moved before export, so a
            deep piece can keep its face on the wall line and its bulk behind
  lod       keep only the FBX objects whose name contains this (e.g. "LOD1")
  bake      { size, tile }: the slot is one of Synty's triplanar shaders (snow
            on top, rock on the sides; no usable UVs). Rebuilt box-mapped in
            object space from `textures.bakeTop` / `textures.bakeSide`, one
            repeat per `tile` metres, smart-unwrapped and baked to a `size` px
            texture of its own
  leaf      pack member of a foliage sheet: the piece is a Synty tree whose one
            slot mixes leaf cards (UVs spanning the sheet) and bark faces (a
            small atlas patch); split into an alpha-masked leaf slot and the atlas

Manifest texture fields: atlas, emissive, tiling (all pack members), and
either `floor` (a pack member copied as the tiling floor texture) or
`floorBake`: { fbx, size } to render a floor slab module top-down into
floor.png (packs like Dungeon Realms have no tiling floor texture, only
atlas-mapped floor meshes). `ceiling` is optional.
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
BAKE_TOP = load_scaled(tex['bakeTop'], 512, f'{REALM}_bake_top') if tex.get('bakeTop') else None
BAKE_SIDE = load_scaled(tex['bakeSide'], 512, f'{REALM}_bake_side') if tex.get('bakeSide') else None
LEAF_MATS = {}


def leaf_material(member):
    """Alpha-masked, double-sided foliage sheet (one per distinct sheet)."""
    if member not in LEAF_MATS:
        stem = re.sub(r'\.(tga|png)$', '', os.path.basename(member)).lower()
        img = bpy.data.images.load(extract(member), check_existing=True)
        img.name = f'{REALM}_leaf_{stem}'
        img.alpha_mode = 'STRAIGHT'
        if img.size[0] > 1024:
            img.scale(1024, 1024)
        img.pack()
        mat = bpy.data.materials.new(f'{REALM}_leaf_{stem}')
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
        t = nodes.new('ShaderNodeTexImage')
        t.image = img
        mat.node_tree.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
        mat.node_tree.links.new(t.outputs['Alpha'], bsdf.inputs['Alpha'])
        bsdf.inputs['Roughness'].default_value = 0.95
        mat.use_backface_culling = False
        LEAF_MATS[member] = mat
    return LEAF_MATS[member]


def split_leaves(obj, member):
    """Leaf cards span the sheet (the sampler repeats); bark faces sit on a small atlas patch."""
    me = obj.data
    uvl = me.uv_layers.active
    me.materials.clear()
    me.materials.append(leaf_material(member))
    me.materials.append(MAT_ATLAS)
    for p in me.polygons:
        us = [uvl.data[l].uv for l in p.loop_indices]
        p.material_index = 0 if max(u.x for u in us) - min(u.x for u in us) > 0.5 else 1


def snowrock_material(tile):
    """Top texture on up-facing surfaces, side texture elsewhere, box-mapped in object space like Synty's triplanar shader."""
    mat = bpy.data.materials.new(f'{REALM}_bake_src')
    mat.use_nodes = True
    nt = mat.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    coord = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (1 / tile, 1 / tile, 1 / tile)
    links.new(coord.outputs['Object'], mapping.inputs['Vector'])
    top = nodes.new('ShaderNodeTexImage')
    top.image = BAKE_TOP
    top.projection = 'BOX'
    top.projection_blend = 0.3
    side = nodes.new('ShaderNodeTexImage')
    side.image = BAKE_SIDE
    side.projection = 'BOX'
    side.projection_blend = 0.3
    links.new(mapping.outputs['Vector'], top.inputs['Vector'])
    links.new(mapping.outputs['Vector'], side.inputs['Vector'])
    geo = nodes.new('ShaderNodeNewGeometry')
    sep = nodes.new('ShaderNodeSeparateXYZ')
    links.new(geo.outputs['Normal'], sep.inputs['Vector'])
    ramp = nodes.new('ShaderNodeMapRange')
    ramp.inputs['From Min'].default_value = 0.45
    ramp.inputs['From Max'].default_value = 0.75
    links.new(sep.outputs['Z'], ramp.inputs['Value'])
    mix = nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    links.new(ramp.outputs['Result'], mix.inputs['Factor'])
    links.new(side.outputs['Color'], mix.inputs[6])
    links.new(top.outputs['Color'], mix.inputs[7])
    links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 1.0
    return mat


def bake_piece(obj, out_name, spec):
    """Replace the piece's materials with one baked texture of the snow/rock shader."""
    import math
    size = int(spec.get('size', 512))
    me = obj.data
    src = snowrock_material(float(spec.get('tile', 4)))
    me.materials.clear()
    me.materials.append(src)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name='bake')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    img = bpy.data.images.new(f'{REALM}_{out_name}', size, size)
    target = src.node_tree.nodes.new('ShaderNodeTexImage')
    target.image = img
    src.node_tree.nodes.active = target
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 8
    scene.cycles.device = 'CPU'
    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = False
    scene.render.bake.use_pass_color = True
    scene.render.bake.margin = 6
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_clear=True)
    dest = os.path.join(WORK, f'{REALM}_{out_name}.png')
    img.filepath_raw = dest
    img.file_format = 'PNG'
    img.save()
    baked = make_mat(f'{REALM}_{out_name}', img)
    me.materials.clear()
    me.materials.append(baked)
    bpy.data.materials.remove(src)


def import_parts(module):
    """Import the module's FBX (or parts) and return the new mesh objects, transforms applied."""
    parts = module.get('parts') or [{'fbx': module['fbx'], 'offset': [0, 0, 0]}]
    meshes = []
    for part in parts:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.fbx(filepath=fbx_path(part['fbx']))
        objs = [o for o in bpy.data.objects if o not in before]
        part_meshes = [o for o in objs if o.type == 'MESH']
        if module.get('lod'):
            keep = [o for o in part_meshes if module['lod'] in o.name]
            others = [o for o in objs if o.type != 'MESH']
            for o in part_meshes:
                if o not in keep:
                    bpy.data.objects.remove(o)
            part_meshes = keep
            objs = keep + others
            # The importer parks the FBX axis fix on a parent empty; keep the world placement.
            for o in part_meshes:
                mw = o.matrix_world.copy()
                o.parent = None
                o.matrix_world = mw
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
    if module.get('scale'):
        s = module['scale']
        # glTF (x, y up, z) -> Blender (x, z, y).
        sc = (s[0], s[2], s[1]) if isinstance(s, list) else (s,) * 3
        for o in meshes:
            o.scale = sc
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
    special = module.get('bake') or module.get('leaf')
    for o in meshes if not special else []:
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
    if module.get('bake'):
        bake_piece(obj, out_name, module['bake'])
    elif module.get('leaf'):
        split_leaves(obj, module['leaf'])
    if module.get('shift'):
        sx, sy, sz = module['shift']
        obj.location.x += sx
        obj.location.y += -sz
        obj.location.z += sy
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
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
    if module.get('sealed'):
        entry['sealed'] = True
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
    if module.get('leaf'):
        # Foliage cuts out; the exporter's alpha handling varies by version, so set it here.
        gltf_path = os.path.join(OUT, out_name + '.gltf')
        with open(gltf_path, encoding='utf-8') as f:
            doc = json.load(f)
        for m in doc.get('materials', []):
            if '_leaf_' in m.get('name', ''):
                m['alphaMode'] = 'MASK'
                m['alphaCutoff'] = 0.45
                m['doubleSided'] = True
        with open(gltf_path, 'w', encoding='utf-8') as f:
            json.dump(doc, f, separators=(',', ':'))
    bpy.data.objects.remove(obj)
    for m in list(bpy.data.meshes):
        if m.users == 0:
            bpy.data.meshes.remove(m)

# Floor (and optional ceiling) textures travel with the kit, scaled to 1024.
textures_out = {}


def bake_floor(spec):
    """Render a floor slab straight down (flat-lit, textured) into floor.png."""
    import math
    module = {'id': '_floor_bake', 'fbx': spec['fbx']}
    meshes = import_parts(module)
    for o in meshes:
        for slot in o.material_slots:
            slot.material = MAT_ATLAS
    mn, mx = bounds(meshes)
    size = float(spec.get('size', max(mx.x - mn.x, mx.y - mn.y)))
    cam_data = bpy.data.cameras.new('_bake_cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = size
    cam = bpy.data.objects.new('_bake_cam', cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = ((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mx.z + 10)
    cam.rotation_euler = (0, 0, 0)
    scene = bpy.context.scene
    scene.camera = cam
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'FLAT'
    scene.display.shading.color_type = 'TEXTURE'
    scene.display.shading.show_shadows = False
    scene.display.shading.show_cavity = False
    scene.render.resolution_x = scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.view_settings.view_transform = 'Standard'
    dest = os.path.join(OUT, 'floor.png')
    scene.render.filepath = dest
    bpy.ops.render.render(write_still=True)
    for o in meshes:
        bpy.data.objects.remove(o)
    bpy.data.objects.remove(cam)
    print(f'floor baked from {spec["fbx"]} at {size} m')
    return dest


if tex.get('floorBake'):
    bake_floor(tex['floorBake'])
    textures_out['floor'] = f'models/kits/{REALM}/floor.png'

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
