"""
Bake the Hall of Antrom's folk (src/hallFolk.ts) into one GLB each:

  python scripts/build-hall-folk.py [--only folk-herald,folk-squire]

A folk in hero wardrobe costs what a hero costs: nine GLBs (core, hair, six
armor pieces, weapon), each carrying the whole 31-clip combat set so the
parts stay in step. Eight of them were ~70 files, ~65 MB and ~2,200 clips on
entering the hall, and remote heroes started dropping out under the load.

So each folk becomes a single file, built from the very parts they would
wear (scripts/folk/folk.json names the set, weapon and appearance), with only
the clips they play (their `motions`, as src/combatAnimations.ts names them):

  - The skeleton and the clips come from scripts/clips/hero-clips.glb, the
    full-joint template every wardrobe part was built against; clips not in
    the folk's list are dropped.
  - Every part's mesh, materials and textures are copied in. Each keeps its
    own skin (its own inverse bind matrices) with the joints re-pointed by
    name at the template's nodes, so it deforms exactly as it does today.
  - The weapon is a Sidekick attachment: one baked `hand_r`/`hand_l` joint
    with the hand's world-space path per clip. That joint comes in as a node
    of its own at the scene root, and its channels are appended to the clips
    it belongs to, so the blade rides the hand as it does in the hero.
  - scripts/slim-roaming-clips.py's passes then run on the result (unposed
    joints, constant tracks, key decimation, repack).

Written: models/folk/<id>.glb and src/folkBodies.json, which
equipmentAvatar reads as solid bodies (one GLB, no parts to assemble).
"""
import copy
import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'scripts/folk/folk.json'
TEMPLATE = ROOT / 'scripts/clips/hero-clips.glb'
OUT_DIR = ROOT / 'models/folk'
BODIES = ROOT / 'src/folkBodies.json'


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


slim = load_module('slimclips', ROOT / 'scripts/slim-roaming-clips.py')
sb = slim.sb

ARMOR_SLOTS = ['head', 'chest', 'shoulders', 'hands', 'legs', 'boots']
SKIN_SLOTS = {'chest', 'hands', 'legs', 'boots'}


def equipment_clips():
    """EquipmentMotion -> GLB clip name, read from src/combatAnimations.ts."""
    src = (ROOT / 'src/combatAnimations.ts').read_text(encoding='utf-8')
    block = src.split('export const EQUIPMENT_CLIPS', 1)[1].split('\n}', 1)[0]
    return dict(re.findall(r"^\s*(\w+): '([^']+)'", block, re.M))


def catalogs():
    outfit = json.loads((ROOT / 'src/outfitCatalog.json').read_text(encoding='utf-8'))
    weapons = json.loads((ROOT / 'src/weaponCatalog.json').read_text(encoding='utf-8'))
    remap = json.loads((ROOT / 'src/roamingModels.json').read_text(encoding='utf-8'))
    items = {it['id']: it for it in outfit['items']}
    return items, set(outfit.get('skinVariants', [])), {it['id']: it for it in weapons['items']}, remap


def item_model(item, cid):
    by = item.get('modelsByCharacter') or {}
    return (by.get(cid) or item['models'])[0]


def part_paths(f, items, skin_variants, weapons, remap):
    """The GLBs this folk would wear as a hero (equipmentAvatar.bodyPartPaths, by hand)."""
    app = f['appearance']
    body, tone = app['bodyType'], app['skinTone']
    paths = [f'models/roaming/customization/{body}/{tone}/core.glb']
    has_helmet = f"{f['set']}-head" in items
    hair = 'none' if has_helmet else app['hairStyle']
    paths.append(f"models/roaming/customization/{body}/hair/{hair}-{app['hairColor']}.glb")
    for slot in ARMOR_SLOTS:
        item_id = f"{f['set']}-{slot}"
        if item_id in items:
            if item_id in skin_variants:
                paths.append(f'models/roaming/customization/armor/{tone}/{item_id}.glb')
            else:
                paths.append(item_model(items[item_id], f['cid']))
        elif slot in SKIN_SLOTS:
            paths.append(f'models/roaming/customization/{body}/{tone}/{slot}.glb')
    weapon = item_model(weapons[f['weapon']], f['cid'])
    return [remap.get(p, p) for p in paths], remap.get(weapon, weapon)


