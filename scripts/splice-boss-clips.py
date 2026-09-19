"""
Stage 2 of the Warlord clip pipeline (plain Python, no Blender):

  python scripts/splice-boss-clips.py [--check] [--only clip,clip]

Reads the bare skeleton GLBs produced by scripts/export-boss-clips.py and
splices their per-bone tracks into the roaming body-part GLBs in TARGETS,
matching bones by name and leaving every existing byte of the target
(mesh, skin, bind matrices, existing clips) untouched. Timelines are
re-zeroed so each clip starts at t=0.

Weapons are single-joint skins and are handled afterwards by
scripts/bake-sword-clips.py, which samples hand_r from the spliced core.

--check only verifies that the FBX skeleton's rest pose matches each
target's bind pose (inverse bind matrices) and prints the report.

Spreading a clip to the whole wardrobe (no Blender, no FBX needed): take the
clips from a GLB that already carries them and splice into every
full-skeleton GLB under models/roaming that lacks them, e.g. the hero's roll:

  python scripts/splice-boss-clips.py --source models/roaming/customization/male/warm/core.glb \
      --only roll --targets roaming
"""
import argparse
import importlib.util
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLIP_DIR = ROOT / '.tmp-boss-anims/clips'
REPORT = ROOT / 'scripts/boss-clip-report.json'

TARGETS = [
    'models/roaming/customization/male/warm/core.glb',
    'models/roaming/customization/male/warm/chest.glb',
    'models/roaming/customization/male/warm/hands.glb',
    'models/roaming/customization/male/warm/legs.glb',
    'models/roaming/customization/male/warm/boots.glb',
    'models/roaming/customization/male/hair/none-brown.glb',
    'models/roaming/combat/equipment/brute-head-combat-v2.glb',
]
TOP_BONE = 'root'
# Leaf attachment bones whose orientation convention differs between the raw
# FBX and the original export. Nothing is skinned to them, so they stay at rest.
SKIP_BONES = {'prop_l', 'prop_r'}

_spec = importlib.util.spec_from_file_location('swordbake', ROOT / 'scripts/bake-sword-clips.py')
sb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sb)


# ------------------------------------------------------------------ math ---

def quat_conj(q):
    return (-q[0], -q[1], -q[2], q[3])


def trs_inverse(trs):
    t, r, s = trs
    inv_s = tuple(1.0 / c for c in s)
    inv_r = quat_conj(r)
    rt = sb.quat_rotate(inv_r, t)
    return (tuple(-c * k for c, k in zip(rt, inv_s)), inv_r, inv_s)


# ------------------------------------------------------------- hierarchy ---

def parents_of(gltf):
    parent = {}
    for i, n in enumerate(gltf['nodes']):
        for ch in n.get('children', []):
            parent[ch] = i
    return parent


def chain(gltf, parent, idx):
    out = []
    while idx is not None:
        out.append(idx)
        idx = parent.get(idx)
    out.reverse()
    return out


def rest_world(gltf, parent, idx, stop_below=None):
    """Rest transform of node idx composed from the scene root, or from the
    child of `stop_below` when given (i.e. in that node's local space)."""
    world = ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0), (1.0, 1.0, 1.0))
    nodes = chain(gltf, parent, idx)
    if stop_below is not None and stop_below in nodes:
        nodes = nodes[nodes.index(stop_below) + 1:]
    for node in nodes:
        world = sb.compose_trs(world, sb.node_rest(gltf['nodes'][node]))
    return world


def name_map(gltf):
    out = {}
    for i, n in enumerate(gltf['nodes']):
        out.setdefault(n.get('name'), i)
    return out


# ---------------------------------------------------------------- checks ---

def check_target(clip_gltf, target, target_bin):
    """Report joints the FBX does not drive, and how many vertices are skinned
    to joints we will not animate (those keep the target's rest pose)."""
    cnames = name_map(clip_gltf)
    skin = target['skins'][0]
    undriven = {}
    for j, node in enumerate(skin['joints']):
        name = target['nodes'][node].get('name')
        if name not in cnames or name in SKIP_BONES:
            undriven[j] = name
    weighted = 0
    for mesh in target.get('meshes', []):
        for prim in mesh['primitives']:
            attrs = prim['attributes']
            if 'JOINTS_0' not in attrs:
                continue
            joints = sb.read_accessor(target, target_bin, attrs['JOINTS_0'])
            weights = sb.read_accessor(target, target_bin, attrs['WEIGHTS_0'])
            for js, ws in zip(joints, weights):
                if any(j in undriven and w > 0 for j, w in zip(js, ws)):
                    weighted += 1
    return sorted(undriven.values()), weighted


