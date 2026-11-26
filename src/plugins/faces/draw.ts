/**
 * Drawing a face: soft 2D cartoon eyes, brows, mouth and blush on a transparent canvas, laid over
 * the round head by the engine (the face is projected onto the front). Everything is measured in
 * voxels of the head model, so the same face is drawn crisp at any resolution.
 */
import type { Expression } from './mood'

export interface FaceLayout {
  center: [number, number]
  size: [number, number]
  style: Record<string, string | number | boolean>
}

export interface FacePose {
  expr: Expression
  /** Eyes shut for a blink. */
  blink: boolean
  /** Mouth while talking: 0 shut, 1 half, 2 open. */
  mouth: 0 | 1 | 2
  /** Where the eyes look (-1…1 across, -1…1 up). */
  lookX: number
  lookY: number
}

const SIDES = [-1, 1] as const
/** Brows that say something: [height above the eye in eye heights, tilt (+ = inner end down)]. */
const BROWS: Partial<Record<Expression, readonly [number, number]>> = {
  angry: [1.05, 0.5],
  sad: [1.2, -0.4],
  worried: [1.25, -0.35],
  surprised: [1.6, 0],
  thinking: [1.3, -0.15],
}

const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d)
const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d)

export function drawFace(g: CanvasRenderingContext2D, W: number, H: number, f: FaceLayout, p: FacePose): void {
  g.clearRect(0, 0, W, H)
  const s = f.style
  const [cx, cy] = f.center
  const [fw, fh] = f.size
  const u = W / fw // pixels per voxel
  const X = (vx: number) => ((vx - (cx - fw / 2)) / fw) * W
  const Y = (vy: number) => (1 - (vy - (cy - fh / 2)) / fh) * H
  const eyeColor = str(s.eyeColor, '#2a2230')
  const gap = num(s.eyeGap, 1.5)
  const eyeY = num(s.eyeY, 3.5)
  const size = num(s.eyeSize, 0.8)
  const lids = num(s.lids, 0)
  const e = p.expr
  g.lineCap = 'round'
  g.lineJoin = 'round'

  // blush first (under everything)
  const blushAmount = e === 'shy' || e === 'love' ? 0.75 : e === 'joy' || e === 'happy' || e === 'wink' ? 0.5 : 0.3
  if (s.blush !== false) {
    g.fillStyle = str(s.blush, '#ff98ad')
    g.globalAlpha = blushAmount
    for (const side of SIDES) {
      g.beginPath()
      g.ellipse(X(cx + side * (gap + 0.55)), Y(eyeY - 1.05), 0.62 * u, 0.3 * u, 0, 0, Math.PI * 2)
      g.fill()
    }
    g.globalAlpha = 1
  }

  // eyes
  const rx = 0.52 * size * u
  const ry = 0.74 * size * u
  const lx = p.lookX * 0.32 * u
  const ly = -p.lookY * 0.28 * u
  for (const side of SIDES) {
    const ex = X(cx + side * gap) + lx
    const ey = Y(eyeY) + ly
    let shape: 'open' | 'arc' | 'shut' | 'heart' = 'open'
    if (p.blink) shape = 'shut'
    else if (e === 'happy' || e === 'joy') shape = 'arc'
    else if (e === 'wink' && side === 1) shape = 'arc'
    else if (e === 'love') shape = 'heart'
    g.strokeStyle = eyeColor
    g.fillStyle = eyeColor
    g.lineWidth = Math.max(1, 0.2 * u)
    if (shape === 'arc') {
      g.beginPath()
      g.moveTo(ex - rx * 1.05, ey + ry * 0.25)
      g.quadraticCurveTo(ex, ey - ry * 1.05, ex + rx * 1.05, ey + ry * 0.25)
      g.stroke()
      continue
    }
    if (shape === 'shut') {
      g.beginPath()
      g.moveTo(ex - rx, ey + ry * 0.1)
      g.quadraticCurveTo(ex, ey + ry * 0.55, ex + rx, ey + ry * 0.1)
      g.stroke()
      continue
    }
    if (shape === 'heart') {
      g.fillStyle = str(s.heart, '#ff5a7a')
      const r = rx * 1.1
      g.beginPath()
      g.moveTo(ex, ey + r * 1.1)
      g.bezierCurveTo(ex - r * 1.6, ey - r * 0.1, ex - r * 0.8, ey - r * 1.3, ex, ey - r * 0.45)
      g.bezierCurveTo(ex + r * 0.8, ey - r * 1.3, ex + r * 1.6, ey - r * 0.1, ex, ey + r * 1.1)
      g.fill()
      continue
    }
    // open eye, maybe partly under a lid
    const big = e === 'surprised' ? 1.22 : e === 'shy' ? 0.9 : 1
    let lid = lids
    if (e === 'sleepy') lid = Math.max(lid, 0.55)
    if (e === 'thinking' && side === 1) lid = Math.max(lid, 0.3)
    g.save()
    if (lid > 0 || e === 'angry' || e === 'sad' || e === 'worried') {
      // cut the top of the eye with a lid line (slanted for angry / sad)
      const tilt = e === 'angry' ? 0.45 : e === 'sad' || e === 'worried' ? -0.35 : 0
      const top = ey - ry * big + ry * big * 2 * Math.max(lid, e === 'angry' ? 0.3 : 0.18)
      g.beginPath()
      g.moveTo(ex - rx * 2, top - side * tilt * rx * 2)
      g.lineTo(ex + rx * 2, top + side * tilt * rx * 2)
      g.lineTo(ex + rx * 2, ey + ry * 3)
      g.lineTo(ex - rx * 2, ey + ry * 3)
      g.closePath()
      g.clip()
    }
    g.beginPath()
    g.ellipse(ex, ey, rx * big, ry * big, 0, 0, Math.PI * 2)
    g.fill()
    // shine
    g.fillStyle = '#ffffff'
    g.globalAlpha = 0.95
    g.beginPath()
    g.arc(ex - rx * 0.32 * big, ey - ry * 0.38 * big, rx * 0.36 * big, 0, Math.PI * 2)
    g.fill()
    g.globalAlpha = 0.7
    g.beginPath()
    g.arc(ex + rx * 0.3 * big, ey + ry * 0.35 * big, rx * 0.16 * big, 0, Math.PI * 2)
    g.fill()
    g.globalAlpha = 1
    g.restore()
    if (lid > 0.05 && e !== 'angry') {
      // the lid's edge
      const top = ey - ry * big + ry * big * 2 * lid
      g.beginPath()
      g.moveTo(ex - rx * 1.05, top)
      g.quadraticCurveTo(ex, top - ry * 0.12, ex + rx * 1.05, top)
      g.stroke()
    }
    if (e === 'sad' && side === 1) {
      // a small tear
      g.fillStyle = str(s.tear, '#8fd3ff')
      g.beginPath()
      g.ellipse(ex + rx * 0.9, ey + ry * 1.05, rx * 0.22, rx * 0.34, 0, 0, Math.PI * 2)
      g.fill()
    }
  }

  // brows (only when they say something)
  if (s.brows !== false && !p.blink) {
    const b = BROWS[e]
    if (b) {
      g.strokeStyle = str(s.brows, eyeColor)
      g.globalAlpha = 0.85
      g.lineWidth = Math.max(1, 0.17 * u)
      for (const side of SIDES) {
        const bx = X(cx + side * gap) + lx * 0.5
        const by = Y(eyeY) - ry * b[0] - (e === 'thinking' && side === 1 ? ry * 0.35 : 0)
        const half = rx * 1.05
        g.beginPath()
        // inner end is the one nearer the middle (side -1: right end; side 1: left end)
        g.moveTo(bx - half, by + (side === 1 ? b[1] : -b[1]) * half * 0.6)
        g.lineTo(bx + half, by + (side === 1 ? -b[1] : b[1]) * half * 0.6)
        g.stroke()
      }
      g.globalAlpha = 1
    }
  }

  // mouth
  if (s.mouth === 'none') return
  const my = Y(num(s.mouthY, 1.8))
  const mx = X(cx)
  const wide = num(s.mouthWide, 1) * u
  const dark = str(s.mouthColor, '#6b2f3a')
  const tongue = str(s.tongue, '#ff8fa3')
  g.strokeStyle = dark
  g.lineWidth = Math.max(1, 0.16 * u)
  const open = p.mouth > 0 ? p.mouth : e === 'joy' ? 2 : e === 'surprised' ? 1 : 0
  if (open > 0) {
    if (e === 'surprised' && p.mouth === 0) {
      g.fillStyle = dark
      g.beginPath()
      g.ellipse(mx, my, 0.24 * wide, 0.3 * wide, 0, 0, Math.PI * 2)
      g.fill()
      return
    }
    const w = (0.32 + 0.14 * open) * wide * (e === 'joy' || e === 'happy' ? 1.2 : 1)
    const h = (0.16 + 0.17 * open) * wide
    g.fillStyle = dark
    g.beginPath()
    if (e === 'sad' || e === 'worried' || e === 'angry') {
      g.ellipse(mx, my, w * 0.8, h * 0.8, 0, 0, Math.PI * 2)
    } else {
      // a "D" smile: flat top, round bottom
      g.moveTo(mx - w, my - h * 0.35)
      g.quadraticCurveTo(mx, my - h * 0.55, mx + w, my - h * 0.35)
      g.quadraticCurveTo(mx + w * 0.9, my + h * 1.1, mx, my + h * 1.05)
      g.quadraticCurveTo(mx - w * 0.9, my + h * 1.1, mx - w, my - h * 0.35)
    }
    g.fill()
    g.save()
    g.clip()
    g.fillStyle = tongue
    g.beginPath()
    g.ellipse(mx, my + h * 0.95, w * 0.6, h * 0.55, 0, 0, Math.PI * 2)
    g.fill()
    g.restore()
    return
  }
  g.beginPath()
  switch (e) {
    case 'sad':
    case 'worried':
      g.moveTo(mx - 0.32 * wide, my + 0.12 * wide)
      g.quadraticCurveTo(mx, my - 0.18 * wide, mx + 0.32 * wide, my + 0.12 * wide)
      break
    case 'angry':
      g.moveTo(mx - 0.3 * wide, my + 0.05 * wide)
      g.lineTo(mx - 0.1 * wide, my - 0.04 * wide)
      g.lineTo(mx + 0.1 * wide, my + 0.04 * wide)
      g.lineTo(mx + 0.3 * wide, my - 0.05 * wide)
      break
    case 'shy':
      g.moveTo(mx - 0.3 * wide, my)
      g.quadraticCurveTo(mx - 0.15 * wide, my - 0.12 * wide, mx, my)
      g.quadraticCurveTo(mx + 0.15 * wide, my + 0.12 * wide, mx + 0.3 * wide, my)
      break
    case 'thinking':
    case 'sleepy':
      g.moveTo(mx - 0.12 * wide, my + 0.02 * wide)
      g.lineTo(mx + 0.22 * wide, my - 0.02 * wide)
      break
    case 'love':
    case 'happy':
    case 'wink':
      // a cat-like ω smile
      g.moveTo(mx - 0.42 * wide, my - 0.06 * wide)
      g.quadraticCurveTo(mx - 0.21 * wide, my + 0.3 * wide, mx, my)
      g.quadraticCurveTo(mx + 0.21 * wide, my + 0.3 * wide, mx + 0.42 * wide, my - 0.06 * wide)
      break
    default:
      g.moveTo(mx - 0.3 * wide, my - 0.04 * wide)
      g.quadraticCurveTo(mx, my + 0.2 * wide, mx + 0.3 * wide, my - 0.04 * wide)
  }
  g.stroke()
}