def align(b):
    while len(b) % 4:
        b += b'\x00'


def copy_assets(g, b, pg, pb):
    """Copy a part's bufferViews, accessors, images, samplers, textures and materials; return the index offsets."""
    bv_off = len(g['bufferViews'])
    for bv in pg.get('bufferViews', []):
        start = bv.get('byteOffset', 0)
        data = pb[start:start + bv['byteLength']]
        align(b)
        nb = {k: v for k, v in bv.items() if k not in ('byteOffset', 'buffer')}
        nb['buffer'] = 0
        nb['byteOffset'] = len(b)
        b += data
        g['bufferViews'].append(nb)
    acc_off = len(g['accessors'])
    for a in pg.get('accessors', []):
        na = copy.deepcopy(a)
        if 'bufferView' in na:
            na['bufferView'] += bv_off
        g['accessors'].append(na)
    img_off = len(g.setdefault('images', []))
    for im in pg.get('images', []):
        ni = copy.deepcopy(im)
        if 'bufferView' in ni:
            ni['bufferView'] += bv_off
        g['images'].append(ni)
    smp_off = len(g.setdefault('samplers', []))
    g['samplers'].extend(copy.deepcopy(pg.get('samplers', [])))
    tex_off = len(g.setdefault('textures', []))
    for t in pg.get('textures', []):
        nt = copy.deepcopy(t)
        if 'source' in nt:
            nt['source'] += img_off
        if 'sampler' in nt:
            nt['sampler'] += smp_off
        g['textures'].append(nt)
    mat_off = len(g.setdefault('materials', []))

    def retex(obj):
        for k, v in obj.items():
            if isinstance(v, dict):
                if k.endswith('Texture') and 'index' in v:
                    v['index'] += tex_off
                retex(v)

    for m in pg.get('materials', []):
        nm = copy.deepcopy(m)
        retex(nm)
        g['materials'].append(nm)
    for ext in pg.get('extensionsUsed', []):
        used = g.setdefault('extensionsUsed', [])
        if ext not in used:
            used.append(ext)
    return acc_off, mat_off


def copy_mesh(g, pg, mesh_index, acc_off, mat_off):
    mesh = copy.deepcopy(pg['meshes'][mesh_index])
    for p in mesh['primitives']:
        p['attributes'] = {k: v + acc_off for k, v in p['attributes'].items()}
        if 'indices' in p:
            p['indices'] += acc_off
        if 'material' in p:
            p['material'] += mat_off
        if 'targets' in p:
            p['targets'] = [{k: v + acc_off for k, v in t.items()} for t in p['targets']]
    g['meshes'].append(mesh)
    return len(g['meshes']) - 1


def parent_of(pg):
    parent = {}
    for i, n in enumerate(pg['nodes']):
        for c in n.get('children', []):
            parent[c] = i
    return parent


def adopt_joint(g, pg, j, joint_by_name, parent):
    """
    A joint the template rig lacks (the customization bodies carry hair-dynamics
    bones) comes over at rest under its own parent, adopting the parent first
    if need be. Nothing animates it here; it rides its parent, which is what a
    hair bone at rest does.
    """
    pn = pg['nodes'][j]
    name = pn.get('name')
    if name in joint_by_name:
        return joint_by_name[name]
    p = parent.get(j)
    if p is None:
        raise SystemExit(f'joint {name!r} is not in the template rig and has no parent to hang from')
    parent_index = adopt_joint(g, pg, p, joint_by_name, parent)
    nn = {k: copy.deepcopy(v) for k, v in pn.items() if k in ('name', 'translation', 'rotation', 'scale', 'matrix')}
    g['nodes'].append(nn)
    index = len(g['nodes']) - 1
    g['nodes'][parent_index].setdefault('children', []).append(index)
    joint_by_name[name] = index
    return index


