"""
Retarget the hero's Synty clips onto the native Decentraland avatar rig and
export them as scene emotes (runs inside Blender):

  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" -b --python scripts/retarget-emotes.py -- [--only clip1,clip2] [--no-render]

Source: scripts/clips/hero-clips.glb, the Sidekick rig with every hero clip
(scripts/bake-sword-clips.py).
Target: Decentraland's BaseMale body (fetched from the catalyst once into
%TEMP%/dcl-rig), whose armature carries the Avatar_* deform bones an emote
must animate.

Both rigs rest in a T-pose, so each mapped bone takes the source bone's
rotation *away from its rest*, in armature space, and applies it to its own
rest orientation; the hips also take the source pelvis travel, scaled by the
hip-height ratio. Sampled at 30 fps, every deform bone keyed on every frame
(Decentraland wants the first and last at least), one clip per file:
animations/<clip>_emote.glb. A contact sheet of each clip is rendered to
%TEMP%/dcl-rig/preview/<clip>.png unless --no-render.
"""
import bpy
import math
import os
import sys
import urllib.request
from mathutils import Matrix, Vector

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
SOURCE = os.path.join(ROOT, 'scripts', 'clips', 'hero-clips.glb')
OUT_DIR = os.path.join(ROOT, 'animations')
WORK = os.path.join(os.environ.get('TEMP', '/tmp'), 'dcl-rig')
TARGET = os.path.join(WORK, 'BaseMale.glb')
PREVIEW = os.path.join(WORK, 'preview')
# Decentraland's BaseMale body shape: the armature is the avatar rig.
TARGET_URL = 'https://peer-ec1.decentraland.org/content/contents/bafkreicdlz2ab65lchjrciobzfsjsdjucydb2rudflujk5wxggp3h6443u'
FPS = 30

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ONLY = set(args[args.index('--only') + 1].split(',')) if '--only' in args else None
RENDER = '--no-render' not in args

# Emote name -> (source action, playback rate, seconds the last pose is held).
# Names are the game's EquipmentMotion ids (src/combatAnimations.ts), so
# src/nativeHero.ts can play `animations/<motion>_emote.glb` for a motion. The
# rate bakes COMBAT_CLIPS' hurried pacing into the file, since an emote plays at
# 1x. Locomotion (idle/walk/run/jump) stays the avatar's own and is not here.
# Death holds its last frame for the rest of the emote so the fallen stay down
# until the revive; a scene emote cannot be frozen on its last pose otherwise.
CLIPS = {
    'combat_idle': ('combat_idle', 1.0, 0),
    'attack_light': ('attack_light', 1.0, 0),
    'attack_light2': ('attack_light2', 1.0, 0),
    'attack_light3': ('attack_light3', 1.0, 0),
    'attack_heavy': ('attack_heavy', 1.0, 0),
    'stab': ('attack_heavy', 1.0, 0),
    'flourish_heavy': ('flourish_heavy', 1.0, 0),
    'heavy_combo_a': ('heavy_combo_a', 1.0, 0),
    'heavy_combo_b': ('heavy_combo_b', 1.0, 0),
    'heavy_combo_c': ('heavy_combo_c', 1.0, 0),
    'leap': ('leap', 1.0, 0),
    'fencing': ('fencing', 1.0, 0),
    'flourish': ('flourish', 1.0, 0),
    'menace': ('menace', 1.0, 0),
    'menace_enter': ('menace_enter', 1.0, 0),
    'roll': ('roll', 1.0, 0),
    'dodge_roll': ('roll', 1.5, 0),
    'stun': ('stun', 1.0, 0),
    'block': ('block', 1.0, 0),
    'hit': ('hit', 1.0, 0),
    'death': ('death', 1.0, 8.0),
    'bow_shoot': ('bow_shoot', 1.6, 0),
    'bow_volley': ('bow_volley', 1.2, 0),
    'bow_bash': ('bow_bash', 1.3, 0),
    'bow_block': ('bow_block', 1.0, 0),
    'cast_bolt': ('cast_bolt', 1.2, 0),
    'cast_nova': ('cast_nova', 1.2, 0),
}

