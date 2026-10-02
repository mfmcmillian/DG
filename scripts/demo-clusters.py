"""Lifts clusters out of a dumped Synty demo scene (scripts/unity-scene-dump.py)
into welded modules of a realm manifest, so one kit piece carries Synty's own
arrangement of a dozen props: a candle cluster, a skull heap, a study corner,
a bay of the crypt's nave, a patch of graveyard.

  python scripts/demo-clusters.py <clusters.json> <manifest.json>

clusters.json:
  { "dumps": { "crypt": "$TEMP/synty-demo/demo-crypt.json", ... },   # from scripts/unity-scene-dump.py
    "clusters": [ { "id": "crypt_nave_bay", "dump": "crypt",
                    "box": [x0, x1, z0, z1, y0, y1],      # Unity metres, optional
                    "groups": ["Props/", "Environment/"],  # group prefixes, optional
                    "exclude": "^SM_Bld_(Base_Floor|Base_Wall|Ceiling)",  # mesh regex, optional
                    "flatten": "min" | "each" | <number>,  # y base: lowest piece, every piece to 0, or a height
                    "thin": { "regex": "Skull_03", "keep": 2 },   # keep every n-th match, optional
                    "colliders": "Pillar_|Tomb_0",                # exporter box colliders, optional
                    "collide": false, "wall": {...}, "anchor": "top" } ] }

Modules are written into the manifest's module list under their ids (replacing
any earlier version) with "source": "demo" so they can be told from hand-built
ones. Offsets are relative to the cluster's x/z centre and its y base; the
exporter recentres anyway. Mirrored scales are kept as given; the exporter
drops their sign.
"""
import json, re, sys

spec_path, manifest_path = sys.argv[1], sys.argv[2]
spec = json.load(open(spec_path))
import os
# Dump paths may start with $TEMP (where scripts/unity-scene-dump.py is usually pointed).
dumps = {k: json.load(open(v.replace('$TEMP', os.environ.get('TEMP', '/tmp'))))['placements'] for k, v in spec['dumps'].items()}

ALWAYS_SKIP = re.compile(r'^(FX_|SM_Chr_|SM_Env_Skydome)')
generated = []

for c in spec['clusters']:
    places = dumps[c['dump']]
    box = c.get('box')
    groups = c.get('groups')
    exclude = re.compile(c['exclude']) if c.get('exclude') else None
    picked = []
    for p in places:
        x, y, z = p['pos']
        if box and not (box[0] <= x <= box[1] and box[2] <= z <= box[3] and (len(box) < 6 or box[4] <= y <= box[5])):
            continue
        if groups and not any(p['group'].startswith(g) for g in groups):
            continue
        if ALWAYS_SKIP.search(p['mesh']) or (exclude and exclude.search(p['mesh'])):
            continue
        picked.append(p)
    # thin: {"regex": "Skull_03", "keep": 2} keeps every n-th match of a mesh regex (deterministic)
    if c.get('thin'):
        thin = re.compile(c['thin']['regex']); keep = int(c['thin'].get('keep', 2)); seen = 0; kept = []
        for p in picked:
            if thin.search(p['mesh']):
                seen += 1
                if seen % keep:
                    continue
            kept.append(p)
        picked = kept
    if not picked:
        print(f'{c["id"]}: nothing picked')
        continue
    xs = [p['pos'][0] for p in picked]; zs = [p['pos'][2] for p in picked]; ys = [p['pos'][1] for p in picked]
    cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
    flatten = c.get('flatten', 'min')
    base = min(ys) if flatten == 'min' else (0 if flatten == 'each' else float(flatten))
    parts = []
    for p in picked:
        x, y, z = p['pos']
        oy = 0 if flatten == 'each' else round(y - base, 3)
        part = {'fbx': p['mesh'], 'offset': [round(x - cx, 3), oy, round(z - cz, 3)]}
        if abs(p['yaw']) > 0.05:
            part['yaw'] = p['yaw']
        s = p['scale']
        if any(abs(v - 1) > 0.01 for v in s):
            part['scale'] = s if any(abs(s[0] - v) > 0.01 for v in s) else s[0]
        parts.append(part)
    module = {'id': c['id'], 'source': 'demo', 'parts': parts}
    for key in ('collide', 'wall', 'anchor', 'scale', 'colliders', 'exclude_mesh'):
        if key in c:
            module[key if key != 'exclude_mesh' else 'exclude'] = c[key]
    generated.append(module)
    from collections import Counter
    kinds = Counter(p['mesh'] for p in picked)
    print(f'{c["id"]}: {len(parts)} parts over {max(xs) - min(xs):.1f} x {max(zs) - min(zs):.1f} m, base y {base:.2f}; {", ".join(f"{k} x{n}" for k, n in kinds.most_common(6))}')

# Written textually so the hand-formatted manifest keeps its layout: a generated
# module is one line, replaced in place when its id is already there, else
# appended before the closing of the module list.
text = open(manifest_path, encoding='utf-8').read()
for module in generated:
    line = '    ' + json.dumps(module, separators=(', ', ': '))
    pattern = re.compile(r'^    \{ *"id": *"' + re.escape(module['id']) + r'".*$', re.M)
    hit = pattern.search(text)
    if hit:
        last = text[hit.end():].lstrip().startswith(']')
        text = text[:hit.start()] + line + ('' if last else ',') + text[hit.end():]
    else:
        close = text.rindex('\n  ]')
        body = text[:close].rstrip()
        text = body + ('' if body.endswith('[') else ',') + '\n' + line + text[close:]
open(manifest_path, 'w', encoding='utf-8', newline='\n').write(text)
print('wrote', manifest_path, len(generated), 'generated modules')
