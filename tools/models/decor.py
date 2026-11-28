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

def add(mid, g, pal, wall=False, fabric=None):
    """`fabric`: palette char → material drawn over those voxels (metal, ceramic…)."""
    m = {'id': mid, 'scale': 0.0625, 'palette': pal, 'layers': g.layers()}
    if fabric:
        m['fabric'] = fabric
    if wall:
        # hangs on the face of a wall cell: the art sits against the +z edge of the cell
        sx, sz = len(m['layers'][0][0]), len(m['layers'][0])
        m['pivot'] = [sx / 2, 0, sz - 9]  # one voxel proud of the wall face
    models.append(m)


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
add('decor:lamp', l, {'p': '#4a4a52', 'q': '#3a3a40', 'g': '#ffe9a8'}, fabric={'p': 'core:metal', 'q': 'core:metal'})

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
add('decor:flower_pot', fp, {'p': '#e08a5a', 'e': '#7a5232', 'l': '#7cc45e', 'r': '#ff8fa8', 'y': '#ffe08a'}, fabric={'p': 'core:ceramic', 'e': 'core:dirt', 'l': 'core:leaves'})

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

# ===== indoor furniture =====================================================================
# bed: frame q, blanket p, pillow w (head at the back, -z)
bd = G()
for (x, z) in [(0, 0), (13, 0), (0, 15), (13, 15)]:
    bd.box(x, x + 1, 0, 3, z, z, 'q')
bd.box(0, 13, 2, 3, 0, 15, 'q')
bd.box(0, 13, 4, 5, 0, 15, 'w')
bd.box(0, 13, 6, 6, 5, 15, lambda x, y, z: 'p' if (x + z) % 4 else 'P')
bd.box(0, 13, 5, 5, 5, 15, 'p')
bd.box(2, 11, 6, 7, 1, 3, 'W')
bd.box(0, 13, 4, 11, 0, 0, 'q')
add('decor:bed', bd, {'p': '#9fd8c4', 'P': '#8cc8b2', 'q': '#c99560', 'w': '#fffaf0', 'W': '#f4ede0'})

# table with a top other pieces stand on (surface 11/16)
tb = G()
for (x, z) in [(1, 1), (13, 1), (1, 13), (13, 13)]:
    tb.box(x, x + 1, 0, 9, z, z + 1, 'q')
tb.box(0, 15, 10, 10, 0, 15, lambda x, y, z: 'p' if x % 4 else 'P')
add('decor:table', tb, {'p': '#d9a56c', 'P': '#c99560', 'q': '#b07a50'})

# chair (back at -z)
chr_ = G()
for (x, z) in [(3, 3), (11, 3), (3, 11), (11, 11)]:
    chr_.box(x, x + 1, 0, 5, z, z + 1, 'q')
chr_.box(3, 12, 6, 6, 3, 12, 'p')
chr_.box(3, 12, 7, 14, 3, 3, lambda x, y, z: 'p' if y % 3 else 'q')
add('decor:chair', chr_, {'p': '#d9a56c', 'q': '#b07a50'})

# armchair: soft, with arms
ac = G()
ac.box(1, 14, 0, 1, 1, 14, 'q')
ac.box(1, 14, 2, 6, 1, 14, 'p')
ac.box(1, 14, 7, 13, 1, 3, 'p')
ac.box(1, 2, 7, 9, 4, 14, 'P').box(13, 14, 7, 9, 4, 14, 'P')
ac.box(3, 12, 7, 7, 4, 13, 'w')
add('decor:armchair', ac, {'p': '#f6bccb', 'P': '#e8a8b8', 'q': '#8a5a3a', 'w': '#fffaf0'})

# bookshelf (open towards +z)
bs = G()
bs.box(0, 15, 0, 25, 2, 3, 'q')
bs.box(0, 0, 0, 25, 2, 13, 'p').box(15, 15, 0, 25, 2, 13, 'p')
for y in (0, 8, 16, 25):
    bs.box(0, 15, y, y, 2, 13, 'p')
