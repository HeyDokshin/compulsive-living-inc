/** Draws tools/desktop/icon.svg: a little voxel island with a tree. Turn it into icon.png (1024 × 1024) with any SVG renderer. */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const S = 62 // half width of a cube on screen
const H = 66 // its height
const CX = 512
const CY = 640
const shade = (hex, k) => '#' + [1, 3, 5].map((i) => Math.round(Math.min(255, parseInt(hex.slice(i, i + 2), 16) * k)).toString(16).padStart(2, '0')).join('')
const cubes = []
const add = (x, y, z, color, side = color) => cubes.push({ x, y, z, color, side })
// water, sand, grass
for (let x = -3; x <= 3; x++)
  for (let z = -3; z <= 3; z++) {
    const d = Math.abs(x) + Math.abs(z)
    if (d > 4) continue
    if (d === 4) add(x, 0, z, '#7fd8ec')
    else if (d === 3) add(x, 0, z, '#f8ebc4')
    else add(x, 0, z, '#9bd67a', '#c79a72'), d <= 1 && add(x, 1, z, '#a5dd7c', '#c79a72')
  }
// a tree, a flower, a shell
add(0, 2, 0, '#a8705a')
for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) add(x, 3, z, '#6fbf5c')
for (const [x, z] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) add(x, 4, z, '#86d06e')
add(0, 5, 0, '#9be07f')
const apples = [[1, 3, 1], [0, 4, 1], [1, 4, 0]]
cubes.sort((a, b) => a.x + a.z - (b.x + b.z) || a.y - b.y)
const at = (x, y, z) => [CX + (x - z) * S, CY + (x + z) * S * 0.5 - y * H]
const poly = (pts, fill) => `<polygon points="${pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="${fill}" stroke="${fill}" stroke-width="1.5" stroke-linejoin="round"/>`
let body = ''
for (const c of cubes) {
  const [x, y] = at(c.x, c.y, c.z)
  body += poly([[x, y - S * 0.5], [x + S, y], [x, y + S * 0.5], [x - S, y]], c.color)
  body += poly([[x - S, y], [x, y + S * 0.5], [x, y + S * 0.5 + H], [x - S, y + H]], shade(c.side, 0.84))
  body += poly([[x + S, y], [x, y + S * 0.5], [x, y + S * 0.5 + H], [x + S, y + H]], shade(c.side, 0.7))
}
for (const [ax, ay, az] of apples) {
  const [x, y] = at(ax, ay, az)
  body += `<circle cx="${x + S * 0.5}" cy="${y + S * 0.55}" r="17" fill="#ff6b6b"/><circle cx="${x + S * 0.5 - 5}" cy="${y + S * 0.55 - 6}" r="5" fill="#ffb3b3"/>`
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe6f4"/><stop offset="1" stop-color="#fdeedd"/></linearGradient></defs>
<rect x="100" y="100" width="824" height="824" rx="186" fill="url(#sky)"/>
<ellipse cx="512" cy="776" rx="290" ry="66" fill="#8a6a55" opacity=".16"/>
<g transform="translate(512 560) scale(.86) translate(-512 -560)">${body}</g>
</svg>`
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'icon.svg'), svg)