# Decentraland deform bone -> Sidekick bone. Twist bones, attach points and the
# fourth finger joints (tips) have no counterpart and keep their rest pose.
# Clips that may play while the player moves (src/nativeHero.ts masks them to the
# upper body then): each also gets a <name>_upper_emote.glb solved for a rest pelvis.
UPPER = {
    'attack_light', 'attack_light2', 'attack_light3', 'attack_heavy', 'stab', 'flourish_heavy',
    'heavy_combo_a', 'heavy_combo_b', 'heavy_combo_c', 'leap', 'fencing', 'flourish', 'menace_enter',
    'hit', 'bow_shoot', 'bow_volley', 'bow_bash', 'cast_bolt', 'cast_nova'
}

BONES = {
    'Avatar_Hips': 'pelvis',
    'Avatar_Spine': 'spine_01', 'Avatar_Spine1': 'spine_02', 'Avatar_Spine2': 'spine_03',
    'Avatar_Neck': 'neck_01', 'Avatar_Head': 'head',
    'Avatar_LeftShoulder': 'clavicle_l', 'Avatar_LeftArm': 'upperarm_l', 'Avatar_LeftForeArm': 'lowerarm_l', 'Avatar_LeftHand': 'hand_l',
    'Avatar_RightShoulder': 'clavicle_r', 'Avatar_RightArm': 'upperarm_r', 'Avatar_RightForeArm': 'lowerarm_r', 'Avatar_RightHand': 'hand_r',
    'Avatar_LeftUpLeg': 'thigh_l', 'Avatar_LeftLeg': 'calf_l', 'Avatar_LeftFoot': 'foot_l', 'Avatar_LeftToeBase': 'ball_l',
    'Avatar_RightUpLeg': 'thigh_r', 'Avatar_RightLeg': 'calf_r', 'Avatar_RightFoot': 'foot_r', 'Avatar_RightToeBase': 'ball_r',
}
for side, s in (('Left', 'l'), ('Right', 'r')):
    for finger, f in (('Thumb', 'thumb'), ('Index', 'index'), ('Middle', 'middle'), ('Ring', 'ring'), ('Pinky', 'pinky')):
        for i in (1, 2, 3):
            BONES[f'Avatar_{side}Hand{finger}{i}'] = f'{f}_0{i}_{s}'


def log(*parts):
    print('[retarget]', *parts, flush=True)


def fetch_target():
    os.makedirs(WORK, exist_ok=True)
    if not os.path.exists(TARGET):
        log('fetching BaseMale.glb')
        urllib.request.urlretrieve(TARGET_URL, TARGET)


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == 'ARMATURE')
    return arm, new


def rotation_of(m):
    return m.to_3x3().normalized()