def add_body_part(g, b, path, joint_by_name, rig):
    pg, pb = sb.load_glb(ROOT / path)
    acc_off, mat_off = copy_assets(g, b, pg, pb)
    added = 0
    for pn in pg['nodes']:
        if 'mesh' not in pn:
            continue
        mesh_idx = copy_mesh(g, pg, pn['mesh'], acc_off, mat_off)
        node = {'name': pn.get('name', Path(path).stem), 'mesh': mesh_idx}
        if 'skin' in pn:
            ps = pg['skins'][pn['skin']]
            joints = [joint_by_name[pg['nodes'][j]['name']] if pg['nodes'][j].get('name') in joint_by_name
                      else adopt_joint(g, pg, j, joint_by_name, parent_of(pg)) for j in ps['joints']]
            skin = {'name': node['name'], 'joints': joints}
            if 'inverseBindMatrices' in ps:
                skin['inverseBindMatrices'] = ps['inverseBindMatrices'] + acc_off
            g['skins'].append(skin)
            node['skin'] = len(g['skins']) - 1
        g['nodes'].append(node)
        g['nodes'][rig].setdefault('children', []).append(len(g['nodes']) - 1)
        added += 1
    if not added:
        raise SystemExit(f'{path}: no mesh')
    return pg


def add_attachment(g, b, path, clips):
    """A Sidekick weapon: its baked hand joint becomes a root node, its channels join the kept clips."""
    pg, pb = sb.load_glb(ROOT / path)
    acc_off, mat_off = copy_assets(g, b, pg, pb)
    node_map = {}
    for pn_index, pn in enumerate(pg['nodes']):
        if 'mesh' in pn:
            continue
        nn = {k: copy.deepcopy(v) for k, v in pn.items() if k in ('name', 'translation', 'rotation', 'scale', 'matrix')}
        nn['name'] = f"{Path(path).stem}-{pn.get('name', 'joint')}"
        g['nodes'].append(nn)
        node_map[pn_index] = len(g['nodes']) - 1
        g['scenes'][0]['nodes'].append(node_map[pn_index])
    for pn in pg['nodes']:
        if 'mesh' not in pn:
            continue
        mesh_idx = copy_mesh(g, pg, pn['mesh'], acc_off, mat_off)
        node = {'name': pn.get('name', Path(path).stem), 'mesh': mesh_idx}
        if 'skin' in pn:
            ps = pg['skins'][pn['skin']]
            skin = {'name': node['name'], 'joints': [node_map[j] for j in ps['joints']]}
            if 'inverseBindMatrices' in ps:
                skin['inverseBindMatrices'] = ps['inverseBindMatrices'] + acc_off
            g['skins'].append(skin)
            node['skin'] = len(g['skins']) - 1
        g['nodes'].append(node)
        g['scenes'][0]['nodes'].append(len(g['nodes']) - 1)
    by_name = {a['name']: a for a in pg.get('animations', [])}
    for an in g['animations']:
        pa = by_name.get(an['name'])
        if pa is None:
            raise SystemExit(f"{path}: has no clip {an['name']!r} for the hand to follow")
        s_off = len(an['samplers'])
        for s in pa['samplers']:
            ns = dict(s)
            ns['input'] += acc_off
            ns['output'] += acc_off
            an['samplers'].append(ns)
        for ch in pa['channels']:
            an['channels'].append({'sampler': ch['sampler'] + s_off, 'target': {'node': node_map[ch['target']['node']], 'path': ch['target']['path']}})
    return pg