# ---------------------------------------------------------------- splice ---

# Jitter below which a track is treated as static (rig units are centimetres).
CONST_EPS = {'translation': 2e-3, 'rotation': 1e-5, 'scale': 1e-4}


def is_constant(values, eps):
    first = values[0]
    return all(abs(a - b) <= eps for v in values for a, b in zip(v, first))


def clip_channels(clip_gltf, clip_bin, anim_index=0):
    anim = clip_gltf['animations'][anim_index]
    per_node = {}
    t0 = math.inf
    for ch in anim['channels']:
        s = anim['samplers'][ch['sampler']]
        times = sb.read_accessor(clip_gltf, clip_bin, s['input'])
        values = sb.read_accessor(clip_gltf, clip_bin, s['output'])
        t0 = min(t0, times[0][0])
        per_node.setdefault(ch['target']['node'], {})[ch['target']['path']] = (times, values)
    return per_node, (0.0 if t0 is math.inf else t0)


FRAME = 1 / 30

# Hero class clips assembled from the raw exports (src/combatAnimations.ts
# ClassMotion). Each part: (export name, start, end, blend) in the export's own
# seconds; start/end None = whole clip; `blend` is how long the pose takes to
# cross from the previous part's last frame into this one (one frame where the
# clips were authored to chain, longer where they were not).
CLASS_COMPOSITES = {
    # Raise the bow with an arrow nocked, draw, release and lower it again.
    'bow_shoot': [('bow_shoot__0', None, None, FRAME), ('bow_shoot__1', None, None, FRAME), ('bow_shoot__2', None, None, FRAME)],
    # Leaping shoot: aim, draw and release, then the plain shot's lowering instead of the kneel it lands in.
    'bow_volley': [('bow_volley', 0.9, 2.05, FRAME), ('bow_shoot__2', 0.55, None, 0.14)],
    # Blocking attack: the bash itself, from and back to the guard.
    'bow_bash': [('bow_bash', 0.2, 1.4, FRAME)],
    'bow_block': [('bow_block', None, None, FRAME)],
    # Point: raise the hand, hold a beat, lower it (the long hold in the middle is cut).
    'cast_bolt': [('cast_bolt', 0.15, 0.95, FRAME), ('cast_bolt', 1.75, 2.35, 0.1)],
    # Roar: crouch, throw the arms up, hold a beat, come down (the long hold is cut).
    'cast_nova': [('cast_nova', 0.3, 1.7, FRAME), ('cast_nova', 2.6, 3.5, 0.1)],
}
PATH_INDEX = {'translation': 0, 'rotation': 1, 'scale': 2}


def concat_clips(parts):
    """
    Join (trimmed) clip exports end to end into one clip. All parts share the
    rig, so tracks are joined per bone; a bone a part does not animate holds
    its rest pose (or its last value) for that stretch. `parts` are
    (gltf, bin, anim_index, start, end, blend). Returns (per_node, t0=0) in
    clip_channels' shape, plus the seam times (where each later part begins).
    """
    per_node = {}
    seams = []
    offset = 0.0
    first = True
    for gltf, bin_, ai, start, end, blend in parts:
        nodes, t0 = clip_channels(gltf, bin_, ai)
        clip_end = 0.0
        for paths in nodes.values():
            for times, _values in paths.values():
                clip_end = max(clip_end, times[-1][0] - t0)
        lo = 0.0 if start is None else start
        hi = clip_end if end is None else min(end, clip_end)
        # This part starts after its blend; the linear key interpolation
        # across the gap is the crossfade from the previous part's last frame.
        gap = 0.0 if first else blend
        offset += gap
        for node, paths in nodes.items():
            for path, (times, values) in paths.items():
                track = sb.Track(times, values, path == 'rotation')
                # Keys inside the trim window, re-zeroed to its start and shifted to this part's slot.
                keys = [(offset,)]
                vals = [track.sample(lo + t0)]
                for t, v in zip(times, values):
                    tt = t[0] - t0
                    # Strictly inside the window, with float slack: a key that rounds onto the
                    # window's edge would otherwise duplicate the edge key appended below.
                    if lo + 1e-4 < tt < hi - 1e-4:
                        keys.append((tt - lo + offset,))
                        vals.append(v)
                keys.append((hi - lo + offset,))
                vals.append(track.sample(hi + t0))
                slot = per_node.setdefault(node, {}).setdefault(path, ([], []))
                if not first and not slot[0]:
                    # First appearance: hold the rest pose through the earlier parts.
                    rest = sb.node_rest(gltf['nodes'][node])[PATH_INDEX[path]]
                    slot[0].extend([(0.0,), (offset - gap,)])
                    slot[1].extend([rest, rest])
                slot[0].extend(keys)
                slot[1].extend(vals)
        length = hi - lo
        # Bones animated earlier but not in this part: hold their last value.
        for node, paths in per_node.items():
            for path, (times, values) in paths.items():
                if node not in nodes or path not in nodes[node]:
                    times.append((offset + length,))
                    values.append(values[-1])
        offset += length
        seams.append(round(offset, 4))
        first = False
    return per_node, 0.0, seams[:-1]


