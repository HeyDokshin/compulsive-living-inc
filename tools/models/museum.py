#!/usr/bin/env python3
"""
The island museum: a cozy little hall with columns and a gabled roof, 5 × 5 blocks at 1/8 scale.
Writes content/museum/models.json5. Run: python3 tools/models/museum.py
The door faces +z (the front).
"""
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'content', 'museum', 'models.json5')

SX, SZ = 40, 40
v = {}


def put(x, y, z, c):
    if 0 <= x < SX and 0 <= z < SZ and y >= 0:
        v[(x, y, z)] = c


def box(x0, x1, y0, y1, z0, z1, c, shell=False):
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            for z in range(z0, z1 + 1):
                if shell and x0 < x < x1 and z0 < z < z1 and y0 < y < y1:
                    continue
                put(x, y, z, c(x, y, z) if callable(c) else c)


# plinth and portico floor, steps at the front
box(1, 38, 0, 2, 1, 32, 'p')
box(3, 36, 0, 2, 33, 36, 'p')
box(12, 27, 0, 1, 37, 37, 'p')
box(12, 27, 0, 0, 38, 38, 'p')

# hall walls (shell) with corner pilasters
def wall(x, y, z):
    corner = x in (2, 37) and z in (2, 30)
    return 'c' if corner else 'w'
box(2, 37, 3, 23, 2, 30, wall, shell=True)

# arched side windows (both sides) and front windows
def window(x_fixed=None, z_fixed=None, a=0, b=0):
    for t in range(a, b + 1):
        for y in range(9, 18):
            mid = (a + b) / 2
            if y >= 16 and abs(t + 0.5 - (mid + 0.5)) > (b - a) / 2 - (y - 15):
                continue
            if x_fixed is not None:
                put(x_fixed, y, t, 'g')
            else:
                put(t, y, z_fixed, 'g')
    # sill
    for t in range(a - 1, b + 2):
        if x_fixed is not None:
            put(x_fixed + (1 if x_fixed > 20 else -1), 8, t, 'f')
            put(x_fixed + (1 if x_fixed > 20 else -1), 7, t, 'l' if (t - a) % 2 == 0 else 'h')
        else:
            put(t, 8, z_fixed + 1, 'f')
            put(t, 9, z_fixed + 1, 'l' if (t - a) % 2 == 0 else 'h')

for (a, b) in ((6, 9), (14, 17), (22, 25)):
    window(x_fixed=2, a=a, b=b)
    window(x_fixed=37, a=a, b=b)
window(z_fixed=30, a=6, b=10)
window(z_fixed=30, a=29, b=33)

# door with an arch and a golden handle
for x in range(16, 24):
    for y in range(3, 18):
        if y >= 15 and abs(x + 0.5 - 20) > 4 - (y - 14):
            continue
        put(x, y, 30, 'd' if x != 19 or y < 4 else 'D')
put(22, 9, 31, 'k')
put(17, 9, 31, 'k')
for x in range(15, 25):
    put(x, 3, 31, 'D')  # door mat

# columns with bases and capitals
for cx in (4, 11, 26, 33):
    box(cx, cx + 2, 3, 22, 33, 35, lambda x, y, z: 'c' if (x + z) % 2 == 0 or y % 4 else 'e')
    box(cx - 1, cx + 3, 3, 3, 32, 36, 'e')
    box(cx - 1, cx + 3, 22, 22, 32, 36, 'e')

# sign above the door: three little emblems (fish, bug, bone)
box(12, 27, 19, 22, 31, 31, 'n')
for (x, c) in ((14, 'b'), (15, 'b'), (16, 'b'), (19, 'm'), (20, 'm'), (23, 'a'), (24, 'a'), (25, 'a')):
    put(x, 20 if c != 'm' else 21, 32, c)
put(13, 21, 32, 'b')
put(20, 20, 32, 'm')
put(19, 20, 32, 'k')

# entablature over everything
box(1, 38, 23, 25, 1, 37, lambda x, y, z: 'e' if y != 24 or (x + z) % 3 else 'c')

