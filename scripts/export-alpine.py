"""Exports the Alpine Mountain backdrop pieces from Synty's Nature Biomes pack.

  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" -b --python scripts/export-alpine.py -- [--only id1,id2] [--preview]

Reads POLYGON_NatureBiomes_AlpineMountain_SourceFiles_v*.zip from ~/Downloads
(nothing unzipped by hand; FBX and textures are pulled into %TEMP%/dg-alpine)
and writes one .gltf per piece into models/backdrop/alpine/, sharing textures,
plus src/backdrop/alpine.json with each piece's size and triangle count.

Synty textures these meshes three ways, and glTF only has one:
  atlas     rocks, dead pines, trunks: flat colours picked off the pack atlas
            (UVs collapsed to a point), exported as-is at 1024 px.
  snowrock  mountains, cliffs, mounds: a triplanar shader (snow on top, rock
            on the sides) with junk UVs. Rebuilt as a Blender box-mapped
            material, smart-UV-unwrapped and baked to a texture per piece.
  pine      living pines: one slot, leaf cards in UV 0..1 and trunk faces
            parked at u > 1 for the shader's second texture. Split into a
            leaf (alpha-masked, double-sided) and a trunk (atlas) slot.
  cards     background tree silhouettes: two card textures, alpha-masked.

Every piece is recentred on its footprint with its base at y = 0.
"""
import bpy, os, sys, json, re, shutil, zipfile, math, mathutils

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ONLY = set(args[args.index('--only') + 1].split(',')) if '--only' in args else None
PREVIEW = '--preview' in args

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
DOWNLOADS = os.path.join(os.path.expanduser('~'), 'Downloads')
PACK = next(f for f in sorted(os.listdir(DOWNLOADS)) if re.match(r'POLYGON_NatureBiomes_AlpineMountain_SourceFiles.*\.zip$', f))
WORK = os.path.join(os.environ.get('TEMP', '/tmp'), 'dg-alpine', 'work')
OUT = os.path.join(ROOT, 'models', 'backdrop', 'alpine')
REPORT = os.path.join(ROOT, 'src', 'backdrop', 'alpine.json')
os.makedirs(WORK, exist_ok=True)
os.makedirs(OUT, exist_ok=True)
os.makedirs(os.path.dirname(REPORT), exist_ok=True)

ZIP = zipfile.ZipFile(os.path.join(DOWNLOADS, PACK))
NAMES = ZIP.namelist()


def extract(base):
    """Pull one file out of the pack by basename (cached under WORK)."""
    hit = next((n for n in NAMES if n.lower().endswith('/' + base.lower()) or n.lower() == base.lower()), None)
    if hit is None:
        raise FileNotFoundError(f'{base} not in {PACK}')
    out = os.path.join(WORK, os.path.basename(hit))
    if not os.path.exists(out):
        with ZIP.open(hit) as src, open(out, 'wb') as dst:
            shutil.copyfileobj(src, dst)
    return out


MATERIAL_LIST = ZIP.read('MaterialList_PNB_Alpine_Mountain.txt').decode('utf-8', 'replace')


def leaf_texture(prefab):
    """The _Leaf_Texture Synty's material list names for a pine prefab."""
    i = MATERIAL_LIST.find('Prefab Name: ' + prefab + '\r')
    if i < 0:
        i = MATERIAL_LIST.find('Prefab Name: ' + prefab + '\n')
    block = MATERIAL_LIST[i:MATERIAL_LIST.find('Prefab Name: ', i + 10)]
    m = re.search(r'_Leaf_Texture: (\S+\.(?:tga|png))', block)
    return m.group(1)


