"""
Build a hero's armor set from a Sidekick preset (Blender, headless):

  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" -b --python scripts/build-hero-outfits.py -- [--previews] [--only scout,striker]

Driven by scripts/outfits/outfits.json: each hero names a .unitypackage in
~/Downloads, one of its presets (`Pack_0N.sk`) and a `set` prefix. The
preset's outfit parts are grouped into the wardrobe's six armor slots and
each slot becomes one skinned GLB that drops straight into the existing
modular hero (same rig, same bind frame, same clips):

  head      AttachmentHead, AttachmentFace
  chest     Torso, ArmUpper*, ArmLower*, AttachmentBack, AttachmentElbow*
  shoulders AttachmentShoulder*
  hands     Hand*
  legs      Hips, Leg*, AttachmentHips*, AttachmentKnee*
  boots     Foot*

Head, hair, eyes, ears, teeth and the like stay the player's own body parts.

A hero's `collectibles` list builds further presets of the same pack as
full sets under their own prefix (the class's outfits to find), and its
`extras` list adds single items from named parts (usually another preset's
helmet or pauldrons, with that preset's palette).

How the GLB is made (no Blender exporter involved, so nothing can drift):
every Sidekick part is skinned to the one shared bind pose, and every
wardrobe GLB carries the same joints and inverse bind matrices for it. So
the skeleton, rig node and clips are copied from scripts/clips/hero-clips.glb
(a full-joint wardrobe part) and only the mesh is new: Blender imports the
part FBXs, the vertices are read out of it (FBX centimetres -> metres, the
frame the wardrobe meshes already use), weights are mapped to joints by bone
name, and triangles whose palette cells are skin go to a separate untextured
primitive whose colour is the skin tone, exactly like the existing
scout-chest. Slots with skin get the four tone variants under
models/roaming/customization/armor/<tone>/; the others one file under
models/roaming/combat/equipment/. The clips kept are the hero set (bosses'
clips are not needed), and scripts/slim-roaming-clips.py's passes run on
the result so each file only carries animation for the joints it uses.

Also written: images/equipment/<set>-<slot>.png icons, src/outfitCatalog.json
(items with their `hero`, `set` and `realm`, skin-variant ids and the hero
defaults the game reads), and with
--previews a render of all six presets of each pack to .tmp-outfits/previews/.
"""
import importlib.util
import json
import os
import re
import struct
import sys
import tarfile
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'scripts/outfits/outfits.json'
TMP = ROOT / '.tmp-outfits'
DOWNLOADS = Path.home() / 'Downloads'
ICON_DIR = ROOT / 'images/equipment'
CATALOG = ROOT / 'src/outfitCatalog.json'


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


slim = load_module('slimclips', ROOT / 'scripts/slim-roaming-clips.py')
sb = slim.sb

SLOT_PARTS = {
    'head': {'AttachmentHead', 'AttachmentFace'},
    'chest': {'Torso', 'ArmUpperLeft', 'ArmUpperRight', 'ArmLowerLeft', 'ArmLowerRight', 'AttachmentBack', 'AttachmentElbowLeft', 'AttachmentElbowRight'},
    'shoulders': {'AttachmentShoulderLeft', 'AttachmentShoulderRight'},
    'hands': {'HandLeft', 'HandRight'},
    'legs': {'Hips', 'LegLeft', 'LegRight', 'AttachmentHipsLeft', 'AttachmentHipsRight', 'AttachmentHipsBack', 'AttachmentHipsFront', 'AttachmentKneeLeft', 'AttachmentKneeRight'},
    'boots': {'FootLeft', 'FootRight'},
}
SLOTS = ['head', 'chest', 'shoulders', 'hands', 'legs', 'boots']
# Palette cells (32x32 grid, glTF v down) the body parts use for skin.
SKIN_CELLS = {(0, 20), (0, 21)}
# Linear base colours of the four skin tones, as the body parts carry them.
SKIN_TONES = {
    'light': (0.8227857543962835, 0.5457244613701866, 0.3762621229909065),
    'warm': (0.6239603916750761, 0.2961382707983211, 0.15292615199615017),
    'tan': (0.39675523072562685, 0.14702726649759498, 0.07421356838014963),
    'deep': (0.1301364766903643, 0.05612849004960009, 0.03433980680868217),
}
DEFAULT_TONE = 'warm'
FBX_TO_M = 0.01