def retarget_clip(src, tgt, action, out_name, rate=1.0, hold=0.0, upper=False):
    """
    Bake one source action onto the target armature as a fresh action; returns (action, frames).

    `upper`: the variant for the renderer's upper-body mask, where the hips keep
    the avatar's own locomotion. The hips are left at rest and every child solves
    its local rotation against that, so the torso and arms land where they would
    have under the clip's own hips: a side-on archer still aims straight ahead
    with a forward-facing pelvis.
    """
    scene = bpy.context.scene
    src.animation_data_create()
    src.animation_data.action = action
    # The importer laid the clip out at the scene's fps (set to FPS before import); the
    # rate hurries it, and `hold` appends frames that repeat the last pose.
    played = max(2, int(round(action.frame_range[1] / rate)) + 1)
    frames = played + int(round(hold * FPS))

    tgt.animation_data_create()
    new_action = bpy.data.actions.new(out_name)
    tgt.animation_data.action = new_action
    # Blender 4.4+/5.x actions are slotted; make sure the armature has one to key into.
    if hasattr(new_action, 'slots') and hasattr(tgt.animation_data, 'action_slot'):
        slot = new_action.slots.new(id_type='OBJECT', name=tgt.name) if not len(new_action.slots) else new_action.slots[0]
        tgt.animation_data.action_slot = slot

    src_rest = {b.name: b.matrix_local.copy() for b in src.data.bones}
    tgt_rest = {b.name: b.matrix_local.copy() for b in tgt.data.bones}
    hip_scale = tgt_rest['Avatar_Hips'].to_translation().z / src_rest[BONES['Avatar_Hips']].to_translation().z
    # Parents first, so each bone's basis is solved against the pose we already gave its parent.
    order = []
    def walk(b):
        order.append(b.name)
        for c in b.children: walk(c)
    for b in tgt.data.bones:
        if b.parent is None: walk(b)

    for pb in tgt.pose.bones:
        pb.rotation_mode = 'QUATERNION'

    for i in range(frames):
        f = min(i, played - 1) * rate
        scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))
        pose = {}
        for name in order:
            bone = tgt.data.bones[name]
            rest = tgt_rest[name]
            parent = bone.parent
            if parent is not None:
                chain = pose[parent.name] @ tgt_rest[parent.name].inverted() @ rest
            else:
                chain = rest.copy()
            s_name = BONES.get(name)
            if s_name is None or s_name not in src.pose.bones:
                pose[name] = chain
                continue
            s_pose = src.pose.bones[s_name].matrix
            delta = rotation_of(s_pose) @ rotation_of(src_rest[s_name]).inverted()
            rot = (delta @ rotation_of(rest)).to_4x4()
            if parent is None and upper:
                desired = rest.copy()
            elif parent is None:
                travel = (s_pose.to_translation() - src_rest[s_name].to_translation()) * hip_scale
                trans = rest.to_translation() + travel
                desired = Matrix.Translation(trans) @ rot
            else:
                desired = Matrix.Translation(chain.to_translation()) @ rot
            pose[name] = desired
            basis = chain.inverted() @ desired
            pb = tgt.pose.bones[name]
            pb.rotation_quaternion = basis.to_quaternion()
            pb.keyframe_insert('rotation_quaternion', frame=i)
            if parent is None:
                pb.location = basis.to_translation()
                pb.keyframe_insert('location', frame=i)
        # Unmapped deform bones stay at rest, but must be keyed so nothing bleeds in from another emote.
        if i == 0 or i == frames - 1:
            for name in order:
                if BONES.get(name) is None:
                    pb = tgt.pose.bones[name]
                    pb.rotation_quaternion = (1, 0, 0, 0)
                    pb.location = (0, 0, 0)
                    pb.keyframe_insert('rotation_quaternion', frame=i)
                    pb.keyframe_insert('location', frame=i)
    # Keyed on every frame, so the curve shape between keys hardly matters; linear keeps the export honest.
    fcurves = []
    if hasattr(new_action, 'layers'):
        for layer in new_action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    fcurves.extend(bag.fcurves)
    else:
        fcurves = list(new_action.fcurves)
    for fc in fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
    return new_action, frames


def render_sheet(tgt, frames, name):
    """Five frames of the clip on the base body, side by side."""
    scene = bpy.context.scene
    os.makedirs(PREVIEW, exist_ok=True)
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        pass
    scene.render.resolution_x, scene.render.resolution_y = 300, 420
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = False
    world = scene.world or bpy.data.worlds.new('w')
    scene.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (0.18, 0.18, 0.2, 1)
    bg.inputs['Strength'].default_value = 1.0
    if 'sheet_sun' not in bpy.data.objects:
        sun = bpy.data.lights.new('sheet_sun', 'SUN'); sun.energy = 3
        so = bpy.data.objects.new('sheet_sun', sun); scene.collection.objects.link(so)
        so.rotation_euler = (math.radians(50), 0, math.radians(-40))
        cam = bpy.data.cameras.new('sheet_cam'); cam.lens = 45
        co = bpy.data.objects.new('sheet_cam', cam); scene.collection.objects.link(co)
        co.location = (2.2, -4.2, 1.5)
        target = Vector((0, 0, 0.95))
        co.rotation_euler = (target - co.location).to_track_quat('-Z', 'Y').to_euler()
        scene.camera = co
    picks = [int(round(k * (frames - 1) / 4)) for k in range(5)]
    paths = []
    for k, fr in enumerate(picks):
        scene.frame_set(fr)
        p = os.path.join(PREVIEW, f'{name}_{k}.png')
        scene.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append(p)
    # Stitch with Blender's own image API (no PIL in Blender's Python).
    w, h = 300, 420
    sheet = bpy.data.images.new(f'{name}_sheet', w * 5, h)
    pixels = [0.0] * (w * 5 * h * 4)
    for k, p in enumerate(paths):
        img = bpy.data.images.load(p)
        px = list(img.pixels)
        for y in range(h):
            row = px[y * w * 4:(y + 1) * w * 4]
            start = (y * w * 5 + k * w) * 4
            pixels[start:start + w * 4] = row
        bpy.data.images.remove(img)
        os.remove(p)
    sheet.pixels = pixels
    sheet.filepath_raw = os.path.join(PREVIEW, f'{name}.png')
    sheet.file_format = 'PNG'
    sheet.save()
    log('sheet', sheet.filepath_raw)