import random
rnd = random.Random(3)
for shelf in (1, 9, 17):
    x = 1
    while x < 15:
        w = rnd.choice((1, 1, 2))
        h = rnd.randint(4, 6)
        col = rnd.choice('rgbyk')
        bs.box(x, min(14, x + w - 1), shelf, shelf + h - 1, 4, 12, col)
        x += w
add('decor:bookshelf', bs, {'p': '#c99560', 'q': '#a87a50', 'r': '#e8645a', 'g': '#7cc45e', 'b': '#6aa0d8', 'y': '#f2c14e', 'k': '#b58ad8'})

# floor lamp: a round foot, a thin stem, a solid two-tier drum shade lit from below
fl = G()
for x in range(16):
    for z in range(16):
        if math.hypot(x + 0.5 - 8, z + 0.5 - 8) <= 2.6:
            fl.set(x, 0, z, 'q')
fl.box(7, 8, 1, 18, 7, 8, 'q')
for y in range(18, 25):
    r = 4.3 if y < 23 else 3.3
    for x in range(16):
        for z in range(16):
            d = math.hypot(x + 0.5 - 8, z + 0.5 - 8)
            if d <= r:
                # the bulb's light seen through the open bottom
                fl.set(x, y, z, 'g' if y == 18 and d < r - 1 else 'p')
add('decor:floor_lamp', fl, {'p': '#fff1c8', 'q': '#8a7a6a', 'g': '#ffe9a8'})

# rugs: one voxel thick
rr = G()
for x in range(16):
    for z in range(16):
        d = math.hypot(x + 0.5 - 8, z + 0.5 - 8)
        if d <= 7.8:
            rr.set(x, 0, z, 'P' if 4.5 < d < 6 else ('w' if d < 2 else 'p'))