FLOAT, UBYTE, USHORT, UINT = 5126, 5121, 5123, 5125
ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER = 34962, 34963


# ------------------------------------------------------------ unitypackage ---

class UnityPackage:
    """A .unitypackage is a tar of <guid>/{asset,pathname}; index by basename."""

    def __init__(self, path):
        self.path = path
        self.cache = TMP / path.stem
        self.cache.mkdir(parents=True, exist_ok=True)
        index_file = self.cache / 'index.json'
        if index_file.exists():
            self.index = json.loads(index_file.read_text())
        else:
            self.index = {}
            with tarfile.open(path, 'r:gz') as tf:
                for m in tf:
                    if m.name.endswith('/pathname'):
                        guid = m.name.split('/')[0]
                        rel = tf.extractfile(m).read().decode('utf-8', 'replace').split('\n')[0]
                        self.index[os.path.basename(rel)] = guid
            index_file.write_text(json.dumps(self.index))

    def extract(self, basename):
        out = self.cache / basename
        if out.exists():
            return out
        guid = self.index.get(basename)
        if guid is None:
            raise SystemExit(f'{self.path.name} has no {basename}')
        with tarfile.open(self.path, 'r:gz') as tf:
            out.write_bytes(tf.extractfile(guid + '/asset').read())
        return out

    def presets(self):
        return sorted(n[:-3] for n in self.index if n.endswith('.sk') and 'Species' not in n)

    def preset_parts(self, preset):
        text = self.extract(preset + '.sk').read_text(encoding='utf-8', errors='replace')
        return [(kind, name) for name, kind in re.findall(r'- Name: (\S+)\n\s+PartType: (\S+)', text)]

    def palette(self, preset):
        return self.extract(f'T_{preset}ColorMap.png')


# ------------------------------------------------------------------ blender ---

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_part(fbx):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(fbx), automatic_bone_orientation=False, ignore_leaf_bones=False, use_anim=False)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers)]
    # A few parts (some hair) come in unparented at identity while their armature carries
    # the cm->m frame; the mesh data is in cm either way, so give them the rig's transform
    # for the renders (read_mesh reads the raw data and scales it itself).
    for o in meshes:
        arm = next(m.object for m in o.modifiers if m.type == 'ARMATURE' and m.object)
        o.matrix_world = arm.matrix_world
    return meshes