def export_emote(tgt, action, frames, name, keep=()):
    """The armature alone with this one clip, Y-up glTF binary, sampled every frame."""
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = 0, frames - 1
    tgt.animation_data.action = action
    for a in list(bpy.data.actions):
        if a is not action and a not in keep:
            bpy.data.actions.remove(a)
    action.name = name
    bpy.ops.object.select_all(action='DESELECT')
    tgt.select_set(True)
    bpy.context.view_layer.objects.active = tgt
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, f'{name}_emote.glb')
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='ACTIVE_ACTIONS', export_force_sampling=True,
        export_frame_range=True, export_frame_step=1, export_optimize_animation_size=False,
        export_skins=False, export_apply=False, export_yup=True,
        export_materials='NONE', export_texcoords=False, export_normals=False)
    name_animation(out, name)
    log('wrote', out, f'{frames} frames', f'{os.path.getsize(out) // 1024} KB')


def name_animation(path, name):
    """ACTIVE_ACTIONS export calls the clip 'Animation'; give it the clip's name like the actions did."""
    import json
    import struct
    data = open(path, 'rb').read()
    json_len = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + json_len])
    for anim in doc.get('animations', []):
        anim['name'] = name
    body = json.dumps(doc, separators=(',', ':')).encode('utf-8')
    body += b' ' * ((4 - len(body) % 4) % 4)
    rest = data[20 + json_len:]
    total = 12 + 8 + len(body) + len(rest)
    with open(path, 'wb') as f:
        f.write(b'glTF' + struct.pack('<II', 2, total) + struct.pack('<I', len(body)) + b'JSON' + body + rest)


def main():
    fetch_target()
    for name, (clip, rate, hold) in CLIPS.items():
        if ONLY and name not in ONLY:
            continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        scene = bpy.context.scene
        scene.render.fps = FPS
        tgt, tgt_objs = import_glb(TARGET)
        src, src_objs = import_glb(SOURCE)
        action = bpy.data.actions.get(clip)
        if action is None:
            log('missing source clip', clip, 'have', sorted(a.name for a in bpy.data.actions))
            continue
        # The source rig only drives the target; hide it from renders.
        for o in src_objs:
            o.hide_render = True
        new_action, frames = retarget_clip(src, tgt, action, name, rate, hold)
        log(name, f'{frames} frames at {FPS} fps')
        if RENDER:
            render_sheet(tgt, frames, name)
        upper_action = None
        if name in UPPER:
            upper_action, _ = retarget_clip(src, tgt, action, f'{name}_upper', rate, hold, upper=True)
            if RENDER:
                render_sheet(tgt, frames, f'{name}_upper')
        # Drop the source rig and the body meshes: the emote is the armature and its clip.
        for o in src_objs:
            bpy.data.objects.remove(o, do_unlink=True)
        for o in tgt_objs:
            if o.type == 'MESH':
                bpy.data.objects.remove(o, do_unlink=True)
        export_emote(tgt, new_action, frames, name, keep=(upper_action,) if upper_action else ())
        if upper_action:
            export_emote(tgt, upper_action, frames, f'{name}_upper')


main()
