"""Exports the Chained Colossus (raid boss) from Synty's Dungeon Realms.

  blender -b --python scripts/export-colossus.py [-- --preview]

The pack's Giant Golem is an environment piece: a colossus lying in the
landscape, delivered as whole limbs plus each limb split at its joint with
the segment's origin on that joint. We export the ten animated segments
(chest, head, upper and lower arms, upper and lower legs) with those pivots
kept, scaled to a standing height of about 13 m, sharing the realm atlas.
The joint positions (found by matching each segment against its whole limb)
are written with the part list to src/raid/colossusParts.json, in glTF metres
of the chest's frame, so the scene can build the skeleton as entities and
pose it in code.

--preview also renders the assembled rest pose to %TEMP%/dg-realms/colossus.png.
"""
import bpy, os, sys, json, zipfile, shutil, mathutils, math

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PREVIEW = '--preview' in args

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOWNLOADS = os.path.join(os.path.expanduser('~'), 'Downloads')
PACK = 'POLYGON_Dungeons_Realms_SourceFiles_v6.zip'
WORK = os.path.join(os.environ.get('TEMP', '/tmp'), 'dg-realms')
OUT = os.path.join(ROOT, 'models', 'raid', 'colossus')
os.makedirs(OUT, exist_ok=True)

# Standing height target in metres; the source stands about 77 units tall.
SCALE = 0.17

# Segment -> (source FBX, joint position in the chest's frame, source units, glTF axes).
# Joints found by matching the split segments against the whole limbs; the
# chest sits at the origin, the head's pivot is its neck.
PARTS = {
    'chest':       ('SM_Env_GiantGolem_Chest_01',       [0, 0, 0]),
    'head':        ('SM_Env_GiantGolem_Head_01',        [0, 18.4, 0]),
    'arm_l_upper': ('SM_Env_GiantGolem_Arm_L_Upper_01', [7.89, 24.68, 6.09]),
    'arm_l_lower': ('SM_Env_GiantGolem_Arm_L_Lower_01', [19.39, 10.34, 5.53]),
    'arm_r_upper': ('SM_Env_GiantGolem_Arm_R_Upper_01', [-15.78, 22.21, -2.96]),
    'arm_r_lower': ('SM_Env_GiantGolem_Arm_R_Lower_01', [-28.98, 6.60, -4.90]),
    'leg_l_upper': ('SM_Env_GiantGolem_Leg_L_Upper_01', [4.49, -1.56, -0.42]),
    'leg_l_lower': ('SM_Env_GiantGolem_Leg_L_Lower_01', [10.05, -16.35, -1.77]),
    'leg_r_upper': ('SM_Env_GiantGolem_Leg_R_Upper_01', [-4.02, -2.33, 0.45]),
    # The right knee: the matcher put it a metre too low (28 thigh vertices near it); set from the thigh's end.
    'leg_r_lower': ('SM_Env_GiantGolem_Leg_R_Lower_01', [-5.67, -17.33, 0.63]),
}
PARENT = {
    'head': 'chest', 'arm_l_upper': 'chest', 'arm_r_upper': 'chest', 'leg_l_upper': 'chest', 'leg_r_upper': 'chest',
    'arm_l_lower': 'arm_l_upper', 'arm_r_lower': 'arm_r_upper', 'leg_l_lower': 'leg_l_upper', 'leg_r_lower': 'leg_r_upper'
}


def extract(member):
    out = os.path.join(WORK, PACK.replace('.zip', ''), member.replace('/', os.sep))
    if os.path.exists(out):
        return out
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with zipfile.ZipFile(os.path.join(DOWNLOADS, PACK)) as z:
        names = z.namelist()
        base = os.path.basename(member).lower()
        hit = next((n for n in names if n.lower() == member.lower()), None) or \
            next((n for n in names if n.lower().endswith('/' + base)), None)
        if hit is None:
            raise FileNotFoundError(f'{member} not in {PACK}')
        with z.open(hit) as src, open(out, 'wb') as dst:
            shutil.copyfileobj(src, dst)
    return out


bpy.ops.wm.read_factory_settings(use_empty=True)

atlas = bpy.data.images.load(extract('Textures/Dungeons_2_Texture_01_A.png'), check_existing=True)
if atlas.size[0] > 1024:
    atlas.scale(1024, 1024)
atlas.pack()
emis = bpy.data.images.load(extract('Textures/Dungeons_2_Texture_Emission_01.png'), check_existing=True)
if emis.size[0] > 512:
    emis.scale(512, 512)
emis.pack()

mat = bpy.data.materials.new('colossus_mat')
mat.use_nodes = True
nodes = mat.node_tree.nodes
bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
t = nodes.new('ShaderNodeTexImage'); t.image = atlas
mat.node_tree.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
e = nodes.new('ShaderNodeTexImage'); e.image = emis
mat.node_tree.links.new(e.outputs['Color'], bsdf.inputs['Emission Color'])
bsdf.inputs['Emission Strength'].default_value = 1.0
bsdf.inputs['Roughness'].default_value = 0.95
bsdf.inputs['Metallic'].default_value = 0.0