def splice_clip(name, clip_gltf, clip_bin, target, target_bin, anim_index=0, channels=None):
    cp = parents_of(clip_gltf)
    cnames = name_map(clip_gltf)
    tnames = name_map(target)
    tp = parents_of(target)
    per_node, t0 = channels if channels else clip_channels(clip_gltf, clip_bin, anim_index)

    # Frame correction for the top bone: its parent differs between files
    # (Blender armature object vs SidekickCustomizationSharedRig).
    top_clip = cnames[TOP_BONE]
    top_target = tnames[TOP_BONE]
    arm_world = rest_world(clip_gltf, cp, cp[top_clip]) if top_clip in cp else ((0, 0, 0), (0, 0, 0, 1), (1, 1, 1))
    rig_world = rest_world(target, tp, tp[top_target]) if top_target in tp else ((0, 0, 0), (0, 0, 0, 1), (1, 1, 1))
    correction = sb.compose_trs(trs_inverse(rig_world), arm_world)  # target-parent <- clip-parent

    samplers = []
    channels = []
    duration = 0.0
    matched = 0
    skipped = []
    for cnode, paths in per_node.items():
        bone = clip_gltf['nodes'][cnode].get('name')
        if bone not in tnames or bone in SKIP_BONES:
            skipped.append(bone)
            continue
        tnode = tnames[bone]
        matched += 1
        rest_t, rest_r, rest_s = sb.node_rest(clip_gltf['nodes'][cnode])
        # Shared time base for this node: union of its channel key times.
        times = sorted({t[0] for p in paths.values() for t in p[0]})
        tracks = {p: sb.Track(v[0], v[1], p == 'rotation') for p, v in paths.items()}
        ts, rs, ss = [], [], []
        prev_r = None
        for t in times:
            lt = tracks['translation'].sample(t) if 'translation' in tracks else rest_t
            lr = tracks['rotation'].sample(t) if 'rotation' in tracks else rest_r
            ls = tracks['scale'].sample(t) if 'scale' in tracks else rest_s
            if bone == TOP_BONE:
                lt, lr, ls = sb.compose_trs(correction, (lt, lr, ls))
            if prev_r is not None and sum(a * b for a, b in zip(prev_r, lr)) < 0:
                lr = tuple(-c for c in lr)
            prev_r = lr
            ts.append(lt)
            rs.append(lr)
            ss.append(ls)
        keys = [(t - t0,) for t in times]
        duration = max(duration, keys[-1][0])
        full_acc = None
        const_acc = None
        for path, values, gtype in (('translation', ts, 'VEC3'), ('rotation', rs, 'VEC4'), ('scale', ss, 'VEC3')):
            if path not in paths:
                continue  # only emit tracks the source clip actually has
            if is_constant(values, CONST_EPS[path]):
                # Collapse static tracks to two keys; most translations/scales are.
                if const_acc is None:
                    const_acc = sb.append_accessor(target, target_bin, [keys[0], keys[-1]], 'SCALAR', with_minmax=True)
                t_acc = const_acc
                values = [values[0], values[-1]]
            else:
                if full_acc is None:
                    full_acc = sb.append_accessor(target, target_bin, keys, 'SCALAR', with_minmax=True)
                t_acc = full_acc
            acc = sb.append_accessor(target, target_bin, values, gtype)
            samplers.append({'input': t_acc, 'output': acc, 'interpolation': 'LINEAR'})
            channels.append({'sampler': len(samplers) - 1, 'target': {'node': tnode, 'path': path}})

    target.setdefault('animations', []).append({'name': name, 'samplers': samplers, 'channels': channels})
    return duration, matched, skipped, correction


