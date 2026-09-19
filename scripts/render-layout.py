"""Offline check of a generated layout: assembles the kit in Blender exactly as
the scene builder would and renders a top-down plan plus an eye-level shot.

  node -e "require('esbuild').build({entryPoints:['scripts/dump-layout.ts'],bundle:true,platform:'node',outfile:'/tmp/dump-layout.js'})"
  node /tmp/dump-layout.js 1337 /tmp/layout.json
  blender -b --python scripts/render-layout.py -- /tmp/layout.json /tmp/out

DCL (x, y, z) is Y-up left-handed; Blender is Z-up right-handed: (x, -z, y), yaw about Z.
"""
import bpy, json, math, os, sys

args = sys.argv[sys.argv.index("--") + 1:]
layout_path, out_dir = args[0], args[1]
os.makedirs(out_dir, exist_ok=True)
SCENE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(SCENE, "models", "dungeon")

with open(layout_path) as f:
    data = json.load(f)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

templates = {}
def template(kit_id, src=None):
    if kit_id in templates:
        return templates[kit_id]
    # Newer dumps carry the model path per placement (realm kits live under models/kits/<realm>/).
    path = os.path.join(SCENE, src.replace("/", os.sep)) if src else os.path.join(MODELS, kit_id + ".gltf")
    bpy.ops.import_scene.gltf(filepath=path)
    roots = [o for o in bpy.context.selected_objects if o.parent is None]
    if len(roots) > 1:
        bpy.ops.object.join()
        roots = [bpy.context.active_object]
    obj = roots[0]
    obj.hide_render = True; obj.hide_viewport = True
    templates[kit_id] = obj
    return obj

def tex_material(name, path, tint=None, scale=1.0):
    mat = bpy.data.materials.new(name); mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    tex = nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images.load(path, check_existing=True)
    if scale != 1.0:
        mapping = nodes.new('ShaderNodeMapping'); mapping.inputs['Scale'].default_value = (scale, scale, 1)
        coord = nodes.new('ShaderNodeTexCoord')
        mat.node_tree.links.new(coord.outputs['UV'], mapping.inputs['Vector'])
        mat.node_tree.links.new(mapping.outputs['Vector'], tex.inputs['Vector'])
    if tint:
        mix = nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1
        mix.inputs[7].default_value = (*tint, 1)
        mat.node_tree.links.new(tex.outputs['Color'], mix.inputs[6])
        mat.node_tree.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    else:
        mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 1
    return mat

style = data.get("style", {"tile": 2.5, "size": 28, "wallHeight": 3})
tile = style["tile"]; size = style["size"]
floor_tex = style.get("floorTexture")
floor_path = os.path.join(SCENE, floor_tex.replace("/", os.sep)) if floor_tex else os.path.join(MODELS, "floor_tiles.png")
floor_mat = tex_material("floor", floor_path, scale=max(1, round(tile / 2.5)))

def place(obj, p):
    obj.location = (p["x"], -p["z"], p["y"])
    obj.rotation_euler = (0, 0, math.radians(p.get("yaw", 0)))

for p in data["placements"]:
    k = p["kind"]
    if k == "ground" or k == "ceiling":
        continue
    if k == "floor":
        bpy.ops.mesh.primitive_plane_add(size=tile)
        o = bpy.context.active_object; place(o, p); o.data.materials.append(floor_mat)
    elif k == "kit":
        t = template(p["id"], p.get("src"))
        o = bpy.data.objects.new(p["id"], t.data)
        bpy.context.collection.objects.link(o)
        place(o, p)

# Sun + fill so the plan reads clearly.
bpy.ops.object.light_add(type='SUN', location=(0, 0, 50))
sun = bpy.context.active_object; sun.data.energy = 4; sun.rotation_euler = (math.radians(35), math.radians(10), math.radians(40))
world = bpy.data.worlds.new("w"); scene.world = world; world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND'); bg.inputs[0].default_value = (0.25, 0.28, 0.35, 1); bg.inputs[1].default_value = 0.8

try:
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
except TypeError:
    try:
        scene.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        pass
scene.render.resolution_x = 1280; scene.render.resolution_y = 1280

ent = data["entrance"]; boss = data["boss"]
origin = (96 - size * tile) / 2
def cell(x, y):
    return origin + (x + 0.5) * tile, origin + (y + 0.5) * tile

# 1. top-down plan
bpy.ops.object.camera_add(location=(48, -48, 120), rotation=(0, 0, 0))
cam = bpy.context.active_object; cam.data.type = 'ORTHO'; cam.data.ortho_scale = 76; cam.data.clip_end = 500
scene.camera = cam
scene.render.filepath = os.path.join(out_dir, "plan.png"); bpy.ops.render.render(write_still=True)

# 2. eye level from the entrance looking into the dungeon (-Z in DCL = +Y here)
ex, ez = cell(ent["x"] + (ent["w"] - 1) / 2, ent["y"] + (ent["h"] - 1) / 2)
bpy.ops.object.camera_add(location=(ex, -(ez + 0.8), 1.7 if style["wallHeight"] < 4 else 3.5), rotation=(math.radians(88 if style["wallHeight"] < 4 else 80), 0, 0))
cam2 = bpy.context.active_object; cam2.data.lens = 24; scene.camera = cam2
scene.render.resolution_x = 1280; scene.render.resolution_y = 720
scene.render.filepath = os.path.join(out_dir, "entrance.png"); bpy.ops.render.render(write_still=True)

# 3. inside the boss room, from its corner towards the centre
bx, bz = cell(boss["x"], boss["y"])
cx, cz = cell(boss["x"] + boss["w"] / 2 - 0.5, boss["y"] + boss["h"] / 2 - 0.5)
bpy.ops.object.camera_add(location=(bx - 0.6, -(bz - 0.6), 2.2))
cam3 = bpy.context.active_object; cam3.data.lens = 20
direction = (cx - cam3.location.x, -cz - cam3.location.y, 1.0 - cam3.location.z)
import mathutils
cam3.rotation_euler = mathutils.Vector(direction).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam3
scene.render.filepath = os.path.join(out_dir, "boss.png"); bpy.ops.render.render(write_still=True)

# 4. optional extra shots: --shot name,cellX,cellY,dirX,dirZ (looking direction in DCL space)
for spec in [a for a in args[2:] if a.startswith("shot=")]:
    name, cx_, cy_, dx, dz = spec[5:].split(",")
    px, pz = cell(float(cx_), float(cy_))
    bpy.ops.object.camera_add(location=(px, -pz, 1.7))
    cam = bpy.context.active_object; cam.data.lens = 22
    cam.rotation_euler = mathutils.Vector((float(dx), -float(dz), -0.05)).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    scene.render.filepath = os.path.join(out_dir, name + ".png"); bpy.ops.render.render(write_still=True)
print("RENDERED", out_dir)