# gabled roof, ridge front-to-back; the front triangle is the pediment with a round window
for k in range(0, 12):
    y = 26 + k
    lo, hi = 1 + 2 * k, 38 - 2 * k
    if lo > hi:
        break
    for x in range(lo, hi + 1):
        for z in range(1, 38):
            slope = x <= lo + 1 or x >= hi - 1
            face = z in (1, 37)
            if not (slope or face):
                continue
            c = 'r' if slope else 'e'
            if slope and z == 37:
                c = 'R'
            if face and not slope:
                if math.hypot(x + 0.5 - 20, y + 0.5 - 30) < 2.4:
                    c = 'g'
                elif math.hypot(x + 0.5 - 20, y + 0.5 - 30) < 3.3:
                    c = 'f'
            put(x, y, z, c)
# finial
put(19, 38, 37, 'k')
put(20, 38, 37, 'k')
put(19, 39, 37, 'k')

# lanterns by the steps
for lx in (10, 29):
    for y in range(0, 7):
        put(lx, y, 38, 'd')
    put(lx, 7, 38, 'L')
    put(lx, 8, 38, 'L')
    put(lx, 9, 38, 'd')

palette = {
    'p': '#d8d0c2',  # plinth stone
    'w': '#f7ecd6',  # walls
    'c': '#fffaf0',  # columns / pilasters
    'e': '#ede3cf',  # entablature / pediment
    'g': '#9fd2e4',  # glass
    'f': '#c9b28e',  # frames
    'd': '#8f5e3c',  # door wood
    'D': '#6e4630',
    'k': '#f2c14e',  # gold
    'n': '#c98d5c',  # sign board
    'b': '#5aa8d8',  # emblems: fish, bug, bone
    'm': '#e8645a',
    'a': '#fff4dc',
    'r': '#6fb7a8',  # roof
    'R': '#5aa596',  # roof edge at the front
    'l': '#ff9eb5',  # flowers in the window boxes
    'h': '#7cc45e',
    'L': '#ffe9a8',  # lantern
}

ys = [k[1] for k in v]
layers = []
for y in range(0, max(ys) + 1):
    rows = []
    for z in range(SZ):
        rows.append(''.join(v.get((x, y, z), '.') for x in range(SX)))
    layers.append(rows)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w') as f:
    f.write('// Generated by tools/models/museum.py — edit the generator, not this file.\n[\n  {\n')
    f.write("    id: 'museum:building',\n    scale: 0.125,\n")
    f.write(f'    palette: {json.dumps(palette)},\n    layers: [\n')
    for layer in layers:
        f.write('      [' + ', '.join(f"'{r}'" for r in layer) + '],\n')
    f.write('    ],\n  },\n]\n')
print(f'museum: {SX}×{len(layers)}×{SZ}, {len(v)} voxels → {os.path.relpath(OUT, ROOT)}')


# ---------------------------------------------------------------------------------------------
# Props for the interior (1/16 scale, one block wide): display tank and terrarium frames, placard,
# lamp, potted plant, bell on the reception desk. Written to content/museum/props.json5.

def grid_layers(cells, sx, sy, sz):
    out = []
    for y in range(sy):
        out.append([''.join(cells.get((x, y, z), '.') for x in range(sx)) for z in range(sz)])
    return out


def frame(size=14, height=12, base='b', post='p', rim='p', floor=None, extra=None):
    c = {}
    for x in range(size):
        for z in range(size):
            c[(x, 0, z)] = base
            if floor and 0 < x < size - 1 and 0 < z < size - 1:
                c[(x, 1, z)] = floor(x, z)
            edge = x in (0, size - 1) or z in (0, size - 1)
            if edge:
                c[(x, height - 1, z)] = rim
    for x in (0, size - 1):
        for z in (0, size - 1):
            for y in range(1, height):
                c[(x, y, z)] = post
    if extra:
        extra(c)
    return grid_layers(c, size, height, size)


props = []

def prop(pid, layers, palette):
    props.append({'id': pid, 'scale': 0.0625, 'palette': palette, 'layers': layers})


# fish tank: wooden base, sand and pebbles, posts and rim (the water is a see-through box drawn by the plugin)
prop('museum:tank', frame(floor=lambda x, z: 'g' if (x * 7 + z * 3) % 11 == 0 else 's'),
     {'b': '#9a6a48', 'p': '#c8956a', 's': '#f3e2b8', 'g': '#8fbf6a'})

