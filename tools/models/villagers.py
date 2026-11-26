#!/usr/bin/env python3
"""
Villagers: animal heads for the chibi rig (8 wide × 7 deep at 1/12, front = +z), a small villager
house (3 × 3 cells at 1/8) and a framed photo. Palette chars on heads: s fur (shared with the
hands), S light fur, e eyes, n nose, b blush, i inner ear, d dark, y bill, w wool.
Writes content/villagers/models.json5. Run: python3 tools/models/villagers.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'content', 'villagers', 'models.json5')


class G:
    def __init__(self):
        self.v = {}

    def set(self, x, y, z, c):
        self.v[(x, y, z)] = c
        return self

    def box(self, x0, x1, y0, y1, z0, z1, c):
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                for z in range(z0, z1 + 1):
                    self.v[(x, y, z)] = c
        return self

    def layers(self, x0=0, z0=0):
        xs = [k[0] for k in self.v]; ys = [k[1] for k in self.v]; zs = [k[2] for k in self.v]
        assert min(xs) >= x0 and min(zs) >= z0 and min(ys) >= 0, 'heads must keep their min corner at 0 (rig pivot)'
        return [[''.join(self.v.get((x, y, z), '.') for x in range(x0, max(xs) + 1)) for z in range(z0, max(zs) + 1)] for y in range(0, max(ys) + 1)]


def base(muzzle=True):
    g = G()
    for x in range(8):
        for y in range(6):
            for z in range(7):
                if (x in (0, 7)) and (y in (0, 5)):
                    continue
                if (z in (0, 6)) and (y == 5) and x in (0, 7):
                    continue
                g.set(x, y, z, 's')
    g.set(2, 3, 6, 'e').set(5, 3, 6, 'e')
    g.set(1, 2, 6, 'b').set(6, 2, 6, 'b')
    if muzzle:
        g.box(3, 4, 1, 2, 6, 6, 'S')
    return g


def rabbit():
    g = base()
    for x in (2, 5):
        g.box(x, x, 6, 10, 2, 3, 's').box(x, x, 7, 9, 3, 3, 'i')
    g.set(3, 2, 7, 'n').set(4, 2, 7, 'n')
    return g


def fox():
    g = base(muzzle=False)
    for (x0, x1) in ((1, 2), (5, 6)):
        g.box(x0, x1, 6, 6, 2, 3, 's').box(x0, x1, 6, 6, 3, 3, 'i')
        g.set(x0 + (1 if x0 == 1 else 0), 7, 2, 's')
    g.box(2, 5, 0, 2, 6, 6, 'S').box(3, 4, 1, 2, 7, 7, 'S').set(3, 2, 8, 'n').set(4, 2, 8, 'n')
    return g


def bear():
    g = base(muzzle=False)
    for x in (0, 6):
        g.box(x, x + 1, 5, 6, 2, 3, 's').set(x + (1 if x == 0 else 0), 6, 3, 'i')
    g.box(2, 5, 0, 2, 7, 7, 'S').set(3, 2, 8, 'n').set(4, 2, 8, 'n')
    return g


def frog():
    g = base(muzzle=False)
    for x in (1, 5):
        g.box(x, x + 1, 5, 7, 3, 5, 's')
        g.set(x + (0 if x == 1 else 1), 6, 6, 'e')
    g.set(2, 3, 6, 's').set(5, 3, 6, 's')
    for x in range(1, 7):
        g.set(x, 1, 6, 'd')
    return g


def duck():
    g = base(muzzle=False)
    g.box(2, 5, 1, 2, 7, 8, 'y').box(3, 4, 1, 1, 9, 9, 'y')
    g.set(3, 6, 3, 's').set(4, 6, 2, 's').set(4, 7, 2, 's')
    return g


def cat():
    g = base()
    for (x0, x1) in ((0, 1), (6, 7)):
        g.box(x0, x1, 5, 6, 2, 3, 's').set(x0 + (1 if x0 == 0 else 0), 6, 3, 'i')
        g.set(x0 + (0 if x0 == 0 else 1), 7, 2, 's')
    g.set(3, 2, 7, 'n').set(4, 2, 7, 'n')
    g.set(0, 2, 6, 'd').set(7, 2, 6, 'd')
    return g


def sheep():
    g = base(muzzle=False)
    for (x, y, z), c in list(g.v.items()):
        if y >= 4 or z <= 2 or x in (0, 7):
            g.v[(x, y, z)] = 'w'
    for x in range(8):
        for z in range(7):
            g.set(x, 6, z, 'w')
    g.box(0, 0, 2, 3, 3, 4, 'S').box(7, 7, 2, 3, 3, 4, 'S')
    g.set(2, 3, 6, 'e').set(5, 3, 6, 'e').set(3, 1, 6, 'n').set(4, 1, 6, 'n')
    return g


def mouse():
    g = base()
    for (x0, x1) in ((0, 2), (5, 7)):
        g.box(x0, x1, 6, 8, 3, 3, 's').box(x0, x1, 6, 8, 4, 4, 'i')
        g.v.pop((x0, 8, 3), None)
        g.v.pop((x1, 8, 3), None)
        g.v.pop((x0, 8, 4), None)
        g.v.pop((x1, 8, 4), None)
    g.set(3, 2, 7, 'n').set(4, 2, 7, 'n')
    return g


HEAD_PAL = {'s': '#c99a70', 'S': '#fff4e6', 'e': '#2a2230', 'n': '#4a2e2a', 'b': '#ffadbb', 'i': '#ffc4d6', 'd': '#3a3434', 'y': '#ffb34a', 'w': '#fffaf0'}
# Round rigs: fur per palette char (0…1) and the drawn face (center / size in voxels on the front at
# z = 7; eyes, blush and painted mouths are erased to fur and drawn by the faces plugin instead).
FUR = {
    'rabbit': {'keys': {'s': 1, 'S': 0.7, 'i': 0.25}, 'length': 0.8, 'density': 6, 'droop': 0.3},
    'fox': {'keys': {'s': 1, 'S': 0.8, 'i': 0.3}, 'length': 1.0, 'density': 6, 'droop': 0.35},
    'bear': {'keys': {'s': 1, 'S': 0.6, 'i': 0.3}, 'length': 1.1, 'density': 5, 'droop': 0.3},
    'duck': {'keys': {'s': 0.6}, 'length': 0.5, 'density': 7, 'droop': 0.2},
    'cat': {'keys': {'s': 1, 'S': 0.7, 'i': 0.2}, 'length': 0.8, 'density': 6, 'droop': 0.3},
    'sheep': {'keys': {'w': 1, 's': 0.3}, 'length': 1.3, 'density': 4, 'droop': 0.1, 'thickness': 0.5},
    'mouse': {'keys': {'s': 0.8, 'S': 0.6, 'i': 0.2}, 'length': 0.6, 'density': 7, 'droop': 0.25},
}
FACE = {'center': [4, 3.2], 'size': [7.6, 5.6], 'front': 7, 'erase': {'e': 's', 'b': 's'}, 'style': {'eyeGap': 1.5, 'eyeY': 3.5, 'mouthY': 1.9}}
FACES = {
    'frog': {'center': [4, 4.4], 'size': [8, 7.6], 'erase': {'e': 's', 'b': 's', 'd': 's'},
             'style': {'eyeGap': 2.5, 'eyeY': 6.4, 'eyeSize': 0.95, 'mouthY': 1.5, 'mouthWide': 1.8}},
    'duck': {'style': {'mouth': 'none'}},
    'sheep': {'erase': {'e': 'w', 'b': 'w'}},
}
models = []
for name, fn in [('rabbit', rabbit), ('fox', fox), ('bear', bear), ('frog', frog), ('duck', duck), ('cat', cat), ('sheep', sheep), ('mouse', mouse)]:
    face = {**FACE, **FACES.get(name, {})}
    face['style'] = {**FACE['style'], **FACES.get(name, {}).get('style', {})}
    m = {'id': f'villagers:head_{name}', 'scale': 1 / 12, 'palette': HEAD_PAL, 'layers': fn().layers(), 'face': face}
    if name in FUR:
        m['fur'] = FUR[name]
    models.append(m)

# villager house: 24 × 24 at 1/8; w walls, q roof, R roof edge, d door (recolored per villager)
v = {}
S = 24
for x in range(2, 22):
    for z in range(4, 20):
        for y in range(1, 10):
            if 2 < x < 21 and 4 < z < 19:
                continue
            v[(x, y, z)] = 'w'
for x in range(1, 23):
    for z in range(3, 21):
        v[(x, 0, z)] = 'f'
for x in range(10, 14):
    for y in range(1, 7):
        v[(x, y, 19)] = 'd'
v[(13, 4, 20)] = 'k'
for (a, b) in ((4, 7), (16, 19)):
    for x in range(a, b + 1):
        for y in range(4, 7):
            v[(x, y, 19)] = 'g' if a < x < b and y == 5 else 'r'
k = 0
while True:
    za, zb = 2 + k, 21 - k
    if za > zb:
        break
    for z in range(za, zb + 1):
        for x in range(0, S):
            if z in (za, za + 1, zb - 1, zb) or x in (0, S - 1):
                v[(x, 10 + k, z)] = 'R' if z in (za, zb) else 'q'
    k += 1
house_pal = {'w': '#f7ecd6', 'f': '#b9bcc6', 'd': '#8f5e3c', 'k': '#f2c14e', 'r': '#fffaf0', 'g': '#a6d8f0', 'q': '#e89a7a', 'R': '#c8705a'}
ys = [kk[1] for kk in v]
models.append({'id': 'villagers:house', 'scale': 0.125, 'palette': house_pal,
               'layers': [[''.join(v.get((x, y, z), '.') for x in range(S)) for z in range(S)] for y in range(max(ys) + 1)]})

# a framed photo on a little stand (fur color 's', background 'b')
ph = G()
for x in range(1, 9):
    for y in range(0, 9):
        edge = x in (1, 8) or y in (0, 8)
        ph.set(x, y, 4, 'f' if edge else 'b')
for (x, y) in [(3, 2), (4, 2), (5, 2), (6, 2), (3, 3), (4, 3), (5, 3), (6, 3), (3, 4), (4, 4), (5, 4), (6, 4), (3, 5), (6, 5), (4, 5), (5, 5)]:
    ph.set(x, y, 5, 's')
ph.set(4, 4, 6, 'e').set(5, 4, 6, 'e')
ph.box(4, 5, 0, 3, 3, 3, 'f')
xs = [kk[0] for kk in ph.v]; zs = [kk[2] for kk in ph.v]
models.append({'id': 'villagers:photo', 'scale': 0.0625, 'palette': {'f': '#c99560', 'b': '#a6d8f0', 's': '#c99a70', 'e': '#2a2230'}, 'layers': ph.layers(min(xs), min(zs))})

with open(OUT, 'w') as f:
    f.write('// Generated by tools/models/villagers.py\n[\n')
    for m in models:
        f.write(f"  {{\n    id: '{m['id']}',\n    scale: {m['scale']},\n    palette: {json.dumps(m['palette'])},\n")
        for extra in ('fur', 'face'):
            if extra in m:
                f.write(f"    {extra}: {json.dumps(m[extra], ensure_ascii=False)},\n")
        f.write("    layers: [\n")
        for layer in m['layers']:
            f.write('      [' + ', '.join(f"'{r}'" for r in layer) + '],\n')
        f.write('    ],\n  },\n')
    f.write(']\n')
print(f'{len(models)} models → {os.path.relpath(OUT, ROOT)}')
