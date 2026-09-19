"""
Stage 1 of the Warlord clip pipeline (runs inside Blender):

  blender --background --python scripts/export-boss-clips.py

For each Synty sword-combat FBX listed in CLIPS, import it into an empty
scene and export the bare skeleton + sampled animation to
.tmp-boss-anims/clips/<clip>.glb. No retargeting happens here; the GLBs are
raw per-bone local TRS tracks in the FBX's own frame rate. Stage 2
(scripts/splice-boss-clips.py, plain Python) copies those tracks into the
untouched roaming GLBs by bone name.

Run scripts/extract-boss-anims.py first to unpack the FBX sources, or leave
the Synty ANIMATION_*_SourceFiles_*.zip packs in Downloads: a clip whose FBX
is not under .tmp-boss-anims is pulled out of the first zip that has its
Sidekick variant.

Hero class clips (bow, casts) live in CLASS_CLIPS. A list of FBX names is a
composite: each file is exported on its own as <clip>__<n>.glb and
scripts/splice-boss-clips.py joins them end to end into one clip.
"""
import os
import sys
import zipfile
import bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
FBX_DIR = os.path.join(ROOT, '.tmp-boss-anims')
OUT_DIR = os.path.join(FBX_DIR, 'clips')
DOWNLOADS = os.path.join(os.path.expanduser('~'), 'Downloads')

# Archer and spellblade motions (src/combatAnimations.ts ClassMotion). The bow
# pack's clips are `_Neut`; the idle/emote packs come in Masc/Femn and the
# hero core is the masculine rig.
CLASS_CLIPS = {
    # Raise the bow with an arrow nocked, draw, release and lower it again.
    'bow_shoot': ['A_MOD_BOW_Stand_Idle_BowDown_ToAiming_Neut.fbx', 'A_MOD_BOW_Stand_Aiming_ToDrawn_Neut.fbx', 'A_MOD_BOW_Stand_Shoot_ToBowDown_Neut.fbx'],
    'bow_volley': 'A_MOD_BOW_Stand_Shoot_Leaping_Neut.fbx',
    'bow_bash': 'A_MOD_BOW_Blocking_Attack_01_Neut.fbx',
    'bow_block': 'A_MOD_BOW_Blocking_Neut.fbx',
    'cast_bolt': 'A_MOD_IDL_PointHand_Index_F_Masc.fbx',
    'cast_nova': 'A_MOD_EMOT_Aggressive_Roar_High_Masc.fbx',
}

CLIPS = {
    'menace_enter': 'A_MOD_SWD_Idle_Menacing01_Enter_Neut.fbx',
    'menace': 'A_MOD_SWD_Idle_Menacing01_Loop_Neut.fbx',
    'flourish': 'A_MOD_SWD_Idle_Flourish01_Neut.fbx',
    'attack_light3': 'A_MOD_SWD_Attack_LightCombo01C_Neut.fbx',
    'flourish_heavy': 'A_MOD_SWD_Attack_HeavyFlourish01_Neut.fbx',
    # HeavyStab01 is already in every part as `attack_heavy`; `stab` aliases it in code.
    'heavy_combo_a': 'A_MOD_SWD_Attack_HeavyCombo01A_Neut.fbx',
    'heavy_combo_b': 'A_MOD_SWD_Attack_HeavyCombo01B_Neut.fbx',
    'heavy_combo_c': 'A_MOD_SWD_Attack_HeavyCombo01C_Neut.fbx',
    'leap': 'A_MOD_SWD_Attack_LightLeaping01_Neut.fbx',
    'fencing': 'A_MOD_SWD_Attack_LightFencing01_Neut.fbx',
    'roll': 'A_MOD_SWD_DodgeRoll_F_Neut.fbx',
    'stun': 'A_MOD_SWD_Stun_Enter_Neut.fbx',
}


def find_fbx(name):
    for root, _dirs, files in os.walk(FBX_DIR):
        if name in files and 'Sidekick' in root.replace('\\', '/'):
            return os.path.join(root, name)
    # Not unpacked yet: take it from whichever animation pack in Downloads has it.
    for zip_name in sorted(os.listdir(DOWNLOADS)):
        if not (zip_name.startswith('ANIMATION_') and zip_name.endswith('.zip')):
            continue
        with zipfile.ZipFile(os.path.join(DOWNLOADS, zip_name)) as z:
            for member in z.namelist():
                m = member.replace('\\', '/')
                if m.endswith('/' + name) and '/Sidekick/' in m:
                    out = os.path.join(FBX_DIR, m.replace('/', os.sep))
                    os.makedirs(os.path.dirname(out), exist_ok=True)
                    with z.open(member) as src, open(out, 'wb') as dst:
                        dst.write(src.read())
                    print(f'EXTRACT {name} <- {zip_name}', flush=True)
                    return out
    raise FileNotFoundError(name)


def find_armature():
    arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    if not arms:
        raise RuntimeError('no armature after FBX import')
    arms.sort(key=lambda o: len(o.data.bones), reverse=True)
    return arms[0]


def export_clip(clip, fbx_name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(
        filepath=find_fbx(fbx_name),
        automatic_bone_orientation=False,
        # Leaf bones (ball_*, finger tips, hair_dyn_*) are real, animated joints here.
        ignore_leaf_bones=False,
        use_anim=True,
        use_custom_props=False,
    )
    arm = find_armature()
    # Drop anything that is not the skeleton so the GLB stays tiny.
    for o in list(bpy.data.objects):
        if o is not arm:
            bpy.data.objects.remove(o, do_unlink=True)
    action = arm.animation_data.action if arm.animation_data else None
    if action is None:
        actions = sorted(bpy.data.actions, key=lambda a: a.frame_range[1] - a.frame_range[0], reverse=True)
        if not actions:
            raise RuntimeError(f'{fbx_name}: no action imported')
        action = actions[0]
        arm.animation_data_create()
        arm.animation_data.action = action
    for other in list(bpy.data.actions):
        if other is not action:
            bpy.data.actions.remove(other)
    action.name = clip
    scene = bpy.context.scene
    fps = scene.render.fps / max(scene.render.fps_base, 0.001)
    start, end = action.frame_range
    out = os.path.join(OUT_DIR, f'{clip}.glb')
    kwargs = dict(
        filepath=out,
        export_format='GLB',
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_nla_strips=False,
        export_force_sampling=True,
        export_optimize_animation_size=False,
        export_anim_single_armature=True,
        export_skins=False,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_apply=False,
    )
    try:
        bpy.ops.export_scene.gltf(**kwargs)
    except TypeError:
        kwargs.pop('export_nla_strips', None)
        bpy.ops.export_scene.gltf(**kwargs)
    print(f'EXPORT {clip}: {len(arm.data.bones)} bones, {fps:g} fps, frames {start:g}-{end:g} ({(end - start) / fps:.3f}s)', flush=True)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    # Optional args after `--`: clip names to restrict to, or `name=Some.fbx`
    # pairs to export ad-hoc clips (handy for comparing against existing ones).
    only = [a for a in sys.argv[sys.argv.index('--') + 1:] if a] if '--' in sys.argv else []
    extra = dict(a.split('=', 1) for a in only if '=' in a)
    only = [a for a in only if '=' not in a]
    for clip, fbx_name in {**CLIPS, **CLASS_CLIPS, **extra}.items():
        if (only or extra) and clip not in only and clip not in extra:
            continue
        if isinstance(fbx_name, list):
            for i, part in enumerate(fbx_name):
                export_clip(f'{clip}__{i}', part)
        else:
            export_clip(clip, fbx_name)
    print('DONE', flush=True)


if __name__ == '__main__':
    main()
