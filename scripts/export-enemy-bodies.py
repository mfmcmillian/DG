"""
Export solid enemy bodies from the Synty POLYGON packs (runs inside Blender):

  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" -b --python scripts/export-enemy-bodies.py -- [--only id1,id2] [--no-render] [--reclip]

Driven by scripts/enemy-bodies.json; packs, zips and palettes come from
scripts/weapons-manifest.json so a body and its blade are looked up the same way.

  1. Clips: every POLYGON-rig FBX in CLIPS (Synty Sword Combat + Base
     Locomotion packs) is imported once and exported as a bare skeleton GLB
     with sampled tracks to %TEMP%/dg-enemies/clips/<clip>.glb (kept between
     runs; --reclip rebuilds them).
  2. Body: the character FBX comes out of its pack zip, one mesh is kept
     (`mesh` for pack-wide Characters.fbx files), the pack atlas is applied,
     and the weapon mesh is placed in the right hand using the grip solved for
     the Sidekick hero (HAND_FROM_FBX / INVERSE_BIND from build-weapons.py,
     moved onto this rig's Hand_R) and skinned 100% to Hand_R. Blender's
     duplicate-bone suffixes (.001) are renamed to the animation packs' (_1).
     Exported as a GLB without animations.
  3. Splice: scripts/splice-boss-clips.py copies each clip's per-bone tracks
     into that GLB by bone name (absolute local TRS, so rest poses never
     matter), with the Hips travel scaled to this character's hip height so
     dwarves do not float. Result: models/enemies/<realm>/<id>.glb.
  4. Preview: the finished GLB is re-imported and rendered mid combat_idle to
     %TEMP%/dg-enemies/preview/<id>.png.
Finally src/enemyBodies.json (id -> path, height, tris) is regenerated;
equipmentAvatar.ts treats these ids as one-piece bodies.
"""
import bpy
import importlib.util
import json
import math
import os
import shutil
import sys
import zipfile
from mathutils import Matrix, Vector

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
MANIFEST = os.path.join(ROOT, 'scripts', 'enemy-bodies.json')
WEAPONS = os.path.join(ROOT, 'scripts', 'weapons-manifest.json')
CATALOG = os.path.join(ROOT, 'src', 'enemyBodies.json')
OUT_ROOT = os.path.join(ROOT, 'models', 'enemies')
DOWNLOADS = os.path.join(os.path.expanduser('~'), 'Downloads')
WORK = os.path.join(os.environ.get('TEMP', '/tmp'), 'dg-enemies')
CLIP_DIR = os.path.join(WORK, 'clips')
BODY_DIR = os.path.join(WORK, 'bodies')
PREVIEW = os.path.join(WORK, 'preview')
TEXTURE_SIZE = 1024
FPS = 30
TOP_BONE = 'Root'

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ONLY = set(args[args.index('--only') + 1].split(',')) if '--only' in args else None
RENDER = '--no-render' not in args
RECLIP = '--reclip' in args

SWORD = 'ANIMATION_Sword_Combat_SourceFiles_v5.zip'
LOCO = 'ANIMATION_Base_Locomotion_SourceFiles_v3.zip'
SWD = 'SourceFiles/Animations/Polygon/'
BL = 'SourceFiles/Animations/Polygon/Masculine/'