# id, fbx, kind, options
MODULES = [
    ('mountain_01', 'SM_Env_MountainRange_01', 'snowrock', {'bake': 1024, 'tile': 6}),
    ('mountain_02', 'SM_Env_MountainRange_02', 'snowrock', {'bake': 1024, 'tile': 6}),
    ('mountain_03', 'SM_Env_MountainRange_03', 'snowrock', {'bake': 1024, 'tile': 5}),
    ('mountain_04', 'SM_Env_MountainRange_04', 'snowrock', {'bake': 512, 'tile': 3}),
    ('cliff_01', 'SM_Env_Rock_Cliff_01', 'snowrock', {'bake': 512, 'tile': 4}),
    ('cliff_02', 'SM_Env_Rock_Cliff_02', 'snowrock', {'bake': 512, 'tile': 4}),
    ('cliff_05', 'SM_Env_Rock_Cliff_05', 'snowrock', {'bake': 512, 'tile': 4}),
    ('cliff_07', 'SM_Env_Rock_Cliff_07', 'snowrock', {'bake': 512, 'tile': 4}),
    ('mound_01', 'SM_Env_Snow_Mound_01', 'snowrock', {'bake': 256, 'tile': 1.5}),
    ('mound_03', 'SM_Env_Snow_Mound_03', 'snowrock', {'bake': 256, 'tile': 1.5}),
    ('pine_01', 'SM_Env_Pine_01', 'pine', {'lod': 'LOD1'}),
    ('pine_02', 'SM_Env_Pine_02', 'pine', {'lod': 'LOD1'}),
    ('pine_dead', 'SM_Env_Pine_NoLeaves_01', 'atlas', {'lod': 'LOD1'}),
    ('trees_01', 'SM_Env_Background_Trees_01', 'cards', {}),
    ('trees_02', 'SM_Env_Background_Trees_02', 'cards', {}),
    ('rock_01', 'SM_Env_Rock_01', 'atlas', {}),
    ('rock_05', 'SM_Env_Rock_05', 'atlas', {}),
    ('rock_rough_01', 'SM_Env_Rock_Rough_01', 'atlas', {}),
    ('rock_rough_02', 'SM_Env_Rock_Rough_02', 'atlas', {}),
]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def load_scaled(member, size, name, alpha=False):
    """Load a pack texture, scale it down and re-save it as a PNG the exporter can copy."""
    img = bpy.data.images.load(extract(member), check_existing=True)
    img.name = name
    img.alpha_mode = 'STRAIGHT' if alpha else 'NONE'
    if img.size[0] > size:
        img.scale(size, size)
    img.pack()
    dest = os.path.join(WORK, name + '.png')
    img.filepath_raw = dest
    img.file_format = 'PNG'
    img.save()
    return img


ATLAS = load_scaled('PolygonNatureBiomesS2_Alpine_Texture_01.png', 1024, 'alpine_atlas')
SNOW = load_scaled('Snow_01.png', 512, 'alpine_snow_src')
ROCK = load_scaled('RiverRocks4_Texture.png', 512, 'alpine_rock_src')
LEAVES = {}
CARDS = {
    'Card': load_scaled('pine04.tga', 1024, 'alpine_card_pine04', alpha=True),
    'other': load_scaled('TreePine_02.tga', 1024, 'alpine_card_treepine02', alpha=True),
}


