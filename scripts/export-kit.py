"""Exports the Dark Fortress kit pieces used by the dungeon builder.

Unzip POLYGON_Dark_Fortress_SourceFiles_v4.zip somewhere (it contains FBX/ and
Texture/ folders), then from the scene folder run:

  blender -b --python scripts/export-kit.py -- <path-to-unzipped-source-files>

Writes one .gltf per module into models/dungeon/ sharing a 1024px atlas,
emissive map and brick texture. Each piece is recentred on its footprint with
its base at y = 0 (banner: top at y = 0) and its detailed face towards +Z.
"""
import bpy, os, sys, json, mathutils
SRC = sys.argv[sys.argv.index("--") + 1]
FBX = os.path.join(SRC, "FBX")
TEX = os.path.join(SRC, "Texture")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "dungeon")

# (output name, fbx name, anchor) anchor: 'base' = footprint centre + base at 0, 'top' = footprint centre + top at 0
MODULES = [
    ("wall_a", "SM_Bld_Wall_01", "base"),
    ("wall_b", "SM_Bld_Wall_03", "base"),
    ("wall_door", "SM_Bld_Wall_Door_Double_01", "base"),
    ("pillar", "SM_Bld_L_Pillar_Half_02", "base"),
    ("torch_wall", "SM_Prop_Torch_02", "base"),
    ("torch_stand", "SM_Prop_Torch_07", "base"),
    ("urn", "SM_Prop_Urn_02", "base"),
    ("skulls", "SM_Prop_Skull_Pile_02", "base"),
    ("table", "SM_Prop_Table_01", "base"),
    ("chair", "SM_Prop_Chair_01", "base"),
    ("crystal", "SM_Prop_Crystal_01", "base"),
    ("rune", "SM_Prop_Rune_01", "base"),
    ("cage", "SM_Prop_Cage_01", "base"),
    ("brazier", "SM_Prop_Brazier_03", "base"),
    ("banner", "SM_Prop_Banner_01", "top"),
    ("chest", "SM_Prop_Chest_01", "base"),
    # 5 m x 6 m "L" series for the open, third-person style
    ("wall_l_a", "SM_Bld_Wall_L_03", "base"),
    ("wall_l_b", "SM_Bld_Wall_L_02", "base"),
    ("wall_l_window", "SM_Bld_Wall_L_Window_01", "base"),
    ("wall_l_door", "SM_Bld_Wall_L_Door_01", "base"),
    ("pillar_l", "SM_Bld_L_Pillar_02", "base"),
    ("statue", "SM_Prop_Statue_02", "base"),
    ("rubble", "SM_Env_Rubble_Pile_01", "base"),
    ("bones", "SM_Env_Bones_01", "base"),
    # 5 m wall with a 3.8 m wide arched opening: the open style's doorway
    ("wall_l_arch", "SM_Bld_Wall_Door_Large_03", "base"),
    # 2 m parapet used for camera-facing walls when the crawler camera is on
    ("parapet", "SM_Bld_Battlements_01", "base"),
]

bpy.ops.wm.read_factory_settings(use_empty=True)

def load_scaled(path, size, name):
    img = bpy.data.images.load(path, check_existing=True)
    img.name = name
    if img.size[0] > size:
        img.scale(size, size)
    img.pack()
    return img

atlas = load_scaled(os.path.join(TEX, "Alts", "PolygonDarkFortress_Texture_01_A.png"), 1024, "DarkFortress_Atlas")
emis = load_scaled(os.path.join(TEX, "Emissive", "PolygonDarkFortress_Emissive_01_A.png"), 512, "DarkFortress_Emissive")
brick = load_scaled(os.path.join(TEX, "Env", "Brick_Large_Texture_01.png"), 1024, "DarkFortress_Brick")

def make_mat(name, img, emissive=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    tex = nodes.new('ShaderNodeTexImage'); tex.image = img
    mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.9
    bsdf.inputs['Metallic'].default_value = 0.0
    if emissive is not None:
        et = nodes.new('ShaderNodeTexImage'); et.image = emissive
        mat.node_tree.links.new(et.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = 1.0
    return mat

MAT_ATLAS = make_mat("DarkFortress_Mat", atlas, emis)
MAT_BRICK = make_mat("DarkFortress_Brick", brick)

def pick_material(slot_name):
    s = slot_name.lower()
    if 'brick' in s or s.startswith('a_wall'):
        return MAT_BRICK
    return MAT_ATLAS

report = {}
for out_name, fbx_name, anchor in MODULES:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.join(FBX, fbx_name + ".fbx"))
    objs = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in objs if o.type == 'MESH']
    # apply transforms so bounds are in world space
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    mn = mathutils.Vector((1e9,)*3); mx = mathutils.Vector((-1e9,)*3)
    uv_info = {}
    for o in meshes:
        for v in o.bound_box:
            w = o.matrix_world @ mathutils.Vector(v)
            mn = mathutils.Vector(map(min, mn, w)); mx = mathutils.Vector(map(max, mx, w))
        for i, slot in enumerate(o.material_slots):
            nm = slot.material.name if slot.material else slot.name
            uvl = o.data.uv_layers.active
            if uvl:
                us = [uvl.data[l].uv for p in o.data.polygons if p.material_index == i for l in p.loop_indices]
                if us:
                    uv_info[nm] = [round(min(u.x for u in us),2), round(max(u.x for u in us),2), round(min(u.y for u in us),2), round(max(u.y for u in us),2)]
            rng = uv_info.get(nm)
            tiling = rng is not None and (rng[1] - rng[0]) > 0.6
            slot.material = MAT_BRICK if (tiling or pick_material(nm) is MAT_BRICK) else MAT_ATLAS
            # Synty tiles these slots in world space (triplanar); the 5 m pieces
            # map one brick texture over twice the area, so repeat it to match.
            repeat = round((mx.x - mn.x) / 2.5)
            if slot.material is MAT_BRICK and repeat > 1 and uvl:
                for p in o.data.polygons:
                    if p.material_index == i:
                        for l in p.loop_indices:
                            uvl.data[l].uv = uvl.data[l].uv * repeat
    cx = (mn.x + mx.x) / 2; cy = (mn.y + mx.y) / 2
    dz = -mn.z if anchor == 'base' else -mx.z
    for o in meshes:
        o.location.x -= cx; o.location.y -= cy; o.location.z += dz
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # drop empties/armatures, then join meshes into one object
    for o in [o for o in objs if o.type != 'MESH']:
        bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = out_name
    obj.data.calc_loop_triangles()
    report[out_name] = {"fbx": fbx_name, "size_xyz_glTF": [round(mx.x-mn.x,3), round(mx.z-mn.z,3), round(mx.y-mn.y,3)], "tris": len(obj.data.loop_triangles), "uv": uv_info}
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, out_name + ".gltf"),
        export_format='GLTF_SEPARATE',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texture_dir="",
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
print("REPORT" + json.dumps(report))