# glb clip name -> (zip, member). Names match EQUIPMENT_CLIPS in src/combatAnimations.ts.
CLIPS = {
    'A_MOD_BL_Idle_Standing_Masc': (LOCO, BL + 'Idle/A_Idle_Standing_Masc.fbx'),
    'A_MOD_BL_Walk_F_Masc': (LOCO, BL + 'Locomotion/Walk/A_Walk_F_Masc.fbx'),
    'A_MOD_BL_Run_F_Masc': (LOCO, BL + 'Locomotion/Run/A_Run_F_Masc.fbx'),
    'combat_idle': (SWORD, SWD + 'Idle/Base/A_Idle_Base_Sword.fbx'),
    'attack_light': (SWORD, SWD + 'Attack/LightCombo01/A_Attack_LightCombo01A_Sword.fbx'),
    'attack_light2': (SWORD, SWD + 'Attack/LightCombo01/A_Attack_LightCombo01B_Sword.fbx'),
    'attack_light3': (SWORD, SWD + 'Attack/LightCombo01/A_Attack_LightCombo01C_Sword.fbx'),
    'attack_heavy': (SWORD, SWD + 'Attack/HeavyStab01/A_Attack_HeavyStab01_Sword.fbx'),
    'flourish_heavy': (SWORD, SWD + 'Attack/HeavyFlourish01/A_Attack_HeavyFlourish01_Sword.fbx'),
    'heavy_combo_a': (SWORD, SWD + 'Attack/HeavyCombo01/A_Attack_HeavyCombo01A_Sword.fbx'),
    'heavy_combo_b': (SWORD, SWD + 'Attack/HeavyCombo01/A_Attack_HeavyCombo01B_Sword.fbx'),
    'heavy_combo_c': (SWORD, SWD + 'Attack/HeavyCombo01/A_Attack_HeavyCombo01C_Sword.fbx'),
    'leap': (SWORD, SWD + 'Attack/LightLeaping01/A_Attack_LightLeaping01_Sword.fbx'),
    'fencing': (SWORD, SWD + 'Attack/LightFencing01/A_Attack_LightFencing01_Sword.fbx'),
    'flourish': (SWORD, SWD + 'Idle/Fidgets/A_Idle_Flourish01_Sword.fbx'),
    'menace': (SWORD, SWD + 'Idle/Menacing01/A_Idle_Menacing01_Sword.fbx'),
    'menace_enter': (SWORD, SWD + 'Idle/Menacing01/A_Idle_Menacing01_Begin_Sword.fbx'),
    'roll': (SWORD, SWD + 'Dodge/A_DodgeRoll_F_Sword.fbx'),
    'stun': (SWORD, SWD + 'Hit/Stun/A_Stun_Begin_Sword.fbx'),
    'block': (SWORD, SWD + 'Block/A_Block_Loop_Sword.fbx'),
    'hit': (SWORD, SWD + 'Hit/HitReact/A_Hit_F_React_Sword.fbx'),
    'death': (SWORD, SWD + 'Death/A_Death_F_01_Sword.fbx'),
}
TPOSE = (LOCO, 'SourceFiles/Animations/Polygon/Neutral/Additive/TPose/A_TPose_Neut.fbx')
# Authored lengths the game assumes (src/combatAnimations.ts), in frames at 30 fps; reported, not enforced.
EXPECTED_FRAMES = {
    'A_MOD_BL_Idle_Standing_Masc': 53, 'A_MOD_BL_Walk_F_Masc': 31, 'A_MOD_BL_Run_F_Masc': 21, 'combat_idle': 53,
    'attack_light': 24, 'attack_light2': 20, 'attack_light3': 22, 'attack_heavy': 41, 'flourish_heavy': 61,
    'heavy_combo_a': 61, 'heavy_combo_b': 50, 'heavy_combo_c': 48, 'leap': 47, 'fencing': 36, 'flourish': 53,
    'menace': 53, 'menace_enter': 40, 'roll': 35, 'stun': 27, 'block': 53, 'hit': 25, 'death': 44,
}

# From build-weapons.py: Blender-import FBX frame (Z up, metres, grip at origin) ->
# the Sidekick hero's T-pose right hand in the glTF frame (Y up, metres).
HAND_FROM_FBX = Matrix((
    (-0.74256, 0.02177, -0.66943, -0.81071),
    (0.09439, -0.98610, -0.13676, 1.32897),
    (-0.66310, -0.16474, 0.73018, -0.05549),
    (0.0, 0.0, 0.0, 1.0)))
# Sidekick hand_r inverse bind (centimetres).
INVERSE_BIND = Matrix((
    (50.29, -56.5723, -65.3492, 105.282),
    (-81.2492, -5.1479, -58.0695, -58.7914),
    (29.487, 82.2989, -48.5532, -89.1958),
    (0.0, 0.0, 0.0, 1.0)))
