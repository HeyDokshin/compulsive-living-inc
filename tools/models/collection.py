#!/usr/bin/env python3
"""
Parametric voxel models for the collection: fish, bugs and fossils.
Writes content/collection/models.json5. Run: python3 tools/models/collection.py

Model format (see docs/05-plugins.md): layers bottom → top, rows back (-z) → front (+z),
chars left → right (x), '.' = empty, palette char → color. Fish and bugs face +x.
"""
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'content', 'collection', 'models.json5')


class Grid:
    def __init__(self):
        self.v = {}

    def set(self, x, y, z, c):
        self.v[(int(x), int(y), int(z))] = c

    def get(self, x, y, z):
        return self.v.get((int(x), int(y), int(z)))

    def has(self, x, y, z):
        return (int(x), int(y), int(z)) in self.v

    def layers(self):
        xs = [k[0] for k in self.v]
        ys = [k[1] for k in self.v]
        zs = [k[2] for k in self.v]
        x0, x1, y0, y1, z0, z1 = min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)
        out = []
        for y in range(y0, y1 + 1):
            rows = []
            for z in range(z0, z1 + 1):
                rows.append(''.join(self.v.get((x, y, z), '.') for x in range(x0, x1 + 1)))
            out.append(rows)
        return out


def h01(x, y, z, s=0):
    """Deterministic hash → [0, 1)."""
    n = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1442695041) & 0xFFFFFFFF
    n = (n ^ (n >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65536


def ellipsoid(g, cx, cy, cz, rx, ry, rz, color, only_top=False):
    for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            if only_top and y + 0.5 < cy:
                continue
            for z in range(int(cz - rz) - 1, int(cz + rz) + 2):
                d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 + ((z + 0.5 - cz) / rz) ** 2
                if d <= 1:
                    g.set(x, y, z, color(x, y, z) if callable(color) else color)


# ---------------------------------------------------------------------------------------------
# Fish: an ellipse-profiled body (head at +x), a forked tail, a dorsal fin, eyes on both sides.

def fish(L, H, T, pattern='plain', tail_kind='fork', dorsal=True, flat=False, spikes=False, whiskers=False):
    g = Grid()
    tail = max(2, L // 5)
    Lb = L - tail
    cy = H / 2 + 0.5
    cz = T / 2
    for x in range(Lb):
        u = (x + 0.5) / Lb
        p = math.sqrt(max(0.0, 1 - ((u - 0.55) / 0.56) ** 2))
        p = max(p, 0.22)
        hh = max(0.55, H / 2 * p)
        ht = max(0.55, T / 2 * p)
        for y in range(0, H + 2):
            for z in range(0, T + 1):
                d = ((y + 0.5 - cy) / hh) ** 2 + ((z + 0.5 - cz) / ht) ** 2
                if d > 1:
                    continue
                rel = (y + 0.5 - cy) / hh
                c = 'b'
                if flat:
                    c = 'w' if y + 0.5 < cy else 'b'
                    if pattern == 'spots' and y + 0.5 >= cy and h01(x, y, z, 3) < 0.18:
                        c = 's'
                else:
                    if rel < -0.4:
                        c = 'w'
                    elif rel > 0.5 and pattern in ('back', 'stripes', 'spots'):
                        c = 'd'
                    if pattern == 'stripes' and rel > -0.4 and x % 3 == 1 and 0.2 < u < 0.85:
                        c = 's'
                    if pattern == 'spots' and rel > -0.4 and h01(x, y, z, 7) < 0.16:
                        c = 's'
                    if pattern == 'band' and rel > -0.4 and abs(u - 0.5) < 0.12:
                        c = 's'
                if spikes and d > 0.55 and h01(x, y, z, 11) < 0.12:
                    c = 's'
                g.set(x, y, z, c)
    zc = int(cz)
    ymid = int(cy)
    # tail fin
    for d in range(1, tail + 1):
        x = -d
        spread = (d + 0.5) * (H / 2) / tail * (0.9 if flat else 1.1)
        if flat:
            for z in range(int(cz - spread), int(cz + spread) + 1):
                if tail_kind == 'fork' and d > tail / 2 and abs(z + 0.5 - cz) < spread * 0.45:
                    continue
                g.set(x, ymid, z, 'f')
        else:
            for y in range(int(cy - spread), int(cy + spread) + 1):
                if tail_kind == 'fork' and d > tail / 2 and abs(y + 0.5 - cy) < spread * 0.45:
                    continue
                g.set(x, y, zc, 'f')
    # dorsal fin
    if dorsal and not flat:
        for x in range(int(Lb * 0.3), int(Lb * 0.68)):
            top = max(y for (xx, y, zz) in g.v if xx == x and zz == zc)
            g.set(x, top + 1, zc, 'f')
            if Lb * 0.4 < x < Lb * 0.55 and H >= 5:
                g.set(x, top + 2, zc, 'f')
    # eyes
    ex = Lb - max(2, Lb // 6)
    if flat:
        top = max(y for (xx, y, zz) in g.v if xx == ex)
        g.set(ex, top, zc - 1, 'e')
        g.set(ex, top, zc + 1, 'e')
    else:
        ey = int(cy + H * 0.12)
        zs = [z for (xx, yy, z) in g.v if xx == ex and yy == ey]
        if zs:
            g.set(ex, ey, min(zs), 'e')
            g.set(ex, ey, max(zs), 'e')
    if whiskers:
        g.set(Lb, ymid - 1, zc - 1, 'f')
        g.set(Lb, ymid - 1, zc + 1, 'f')
        g.set(Lb + 1, ymid - 2, zc - 2, 'f')
        g.set(Lb + 1, ymid - 2, zc + 2, 'f')
    return g


def octopus():
    g = Grid()
    ellipsoid(g, 5, 6.5, 5, 3.2, 3.6, 3.2, lambda x, y, z: 's' if h01(x, y, z, 2) < 0.12 else 'b')
    for k in range(8):
        a = k * math.pi / 4 + 0.3
        for s in range(9):
            r = 1.6 + s * 0.55
            y = 3 - s * 0.35 + (0.6 if s > 6 else 0)
            x = 5 + math.cos(a + s * 0.12) * r
            z = 5 + math.sin(a + s * 0.12) * r
            g.set(x, max(0, y), z, 'w' if s % 3 == 2 else 'b')
    g.set(8, 7, 3, 'e')
    g.set(8, 7, 6, 'e')
    return g


# ---------------------------------------------------------------------------------------------
# Bugs

def butterfly(eyespot=False, moth=False):
    g = Grid()
    # body along x
    for x in range(1, 8):
        g.set(x, 1, 0, 'k')
    if moth:
        for x in range(2, 7):
            g.set(x, 2, 0, 'k')
    g.set(8, 2, 0, 'k')
    g.set(9, 3, -1, 'k')
    g.set(9, 3, 1, 'k')
    lobes = [(5.6, 3.6, 2.7, 3.2), (2.4, 3.0, 2.2, 2.6)]  # (cx, cz, rx, rz)
    cells = set()
    for side in (-1, 1):
        for x in range(-1, 10):
            for zz in range(1, 8):
                for (cx, cz, rx, rz) in lobes:
                    if ((x + 0.5 - cx) / rx) ** 2 + ((zz + 0.5 - cz) / rz) ** 2 <= 1:
                        cells.add((x, zz * side))
    for (x, z) in cells:
        edge = any((x + dx, z + dz) not in cells and (z + dz) != 0 for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        c = 'b' if edge else 'a'
        if eyespot:
            d = math.hypot(x + 0.5 - 6.2, abs(z) + 0.5 - 4.0)
            if d < 0.8:
                c = 'e'
            elif d < 1.7:
                c = 'c'
        elif not edge and h01(x, 0, abs(z), 5) < 0.1:
            c = 'c'
        y = 1 + (1 if abs(z) >= 4 else 0)
        g.set(x, y, z, c)
    return g


def bee():
    g = Grid()
    ellipsoid(g, 4, 2.5, 3, 3.6, 2.4, 2.4, lambda x, y, z: 'k' if x in (1, 4) else 'a')
    ellipsoid(g, 8, 2.5, 3, 1.3, 1.3, 1.3, 'k')
    for x in (3, 4, 5):
        g.set(x, 5, 1, 'g')
        g.set(x, 5, 5, 'g')
        g.set(x - 1, 5, 0, 'g')
        g.set(x - 1, 5, 6, 'g')
    return g


def dome(L, T, H, color_fn, legs=True):
    g = Grid()
    ellipsoid(g, L / 2, 0.5, T / 2, L / 2, H, T / 2, color_fn, only_top=True)
    if legs:
        for x in (int(L * 0.3), int(L * 0.55), int(L * 0.75)):
            g.set(x, 0, -1, 'k')
            g.set(x, 0, T, 'k')
    return g


def ladybug():
    def col(x, y, z):
        if x >= 5:
            return 'k'
        if z == 3 and y >= 2:
            return 'k'
        return 'k' if h01(x, y, z, 9) < 0.18 else 'a'
    g = dome(6, 6, 3.2, col)
    g.set(6, 1, 2, 'e')
    g.set(6, 1, 3, 'e')
    return g


def rhino():
    g = dome(9, 6, 3.8, lambda x, y, z: 'c' if (y >= 3 and h01(x, y, z, 1) < 0.25) else 'a')
    ellipsoid(g, 9.5, 1.5, 3, 1.6, 1.5, 1.8, 'b')
    for i, (x, y) in enumerate([(10, 3), (11, 4), (11, 5), (12, 6), (12, 7), (11, 8)]):
        g.set(x, y, 3, 'b')
    return g


def dragonfly():
    g = Grid()
    for x in range(0, 10):
        g.set(x, 1, 0, 'a' if x % 2 else 'b')
    ellipsoid(g, 11, 1.5, 0.5, 1.6, 1.1, 1.1, 'a')
    g.set(13, 2, -1, 'e')
    g.set(13, 2, 1, 'e')
    g.set(13, 1, 0, 'a')
    for wx in (9, 11):
        for z in range(1, 7):
            for s in (-1, 1):
                g.set(wx, 2, z * s, 'g')
                if 2 <= z <= 5:
                    g.set(wx + (1 if wx == 11 else -1), 2, z * s, 'g')
    return g


def firefly():
    g = Grid()
    ellipsoid(g, 3.5, 1.5, 1.5, 3, 1.4, 1.4, lambda x, y, z: 'y' if x <= 1 else ('a' if x >= 5 else 'k'))
    g.set(7, 2, 1, 'a')
    return g


def cicada():
    g = Grid()
    ellipsoid(g, 4, 1.8, 2.5, 4, 1.8, 2.3, lambda x, y, z: 'b' if x >= 6 else 'a')
    g.set(8, 2, 0, 'e')
    g.set(8, 2, 4, 'e')
    for x in range(-2, 7):
        for z in (0, 1, 3, 4):
            if x < 0 and z in (0, 4):
                continue
            g.set(x, 4, z, 'g')
    return g


def hopper():
    g = Grid()
    ellipsoid(g, 5, 2, 1.5, 5, 1.6, 1.4, lambda x, y, z: 'b' if y >= 3 else 'a')
    ellipsoid(g, 10, 2.5, 1.5, 1.4, 1.4, 1.2, 'a')
    g.set(11, 3, 0, 'e')
    g.set(11, 3, 2, 'e')
    for z in (-1, 3):
        for (x, y) in [(4, 1), (3, 2), (2, 3), (1, 4), (0, 3), (-1, 2), (-2, 1), (-3, 0)]:
            g.set(x, y, z, 'b')
        g.set(7, 0, z, 'b')
        g.set(8, 1, z, 'b')
    g.set(12, 4, 0, 'b')
    g.set(13, 5, 0, 'b')
    g.set(12, 4, 2, 'b')
    g.set(13, 5, 2, 'b')
    return g


def pillbug():
    def col(x, y, z):
        return 'b' if x % 2 == 0 else 'a'
    g = dome(7, 5, 2.6, col)
    g.set(7, 0, 2, 'k')
    return g


def strider():
    g = Grid()
    for x in range(2, 7):
        g.set(x, 1, 0, 'a')
    g.set(7, 1, 0, 'b')
    for (x0, dx, n) in [(6, 1, 3), (4, 0, 5), (3, -1, 6)]:
        for s in (-1, 1):
            for i in range(1, n + 1):
                g.set(x0 + dx * i // 2, 0, s * i, 'b')
    return g


def ant():
    g = Grid()
    ellipsoid(g, 2, 1.6, 1.5, 2, 1.6, 1.5, 'a')
    ellipsoid(g, 5, 1.6, 1.5, 1.1, 1.0, 1.0, 'a')
    ellipsoid(g, 7.5, 1.8, 1.5, 1.4, 1.3, 1.3, 'a')
    for x in (4, 5, 6):
        g.set(x, 0, -1, 'b')
        g.set(x, 0, 3, 'b')
    g.set(9, 3, 0, 'b')
    g.set(9, 3, 2, 'b')
    g.set(8, 2, 0, 'e')
    g.set(8, 2, 2, 'e')
    return g


def snail():
    g = Grid()
    for x in range(0, 9):
        g.set(x, 0, 1, 'b')
        g.set(x, 0, 2, 'b')
    g.set(8, 1, 1, 'b')
    g.set(8, 2, 1, 'b')
    g.set(8, 1, 2, 'b')
    g.set(8, 2, 2, 'b')
    g.set(8, 3, 1, 'e')
    g.set(8, 3, 2, 'e')
    for x in range(1, 7):
        for y in range(1, 7):
            for z in range(0, 4):
                dx, dy = x + 0.5 - 3.8, y + 0.5 - 3.6
                r = math.hypot(dx, dy)
                if r <= 3 and 0 < z < 3 or (r <= 2.2 and z in (0, 3)):
                    a = math.atan2(dy, dx)
                    ridge = ((a / (2 * math.pi)) + r / 1.4) % 1 < 0.3
                    g.set(x, y, z, 'c' if ridge else 'a')
    return g


# ---------------------------------------------------------------------------------------------
# Fossils (bone/stone colors)

def ammonite():
    g = Grid()
    for x in range(12):
        for y in range(12):
            dx, dy = x + 0.5 - 6, y + 0.5 - 6
            r = math.hypot(dx, dy)
            if r > 6:
                continue
            a = math.atan2(dy, dx)
            ridge = ((a / (2 * math.pi)) + r / 2.0) % 1 < 0.28
            for z in range(3):
                if z != 1 and r > 5.4:
                    continue
                g.set(x, y, z, 'd' if ridge else 'a')
    return g


def trilobite():
    g = Grid()
    for x in range(10):
        for z in range(8):
            u = (x + 0.5) / 10
            half = 3.9 * math.sqrt(max(0, 1 - ((u - 0.55) / 0.6) ** 2))
            if abs(z + 0.5 - 4) > half:
                continue
            c = 'd' if x % 2 == 0 and x < 7 else 'a'
            g.set(x, 0, z, c)
            if abs(z + 0.5 - 4) < 1.2:
                g.set(x, 1, z, 'a' if x < 7 else 'd')
    g.set(8, 1, 2, 'e')
    g.set(8, 1, 5, 'e')
    return g


def tooth():
    g = Grid()
    for y in range(11):
        half = (10 - y) * 0.48
        for x in range(-6, 7):
            if abs(x) > half:
                continue
            c = 'd' if y < 2 else 'a'
            if abs(abs(x) - half) < 0.6 and y % 2 == 0 and y >= 2:
                c = 'c'
            for z in range(2):
                g.set(x, y, z, c)
    return g


def fern():
    g = Grid()
    for x in range(11):
        for z in range(8):
            g.set(x, 0, z, 'a')
            g.set(x, 1, z, 'a')
    for x in range(1, 10):
        g.set(x, 1, 4, 'f')
        if x % 2 == 1:
            w = max(1, 3 - abs(x - 4) // 2)
            for k in range(1, w + 1):
                g.set(x + k // 2, 1, 4 - k, 'f')
                g.set(x + k // 2, 1, 4 + k, 'f')
    return g


def amber():
    g = Grid()
    ellipsoid(g, 3.5, 3, 3, 3.4, 3, 2.8, lambda x, y, z: 'b' if h01(x, y, z, 4) < 0.15 else 'a')
    g.set(3, 3, 3, 'i')
    g.set(4, 3, 3, 'i')
    g.set(3, 4, 2, 'i')
    g.set(3, 4, 4, 'i')
    return g


def skull():
    g = Grid()
    # head
    ellipsoid(g, 7, 3, 4.5, 4.2, 3, 3.2, lambda x, y, z: 'd' if h01(x, y, z, 6) < 0.12 else 'a')
    # beak
    for x in range(11, 14):
        for y in range(1, 4 - (x - 11)):
            for z in (3, 4, 5):
                g.set(x, y, z, 'a')
    g.set(13, 4, 4, 'a')
    # frill (standing disc at the back)
    for y in range(0, 11):
        for z in range(-2, 11):
            r = math.hypot(y + 0.5 - 4, z + 0.5 - 4.5)
            if r <= 6.2:
                g.set(2, y, z, 'c' if r > 5.4 and (y + z) % 2 else 'a')
                if r < 4:
                    g.set(3, y, z, 'a')
    # horns
    for i in range(5):
        g.set(8 + i, 5 + i // 2, 2, 'c')
        g.set(8 + i, 5 + i // 2, 6, 'c')
    g.set(11, 4, 4, 'c')
    g.set(12, 5, 4, 'c')
    g.set(9, 4, 2, 'e')
    g.set(9, 4, 6, 'e')
    return g


def claw():
    g = Grid()
    for i in range(14):
        a = i / 13 * math.pi * 0.85
        r = 6
        x = 1 + r * (1 - math.cos(a))
        y = r * math.sin(a)
        thick = 2 if i < 9 else 1
        for t in range(thick):
            for z in range(2):
                g.set(x - t * 0.5, y + t, z, 'd' if i < 2 else 'a')
    return g


def egg():
    g = Grid()
    ellipsoid(g, 3, 4, 3, 3, 4, 3, lambda x, y, z: 's' if h01(x, y, z, 8) < 0.14 else 'a')
    return g


# ---------------------------------------------------------------------------------------------

def model(mid, g, palette, scale=0.0625):
    return {'id': mid, 'scale': scale, 'palette': palette, 'layers': g.layers()}


FISH_EYE = '#2a2230'
models = []

def add_fish(name, args, b, w, f, s='#ffffff', d=None, **kw):
    pal = {'b': b, 'w': w, 'f': f, 'e': FISH_EYE, 's': s, 'd': d or b}
    models.append(model(f'collection:{name}', fish(*args, **kw), pal))

add_fish('crucian', (11, 6, 3), '#c9a35a', '#efe0b0', '#b8864a', pattern='back', d='#a8823e')
add_fish('carp', (15, 7, 4), '#d98a4a', '#f4e1c0', '#e06a3a', s='#f7f1e6', pattern='spots', d='#c96a2a', whiskers=True)
add_fish('perch', (11, 6, 3), '#a7b84a', '#f1ecc4', '#ff8a4a', s='#5a6a2a', pattern='stripes')
add_fish('roach', (10, 5, 3), '#b8c4cc', '#f2f4f6', '#ff7a6a', pattern='back', d='#7f96a8')
add_fish('ruffe', (9, 5, 3), '#b59a5a', '#efe2b8', '#8a7040', s='#6a5530', pattern='spots')
add_fish('pike', (19, 5, 3), '#7fa25a', '#eef0c8', '#9a8a4a', s='#d8e08a', pattern='spots', d='#5d7a3d', tail_kind='round')
add_fish('salmon', (16, 6, 4), '#d98a7a', '#f6e4dc', '#b46a5a', s='#4a3a40', pattern='spots', d='#8a7a8a')
add_fish('catfish', (17, 5, 5), '#6a6a74', '#d8d4c8', '#55555f', pattern='back', d='#4a4a52', dorsal=False, tail_kind='round', whiskers=True)
add_fish('goldfish', (8, 6, 3), '#ff9a3a', '#ffd9a0', '#ffb36a', pattern='plain')
add_fish('sea_bass', (14, 6, 4), '#8aa4b8', '#eef2f4', '#6a8498', pattern='back', d='#5a7488')
add_fish('flounder', (12, 2, 9), '#b8a07a', '#f4efe4', '#a08a68', s='#7a6448', pattern='spots', flat=True, tail_kind='round')
add_fish('mackerel', (13, 5, 3), '#5fa0b8', '#f0f4f4', '#4a7a8c', s='#2f5a6a', pattern='stripes', d='#3f7a90')
add_fish('pufferfish', (9, 8, 7), '#e8d48a', '#fbf5dc', '#d8b45a', s='#8a7040', spikes=True, tail_kind='round')
models.append(model('collection:octopus', octopus(), {'b': '#e8786a', 'w': '#f6b4a4', 's': '#c9584a', 'e': FISH_EYE}))

rigs = []
WINGS = {'butterfly': set('abce'), 'glass': set('g')}


def add_bug(name, g, pal, wings=None):
    """wings: a set of palette chars that make the wings — then also emit body/wing parts and a rig
    so the bugs plugin can flap them (hinge along the body line z = 0)."""
    mid = f'collection:{name}'
    models.append(model(mid, g, pal))
    if not wings:
        return
    xs = [k[0] for k in g.v]; ys = [k[1] for k in g.v]; zs = [k[2] for k in g.v]
    x0, y0, z0 = min(xs), min(ys), min(zs)
    sx, sz = max(xs) - x0 + 1, max(zs) - z0 + 1
    origin = (x0 + sx / 2, y0, z0 + sz / 2)  # = the full model's default pivot, in grid coords
    parts = {'body': Grid(), 'wingL': Grid(), 'wingR': Grid()}
    for (x, y, z), c in g.v.items():
        part = 'body' if c not in wings or z == 0 else ('wingL' if z < 0 else 'wingR')
        parts[part].set(x, y, z, c)
    wing_y = min(k[1] for p in ('wingL', 'wingR') for k in parts[p].v)
    hinge = (origin[0], wing_y, 0.5)
    rig_parts = []
    for pname, pg in parts.items():
        if not pg.v:
            continue
        pmin = (min(k[0] for k in pg.v), min(k[1] for k in pg.v), min(k[2] for k in pg.v))
        anchor = origin if pname == 'body' else hinge
        pivot = [round(anchor[i] - pmin[i], 3) for i in range(3)]
        at = [round(anchor[i] - origin[i], 3) for i in range(3)]
        models.append(model(f'{mid}_{pname}', pg, pal))
        rig_parts.append({'name': pname, 'model': f'{mid}_{pname}', 'pivot': pivot, 'at': at})
    rigs.append({'id': mid, 'scale': 0.0625, 'parts': rig_parts})

add_bug('cabbage_white', butterfly(), {'a': '#fbfaf2', 'b': '#e6e4d4', 'c': '#3a3a3a', 'k': '#4a4a4a'}, wings=WINGS['butterfly'])
add_bug('peacock_eye', butterfly(eyespot=True), {'a': '#c9483a', 'b': '#5a2a2a', 'c': '#5a8ad8', 'e': '#ffe08a', 'k': '#3a2a2a'}, wings=WINGS['butterfly'])
add_bug('moth', butterfly(moth=True), {'a': '#b8a48a', 'b': '#8a765e', 'c': '#6a5a48', 'k': '#7a6a58'}, wings=WINGS['butterfly'])
add_bug('winter_moth', butterfly(moth=True), {'a': '#e2dccc', 'b': '#bcb4a0', 'c': '#a49c88', 'k': '#9c9484'}, wings=WINGS['butterfly'])
add_bug('bumblebee', bee(), {'a': '#ffd23a', 'k': '#3a3030', 'g': '#eef6ff'}, wings=WINGS['glass'])
add_bug('ladybug', ladybug(), {'a': '#e8423a', 'k': '#2a2226', 'e': '#ffffff'})
add_bug('dragonfly', dragonfly(), {'a': '#3aa0c8', 'b': '#2a6a8a', 'e': '#2a3a4a', 'g': '#dff4ff'}, wings=WINGS['glass'])
add_bug('red_dragonfly', dragonfly(), {'a': '#e0563a', 'b': '#a8382a', 'e': '#4a2a2a', 'g': '#fff0e6'}, wings=WINGS['glass'])
add_bug('firefly', firefly(), {'k': '#3a3436', 'a': '#e8704a', 'y': '#f6ff8a'})
add_bug('cicada', cicada(), {'a': '#6a8a4a', 'b': '#4a5a34', 'e': '#c84a3a', 'g': '#e8f4ec'})
add_bug('rhino_beetle', rhino(), {'a': '#6a3a2a', 'b': '#4a2a20', 'c': '#9a6a54', 'k': '#3a2420'})
add_bug('grasshopper', hopper(), {'a': '#7ac45a', 'b': '#5a9a3a', 'e': '#2a3a20'})
add_bug('cricket', hopper(), {'a': '#6a4a34', 'b': '#4a3424', 'e': '#1e1612'})
add_bug('pill_bug', pillbug(), {'a': '#8a8a96', 'b': '#6a6a76', 'k': '#4a4a54'})
add_bug('pond_skater', strider(), {'a': '#4a4a52', 'b': '#2a2a30'})
add_bug('ant', ant(), {'a': '#3a2a2a', 'b': '#2a1e1e', 'e': '#7a4a3a'})
add_bug('snail', snail(), {'a': '#d8a46a', 'c': '#a8744a', 'b': '#c8c0b0', 'e': '#3a3434'})

BONE = {'a': '#ece2c8', 'd': '#c8b896', 'c': '#fff8e6', 'e': '#8a7a62'}
STONE = {'a': '#b8b2a8', 'd': '#8f8a82', 'c': '#d8d2c8', 'e': '#5a5650'}
models.append(model('collection:ammonite', ammonite(), {**STONE, 'a': '#c8a882', 'd': '#9a7a5a'}))
models.append(model('collection:trilobite', trilobite(), STONE))
models.append(model('collection:megalodon_tooth', tooth(), {'a': '#d8d0bc', 'd': '#8a7a6a', 'c': '#f4eee0'}))
models.append(model('collection:fern_imprint', fern(), {'a': '#c4bcae', 'f': '#7a8a5a'}))
models.append(model('collection:amber', amber(), {'a': '#f0a83a', 'b': '#f8c86a', 'i': '#5a3a1a'}))
models.append(model('collection:triceratops_skull', skull(), BONE))
models.append(model('collection:raptor_claw', claw(), BONE))
models.append(model('collection:dino_egg', egg(), {'a': '#e6dcc4', 's': '#b8a888'}))


def dump(ms):
    lines = ['// Generated by tools/models/collection.py — edit the generator, not this file.', '[']
    for m in ms:
        lines.append('  {')
        lines.append(f"    id: '{m['id']}',")
        lines.append(f"    scale: {m['scale']},")
        lines.append(f"    palette: {json.dumps(m['palette'])},")
        lines.append('    layers: [')
        for layer in m['layers']:
            lines.append('      [' + ', '.join(f"'{r}'" for r in layer) + '],')
        lines.append('    ],')
        lines.append('  },')
    lines.append(']')
    return '\n'.join(lines) + '\n'


os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w') as f:
    f.write(dump(models))
RIGS = os.path.join(ROOT, 'content', 'collection', 'rigs.json5')
with open(RIGS, 'w') as f:
    f.write('// Generated by tools/models/collection.py — winged bugs: body + wings that flap (hinge on the body line).\n[\n')
    for r in rigs:
        f.write(f"  {{ id: '{r['id']}', scale: {r['scale']}, parts: [\n")
        for p in r['parts']:
            f.write(f"    {{ name: '{p['name']}', model: '{p['model']}', pivot: {json.dumps(p['pivot'])}, at: {json.dumps(p['at'])} }},\n")
        f.write('  ] },\n')
    f.write(']\n')
print(f'{len(models)} models → {os.path.relpath(OUT, ROOT)}, {len(rigs)} rigs → {os.path.relpath(RIGS, ROOT)}')
for m in models:
    L = m['layers']
    print(f"  {m['id']:36} {len(L[0][0])}×{len(L)}×{len(L[0])}")
