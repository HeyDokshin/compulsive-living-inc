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