# terrarium: base with grass, a twig
def twig(c):
    for i in range(7):
        c[(4 + i // 2, 2 + i, 6)] = 't'
    c[(7, 7, 6)] = 'l'
    c[(8, 8, 6)] = 'l'
    c[(6, 5, 7)] = 'l'
prop('museum:terrarium', frame(floor=lambda x, z: 'h' if (x + z) % 3 else 'H', extra=twig),
     {'b': '#9a6a48', 'p': '#d9c3a0', 'h': '#9bd67a', 'H': '#7cc45e', 't': '#8a5a3a', 'l': '#7cc45e'})

# placard on a little stand (an empty spot)
pl = {}
for y in range(0, 4):
    pl[(5, y, 5)] = 'p'
for x in range(2, 9):
    for y in range(4, 8):
        pl[(x, y, 5)] = 'w' if 2 < x < 8 and 4 < y < 7 else 'f'
pl[(4, 6, 6)] = 'k'
pl[(5, 6, 6)] = 'k'
pl[(6, 5, 6)] = 'k'
prop('museum:placard', grid_layers(pl, 11, 8, 11), {'p': '#9a6a48', 'f': '#c8956a', 'w': '#fff8e8', 'k': '#b8a890'})

# lamp post
lp = {}
for y in range(0, 22):
    lp[(3, y, 3)] = 'd' if y > 1 else 'b'
for x in range(1, 6):
    for z in range(1, 6):
        lp[(x, 0, z)] = 'b'
        if 1 < x < 5 and 1 < z < 5:
            lp[(x, 22, z)] = 'l'
            lp[(x, 23, z)] = 'l'
            lp[(x, 24, z)] = 'd'
prop('museum:lamp', grid_layers(lp, 7, 25, 7), {'b': '#6e4630', 'd': '#8f5e3c', 'l': '#ffe9a8'})

# potted plant
pp = {}
for x in range(3, 9):
    for z in range(3, 9):
        for y in range(0, 4):
            if x in (3, 8) or z in (3, 8) or y == 0:
                pp[(x, y, z)] = 'c'
            else:
                pp[(x, y, z)] = 'e'
import random
rnd = random.Random(7)
for y in range(4, 13):
    r = 3.2 - abs(y - 8) * 0.45
    for x in range(12):
        for z in range(12):
            if (x - 5.5) ** 2 + (z - 5.5) ** 2 <= r * r and rnd.random() < 0.85:
                pp[(x, y, z)] = 'l' if rnd.random() < 0.7 else 'L'
prop('museum:plant', grid_layers(pp, 12, 13, 12), {'c': '#e08a5a', 'e': '#7a5232', 'l': '#7cc45e', 'L': '#5aa64a'})

# reception bell
bl = {}
for x in range(3, 8):
    for z in range(3, 8):
        bl[(x, 0, z)] = 'b'
for y in range(1, 4):
    rr = 2.2 - (y - 1) * 0.6
    for x in range(11):
        for z in range(11):
            if (x - 5) ** 2 + (z - 5) ** 2 <= rr * rr:
                bl[(x, y, z)] = 'g'
bl[(5, 4, 5)] = 'g'
prop('museum:bell', grid_layers(bl, 11, 5, 11), {'b': '#6e4630', 'g': '#f2c14e'})

# --- the curator: a calm capybara in round glasses and a bow tie (rig: body + head) -----------
body = {}
BW, BH, BD = 10, 9, 8
for x in range(BW):
    for y in range(BH):
        for z in range(BD):
            # rounded corners
            if (x in (0, BW - 1)) and (z in (0, BD - 1)):
                continue
            if y == BH - 1 and (x in (0, BW - 1) or z in (0, BD - 1)):
                continue
            c = 'b'
            if z == BD - 1 and 2 <= x <= BW - 3 and y <= BH - 3:
                c = 'v'  # waistcoat
            if z == BD - 1 and 4 <= x <= 5 and y <= BH - 3 and y % 2 == 0:
                c = 'k'  # buttons
            if y == 0 and (x in (1, 2, BW - 3, BW - 2)) and z in (1, 2, BD - 3, BD - 2):
                c = 'f'  # feet
            body[(x, y, z)] = c
# bow tie
for (x, y) in [(3, 7), (4, 7), (5, 7), (6, 7), (3, 6), (6, 6), (4, 6), (5, 6)]:
    body[(x, y, BD)] = 't'
# little arms at the sides
for y in range(3, 7):
    body[(-1, y, 4)] = 'b'
    body[(BW, y, 4)] = 'b'
body[(-1, 2, 5)] = 'f'
body[(BW, 2, 5)] = 'f'

head = {}
HW, HH, HD = 10, 7, 9
for x in range(HW):
    for y in range(HH):
        for z in range(HD):
            if (x in (0, HW - 1)) and (y in (0, HH - 1)):
                continue
            head[(x, y, z)] = 'b'
# snout
for x in range(2, 8):
    for y in range(0, 4):
        for z in range(HD, HD + 3):
            if (x in (2, 7)) and y == 3:
                continue
            head[(x, y, z)] = 's'
head[(4, 3, HD + 2)] = 'n'
head[(5, 3, HD + 2)] = 'n'
head[(4, 1, HD + 2)] = 'm'
head[(5, 1, HD + 2)] = 'm'
# ears
for (x, z) in [(1, 2), (1, 3), (8, 2), (8, 3)]:
    head[(x, HH, z)] = 'r'
# eyes and round glasses on the front face (z = HD - 1)
for ex in (2, 7):
    head[(ex, 4, HD - 1)] = 'e'
    for (dx, dy) in [(-1, 0), (1, 0), (0, 1), (0, -1), (-1, 1), (1, 1), (-1, -1), (1, -1)]:
        if (ex + dx, 4 + dy) != (ex, 4):
            head[(ex + dx, 4 + dy, HD)] = 'g'
for x in range(4, 6):
    head[(x, 5, HD)] = 'g'  # bridge

def bounds(c):
    xs = [k[0] for k in c]; ys = [k[1] for k in c]; zs = [k[2] for k in c]
    return min(xs), min(ys), min(zs), max(xs), max(ys), max(zs)

def norm(c):
    x0, y0, z0, x1, y1, z1 = bounds(c)
    return {(x - x0, y - y0, z - z0): v for (x, y, z), v in c.items()}, (x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1), (x0, y0, z0)

CUR = {'b': '#b9875a', 'v': '#5aa596', 'k': '#f2c14e', 'f': '#8a5a3a', 't': '#e8645a', 's': '#9a6a48', 'n': '#3a2a2a', 'm': '#6e4630', 'r': '#8a5a3a', 'e': '#2a2230', 'g': '#f2c14e'}
bn, bsize, bmin = norm(body)
hn, hsize, hmin = norm(head)
prop('museum:curator_body', grid_layers(bn, *bsize), CUR)
prop('museum:curator_head', grid_layers(hn, *hsize), CUR)
# rig: body pivot at its bottom center; the head sits on top, pivoting at its back-bottom (nods)
body_pivot = [BW / 2 - bmin[0], 0, BD / 2 - bmin[2]]
head_pivot = [HW / 2 - hmin[0], 0, HD / 2 - hmin[2]]
curator_rig = {'id': 'museum:curator', 'scale': 0.0625, 'parts': [
    {'name': 'body', 'model': 'museum:curator_body', 'pivot': body_pivot, 'at': [0, 0, 0]},
    {'name': 'head', 'model': 'museum:curator_head', 'pivot': head_pivot, 'at': [0, BH - 1, 0.5], 'parent': 'body'},
]}
RIGS = os.path.join(ROOT, 'content', 'museum', 'rigs.json5')
with open(RIGS, 'w') as f:
    f.write('// Generated by tools/models/museum.py — the curator.\n[\n')
    f.write(f"  {{ id: '{curator_rig['id']}', scale: {curator_rig['scale']}, parts: [\n")
    for part in curator_rig['parts']:
        extra = f", parent: '{part['parent']}'" if 'parent' in part else ''
        f.write(f"    {{ name: '{part['name']}', model: '{part['model']}', pivot: {json.dumps(part['pivot'])}, at: {json.dumps(part['at'])}{extra} }},\n")
    f.write('  ] },\n]\n')

# appended to the same models file (one models.json5 per content pack)
with open(OUT) as f:
    text = f.read().rstrip()
assert text.endswith(']')
with open(OUT, 'w') as f:
    f.write(text[:-1])
    f.write('  // --- interior props ---\n')
    for m in props:
        f.write(f"  {{\n    id: '{m['id']}',\n    scale: {m['scale']},\n    palette: {json.dumps(m['palette'])},\n    layers: [\n")
        for layer in m['layers']:
            f.write('      [' + ', '.join(f"'{r}'" for r in layer) + '],\n')
        f.write('    ],\n  },\n')
    f.write(']\n')
print(f'{len(props)} props → {os.path.relpath(OUT, ROOT)}')