YUP = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))

# The grip's offset from the wrist joint in the Sidekick T-pose (Blender Z-up world, metres),
# and the blade's orientation there. Both rigs T-pose palm-down with the arms along X, so the
# same world offset and orientation carry over to the POLYGON wrist.
SK_WEAPON_WORLD = YUP.inverted() @ HAND_FROM_FBX
# inverse(IBM) maps joint space back to mesh space, so its translation is already metres.
SK_HAND_WORLD = (YUP.inverted() @ INVERSE_BIND.inverted()).to_translation()
GRIP_FROM_WRIST = SK_WEAPON_WORLD.to_translation() - SK_HAND_WORLD
BLADE_ROTATION = SK_WEAPON_WORLD.to_3x3().to_4x4()

REQUIRED_BONES = {'Root', 'Hips', 'Spine_01', 'Head', 'Hand_R', 'Hand_L', 'UpperLeg_L', 'UpperLeg_R'}


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


splice = load_module('splice_boss_clips', os.path.join(ROOT, 'scripts', 'splice-boss-clips.py'))
splice.TOP_BONE = TOP_BONE
splice.SKIP_BONES = {'Prop_L', 'Prop_R'}
sb = splice.sb


# ------------------------------------------------------------------ sources ---

def extract(zip_name, member):
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


def pack_atlas(pack):
    palettes = pack['palettes']
    return palettes.get('base') or next(iter(palettes.values()))


# ------------------------------------------------------------------ blender ---

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS


def import_fbx(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False, ignore_leaf_bones=False, use_custom_props=False)
    return [o for o in bpy.data.objects if o not in before]


def armature_of(objects):
    arms = [o for o in objects if o.type == 'ARMATURE']
    if not arms:
        raise RuntimeError('no armature imported')
    arms.sort(key=lambda o: len(o.data.bones), reverse=True)
    return arms[0]


def bone_world_head(arm, name):
    return arm.matrix_world @ arm.data.bones[name].head_local


def export_clips():
    """Bare skeleton + sampled tracks per clip, once. `tpose` is the retarget reference, not a game clip."""
    os.makedirs(CLIP_DIR, exist_ok=True)
    print('clips:')
    for clip, (zip_name, member) in {**CLIPS, 'tpose': TPOSE}.items():
        out = os.path.join(CLIP_DIR, f'{clip}.glb')
        if os.path.exists(out) and not RECLIP:
            continue
        reset_scene()
        objs = import_fbx(extract(zip_name, member))
        arm = armature_of(objs)
        for o in list(bpy.data.objects):
            if o is not arm:
                bpy.data.objects.remove(o, do_unlink=True)
        action = arm.animation_data.action if arm.animation_data else None
        if action is None:
            raise RuntimeError(f'{member}: no action imported')
        action.name = clip
        start, end = action.frame_range
        frames = int(round(end - start))
        expected = EXPECTED_FRAMES.get(clip)
        flag = '' if expected is None or abs(frames - expected) <= 1 else f'  <-- game assumes {expected}'
        bpy.ops.export_scene.gltf(
            filepath=out, export_format='GLB', export_animations=True, export_animation_mode='ACTIONS',
            export_force_sampling=True, export_optimize_animation_size=False, export_anim_single_armature=True,
            export_skins=False, export_morph=False, export_cameras=False, export_lights=False, export_extras=False,
            export_apply=False
        )
        print(f'  {clip:28s} {frames:3d} frames{flag}')


