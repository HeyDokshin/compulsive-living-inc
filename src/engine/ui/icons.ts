import type { VoxelModel } from '../models/voxelModel'
import { voxelAt } from '../models/voxelModel'

/** Pixel-art isometric icon of a voxel model, drawn on a 2D canvas (no WebGL needed). */
export function paintVoxelIcon(model: VoxelModel, colors: string[], size = 64): string {
  const [sx, sy, sz] = model.size
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  // a = half-width of one voxel's diamond; fit (sx + sz) wide and (sx + sz) / 2 + sy tall
  const a = Math.max(1, Math.floor(Math.min((size - 4) / (sx + sz), (size - 4) / ((sx + sz) / 2 + sy))))
  const w = (sx + sz) * a
  const h = ((sx + sz) / 2 + sy) * a
  const ox = Math.round((size - w) / 2 + sz * a)
  const oy = Math.round((size - h) / 2 + sy * a)
  const shade = (hex: string, k: number) => {
    const n = parseInt(hex.slice(1), 16)
    const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)))
    return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`
  }
  // Viewer at front-right (+x, +z): draw far voxels first.
  const cells: Array<[number, number, number]> = []
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) if (voxelAt(model, x, y, z)) cells.push([x, y, z])
  cells.sort((p, q) => p[0] + p[2] - (q[0] + q[2]) || p[1] - q[1])
  for (const [x, y, z] of cells) {
    const col = colors[voxelAt(model, x, y, z)] ?? '#ff00ff'
    // screen position of the voxel's top-front corner (x+1, y+1, z+1) projected
    const px = ox + (x - z) * a
    const py = oy + ((x + z) / 2) * a - y * a
    const top = [
      [px, py - a / 2],
      [px + a, py],
      [px, py + a / 2],
      [px - a, py],
    ]
    if (!voxelAt(model, x, y + 1, z)) poly(g, top, shade(col, 1.08))
    if (!voxelAt(model, x, y, z + 1))
      poly(
        g,
        [
          [px - a, py],
          [px, py + a / 2],
          [px, py + a * 1.5],
          [px - a, py + a],
        ],
        shade(col, 0.9),
      )
    if (!voxelAt(model, x + 1, y, z))
      poly(
        g,
        [
          [px, py + a / 2],
          [px + a, py],
          [px + a, py + a],
          [px, py + a * 1.5],
        ],
        shade(col, 0.74),
      )
  }
  return c.toDataURL()
}

/**
 * Flat pixel sprite of the model's front view, tilted diagonally with a soft outline —
 * reads much better than isometry for tall, thin things like tools.
 */
export function paintSpriteIcon(model: VoxelModel, colors: string[], size = 64, angleDeg = -40): string {
  const [sx, sy, sz] = model.size
  // front view (looking along -z): nearest voxel per (x, y); a bit darker when it sits deeper
  const sprite = document.createElement('canvas')
  sprite.width = sx + 2
  sprite.height = sy + 2
  const g = sprite.getContext('2d')!
  const img = g.createImageData(sx + 2, sy + 2)
  const mask = new Uint8Array((sx + 2) * (sy + 2))
  for (let y = 0; y < sy; y++) {
    for (let x = 0; x < sx; x++) {
      for (let z = sz - 1; z >= 0; z--) {
        const c = voxelAt(model, x, y, z)
        if (!c) continue
        const n = parseInt((colors[c] ?? '#ff00ff').slice(1), 16)
        const k = 1 - (sz - 1 - z) * 0.06
        const px = x + 1
        const py = sy - y // flip: y up → canvas down
        const i = (py * (sx + 2) + px) * 4
        img.data[i] = Math.min(255, ((n >> 16) & 255) * k)
        img.data[i + 1] = Math.min(255, ((n >> 8) & 255) * k)
        img.data[i + 2] = Math.min(255, (n & 255) * k)
        img.data[i + 3] = 255
        mask[py * (sx + 2) + px] = 1
        break
      }
    }
  }
  // 1px soft outline around the silhouette
  for (let y = 0; y < sy + 2; y++) {
    for (let x = 0; x < sx + 2; x++) {
      if (mask[y * (sx + 2) + x]) continue
      const near = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => mask[(y + dy!) * (sx + 2) + (x + dx!)] === 1)
      if (!near) continue
      const i = (y * (sx + 2) + x) * 4
      img.data[i] = 120
      img.data[i + 1] = 92
      img.data[i + 2] = 86
      img.data[i + 3] = 150
    }
  }
  g.putImageData(img, 0, 0)

  const c = document.createElement('canvas')
  c.width = c.height = size
  const out = c.getContext('2d')!
  out.imageSmoothingEnabled = false
  const a = (angleDeg * Math.PI) / 180
  // fit the rotated sprite's bounding box
  const w = sx + 2
  const h = sy + 2
  const bw = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))
  const bh = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a))
  const scale = Math.max(1, Math.floor(((size - 2) / Math.max(bw, bh)) * 2) / 2)
  out.translate(size / 2, size / 2)
  out.rotate(a)
  out.scale(scale, scale)
  out.drawImage(sprite, -w / 2, -h / 2)
  return c.toDataURL()
}

/** Is this model tall and thin enough to look better as a flat sprite? */
export function prefersSprite(model: VoxelModel): boolean {
  const [sx, sy, sz] = model.size
  return sy >= 1.6 * Math.max(sx, sz)
}

/** Isometric cube icon from the block atlas: tiles for top and side faces (atlas pixel rects). */
export function paintBlockIcon(atlas: HTMLCanvasElement, top: [number, number, number, number], side: [number, number, number, number], size = 64): string {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false
  const w = size * 0.42
  const cx = size / 2
  const ty = size * 0.1
  const draw = (rect: number[], m: [number, number, number, number, number, number], dark: number) => {
    g.save()
    g.setTransform(...m)
    g.drawImage(atlas, rect[0]!, rect[1]!, rect[2]!, rect[3]!, 0, 0, 16, 16)
    if (dark > 0) {
      g.fillStyle = `rgba(60,40,50,${dark})`
      g.fillRect(0, 0, 16, 16)
    }
    g.restore()
  }
  // top diamond: T=(cx,ty) R=(cx+w,ty+w/2) L=(cx-w,ty+w/2)
  draw(top, [w / 16, w / 32, -w / 16, w / 32, cx, ty], 0)
  // left face from L down, right face from bottom vertex B=(cx, ty+w)
  draw(side, [w / 16, w / 32, 0, w / 16, cx - w, ty + w / 2], 0.08)
  draw(side, [w / 16, -w / 32, 0, w / 16, cx, ty + w], 0.22)
  return c.toDataURL()
}

/** Simple round icon for items without a model. */
export function paintDotIcon(color: string, size = 64): string {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  g.fillStyle = color
  g.beginPath()
  g.arc(size / 2, size / 2, size * 0.3, 0, Math.PI * 2)
  g.fill()
  return c.toDataURL()
}

function poly(g: CanvasRenderingContext2D, pts: number[][], fill: string): void {
  g.fillStyle = fill
  g.beginPath()
  pts.forEach(([x, y], i) => (i ? g.lineTo(x!, y!) : g.moveTo(x!, y!)))
  g.closePath()
  g.fill()
}
