#!/usr/bin/env python3
"""
The player's house in three sizes (4 × 4 cells at 1/8 scale, door at the front, +z) and its mailbox.
Writes content/house/models.json5. Run: python3 tools/models/house.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'content', 'house', 'models.json5')
S = 32  # footprint in voxels (4 cells at 1/8)


def house(level):
    v = {}

    def put(x, y, z, c):
        if 0 <= x < S and 0 <= z < S and y >= 0:
            v[(x, y, z)] = c

    def box(x0, x1, y0, y1, z0, z1, c, shell=False):
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                for z in range(z0, z1 + 1):
                    if shell and x0 < x < x1 and z0 < z < z1 and y0 < y < y1:
                        continue
                    put(x, y, z, c(x, y, z) if callable(c) else c)

    wh = [0, 11, 13, 16][level]          # wall height
    x0, x1, z0, z1 = 3, 28, 6, 26        # walls
    # foundation and porch
    box(x0 - 1, x1 + 1, 0, 0, z0 - 1, z1 + 1, 'f')
    box(11, 20, 0, 1 if level == 3 else 0, z1 + 1, z1 + 4, 'f' if level < 3 else 'F')
    # walls: logs for the cabin, plaster with a timber base later
    def wall(x, y, z):
        if level == 1:
            return 'w' if y % 2 else 'W'
        if y <= 2:
            return 'b'
        corner = x in (x0, x1) and z in (z0, z1)
        return 't' if corner else 'w'
    box(x0, x1, 1, wh, z0, z1, wall, shell=True)
    # door
    for x in range(14, 18):
        for y in range(1, 9):
            put(x, y, z1, 'd' if x not in (14, 17) or y < 8 else 'D')
    put(17, 5, z1 + 1, 'k')
    # windows (front and sides), with flower boxes from level 2
    wins = [(6, 10, 'z'), (21, 25, 'z')] + ([(10, 14, 'x'), (18, 22, 'x')] if level >= 2 else [])
    for (a, b, axis) in wins:
        for t in range(a, b + 1):
            for y in range(4, 8):
                edge = t in (a, b) or y in (4, 7)
                c = 'r' if edge else 'g'
                if axis == 'z':
                    put(t, y, z1, c)
                else:
                    put(x0, y, t, c)
                    put(x1, y, t, c)
        if level >= 2:
            for t in range(a, b + 1):
                if axis == 'z':
                    put(t, 3, z1 + 1, 'p')
                    put(t, 4, z1 + 1, 'l' if t % 2 else 'o')
    # roof: a gable along x (the ridge runs left-right), overhanging front and back
    rz0, rz1 = z0 - 2, z1 + 2
    mid = (rz0 + rz1) / 2
    k = 0
    while True:
        y = wh + 1 + k
        za, zb = rz0 + k, rz1 - k
        if za > zb:
            break
        for z in range(za, zb + 1):
            for x in range(x0 - 2, x1 + 3):
                edge = z in (za, za + 1, zb - 1, zb) or x in (x0 - 2, x1 + 2)
                if not edge:
                    continue
                c = 'R' if z in (za, zb) else 'q'
                if x in (x0 - 2, x1 + 2) and z not in (za, zb):
                    c = 'w' if level == 1 else 'W2'
                put(x, y, z, c)
        k += 1
    top = wh + k
    # chimney
    if level >= 2:
        box(22, 24, wh, top + 2, 10, 12, 'c')
        box(21, 25, top + 3, top + 3, 9, 13, 'C')
    # attic dormer window on the front slope (level 3)
    if level == 3:
        zf = int(mid) + 3
        box(13, 18, wh + 4, wh + 8, zf, zf + 2, 'w')
        box(14, 17, wh + 5, wh + 7, zf + 2, zf + 2, 'g')
        box(12, 19, wh + 9, wh + 9, zf - 1, zf + 3, 'q')
        # porch posts and a lantern
        for x in (11, 20):
            box(x, x, 2, 9, z1 + 4, z1 + 4, 't')
        box(11, 20, 10, 10, z1 + 1, z1 + 4, 'q')
        put(19, 8, z1 + 3, 'L')
    # door awning (level 2)
    if level == 2:
        box(13, 18, 9, 9, z1 + 1, z1 + 2, 'q')
    return v


PAL = {
    1: {'f': '#b9bcc6', 'F': '#d8d2c8', 'w': '#c99560', 'W': '#b58450', 'W2': '#b58450', 'd': '#8f5e3c', 'D': '#6e4630', 'k': '#f2c14e',
        'r': '#8a5a3a', 'g': '#a6d8f0', 'R': '#a8584a', 'q': '#c8705a', 't': '#8a5a3a', 'b': '#8a5a3a'},
    2: {'f': '#b9bcc6', 'F': '#d8d2c8', 'w': '#f7ecd6', 'W': '#f7ecd6', 'W2': '#f7ecd6', 'b': '#c99560', 't': '#c99560', 'd': '#7fbfa8', 'D': '#5aa596',
        'k': '#f2c14e', 'r': '#fffaf0', 'g': '#a6d8f0', 'R': '#4f9a8a', 'q': '#6fb7a8', 'c': '#c8705a', 'C': '#a8584a', 'p': '#8a5a3a', 'l': '#ff8fa8', 'o': '#ffe08a'},
    3: {'f': '#b9bcc6', 'F': '#d8d2c8', 'w': '#fff4e2', 'W': '#fff4e2', 'W2': '#fff4e2', 'b': '#a6cbea', 't': '#8f5e3c', 'd': '#e8645a', 'D': '#c8504a',
        'k': '#f2c14e', 'r': '#fffaf0', 'g': '#a6d8f0', 'R': '#5a6aa8', 'q': '#7a8ad0', 'c': '#b9bcc6', 'C': '#9a9ca6', 'p': '#8a5a3a', 'l': '#ff8fa8',
        'o': '#ffe08a', 'L': '#ffe9a8'},
}

models = []
for level in (1, 2, 3):
    v = house(level)
    # two-character palette keys don't fit a char grid: map W2 to 'X'
    v = {k: ('X' if c == 'W2' else c) for k, c in v.items()}
    pal = {('X' if k == 'W2' else k): c for k, c in PAL[level].items()}
    ys = [k[1] for k in v]
    layers = [[''.join(v.get((x, y, z), '.') for x in range(S)) for z in range(S)] for y in range(0, max(ys) + 1)]
    models.append({'id': f'house:house_{level}', 'scale': 0.125, 'palette': pal, 'layers': layers})

# mailbox on a post (1/16)
mb = {}
for y in range(0, 10):
    mb[(7, y, 7)] = 'q'
    mb[(8, y, 7)] = 'q'
for x in range(4, 12):
    for y in range(10, 16):
        for z in range(4, 11):
            top = y == 15 and x in (4, 11)
            if top:
                continue
            mb[(x, y, z)] = 'p'
for y in range(11, 14):
    mb[(11, y, 11)] = 'r'  # flag
mb[(11, 14, 11)] = 'r'
mb[(12, 14, 11)] = 'r'
models.append({'id': 'house:mailbox', 'scale': 0.0625, 'palette': {'q': '#8a5a3a', 'p': '#6aa0d8', 'r': '#e8645a'},
               'layers': [[''.join(mb.get((x, y, z), '.') for x in range(16)) for z in range(16)] for y in range(16)]})

with open(OUT, 'w') as f:
    f.write('// Generated by tools/models/house.py — the house in three sizes and its mailbox.\n[\n')
    for m in models:
        f.write(f"  {{\n    id: '{m['id']}',\n    scale: {m['scale']},\n    palette: {json.dumps(m['palette'])},\n    layers: [\n")
        for layer in m['layers']:
            f.write('      [' + ', '.join(f"'{r}'" for r in layer) + '],\n')
        f.write('    ],\n  },\n')
    f.write(']\n')
print(f'{len(models)} models → {os.path.relpath(OUT, ROOT)}')