def make_material(pack_key, atlas_png, size=TEXTURE_SIZE):
    mat = bpy.data.materials.new(f'{pack_key}-atlas')
    mat.use_nodes = True
    mat.use_backface_culling = False
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = 0.7
    # Scale once to a file of our own; the exporter copies an image's file as-is, and its
    # name becomes the shared PNG next to the .gltf files.
    scaled = os.path.join(WORK, 'textures', f'atlas-{pack_key}-{size}.png')
    if not os.path.exists(scaled):
        os.makedirs(os.path.dirname(scaled), exist_ok=True)
        src = bpy.data.images.load(atlas_png)
        if max(src.size) > size:
            src.scale(size, size)
        src.filepath_raw = scaled
        src.file_format = 'PNG'
        src.save()
        bpy.data.images.remove(src)
    img = bpy.data.images.load(scaled)
    img.name = f'atlas-{pack_key}-{size}'
    # Synty palettes keep an emission mask in the alpha channel; it is not transparency.
    img.alpha_mode = 'NONE'
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    return mat


def import_weapon_mesh(fbx):
    objs = import_fbx(fbx)
    meshes = [o for o in objs if o.type == 'MESH']
    for o in objs:
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return obj


def attach_weapon(arm, weapon, like, grip, mirror):
    """Move the weapon mesh into Hand_R (world), set up exactly like the imported body mesh `like`
    (same parent and parent-inverse), and skin it 100% to Hand_R so the exporter treats both alike."""
    wrist = bone_world_head(arm, 'Hand_R')
    offset = Vector(GRIP_FROM_WRIST)
    rotation = BLADE_ROTATION
    if mirror:
        flip = Matrix.Rotation(math.pi, 4, 'Z')
        offset = flip.to_3x3() @ offset
        rotation = flip @ rotation
    shift = Matrix.Translation(Vector((0, 0, -grip))) if grip else Matrix.Identity(4)
    placement = Matrix.Translation(wrist + offset) @ rotation @ shift
    weapon.parent = arm
    weapon.matrix_parent_inverse = like.matrix_parent_inverse.copy()
    weapon.matrix_basis = like.matrix_basis.copy()
    bpy.context.view_layer.update()
    # Vertices were world-space (transform applied on import); re-express them so this object's world equals the placement.
    weapon.data.transform(weapon.matrix_world.inverted() @ placement)
    weapon.data.update()
    vg = weapon.vertex_groups.new(name='Hand_R')
    vg.add(list(range(len(weapon.data.vertices))), 1.0, 'REPLACE')
    mod = weapon.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm


def rename_duplicate_bones(arm):
    """Blender suffixes a second `Thumb_01` as `Thumb_01.001`; the animation FBX files call it `Thumb_01_1`."""
    renamed = 0
    for bone in arm.data.bones:
        if bone.name.endswith('.001'):
            bone.name = bone.name[:-4] + '_1'
            renamed += 1
    return renamed


