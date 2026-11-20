#!/usr/bin/env python3
"""
Outdoor decor pieces (1/16 scale, front = +z). Palette char 'p' is the paintable color (variants
recolor it), 'q' the secondary one. Writes content/decor/models.json5. Run: python3 tools/models/decor.py
"""
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'content', 'decor', 'models.json5')


class G:
    def __init__(self):
        self.v = {}

    def box(self, x0, x1, y0, y1, z0, z1, c):
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                for z in range(z0, z1 + 1):
                    self.v[(x, y, z)] = c(x, y, z) if callable(c) else c
        return self

    def set(self, x, y, z, c):
        self.v[(x, y, z)] = c
        return self

    def layers(self):
        xs = [k[0] for k in self.v]; ys = [k[1] for k in self.v]; zs = [k[2] for k in self.v]
        x0, y0, z0 = min(xs), min(ys), min(zs)
        out = []
        for y in range(y0, max(ys) + 1):
            out.append([''.join(self.v.get((x, y, z), '.') for x in range(x0, max(xs) + 1)) for z in range(z0, max(zs) + 1)])
        return out


models = []

def add(mid, g, pal):
    models.append({'id': mid, 'scale': 0.0625, 'palette': pal, 'layers': g.layers()})


# bench: seat, backrest, legs
b = G()
for x in (1, 12):
    b.box(x, x + 1, 0, 4, 1, 2, 'q').box(x, x + 1, 0, 4, 6, 7, 'q')
b.box(0, 13, 5, 6, 1, 7, lambda x, y, z: 'p' if z % 2 else 'P')
b.box(0, 13, 7, 11, 0, 1, lambda x, y, z: 'p' if y % 2 else 'P')
add('decor:bench', b, {'p': '#d9a56c', 'P': '#c99560', 'q': '#8a5a3a'})

# crate
c = G()
c.box(0, 11, 0, 9, 0, 11, lambda x, y, z: 'q' if (x in (0, 11)) + (y in (0, 9)) + (z in (0, 11)) >= 2 else ('p' if y % 3 else 'P'))
add('decor:crate', c, {'p': '#c99560', 'P': '#b58450', 'q': '#8a5a3a'})

# sign
s = G()
s.box(6, 7, 0, 9, 6, 7, 'q')
s.box(1, 12, 9, 15, 7, 8, 'p')
for x in range(3, 11, 2):
    s.set(x, 13, 9, 'k').set(x + 1, 11, 9, 'k')
add('decor:sign', s, {'p': '#e2b27f', 'q': '#8a5a3a', 'k': '#6e4630'})

# fence segment (connects with neighbours: posts at both ends)
f = G()
for x in (0, 15):
    f.box(x, x, 0, 12, 7, 8, 'q')
f.box(1, 14, 4, 5, 7, 8, 'p').box(1, 14, 9, 10, 7, 8, 'p')
for x in (5, 10):
    f.box(x, x, 0, 11, 7, 8, 'p')
add('decor:fence', f, {'p': '#e2b27f', 'q': '#c99560'})

# lamp post with a lantern
l = G()
l.box(5, 10, 0, 1, 5, 10, 'q')
l.box(7, 8, 2, 19, 7, 8, 'p')
l.box(5, 10, 20, 20, 5, 10, 'p')
l.box(5, 10, 21, 25, 5, 10, lambda x, y, z: 'g' if 5 < x < 10 or 5 < z < 10 else 'p')
l.box(4, 11, 26, 26, 4, 11, 'p').box(6, 9, 27, 27, 6, 9, 'p')
add('decor:lamp', l, {'p': '#4a4a52', 'q': '#3a3a40', 'g': '#ffe9a8'})

# bonfire: a ring of stones, crossed logs, flames
fire = G()
for a in range(16):
    t = a / 16 * 2 * math.pi
    fire.set(round(7 + math.cos(t) * 6), 0, round(7 + math.sin(t) * 6), 's')
    fire.set(round(7 + math.cos(t) * 6), 1, round(7 + math.sin(t) * 6), 'S' if a % 2 else 's')
for i in range(3, 12):
    fire.set(i, 1, i, 'w').set(i, 1, 14 - i, 'w').set(i, 2, 7, 'W')