def palette_material(png):
    img = bpy.data.images.load(str(png))
    mat = bpy.data.materials.new('palette')
    mat.use_nodes = True
    tree = mat.node_tree
    tex = tree.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = 'Closest'
    bsdf = next(n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED')
    tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    tree.nodes.active = tex
    return mat


def apply_material(meshes, mat):
    for o in meshes:
        o.data.materials.clear()
        o.data.materials.append(mat)


def bounds(meshes):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for o in meshes:
        ev = o.evaluated_get(depsgraph)
        for v in ev.data.vertices:
            w = o.matrix_world @ v.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


def icon_subject(meshes, names):
    """One side of a paired slot (right hand, right boot, right pauldron) fills the icon better than both a metre apart."""
    right = [o for o, name in zip(meshes, names) if re.search(r'_\d\d(HNDR|FOTR|ASHR|AEBR|AKNR)_', name)]
    left = [o for o, name in zip(meshes, names) if re.search(r'_\d\d(HNDL|FOTL|ASHL|AEBL|AKNL)_', name)]
    if len(meshes) == len(right) + len(left) and (right or left):
        return right or left
    return meshes


def render(meshes, path, size, view_dir, transparent, margin=1.25):
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.hide_render = o not in meshes
    lo, hi = bounds(meshes)
    center = (lo + hi) / 2
    extent = max(hi.x - lo.x, hi.z - lo.z, 0.05)
    scene = bpy.context.scene
    cam_d = bpy.data.cameras.new('cam')
    cam_d.type = 'ORTHO'
    cam_d.ortho_scale = extent * margin
    cam_d.clip_end = 100
    cam = bpy.data.objects.new('cam', cam_d)
    scene.collection.objects.link(cam)
    scene.camera = cam
    view_dir = Vector(view_dir).normalized()
    cam.location = center + view_dir * 10
    cam.rotation_euler = view_dir.to_track_quat('Z', 'Y').to_euler()
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'TEXTURE'
    sh.show_backface_culling = False
    sh.show_shadows = False
    sh.show_cavity = True
    scene.render.film_transparent = transparent
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA' if transparent else 'RGB'
    scene.view_settings.view_transform = 'Standard'
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    bpy.data.cameras.remove(cam_d)


def uv_layer_index(me):
    """Sidekick parts carry two UV sets; the palette one is the first, but make sure it lands in palette cells."""
    return 0


def read_mesh(obj, joint_index):
    """
    Triangles of one part in the wardrobe's mesh frame: positions in metres,
    corner normals, palette UVs (glTF v), up to four joint weights by bone
    name. Returns (vertices, textured_tris, skin_tris) with vertices deduped.
    """
    me = obj.data
    if hasattr(me, 'calc_loop_triangles'):
        me.calc_loop_triangles()
    uv = me.uv_layers[uv_layer_index(me)].data
    # Bones the wardrobe rig lacks (a pack's extra dangle bones such as ashl_dyn_02)
    # are never animated by our clips, so weighting their ancestor instead is the
    # same pose with one joint fewer.
    arm = next(m.object for m in obj.modifiers if m.type == 'ARMATURE' and m.object)
    remapped = {}

    def resolve(name):
        bone = arm.data.bones.get(name)
        original = name
        while name not in joint_index and bone is not None and bone.parent is not None:
            bone = bone.parent
            name = bone.name
        if name not in joint_index:
            raise SystemExit(f'{obj.name}: bone {original} has no ancestor in the wardrobe rig')
        if name != original and original not in remapped:
            remapped[original] = name
            print(f'      {obj.name}: {original} -> {name}')
        return name

    group_name = {vg.index: resolve(vg.name) for vg in obj.vertex_groups}
    normals = me.corner_normals if hasattr(me, 'corner_normals') else None
    vertices = []
    lookup = {}
    tex_tris = []
    skin_tris = []
    weights_cache = {}
    for tri in me.loop_triangles:
        corner_ids = []
        cells = []
        for li, vi in zip(tri.loops, tri.vertices):
            v = me.vertices[vi]
            n = Vector(normals[li].vector if normals is not None else me.loops[li].normal)
            if n.length_squared < 1e-12:
                n = Vector(me.vertices[vi].normal)
            n.normalize()
            u = uv[li].uv
            if vi not in weights_cache:
                merged = {}
                for g in v.groups:
                    if g.weight > 0 and g.group in group_name:
                        merged[group_name[g.group]] = merged.get(group_name[g.group], 0.0) + g.weight
                named = sorted(merged.items(), key=lambda x: -x[1])[:4]
                total = sum(w for _, w in named) or 1.0
                weights_cache[vi] = tuple((joint_index[name], w / total) for name, w in named)
            ws = weights_cache[vi]
            gu, gv = u.x, 1.0 - u.y
            key = (round(v.co.x, 4), round(v.co.y, 4), round(v.co.z, 4), round(n.x, 3), round(n.y, 3), round(n.z, 3), round(gu, 5), round(gv, 5), ws)
            idx = lookup.get(key)
            if idx is None:
                idx = len(vertices)
                lookup[key] = idx
                vertices.append(((v.co.x * FBX_TO_M, v.co.y * FBX_TO_M, v.co.z * FBX_TO_M), (n.x, n.y, n.z), (gu, gv), ws))
            corner_ids.append(idx)
            cells.append((min(31, int(gu * 32)), min(31, int(gv * 32))))
        (skin_tris if all(c in SKIN_CELLS for c in cells) else tex_tris).append(tuple(corner_ids))
    return vertices, tex_tris, skin_tris


# --------------------------------------------------------------------- glb ---

def append_view(gltf, bin_, data, target=None):
    while len(bin_) % 4:
        bin_ += b'\x00'
    view = {'buffer': 0, 'byteOffset': len(bin_), 'byteLength': len(data)}
    if target is not None:
        view['target'] = target
    bin_ += data
    gltf['bufferViews'].append(view)
    return len(gltf['bufferViews']) - 1


def append_accessor(gltf, bin_, values, ctype, atype, fmt, target=None, minmax=False):
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[atype]
    data = b''.join(struct.pack('<' + fmt * n, *v) if n > 1 else struct.pack('<' + fmt, v) for v in values)
    acc = {'bufferView': append_view(gltf, bin_, data, target), 'componentType': ctype, 'count': len(values), 'type': atype}
    if minmax:
        acc['min'] = [min(v[i] for v in values) for i in range(n)]
        acc['max'] = [max(v[i] for v in values) for i in range(n)]
    gltf['accessors'].append(acc)
    return len(gltf['accessors']) - 1


def build_glb(reference, clips, vertices, tex_tris, skin_tris, palette_png, set_id, slot, tone, out_path):
    item = out_path.stem
    gltf = json.loads(json.dumps(reference[0]))
    bin_ = bytearray(reference[1])
    gltf['animations'] = [a for a in gltf.get('animations', []) if a['name'] in clips]
    gltf['asset'] = {'generator': 'DG build-hero-outfits: Sidekick preset on the shared wardrobe rig', 'version': '2.0'}

    positions = [v[0] for v in vertices]
    normals = [v[1] for v in vertices]
    uvs = [v[2] for v in vertices]
    joints = []
    weights = []
    for v in vertices:
        ws = list(v[3]) + [(0, 0.0)] * (4 - len(v[3]))
        joints.append(tuple(j for j, _ in ws))
        weights.append(tuple(w for _, w in ws))
    attributes = {
        'POSITION': append_accessor(gltf, bin_, positions, FLOAT, 'VEC3', 'f', ARRAY_BUFFER, minmax=True),
        'NORMAL': append_accessor(gltf, bin_, normals, FLOAT, 'VEC3', 'f', ARRAY_BUFFER),
        'TEXCOORD_0': append_accessor(gltf, bin_, uvs, FLOAT, 'VEC2', 'f', ARRAY_BUFFER),
        'JOINTS_0': append_accessor(gltf, bin_, joints, USHORT, 'VEC4', 'H', ARRAY_BUFFER),
        'WEIGHTS_0': append_accessor(gltf, bin_, weights, FLOAT, 'VEC4', 'f', ARRAY_BUFFER),
    }
    itype, ifmt = (USHORT, 'H') if len(vertices) < 65535 else (UINT, 'I')

    png = palette_png.read_bytes()
    gltf['samplers'] = [{'magFilter': 9728, 'minFilter': 9984}]
    gltf['images'] = [{'bufferView': append_view(gltf, bin_, png), 'mimeType': 'image/png', 'name': palette_png.stem}]
    gltf['textures'] = [{'sampler': 0, 'source': 0}]
    gltf['materials'] = [{
        'name': f'SidekickPalette-{set_id}', 'doubleSided': True,
        'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0, 'roughnessFactor': 0.75},
    }]
    primitives = []
    if tex_tris:
        idx = append_accessor(gltf, bin_, [i for t in tex_tris for i in t], itype, 'SCALAR', ifmt, ELEMENT_ARRAY_BUFFER)
        primitives.append({'attributes': attributes, 'indices': idx, 'material': 0})
    if skin_tris:
        gltf['materials'].append({
            'name': 'CustomizationArmorSkin',
            'pbrMetallicRoughness': {'baseColorFactor': [*SKIN_TONES[tone], 1], 'metallicFactor': 0, 'roughnessFactor': 0.8},
        })
        idx = append_accessor(gltf, bin_, [i for t in skin_tris for i in t], itype, 'SCALAR', ifmt, ELEMENT_ARRAY_BUFFER)
        primitives.append({'attributes': attributes, 'indices': idx, 'material': 1})
    gltf['meshes'] = [{'name': item, 'primitives': primitives}]
    mesh_node = next(n for n in gltf['nodes'] if 'mesh' in n)
    mesh_node['mesh'] = 0
    mesh_node['name'] = item

    slim.repair_inputs(gltf, bin_)
    slim.prune_unposed(gltf, bin_)
    slim.slim(gltf, bin_)
    slim.decimate(gltf, bin_)
    bin_ = slim.repack(gltf, bin_)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sb.save_glb(out_path, gltf, bin_)
    return out_path.stat().st_size


# -------------------------------------------------------------------- main ---

def build_hero(hero_id, hero, config, reference, joint_index):
    pack = UnityPackage(DOWNLOADS / hero['pack'])
    items = []
    skin_variants = []
    build_set(pack, hero_id, hero['preset'], hero['set'], hero['names'], hero['descriptions'], config, reference, joint_index, items, skin_variants)
    # Further presets of the same pack become collectible sets with their own
    # prefix, so a class has two more full outfits to find beyond its basic one.
    for coll in hero.get('collectibles', []):
        build_set(pack, hero_id, coll['preset'], coll['set'], coll['names'], coll['descriptions'], config, reference, joint_index, items, skin_variants)
    # Extra pieces from the pack's other presets, so a class has a pool to
    # collect from rather than one fixed look. An extra whose id is exactly
    # `<set>-<slot>` fills a slot the main preset left empty and becomes the
    # hero's default for it.
    palette = pack.palette(hero['preset'])
    for extra in hero.get('extras', []):
        pal = pack.palette(extra['palette']) if extra.get('palette') else palette
        build_item(pack, extra['id'], extra['slot'], extra['parts'], pal, extra['name'], extra['description'],
                   hero['set'], config, reference, joint_index, items, skin_variants)
    # Who wears it and where it is found: the game filters the wardrobe by class
    # and drops a set's pieces in its realm. The hero's own set has no realm: it
    # is the starter, always owned.
    realm_of = {hero['set']: ''}
    label_of = {hero['set']: hero['label']}
    for coll in hero.get('collectibles', []):
        realm_of[coll['set']] = coll.get('realm', 'fortress')
        label_of[coll['set']] = coll['label']
    for item in items:
        set_id = max((s for s in realm_of if item['id'].startswith(s + '-')), key=len)
        item['hero'] = hero_id
        item['set'] = set_id
        item['setLabel'] = label_of[set_id]
        item['realm'] = realm_of[set_id]
    return items, skin_variants


def hero_prefixes(hero):
    """Every item-id prefix this hero's build owns (its set, its collectible sets)."""
    return [hero['set'] + '-'] + [c['set'] + '-' for c in hero.get('collectibles', [])]


def build_set(pack, hero_id, preset, set_id, names, descriptions, config, reference, joint_index, items, skin_variants):
    """One preset -> up to six slot items prefixed `set_id-`."""
    parts = pack.preset_parts(preset)
    palette = pack.palette(preset)
    print(f'== {hero_id}: {preset} ({len(parts)} parts) -> {set_id}-*')
    for slot in SLOTS:
        wanted = [name for kind, name in parts if kind in SLOT_PARTS[slot]]
        # Presets may borrow a part from another Sidekick pack (a Knights preset
        # wears a Viking face piece); only what this pack ships can be built.
        missing = [name for name in wanted if name + '.fbx' not in pack.index]
        for name in missing:
            print(f'   {slot}: {name} is not in this pack, skipped')
        wanted = [name for name in wanted if name not in missing]
        if not wanted:
            print(f'   {slot}: preset has no parts for this slot')
            continue
        build_item(pack, f'{set_id}-{slot}', slot, wanted, palette, names[slot], descriptions[slot],
                   set_id, config, reference, joint_index, items, skin_variants)


def build_item(pack, item_id, slot, names, palette, name, description, set_id, config, reference, joint_index, items, skin_variants):
    """One inventory item: the named Sidekick parts merged into one GLB per tone (if it shows skin) plus its icon."""
    reset_scene()
    meshes = []
    mesh_names = []
    for part in names:
        imported = import_part(pack.extract(part + '.fbx'))
        meshes += imported
        mesh_names += [part] * len(imported)
    vertices, tex_tris, skin_tris = [], [], []
    for obj in meshes:
        v, t, s = read_mesh(obj, joint_index)
        base = len(vertices)
        vertices += v
        tex_tris += [tuple(i + base for i in tri) for tri in t]
        skin_tris += [tuple(i + base for i in tri) for tri in s]
    line = f'   {item_id}: {", ".join(names)}: {len(vertices)} verts, {len(tex_tris)} tris'
    if skin_tris:
        # Bare skin: one file per tone; the catalog's default is the warm one (the
        # game always resolves these through appearanceArmor, so no extra copy).
        for tone in SKIN_TONES:
            size = build_glb(reference, config['clips'], vertices, tex_tris, skin_tris, palette, set_id, slot, tone,
                             ROOT / f'models/roaming/customization/armor/{tone}/{item_id}.glb')
        default_path = ROOT / f'models/roaming/customization/armor/{DEFAULT_TONE}/{item_id}.glb'
        skin_variants.append(item_id)
        line += f' + {len(skin_tris)} skin tris (4 tones)'
    else:
        default_path = ROOT / f'models/roaming/combat/equipment/{item_id}.glb'
        size = build_glb(reference, config['clips'], vertices, tex_tris, skin_tris, palette, set_id, slot, DEFAULT_TONE, default_path)
    print(f'{line}; {size / 1e6:.2f} MB')
    apply_material(meshes, palette_material(palette))
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    render(icon_subject(meshes, mesh_names), ICON_DIR / f'{item_id}.png', (256, 256), (0.35, -1.0, 0.2), transparent=True, margin=1.1)
    items.append({
        'id': item_id,
        'name': name,
        'slot': slot,
        'description': description,
        'icon': f'images/equipment/{item_id}.png',
        'models': [default_path.relative_to(ROOT).as_posix()],
    })


def render_previews(config, only):
    out = TMP / 'previews'
    out.mkdir(parents=True, exist_ok=True)
    for hero_id, hero in config['heroes'].items():
        if only and hero_id not in only:
            continue
        pack = UnityPackage(DOWNLOADS / hero['pack'])
        for preset in pack.presets():
            reset_scene()
            meshes = []
            for kind, name in pack.preset_parts(preset):
                if name + '.fbx' not in pack.index:
                    # Presets may borrow a body part (a nose, say) from another Sidekick pack; the preview does without it.
                    print(f'   {preset}: {name} is not in this pack, skipped')
                    continue
                meshes += import_part(pack.extract(name + '.fbx'))
            apply_material(meshes, palette_material(pack.palette(preset)))
            path = out / f'{preset}.png'
            render(meshes, path, (384, 640), (0.45, -1.0, 0.15), transparent=False, margin=1.15)
            print(f'preview {path}')


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = set()
    if '--only' in argv:
        only = set(argv[argv.index('--only') + 1].split(','))
    config = json.loads(CONFIG.read_text(encoding='utf-8'))
    if '--previews' in argv:
        render_previews(config, only)
        return
    reference = sb.load_glb(ROOT / config['reference'])
    ref_gltf = reference[0]
    joint_index = {ref_gltf['nodes'][j]['name']: i for i, j in enumerate(ref_gltf['skins'][0]['joints'])}
    catalog = {'items': [], 'skinVariants': [], 'defaults': {}}
    if CATALOG.exists():
        catalog = json.loads(CATALOG.read_text(encoding='utf-8'))
    for hero_id, hero in config['heroes'].items():
        if only and hero_id not in only:
            continue
        items, skin_variants = build_hero(hero_id, hero, config, reference, joint_index)
        built = {i['id'] for i in items}
        prefixes = tuple(hero_prefixes(hero))
        catalog['items'] = [i for i in catalog['items'] if not i['id'].startswith(prefixes)] + items
        catalog['skinVariants'] = sorted((set(catalog['skinVariants']) - {i for i in catalog['skinVariants'] if i.startswith(prefixes)}) | set(skin_variants))
        catalog['defaults'][hero_id] = {slot: (f'{hero["set"]}-{slot}' if f'{hero["set"]}-{slot}' in built else f'none-{slot}') for slot in SLOTS}
    catalog['note'] = 'Generated by scripts/build-hero-outfits.py from scripts/outfits/outfits.json; do not edit.'
    CATALOG.write_text(json.dumps(catalog, indent=2) + '\n', encoding='utf-8')
    print('WROTE', CATALOG)


if __name__ == '__main__':
    main()