add('decor:rug_round', rr, {'p': '#f6bccb', 'P': '#e8879e', 'w': '#fffaf0'})
rs = G()
for x in range(16):
    for z in range(16):
        edge = x in (0, 15) or z in (0, 15)
        rs.set(x, 0, z, 'q' if edge else ('P' if (x // 3 + z // 3) % 2 else 'p'))
add('decor:rug_square', rs, {'p': '#a6cbea', 'P': '#90b8da', 'q': '#fffaf0'})

# tabletop things
va = G()
for y in range(0, 7):
    r = 2.2 - abs(y - 3) * 0.3
    for x in range(8):
        for z in range(8):
            if math.hypot(x + 0.5 - 4, z + 0.5 - 4) <= r:
                va.set(x, y, z, 'p')
for (x, z, c) in [(3, 3, 'r'), (4, 4, 'y'), (4, 3, 'r'), (3, 4, 'w')]:
    va.set(x, 7, z, 'l').set(x, 8, z, c)
add('decor:vase', va, {'p': '#6aa0d8', 'l': '#7cc45e', 'r': '#ff8fa8', 'y': '#ffe08a', 'w': '#fffaf0'}, fabric={'p': 'core:ceramic', 'w': 'core:ceramic', 'l': 'core:leaves'})
tl = G()
tl.box(2, 5, 0, 0, 2, 5, 'q').box(3, 4, 1, 5, 3, 4, 'q')
# a solid drum shade, narrower at the top, lit from below
for y in range(5, 10):
    r = 2.9 if y < 8 else 2.2
    for x in range(8):
        for z in range(8):
            d = math.hypot(x + 0.5 - 4, z + 0.5 - 4)
            if d <= r:
                tl.set(x, y, z, 'g' if y == 5 and d < r - 1 else 'p')
add('decor:table_lamp', tl, {'p': '#fff1c8', 'q': '#c99560', 'g': '#ffe9a8'})
bk = G()
for i, (c, w) in enumerate([('r', 9), ('b', 8), ('g', 9)]):
    bk.box(0, w - 1, i * 2, i * 2 + 1, i % 2, 5 + i % 2, c)
    bk.box(1, w - 1, i * 2, i * 2 + 1, 1 + i % 2, 4 + i % 2, 'w')
add('decor:books', bk, {'r': '#e8645a', 'b': '#6aa0d8', 'g': '#7cc45e', 'w': '#fffaf0'})
tp = G()
for y in range(0, 5):
    r = 2.6 - abs(y - 2) * 0.45
    for x in range(10):
        for z in range(8):
            if math.hypot(x + 0.5 - 4, z + 0.5 - 4) <= r:
                tp.set(x, y, z, 'p')
tp.set(4, 5, 4, 'p').set(4, 6, 4, 'k')
tp.set(7, 2, 4, 'p').set(8, 3, 4, 'p').set(9, 4, 4, 'p')
tp.set(0, 3, 4, 'p').set(0, 2, 4, 'p').set(1, 4, 4, 'p').set(1, 1, 4, 'p')
add('decor:teapot', tp, {'p': '#fffaf0', 'k': '#6aa0d8'}, fabric={'p': 'core:ceramic', 'k': 'core:ceramic'})

# wall pieces: 16 deep, the art on the +z face (they hang on the side facing you)
pa = G()
for x in range(2, 14):
    for y in range(0, 10):
        edge = x in (2, 13) or y in (0, 9)
        c = 'f' if edge else ('s' if y > 5 else ('h' if y > 3 and (x - y) % 5 < 3 else 'g'))
        if not edge and y in (6, 7) and 8 <= x <= 10:
            c = 'u'
        pa.set(x, y, 15, c)
add('decor:painting', pa, {'f': '#c99560', 's': '#a6d8f0', 'g': '#9bd67a', 'h': '#7cc45e', 'u': '#fff2b8'}, wall=True)
ck = G()
for x in range(3, 13):
    for y in range(0, 10):
        d = math.hypot(x + 0.5 - 8, y + 0.5 - 5)
        if d <= 4.9:
            ck.set(x, y, 15, 'f' if d > 3.9 else 'w')
for (x, y) in [(8, 5), (8, 6), (8, 7), (9, 5), (10, 5)]:
    ck.set(x, y, 15, 'k')
add('decor:wall_clock', ck, {'f': '#b07a50', 'w': '#fffaf0', 'k': '#3a2a2a'}, wall=True)
sh = G()
sh.box(1, 14, 0, 0, 12, 15, 'p')
sh.box(2, 2, 1, 2, 15, 15, 'q').box(13, 13, 1, 2, 15, 15, 'q')
sh.box(4, 5, 1, 4, 13, 14, 'l').box(4, 5, 5, 5, 13, 14, 'L')
sh.box(9, 11, 1, 3, 13, 14, 'c')
add('decor:wall_shelf', sh, {'p': '#d9a56c', 'q': '#b07a50', 'l': '#e08a5a', 'L': '#7cc45e', 'c': '#a6cbea'}, wall=True)

# --- more pieces (stage 16) -----------------------------------------------------------------------
# stool
st = G()
for x in (3, 10):
    for z in (3, 10):
        st.box(x, x + 1, 0, 6, z, z + 1, 'q')
for x in range(2, 14):
    for z in range(2, 14):
        if math.hypot(x + 0.5 - 8, z + 0.5 - 8) <= 6:
            st.set(x, 7, z, 'p').set(x, 8, z, 'p')
add('decor:stool', st, {'p': '#d9a56c', 'q': '#a87a50'})

# barrel with hoops
br = G()
for y in range(0, 16):
    r = 6.2 - abs(y - 7.5) * 0.12
    for x in range(16):
        for z in range(16):
            if math.hypot(x + 0.5 - 8, z + 0.5 - 8) <= r:
                br.set(x, y, z, 'k' if y in (2, 3, 12, 13) else ('p' if (x + z) % 3 else 'P'))
add('decor:barrel', br, {'p': '#b8844a', 'P': '#a8743c', 'k': '#5a5a64'}, fabric={'k': 'core:metal'})

# planter box with flowers
pl = G()
pl.box(1, 14, 0, 4, 4, 11, 'p').box(2, 13, 5, 5, 5, 10, 'e')
for (x, z, c) in [(3, 6, 'r'), (6, 8, 'y'), (9, 6, 'w'), (12, 8, 'r')]:
    pl.set(x, 6, z, 'l').set(x, 7, z, 'l')
    # a little flower head: a center and four petals
    pl.set(x, 8, z, 'y' if c != 'y' else 'r')
    for (dx, dz) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        pl.set(x + dx, 8, z + dz, c)
add('decor:planter', pl, {'p': '#c97a5a', 'e': '#7a5232', 'l': '#7cc45e', 'r': '#ff8fa8', 'y': '#ffe08a', 'w': '#fffaf0'})

# candle on a dish (on tables)
cd = G()
for x in range(7):
    for z in range(7):
        if math.hypot(x + 0.5 - 3.5, z + 0.5 - 3.5) <= 3.4:
            cd.set(x, 0, z, 'q')
cd.box(2, 4, 1, 5, 2, 4, 'p').set(3, 6, 3, 'k').set(3, 7, 3, 'f')
add('decor:candle', cd, {'p': '#fff4e0', 'q': '#c9a46a', 'k': '#3a2a2a', 'f': '#ffb84a'})

# stone lantern
sl = G()
sl.box(4, 11, 0, 1, 4, 11, 's').box(6, 9, 2, 8, 6, 9, 's')
sl.box(4, 11, 9, 9, 4, 11, 's').box(5, 10, 10, 13, 5, 10, lambda x, y, z: 'g' if 6 < x < 9 or 6 < z < 9 else 's')
sl.box(3, 12, 14, 14, 3, 12, 'S').box(5, 10, 15, 15, 5, 10, 'S').box(7, 8, 16, 16, 7, 8, 'S')
add('decor:stone_lantern', sl, {'s': '#b8b4ac', 'S': '#a8a49c', 'g': '#ffe9a8'}, fabric={'s': 'core:stone', 'S': 'core:stone'})

# wind chime on a post
wc = G()
wc.box(7, 8, 0, 18, 7, 8, 'q').box(4, 11, 19, 19, 7, 8, 'q')
for x in (4, 6, 9, 11):
    wc.box(x, x, 12 + (x % 3), 18, 7, 7, 'm')
wc.box(3, 12, 19, 20, 6, 9, 'p')
add('decor:wind_chime', wc, {'q': '#a87a50', 'm': '#c8d4dc', 'p': '#7fcfb0'}, fabric={'m': 'core:metal'})

# shell lamp (on tables)
sh2 = G()
for x in range(8):
    for z in range(8):
        if math.hypot(x + 0.5 - 4, z + 0.5 - 4) <= 3.6:
            sh2.set(x, 0, z, 'q')
sh2.box(3, 4, 1, 4, 3, 4, 'q')
for y in range(5, 10):
    r = 3.6 - (y - 5) * 0.5
    for x in range(8):
        for z in range(8):
            d = math.hypot(x + 0.5 - 4, z + 0.5 - 4)
            if d <= r:
                sh2.set(x, y, z, 'p' if (int(math.degrees(math.atan2(z - 3.5, x - 3.5))) // 30) % 2 else 'P')
add('decor:shell_lamp', sh2, {'p': '#ffe2d6', 'P': '#f6c8b8', 'q': '#e8d4b8'}, fabric={'p': 'core:ceramic', 'P': 'core:ceramic'})

# a fish on a board (wall)
ft = G()
for x in range(1, 15):
    for y in range(0, 8):
        ft.set(x, y, 15, 'b')
for x in range(3, 13):
    h = 3 - abs(x - 7.5) * 0.35
    for y in range(int(4 - h), int(4 + h) + 1):
        ft.set(x, y, 14, 'f')
ft.box(12, 13, 2, 6, 14, 14, 'f').set(4, 4, 13, 'e')
add('decor:fish_trophy', ft, {'b': '#a87a50', 'f': '#6aa0c8', 'e': '#2a2230'}, wall=True)

# a butterfly in a frame (wall)
bf = G()
for x in range(3, 13):
    for y in range(0, 10):
        edge = x in (3, 12) or y in (0, 9)
        bf.set(x, y, 15, 'f' if edge else 'w')
for (x, y) in [(6, 3), (6, 4), (6, 5), (6, 6), (5, 5), (5, 6), (5, 3), (9, 3), (9, 4), (9, 5), (9, 6), (10, 5), (10, 6), (10, 3)]:
    bf.set(x, y, 14, 'a')
bf.box(7, 8, 3, 6, 14, 14, 'k')
add('decor:butterfly_frame', bf, {'f': '#5a3a2a', 'w': '#f4efe4', 'a': '#ffb84a', 'k': '#3a2a2a'}, wall=True)

# a fossil on a little stand (on tables)
fs = G()
fs.box(1, 8, 0, 1, 1, 6, 'q').box(4, 5, 2, 3, 3, 4, 'q')
for x in range(1, 9):
    for y in range(4, 10):
        dx, dy = x + 0.5 - 5, y + 0.5 - 7
        r = math.hypot(dx, dy)
        if r <= 3:
            a = math.atan2(dy, dx)
            fs.set(x, y, 3, 'd' if ((a / (2 * math.pi)) + r / 1.5) % 1 < 0.3 else 'a')
            fs.set(x, y, 4, 'a')
add('decor:fossil_stand', fs, {'q': '#5a3a2a', 'a': '#c8a882', 'd': '#9a7a5a'})

# a winter wreath (wall)
wr = G()
for x in range(3, 13):
    for y in range(0, 10):
        d = math.hypot(x + 0.5 - 8, y + 0.5 - 5)
        if 2.6 <= d <= 4.9:
            wr.set(x, y, 15, 'r' if (x * 7 + y * 3) % 11 == 0 else ('g' if (x + y) % 2 else 'G'))
wr.box(7, 8, 0, 1, 14, 14, 'b')
add('decor:wreath', wr, {'g': '#4a8a5a', 'G': '#3a7a4a', 'r': '#e8423a', 'b': '#e8645a'}, wall=True)

# a gift box (on tables)
gb = G()
gb.box(0, 7, 0, 5, 0, 7, lambda x, y, z: 'r' if x in (3, 4) or z in (3, 4) else 'p')
gb.box(0, 7, 6, 6, 0, 7, lambda x, y, z: 'r' if x in (3, 4) or z in (3, 4) else 'p')
gb.set(2, 7, 3, 'r').set(2, 7, 4, 'r').set(5, 7, 3, 'r').set(5, 7, 4, 'r').set(3, 8, 3, 'r').set(4, 8, 4, 'r')
add('decor:gift_box', gb, {'p': '#7fcfb0', 'r': '#fff4e0'})

with open(OUT, 'w') as fo:
    fo.write('// Generated by tools/models/decor.py\n[\n')
    for m in models:
        pivot = f"    pivot: {json.dumps(m['pivot'])},\n" if 'pivot' in m else ''
        keys = ', '.join(f"{k}: '{v}'" for k, v in m.get('fabric', {}).items())
        fabric = f"    fabric: {{ keys: {{ {keys} }}, tile: 6, strength: 0.6, always: true }},\n" if keys else ''
        fo.write(f"  {{\n    id: '{m['id']}',\n    scale: {m['scale']},\n{pivot}    palette: {json.dumps(m['palette'])},\n{fabric}    layers: [\n")
        for layer in m['layers']:
            fo.write('      [' + ', '.join(f"'{r}'" for r in layer) + '],\n')
        fo.write('    ],\n  },\n')
    fo.write(']\n')
print(f'{len(models)} models → {os.path.relpath(OUT, ROOT)}')