def roaming_targets(source):
    """Every full-skeleton (has a `root` bone) GLB under models/roaming, except the source."""
    out = []
    for p in sorted((ROOT / 'models/roaming').rglob('*.glb')):
        if source is not None and p.resolve() == source.resolve():
            continue
        gltf, _ = sb.load_glb(p)
        if TOP_BONE in name_map(gltf):
            out.append(p.relative_to(ROOT).as_posix())
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--only', default='')
    ap.add_argument('--source', default='', help='take clips from this already-spliced GLB instead of the Blender exports')
    ap.add_argument('--targets', default='boss', choices=['boss', 'roaming'])
    args = ap.parse_args()
    only = {c for c in args.only.split(',') if c}

    # clips: name -> (gltf, bin, animation index)
    clips = {}
    source = ROOT / args.source if args.source else None
    if source is not None:
        sg, sbin = sb.load_glb(source)
        for i, anim in enumerate(sg.get('animations', [])):
            if only and anim['name'] not in only:
                continue
            clips[anim['name']] = (sg, sbin, i)
        if not clips:
            raise SystemExit(f'{source} has none of the requested clips')
    else:
        raw_names = {part[0] for parts in CLASS_COMPOSITES.values() for part in parts}
        raw = {}
        for p in sorted(CLIP_DIR.glob('*.glb')):
            if p.stem in raw_names or '__' in p.stem:
                raw[p.stem] = sb.load_glb(p)  # assembled below, never spliced as-is
                continue
            if only and p.stem not in only:
                continue
            cg, cb = sb.load_glb(p)
            clips[p.stem] = (cg, cb, 0)
        for name, parts in CLASS_COMPOSITES.items():
            if only and name not in only:
                continue
            if not all(part[0] in raw for part in parts):
                continue
            per_node, t0, seams = concat_clips([(*raw[export], 0, start, end, blend) for export, start, end, blend in parts])
            cg, cb = raw[parts[0][0]]
            clips[name] = (cg, cb, 0, (per_node, t0))
            print(f'composite {name}: {len(parts)} part(s), seams at {seams}')
        if not clips:
            raise SystemExit(f'no clip GLBs in {CLIP_DIR}; run export-boss-clips.py in Blender first')

    targets = TARGETS if args.targets == 'boss' else roaming_targets(source)
    report = {}
    any_clip = next(iter(clips.values()))[0]
    total_added = 0
    for rel in targets:
        path = ROOT / rel
        target, target_bin = sb.load_glb(path)
        existing = {a['name'] for a in target.get('animations', [])}
        if not args.check and all(name in existing for name in clips):
            continue
        undriven, weighted = check_target(any_clip, target, target_bin)
        print(f'{rel}')
        print(f'  undriven joints={len(undriven)} (vertices skinned to them: {weighted}){" " + str(undriven[:6]) if undriven else ""}')
        if args.check:
            continue
        added = 0
        for name, entry in clips.items():
            if name in existing:
                continue
            cg, cb, ai = entry[:3]
            duration, matched, skipped, corr = splice_clip(name, cg, cb, target, target_bin, ai, entry[3] if len(entry) > 3 else None)
            report.setdefault(name, {})[rel] = round(duration, 4)
            added += 1
            print(f'  + {name}: {duration:.3f}s bones={matched} unmatched={len(skipped)}')
        if added:
            sb.save_glb(path, target, target_bin)
            total_added += 1
        print(f'  -> {len(target.get("animations", []))} clips, {path.stat().st_size} bytes')

    if not args.check:
        durations = {name: max(v.values()) for name, v in report.items()}
        print(f'spliced into {total_added} file(s); durations {durations}')
        if args.targets == 'boss':
            REPORT.write_text(json.dumps({'durations': durations, 'per_target': report}, indent=2), encoding='utf-8')
            print('WROTE', REPORT)


if __name__ == '__main__':
    main()