def scene_bounds(objs):
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    for o in objs:
        for c in o.bound_box:
            p = o.matrix_world @ Vector(c)
            lo = Vector((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
            hi = Vector((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
    return lo, hi


def export_body_glb(path):
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_yup=True, export_apply=True,
        export_animations=False, export_skins=True, export_def_bones=False, export_morph=False,
        export_materials='EXPORT', export_image_format='AUTO',
        export_texcoords=True, export_normals=True, export_tangents=False,
        export_cameras=False, export_lights=False, export_extras=False
    )


# ----------------------------------------------------------------- retarget ---
# The animation FBX rig and the character rigs share bone names but not joint
# frames, so local rotations cannot be copied. Instead every joint's world
# rotation is taken from the clip and mapped onto the character with a per-joint
# offset solved where both rigs are known to agree: the T-pose (A_TPose_Neut on
# the animation rig, the bind pose on the character).

IDENTITY = ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0), (1.0, 1.0, 1.0))


def quat_inv(q):
    return (-q[0], -q[1], -q[2], q[3])


def node_order(gltf, parents):
    """Nodes parents-first."""
    order = []
    seen = set()

    def visit(i):
        if i in seen:
            return
        p = parents.get(i)
        if p is not None:
            visit(p)
        seen.add(i)
        order.append(i)

    for i in range(len(gltf['nodes'])):
        visit(i)
    return order


class Rig:
    def __init__(self, gltf, bin_, anim_index=None):
        self.gltf = gltf
        self.bin = bin_
        self.parents = splice.parents_of(gltf)
        self.order = node_order(gltf, self.parents)
        self.names = splice.name_map(gltf)
        self.tracks = {}
        self.times = []
        if anim_index is not None and gltf.get('animations'):
            per_node, t0 = splice.clip_channels(gltf, bin_, anim_index)
            self.t0 = t0
            times = set()
            for node, paths in per_node.items():
                self.tracks[node] = {p: sb.Track(v[0], v[1], p == 'rotation') for p, v in paths.items()}
                for v in paths.values():
                    times.update(t[0] for t in v[0])
            self.times = sorted(times)

    def local(self, node, t):
        rest_t, rest_r, rest_s = sb.node_rest(self.gltf['nodes'][node])
        tr = self.tracks.get(node)
        if not tr or t is None:
            return rest_t, rest_r, rest_s
        return (tr['translation'].sample(t) if 'translation' in tr else rest_t,
                tr['rotation'].sample(t) if 'rotation' in tr else rest_r,
                tr['scale'].sample(t) if 'scale' in tr else rest_s)

    def world(self, t=None):
        out = {}
        for node in self.order:
            parent = self.parents.get(node)
            out[node] = sb.compose_trs(out[parent] if parent is not None else IDENTITY, self.local(node, t))
        return out


def anim_name_for(name, anim_names):
    """Character bone -> animation rig bone name. Knights suffix fingers _L/_R; the animation rig repeats the right hand as *_1."""
    if name in anim_names:
        return name
    if name.endswith('_L') and name[:-2] in anim_names:
        return name[:-2]
    if name.endswith('_R') and name[:-2] + '_1' in anim_names:
        return name[:-2] + '_1'
    return None


def retarget_clip(name, clip, tpose_world, body, body_rest, offsets, mapping, hips_ratio, target, target_bin):
    times = clip.times
    keys = [(t - clip.t0,) for t in times]
    hips_b = body.names['Hips']
    root_b = body.parents.get(hips_b)
    root_a = clip.parents.get(clip.names['Hips'])
    rot_tracks = {node: [] for node in mapping}
    hips_track = []
    for t in times:
        wa = clip.world(t)
        wb = {}
        for node in body.order:
            parent = body.parents.get(node)
            parent_w = wb[parent] if parent is not None else IDENTITY
            lt, lr, ls = sb.node_rest(body.gltf['nodes'][node])
            a = clip.names.get(mapping[node]) if node in mapping else None
            if a is not None:
                target_r = sb.quat_normalize(sb.quat_mul(wa[a][1], offsets[node]))
                lr = sb.quat_normalize(sb.quat_mul(quat_inv(parent_w[1]), target_r))
                rot_tracks[node].append(lr)
            if node == hips_b and root_a is not None and root_b is not None:
                # Hip travel: the clip's hips relative to its root, in world, scaled to this character.
                off = tuple(h - r for h, r in zip(wa[clip.names['Hips']][0], wa[root_a][0]))
                off = tuple(c * hips_ratio for c in off)
                local = sb.quat_rotate(quat_inv(parent_w[1]), off)
                lt = tuple(c / s if abs(s) > 1e-9 else c for c, s in zip(local, parent_w[2]))
                hips_track.append(lt)
            wb[node] = sb.compose_trs(parent_w, (lt, lr, ls))

    samplers = []
    channels = []
    time_acc = sb.append_accessor(target, target_bin, keys, 'SCALAR', with_minmax=True)
    const_acc = None

    def emit(node, path, values, gtype, eps):
        nonlocal const_acc
        if len(values) > 1 and splice.is_constant(values, eps):
            if const_acc is None:
                const_acc = sb.append_accessor(target, target_bin, [keys[0], keys[-1]], 'SCALAR', with_minmax=True)
            t_acc, values = const_acc, [values[0], values[-1]]
        else:
            t_acc = time_acc
        acc = sb.append_accessor(target, target_bin, values, gtype)
        samplers.append({'input': t_acc, 'output': acc, 'interpolation': 'LINEAR'})
        channels.append({'sampler': len(samplers) - 1, 'target': {'node': node, 'path': path}})

    for node, values in rot_tracks.items():
        fixed = []
        prev = None
        for q in values:
            if prev is not None and sum(a * b for a, b in zip(prev, q)) < 0:
                q = tuple(-c for c in q)
            fixed.append(q)
            prev = q
        emit(node, 'rotation', fixed, 'VEC4', 1e-5)
    if hips_track:
        emit(hips_b, 'translation', hips_track, 'VEC3', 2e-3)
    target.setdefault('animations', []).append({'name': name, 'samplers': samplers, 'channels': channels})
    return keys[-1][0] if keys else 0.0


def load_rig(path, anim_index=None):
    gltf, bin_ = sb.load_glb(path)
    return Rig(gltf, bin_, anim_index)


def splice_all(body_glb, out_glb):
    target, target_bin = sb.load_glb(body_glb)
    target.pop('animations', None)
    body = Rig(target, target_bin)
    body_rest = body.world()

    tpose = load_rig(os.path.join(CLIP_DIR, 'tpose.glb'), 0)
    tpose_world = tpose.world(tpose.times[0])

    mapping = {}
    offsets = {}
    for name, node in body.names.items():
        a = anim_name_for(name, tpose.names)
        if a is None or name in splice.SKIP_BONES or node not in body_rest:
            continue
        mapping[node] = a
        offsets[node] = sb.quat_normalize(sb.quat_mul(quat_inv(tpose_world[tpose.names[a]][1]), body_rest[node][1]))
    hips_a = tpose.names['Hips']
    root_a = tpose.parents[hips_a]
    hips_b = body.names['Hips']
    root_b = body.parents[hips_b]
    dist = lambda w, a, b: math.sqrt(sum((x - y) ** 2 for x, y in zip(w[a][0], w[b][0])))
    hips_ratio = dist(body_rest, hips_b, root_b) / max(dist(tpose_world, hips_a, root_a), 1e-6)
    check = {
        'anim Hand_R': tuple(round(c, 2) for c in tpose_world[tpose.names['Hand_R']][0]),
        'body Hand_R': tuple(round(c, 2) for c in body_rest[body.names['Hand_R']][0]),
    }

    report = []
    for clip in CLIPS:
        rig = load_rig(os.path.join(CLIP_DIR, f'{clip}.glb'), 0)
        duration = retarget_clip(clip, rig, tpose_world, body, body_rest, offsets, mapping, hips_ratio, target, target_bin)
        report.append((clip, duration))
    unmatched = sorted(n for n in joint_names(target) if body.names.get(n) not in mapping)
    os.makedirs(os.path.dirname(out_glb), exist_ok=True)
    sb.save_glb(out_glb, target, bytes(target_bin))
    return report, len(mapping), unmatched, hips_ratio, check


def finish_gltf(spliced_glb, out_gltf):
    gltf, bin_ = sb.load_glb(spliced_glb)
    return write_gltf_separate(gltf, bytes(bin_), out_gltf)


def joint_names(gltf):
    out = set()
    for skin in gltf.get('skins', []):
        for j in skin['joints']:
            out.add(gltf['nodes'][j].get('name'))
    return out


# --------------------------------------------------------- gltf + shared png ---

def write_gltf_separate(gltf, bin_, out_gltf):
    """Write <id>.gltf + <id>.bin, moving embedded images out to <realm>/<image name>.png so bodies of a realm share their atlases."""
    out_dir = os.path.dirname(out_gltf)
    stem = os.path.splitext(os.path.basename(out_gltf))[0]
    drop = set()
    for image in gltf.get('images', []):
        if 'bufferView' not in image:
            continue
        view = gltf['bufferViews'][image['bufferView']]
        data = bin_[view['byteOffset']:view['byteOffset'] + view['byteLength']]
        ext = '.png' if image.get('mimeType', 'image/png').endswith('png') else '.jpg'
        name = image.get('name') or f'image{image["bufferView"]}'
        with open(os.path.join(out_dir, name + ext), 'wb') as f:
            f.write(data)
        drop.add(image['bufferView'])
        image.pop('bufferView')
        image['uri'] = name + ext
    # Repack the buffer without the image views, remapping every bufferView index.
    new_bin = bytearray()
    remap = {}
    views = []
    for i, view in enumerate(gltf['bufferViews']):
        if i in drop:
            continue
        while len(new_bin) % 4:
            new_bin += b'\x00'
        start = len(new_bin)
        new_bin += bin_[view['byteOffset']:view['byteOffset'] + view['byteLength']]
        remap[i] = len(views)
        views.append({**view, 'byteOffset': start})
    gltf['bufferViews'] = views
    for acc in gltf.get('accessors', []):
        if 'bufferView' in acc:
            acc['bufferView'] = remap[acc['bufferView']]
    gltf['buffers'] = [{'uri': stem + '.bin', 'byteLength': len(new_bin)}]
    with open(os.path.join(out_dir, stem + '.bin'), 'wb') as f:
        f.write(new_bin)
    with open(out_gltf, 'w', encoding='utf-8') as f:
        json.dump(gltf, f, separators=(',', ':'))
    return len(new_bin) + os.path.getsize(out_gltf)


# ------------------------------------------------------------------ preview ---

def render_preview(glb, path):
    """Re-import the finished GLB and render it mid combat_idle from the front-right."""
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=glb)
    arm = armature_of(list(bpy.data.objects))
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    action = bpy.data.actions.get('combat_idle')
    if action is not None:
        if arm.animation_data is None:
            arm.animation_data_create()
        arm.animation_data.action = action
        if hasattr(arm.animation_data, 'action_slot') and len(getattr(action, 'slots', [])):
            arm.animation_data.action_slot = action.slots[0]
        start, end = action.frame_range
        bpy.context.scene.frame_set(int(start + (end - start) * 0.4))
    bpy.context.view_layer.update()
    lo, hi = scene_bounds(meshes)
    center = (lo + hi) / 2
    height = hi.z - lo.z
    scene = bpy.context.scene
    cam_d = bpy.data.cameras.new('preview-cam')
    cam_d.type = 'ORTHO'
    cam_d.ortho_scale = height * 1.3
    cam = bpy.data.objects.new('preview-cam', cam_d)
    scene.collection.objects.link(cam)
    scene.camera = cam
    view_dir = Vector((0.6, -1.0, 0.3)).normalized()
    cam.location = center + view_dir * (height * 4 + 1)
    cam.rotation_euler = view_dir.to_track_quat('Z', 'Y').to_euler()
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'TEXTURE'
    sh.show_backface_culling = False
    sh.show_shadows = False
    sh.show_cavity = True
    scene.render.film_transparent = False
    scene.render.resolution_x = 512
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'Standard'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