def image_material(name, img, alpha=False, double=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    t = nodes.new('ShaderNodeTexImage')
    t.image = img
    mat.node_tree.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    if alpha:
        mat.node_tree.links.new(t.outputs['Alpha'], bsdf.inputs['Alpha'])
    bsdf.inputs['Roughness'].default_value = 0.95
    bsdf.inputs['Metallic'].default_value = 0.0
    mat.use_backface_culling = not double
    return mat


MAT_ATLAS = image_material('alpine_atlas', ATLAS)
MAT_CARDS = {k: image_material(f'alpine_card_{k}', img, alpha=True, double=True) for k, img in CARDS.items()}


def leaf_material(tex_name):
    if tex_name not in LEAVES:
        stem = re.sub(r'\.(tga|png)$', '', tex_name).lower()
        img = load_scaled(tex_name, 1024, f'alpine_leaf_{stem}', alpha=True)
        LEAVES[tex_name] = image_material(f'alpine_leaf_{stem}', img, alpha=True, double=True)
    return LEAVES[tex_name]


def snowrock_material(tile):
    """Snow on up-facing surfaces, rock elsewhere, both box-mapped in object space (what Synty's triplanar shader did)."""
    mat = bpy.data.materials.new('alpine_snowrock_bake')
    mat.use_nodes = True
    nt = mat.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    coord = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (1 / tile, 1 / tile, 1 / tile)
    links.new(coord.outputs['Object'], mapping.inputs['Vector'])
    snow = nodes.new('ShaderNodeTexImage')
    snow.image = SNOW
    snow.projection = 'BOX'
    snow.projection_blend = 0.3
    rock = nodes.new('ShaderNodeTexImage')
    rock.image = ROCK
    rock.projection = 'BOX'
    rock.projection_blend = 0.3
    links.new(mapping.outputs['Vector'], snow.inputs['Vector'])
    links.new(mapping.outputs['Vector'], rock.inputs['Vector'])
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
    links.new(rock.outputs['Color'], mix.inputs[6])
    links.new(snow.outputs['Color'], mix.inputs[7])
    links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 1.0
    return mat


def import_module(fbx, lod=None):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=extract(fbx + '.fbx'))
    objs = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in objs if o.type == 'MESH']
    others = [o for o in objs if o.type != 'MESH']
    if lod:
        keep = [o for o in meshes if lod in o.name]
        for o in meshes:
            if o not in keep:
                bpy.data.objects.remove(o)
        meshes = keep
    for o in meshes:
        # Keep the world placement (the importer parks the FBX Y-up fix on the parent).
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    for o in others:
        bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    return obj


def recentre(obj):
    mn = mathutils.Vector((1e9,) * 3)
    mx = mathutils.Vector((-1e9,) * 3)
    for v in obj.bound_box:
        w = obj.matrix_world @ mathutils.Vector(v)
        mn = mathutils.Vector(map(min, mn, w))
        mx = mathutils.Vector(map(max, mx, w))
    obj.location.x -= (mn.x + mx.x) / 2
    obj.location.y -= (mn.y + mx.y) / 2
    obj.location.z -= mn.z
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return mx - mn


def split_pine(obj, fbx):
    """Leaf cards keep UV 0..1; trunk faces are parked one tile over for the shader's trunk texture."""
    me = obj.data
    uvl = me.uv_layers.active
    leaf = leaf_material(leaf_texture(fbx))
    me.materials.clear()
    me.materials.append(leaf)
    me.materials.append(MAT_ATLAS)
    # Leaf cards span the leaf sheet (one to three clusters across, so the
    # sampler repeats); trunk and branch faces sit on a small bark patch of the atlas.
    for p in me.polygons:
        us = [uvl.data[l].uv for l in p.loop_indices]
        umin = min(u.x for u in us)
        umax = max(u.x for u in us)
        p.material_index = 0 if umax - umin > 0.5 else 1
    trunk = [p for p in me.polygons if p.material_index == 1]
    tu = [uvl.data[l].uv for p in trunk for l in p.loop_indices]
    if tu:
        print(f'  pine trunk faces={len(trunk)} leaf faces={len(me.polygons) - len(trunk)} trunk uv x {min(u.x for u in tu):.2f}..{max(u.x for u in tu):.2f} y {min(u.y for u in tu):.2f}..{max(u.y for u in tu):.2f}')
    else:
        print(f'  pine trunk faces=0 leaf faces={len(me.polygons)}')


def assign_cards(obj):
    me = obj.data
    slots = [m.name if m else '' for m in me.materials]
    for i, name in enumerate(slots):
        me.materials[i] = MAT_CARDS['Card'] if name.startswith('Card') else MAT_CARDS['other']