for (x, z, h) in [(7, 7, 7), (6, 7, 5), (8, 7, 5), (7, 6, 5), (7, 8, 5), (6, 6, 3), (8, 8, 3), (6, 8, 3), (8, 6, 3)]:
    for y in range(2, 2 + h):
        fire.set(x, y, z, 'y' if y < 2 + h // 2 and (x, z) == (7, 7) else ('f' if y < 2 + h - 1 else 'r'))
add('decor:bonfire', fire, {'s': '#b9bcc6', 'S': '#a9adb8', 'w': '#8a5a3a', 'W': '#6e4630', 'f': '#ff9a4a', 'y': '#ffe08a', 'r': '#ff6a4a'})

# birdhouse on a post
bh = G()
bh.box(7, 8, 0, 11, 7, 8, 'q')
bh.box(4, 11, 12, 18, 4, 11, 'w')
bh.set(7, 15, 12, 'k').set(8, 15, 12, 'k').set(7, 16, 12, 'k').set(8, 16, 12, 'k').set(7, 13, 12, 'q').set(8, 13, 12, 'q')
for k in range(5):
    bh.box(3 + k, 12 - k, 19 + k, 19 + k, 3, 12, 'p')
add('decor:birdhouse', bh, {'p': '#e8645a', 'q': '#8a5a3a', 'w': '#f2dcb8', 'k': '#3a2a2a'})

# flower pot
fp = G()
for y in range(0, 6):
    r = 3 + y * 0.35
    for x in range(12):
        for z in range(12):
            d = math.hypot(x + 0.5 - 6, z + 0.5 - 6)
            if d <= r:
                fp.set(x, y, z, 'e' if y == 5 and d < r - 1 else 'p')
for y in range(6, 11):
    for x in range(12):
        for z in range(12):
            d = math.hypot(x + 0.5 - 6, z + 0.5 - 6)
            if d <= 3.6 - abs(y - 8) * 0.6 and (x + y + z) % 4:
                fp.set(x, y, z, 'l')
for (x, z) in [(5, 5), (7, 6), (5, 7), (6, 4)]:
    fp.set(x, 11, z, 'r').set(x, 10, z, 'r')
fp.set(6, 11, 6, 'y')
add('decor:flower_pot', fp, {'p': '#e08a5a', 'e': '#7a5232', 'l': '#7cc45e', 'r': '#ff8fa8', 'y': '#ffe08a'})

# workbench with a saw and a hammer
wb = G()
for (x, z) in [(1, 1), (12, 1), (1, 8), (12, 8)]:
    wb.box(x, x + 1, 0, 7, z, z + 1, 'q')
wb.box(0, 14, 2, 2, 1, 9, 'q')
wb.box(0, 14, 8, 9, 0, 10, lambda x, y, z: 'p' if x % 3 else 'P')
wb.box(2, 7, 10, 10, 2, 3, 'm').box(2, 2, 10, 11, 2, 3, 'h')
wb.box(9, 12, 10, 10, 6, 6, 'h').box(12, 13, 10, 11, 5, 7, 'm')
add('decor:workbench', wb, {'p': '#d9a56c', 'P': '#c99560', 'q': '#8a5a3a', 'm': '#b9bcc6', 'h': '#6e4630'})

# storage chest: body, a domed lid, metal bands and a lock on the front
ch = G()
ch.box(0, 13, 0, 6, 0, 9, lambda x, y, z: 'm' if x in (2, 11) else ('p' if y % 3 else 'P'))
for y in range(7, 10):
    inset = (y - 7)
    ch.box(0, 13, y, y, inset, 9 - inset, lambda x, yy, z: 'm' if x in (2, 11) else 'p')
ch.box(6, 7, 4, 7, 10, 10, 'k')
ch.set(6, 5, 11, 'K').set(7, 5, 11, 'K')
add('decor:chest', ch, {'p': '#c99560', 'P': '#b58450', 'm': '#9a9aa4', 'k': '#f2c14e', 'K': '#6e4630'})

with open(OUT, 'w') as fo:
    fo.write('// Generated by tools/models/decor.py\n[\n')
    for m in models:
        fo.write(f"  {{\n    id: '{m['id']}',\n    scale: {m['scale']},\n    palette: {json.dumps(m['palette'])},\n    layers: [\n")
        for layer in m['layers']:
            fo.write('      [' + ', '.join(f"'{r}'" for r in layer) + '],\n')
        fo.write('    ],\n  },\n')
    fo.write(']\n')
print(f'{len(models)} models → {os.path.relpath(OUT, ROOT)}')