# ------------------------------------------------------------------- main ---

def build(body, packs, characters, weapons):
    pack = packs[body['pack']]
    weapon_spec = weapons[body['weapon']]
    weapon_pack = packs[weapon_spec['pack']]
    chr_fbx = extract(pack['zip'], characters[body['pack']]['fbx'].format(name=body.get('fbx', '')))
    wep_fbx = extract(weapon_pack['zip'], weapon_pack['fbx'].format(name=weapon_spec['mesh']))

    reset_scene()
    objs = import_fbx(chr_fbx)
    arm = armature_of(objs)
    arm.name = body['id']
    meshes = [o for o in objs if o.type == 'MESH']
    # Keep only skinned parts. Packs ship stray helper meshes, and bone-parented extras
    # (Knights' pouch and sheath) export with a transform this pipeline does not track.
    kept = []
    for o in meshes:
        if any(m.type == 'ARMATURE' for m in o.modifiers):
            kept.append(o)
        else:
            print(f"  {body['id']}: dropping unskinned mesh {o.name}")
            bpy.data.objects.remove(o, do_unlink=True)
    meshes = kept
    if body.get('mesh'):
        keep = [o for o in meshes if o.name == body['mesh']]
        if not keep:
            raise RuntimeError(f"{body['id']}: mesh {body['mesh']} not in {chr_fbx}; have {[o.name for o in meshes]}")
        for o in meshes:
            if o not in keep:
                bpy.data.objects.remove(o, do_unlink=True)
        meshes = keep
    for o in list(bpy.data.objects):
        if o.type not in ('MESH', 'ARMATURE') or (o.type == 'ARMATURE' and o is not arm):
            bpy.data.objects.remove(o, do_unlink=True)
    missing = REQUIRED_BONES - set(b.name for b in arm.data.bones)
    if missing:
        raise RuntimeError(f"{body['id']}: rig lacks {sorted(missing)}")
    rename_duplicate_bones(arm)

    body_mat = make_material(body['pack'], extract(pack['zip'], pack_atlas(pack)))
    for o in meshes:
        o.data.materials.clear()
        o.data.materials.append(body_mat)

    hand_r = bone_world_head(arm, 'Hand_R')
    hand_l = bone_world_head(arm, 'Hand_L')
    mirror = hand_r.x > hand_l.x
    if mirror:
        print(f"  {body['id']}: Hand_R on +X, mirroring grip")

    weapon = import_weapon_mesh(wep_fbx)
    weapon.name = f"{body['id']}-{body['weapon']}"
    palette = weapon_pack['palettes'][weapon_spec['palette']]
    # A blade from another pack brings its own atlas; it is small on screen, so ship it at half size.
    weapon_mat = body_mat if weapon_spec['pack'] == body['pack'] and palette == pack_atlas(pack) \
        else make_material(weapon_spec['pack'], extract(weapon_pack['zip'], palette), TEXTURE_SIZE // 2)
    weapon.data.materials.clear()
    weapon.data.materials.append(weapon_mat)
    attach_weapon(arm, weapon, meshes[0], weapon_spec.get('grip', 0), mirror)

    lo, hi = scene_bounds(meshes)
    tris = sum(len(p.vertices) - 2 for o in meshes + [weapon] for p in o.data.polygons)
    os.makedirs(BODY_DIR, exist_ok=True)
    body_glb = os.path.join(BODY_DIR, f"{body['id']}.glb")
    export_body_glb(body_glb)

    spliced = os.path.join(BODY_DIR, f"{body['id']}-spliced.glb")
    report, joints, unmatched, hips_ratio, check = splice_all(body_glb, spliced)
    if RENDER:
        os.makedirs(PREVIEW, exist_ok=True)
        render_preview(spliced, os.path.join(PREVIEW, f"{body['id']}.png"))
    out = os.path.join(OUT_ROOT, body['realm'], f"{body['id']}.gltf")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    size = finish_gltf(spliced, out)
    print(f"  {body['id']}: height {hi.z - lo.z:.2f} m, hips x{hips_ratio:.2f}, {tris} tris, {len(report)} clips on {joints} joints, "
          f"{size // 1024} KB + shared atlas; T-pose check {check}; undriven joints: {unmatched or 'none'}")
    return {'path': os.path.relpath(out, ROOT).replace(os.sep, '/'), 'height': round(hi.z - lo.z, 3), 'tris': tris}


def main():
    with open(MANIFEST) as f:
        manifest = json.load(f)
    with open(WEAPONS) as f:
        weapons_manifest = json.load(f)
    packs = weapons_manifest['packs']
    weapons = {w['id']: w for w in weapons_manifest['weapons']}
    catalog = {}
    if os.path.exists(CATALOG):
        with open(CATALOG) as f:
            catalog = json.load(f)

    export_clips()
    for body in manifest['bodies']:
        if ONLY and body['id'] not in ONLY:
            continue
        print(f"body {body['id']} ({body.get('fbx') or body.get('mesh')} + {body['weapon']})")
        catalog[body['id']] = build(body, packs, manifest['characters'], weapons)

    ordered = {b['id']: catalog[b['id']] for b in manifest['bodies'] if b['id'] in catalog}
    with open(CATALOG, 'w') as f:
        json.dump(ordered, f, indent=2)
        f.write('\n')
    print('wrote', os.path.relpath(CATALOG, ROOT))


main()