def bake_snowrock(obj, out_id, size, tile):
    me = obj.data
    mat = snowrock_material(tile)
    me.materials.clear()
    me.materials.append(mat)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    # Fresh, non-overlapping UVs for the bake target.
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name='bake')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    img = bpy.data.images.new(f'alpine_{out_id}', size, size)
    target = mat.node_tree.nodes.new('ShaderNodeTexImage')
    target.image = img
    mat.node_tree.nodes.active = target
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 8
    scene.cycles.device = 'CPU'
    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = False
    scene.render.bake.use_pass_color = True
    scene.render.bake.margin = 6
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_clear=True)
    dest = os.path.join(WORK, f'alpine_{out_id}.png')
    img.filepath_raw = dest
    img.file_format = 'PNG'
    img.save()
    baked = image_material(f'alpine_{out_id}', img)
    me.materials.clear()
    me.materials.append(baked)
    bpy.data.materials.remove(mat)


def render_preview(obj, out_id, size):
    cam_data = bpy.data.cameras.new('_cam')
    cam = bpy.data.objects.new('_cam', cam_data)
    scene.collection.objects.link(cam)
    d = max(size) * 1.6
    cam.location = (d * 0.8, -d * 0.9, size.z * 0.5 + d * 0.4)
    direction = mathutils.Vector((0, 0, size.z * 0.4)) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE'
    scene.eevee.taa_render_samples = 8
    if not scene.world:
        scene.world = bpy.data.worlds.new('_w')
    scene.world.use_nodes = True
    bg = next(n for n in scene.world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (0.35, 0.4, 0.5, 1)
    bg.inputs['Strength'].default_value = 1.5
    scene.render.resolution_x = scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.filepath = os.path.join(WORK, '..', f'preview_{out_id}.png')
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    bpy.data.cameras.remove(cam_data)


def export(obj, out_id):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    path = os.path.join(OUT, out_id + '.gltf')
    bpy.ops.export_scene.gltf(
        filepath=path,
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
    # Leaves and cards cut out; the exporter's alpha handling varies by version, so set it here.
    with open(path, encoding='utf-8') as f:
        doc = json.load(f)
    for m in doc.get('materials', []):
        if 'leaf' in m['name'] or 'card' in m['name']:
            m['alphaMode'] = 'MASK'
            m['alphaCutoff'] = 0.45
            m['doubleSided'] = True
        else:
            m.pop('alphaMode', None)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(doc, f, separators=(',', ':'))


report = {}
if ONLY and os.path.exists(REPORT):
    with open(REPORT) as f:
        report = json.load(f).get('pieces', {})

for out_id, fbx, kind, opt in MODULES:
    if ONLY and out_id not in ONLY:
        continue
    obj = import_module(fbx, opt.get('lod'))
    obj.name = out_id
    size = recentre(obj)
    if kind == 'atlas':
        obj.data.materials.clear()
        obj.data.materials.append(MAT_ATLAS)
    elif kind == 'pine':
        split_pine(obj, fbx)
    elif kind == 'cards':
        assign_cards(obj)
    elif kind == 'snowrock':
        bake_snowrock(obj, out_id, opt['bake'], opt['tile'])
    obj.data.calc_loop_triangles()
    entry = {
        'src': f'models/backdrop/alpine/{out_id}.gltf',
        'size': [round(size.x, 2), round(size.z, 2), round(size.y, 2)],
        'tris': len(obj.data.loop_triangles),
    }
    report[out_id] = entry
    print(f'ALPINE {out_id}: size={entry["size"]} tris={entry["tris"]}')
    if PREVIEW:
        render_preview(obj, out_id, size)
    export(obj, out_id)
    bpy.data.objects.remove(obj)
    for m in list(bpy.data.meshes):
        if m.users == 0:
            bpy.data.meshes.remove(m)

# The snow tile also covers the ground between the pieces (a tiled plane in src/backdrop.ts).
shutil.copyfile(os.path.join(WORK, 'alpine_snow_src.png'), os.path.join(OUT, 'alpine_snow.png'))

with open(REPORT, 'w') as f:
    json.dump({'pieces': report}, f, indent=2)
    f.write('\n')
print('ALPINE_DONE', REPORT)