def import_part(fbx):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=extract('FBX/' + fbx + '.fbx'))
    objs = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in objs if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in [o for o in objs if o.type != 'MESH']:
        bpy.data.objects.remove(o)
    if len(meshes) > 1:
        bpy.ops.object.select_all(action='DESELECT')
        for o in meshes:
            o.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    for slot in obj.material_slots:
        slot.material = mat
    # The pack lays the colossus on the ground (its up is Blender +Y); stand it up.
    obj.rotation_euler = (math.radians(90), 0, 0)
    obj.scale = (SCALE,) * 3
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return obj


def gltf_bounds(obj):
    """Local bounds in glTF axes (x, y up, z) from Blender's (x, y, z up)."""
    mn = [1e9] * 3
    mx = [-1e9] * 3
    for v in obj.bound_box:
        g = (v[0], v[2], -v[1])
        for i in range(3):
            mn[i] = min(mn[i], g[i])
            mx[i] = max(mx[i], g[i])
    return [round(a, 3) for a in mn], [round(a, 3) for a in mx]


report = {'scale': SCALE, 'parts': {}}
kept = {}
for name, (fbx, joint) in PARTS.items():
    obj = import_part(fbx)
    obj.name = name
    obj.data.calc_loop_triangles()
    mn, mx = gltf_bounds(obj)
    parent = PARENT.get(name)
    # Joint offsets relative to the parent's joint, in metres.
    pj = PARTS[parent][1] if parent else [0, 0, 0]
    offset = [round((joint[i] - pj[i]) * SCALE, 3) for i in range(3)]
    report['parts'][name] = {
        'src': f'models/raid/colossus/{name}.gltf', 'parent': parent, 'offset': offset,
        'min': mn, 'max': mx, 'tris': len(obj.data.loop_triangles)
    }
    print(f'{name}: offset {offset} bounds {mn}..{mx} {len(obj.data.loop_triangles)} tris')
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, name + '.gltf'),
        export_format='GLTF_SEPARATE', use_selection=True, export_apply=True, export_yup=True,
        export_texture_dir='', export_image_format='AUTO', export_materials='EXPORT',
        export_normals=True, export_texcoords=True, export_animations=False, export_skins=False,
        export_morph=False, export_lights=False, export_cameras=False)
    kept[name] = obj

os.makedirs(os.path.join(ROOT, 'src', 'raid'), exist_ok=True)
with open(os.path.join(ROOT, 'src', 'raid', 'colossusParts.json'), 'w') as f:
    json.dump(report, f, indent=2)
print('COLOSSUS_DONE')

if PREVIEW:
    # Stand the segments at their joints (rest pose) and render from the front and the side.
    def place(name):
        obj = kept[name]
        parent = PARENT.get(name)
        if parent:
            place(parent)
            obj.parent = kept[parent]
        off = report['parts'][name]['offset']
        obj.location = (off[0], -off[2], off[1])  # glTF (x, y, z) -> Blender (x, -z, y)
    for name in PARTS:
        place(name)
    feet = min(gltf_bounds(kept[n])[0][1] + sum(report['parts'][p]['offset'][1] for p in ['chest'] + ([n] if n != 'chest' else [])) for n in ['leg_l_lower', 'leg_r_lower'])
    # Lift so the lower legs' soles rest on z = 0 (approximation: chest joint + leg joints).
    lift = -min(
        report['parts']['leg_l_upper']['offset'][1] + report['parts']['leg_l_lower']['offset'][1] + report['parts']['leg_l_lower']['min'][1],
        report['parts']['leg_r_upper']['offset'][1] + report['parts']['leg_r_lower']['offset'][1] + report['parts']['leg_r_lower']['min'][1])
    kept['chest'].location.z = lift
    print('chest height above ground', round(lift, 3))
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    bpy.ops.object.light_add(type='SUN', location=(0, 0, 30))
    bpy.context.active_object.data.energy = 4
    bpy.context.active_object.rotation_euler = (math.radians(45), math.radians(15), math.radians(20))
    w = bpy.data.worlds.new('w'); bpy.context.scene.world = w; w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND'); bg.inputs[0].default_value = (0.25, 0.28, 0.35, 1)
    try:
        bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        pass
    scene = bpy.context.scene
    scene.render.resolution_x = 1000; scene.render.resolution_y = 800
    for label, loc in [('front', (0, -30, 7)), ('side', (30, 0, 7)), ('back', (0, 30, 7))]:
        bpy.ops.object.camera_add(location=loc)
        cam = bpy.context.active_object
        cam.rotation_euler = mathutils.Vector((-loc[0], -loc[1], 0)).to_track_quat('-Z', 'Y').to_euler()
        cam.data.lens = 35
        scene.camera = cam
        scene.render.filepath = os.path.join(WORK, f'colossus-{label}.png')
        bpy.ops.render.render(write_still=True)
    print('PREVIEW', WORK)