def measure(g, b, core_path):
    tris = 0
    for mesh in g['meshes']:
        for p in mesh['primitives']:
            if 'indices' in p:
                tris += g['accessors'][p['indices']]['count'] // 3
    # The rig root scales centimetres to metres and turns Z up to Y up: the body's height is its Z extent.
    height = 1.85
    for node in g['nodes']:
        if node.get('name', '').endswith('-core') and 'mesh' in node:
            top = max(g['accessors'][p['attributes']['POSITION']].get('max', [0, 0, 0])[2] for p in g['meshes'][node['mesh']]['primitives'])
            if 140 <= top <= 220:
                height = round(top / 100, 3)
    return tris, height


def build(f, clip_names, cats):
    items, skin_variants, weapons, remap = cats
    parts, weapon = part_paths(f, items, skin_variants, weapons, remap)
    for p in parts + [weapon]:
        if not (ROOT / p).exists():
            raise SystemExit(f"{f['id']}: missing part {p}")
    g, b = sb.load_glb(TEMPLATE)
    b = bytearray(b)
    rig = g['scenes'][0]['nodes'][0]
    # The template's own mesh goes; its skeleton, skin joints and clips stay.
    mesh_nodes = {i for i, node in enumerate(g['nodes']) if 'mesh' in node}
    for node in g['nodes']:
        node.pop('mesh', None)
        node.pop('skin', None)
        if 'children' in node:
            node['children'] = [c for c in node['children'] if c not in mesh_nodes]
    joint_by_name = {}
    for j in g['skins'][0]['joints']:
        name = g['nodes'][j].get('name')
        if name in joint_by_name:
            raise SystemExit(f'template rig has two joints named {name!r}')
        joint_by_name[name] = j
    g['skins'] = []
    g['meshes'] = []
    g['materials'] = []
    g['textures'] = []
    g['images'] = []
    g['samplers'] = []
    wanted = [clip_names[m] for m in f['motions']]
    have = {a['name'] for a in g['animations']}
    for c in wanted:
        if c not in have:
            raise SystemExit(f"{f['id']}: template has no clip {c!r}")
    g['animations'] = [a for a in g['animations'] if a['name'] in wanted]

    for p in parts:
        add_body_part(g, b, p, joint_by_name, rig)
    add_attachment(g, b, weapon, wanted)

    unposed = slim.prune_unposed(g, b)
    constant = slim.slim(g, b)
    keys_before, keys_after = slim.decimate(g, b)
    b = slim.repack(g, b)
    g['asset'] = {'version': '2.0', 'generator': f"scripts/build-hall-folk.py: {f['id']} from {len(parts)} wardrobe parts + {Path(weapon).stem}"}
    out = OUT_DIR / f"{f['id']}.glb"
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sb.save_glb(out, g, b)
    tris, height = measure(g, b, parts[0])
    size = out.stat().st_size
    print(f"{f['id']:20s} {size / 1e6:5.1f} MB  {tris:6d} tris  {height:.2f} m  clips {len(g['animations'])}  "
          f"(channels dropped: {unposed} unposed, {constant} constant; keys {keys_before} -> {keys_after})")
    return {'path': str(out.relative_to(ROOT)).replace('\\', '/'), 'height': height, 'tris': tris, 'title': f['title']}


def main():
    only = None
    if '--only' in sys.argv:
        only = set(sys.argv[sys.argv.index('--only') + 1].split(','))
    config = json.loads(CONFIG.read_text(encoding='utf-8'))
    clip_names = equipment_clips()
    cats = catalogs()
    bodies = json.loads(BODIES.read_text(encoding='utf-8')) if BODIES.exists() else {}
    total = 0
    for f in config['folk']:
        if only and f['id'] not in only:
            continue
        bodies[f['id']] = build(f, clip_names, cats)
        total += (ROOT / bodies[f['id']]['path']).stat().st_size
    BODIES.write_text(json.dumps(bodies, indent=2) + '\n', encoding='utf-8')
    print(f'{len(bodies)} folk, {total / 1e6:.1f} MB built this run -> {BODIES.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
