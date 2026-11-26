import { Color } from 'three'

export interface LightKey {
  /** Hour 0..24. */
  t: number
  sun: string
  sunIntensity: number
  sky: string
  ground: string
  ambient: number
  background: string
}

export interface LightState {
  sun: Color
  sunIntensity: number
  sky: Color
  ground: Color
  ambient: number
  background: Color
  /** Unit direction *towards* the light (sun by day, moon by night). */
  dir: [number, number, number]
  isNight: boolean
}

const a = new Color()
const b = new Color()
let sortedFor: LightKey[] | null = null
let sorted: LightKey[] = []

/** A reusable result object (sampleLight writes into it — no allocations per frame). */
export function createLightState(): LightState {
  return { sun: new Color(), sunIntensity: 0, sky: new Color(), ground: new Color(), ambient: 0, background: new Color(), dir: [0, 1, 0], isNight: false }
}

/** Interpolate the keyframe curve at `hour` (wraps around midnight) into `out`. */
export function sampleLight(keys: LightKey[], hour: number, azimuthDeg: number, maxElevationDeg: number, out = createLightState()): LightState {
  if (sortedFor !== keys) {
    sortedFor = keys
    sorted = [...keys].sort((x, y) => x.t - y.t)
  }
  const h = ((hour % 24) + 24) % 24
  let i = sorted.findIndex((k) => k.t > h)
  if (i === -1) i = 0
  const next = sorted[i]!
  const prev = sorted[(i - 1 + sorted.length) % sorted.length]!
  const span = (next.t - prev.t + 24) % 24 || 24
  const k = ((h - prev.t + 24) % 24) / span

  const mix = (target: Color, p: string, n: string) => target.copy(a.set(p)).lerp(b.set(n), k)
  const lerp = (p: number, n: number) => p + (n - p) * k

  // Sun rises at 6, peaks at 12, sets at 18. At night the moon takes the opposite arc.
  const dayPhase = (h - 6) / 12
  const isNight = dayPhase < 0 || dayPhase > 1
  const phase = isNight ? ((h + 6) % 24) / 12 : dayPhase
  const elevation = (Math.max(0.12, Math.sin(phase * Math.PI)) * (maxElevationDeg * Math.PI)) / 180
  const az = ((azimuthDeg + (phase - 0.5) * 140) * Math.PI) / 180

  mix(out.sun, prev.sun, next.sun)
  mix(out.sky, prev.sky, next.sky)
  mix(out.ground, prev.ground, next.ground)
  mix(out.background, prev.background, next.background)
  out.sunIntensity = lerp(prev.sunIntensity, next.sunIntensity)
  out.ambient = lerp(prev.ambient, next.ambient)
  out.dir[0] = Math.cos(elevation) * Math.sin(az)
  out.dir[1] = Math.sin(elevation)
  out.dir[2] = Math.cos(elevation) * Math.cos(az)
  out.isNight = isNight
  return out
}

/** Soft, pastel day: lavender nights, peach mornings, airy noon, candy-pink sunset. */
export const DEFAULT_LIGHT_KEYS: LightKey[] = [
  { t: 0, sun: '#b3c0ff', sunIntensity: 0.55, sky: '#9eaaf0', ground: '#5d5880', ambient: 1.4, background: '#36407a' },
  { t: 4.5, sun: '#bfc8ff', sunIntensity: 0.5, sky: '#a6b0f0', ground: '#625c84', ambient: 1.4, background: '#46508a' },
  { t: 6.3, sun: '#ffc8a8', sunIntensity: 1.1, sky: '#ffdccf', ground: '#b8a090', ambient: 1.4, background: '#ffcfbf' },
  { t: 8.5, sun: '#fff0d8', sunIntensity: 1.7, sky: '#d9ecff', ground: '#c9b393', ambient: 1.45, background: '#b5e3f2' },
  { t: 12, sun: '#fff8ee', sunIntensity: 1.9, sky: '#e2f1ff', ground: '#cdb796', ambient: 1.55, background: '#aee0f2' },
  { t: 16, sun: '#ffe6bf', sunIntensity: 1.8, sky: '#e6ecff', ground: '#cdb48f', ambient: 1.45, background: '#c4e2ee' },
  // golden hour: low warm sun, peachy sky
  { t: 17.4, sun: '#ffc68a', sunIntensity: 1.65, sky: '#ffe2cf', ground: '#c9a88c', ambient: 1.45, background: '#ffd2b4' },
  { t: 18.2, sun: '#ffb494', sunIntensity: 1.2, sky: '#ffd9e0', ground: '#c09aa4', ambient: 1.5, background: '#ffbcc2' },
  { t: 19.6, sun: '#c9b0ff', sunIntensity: 0.65, sky: '#a596e0', ground: '#625878', ambient: 1.25, background: '#7468b8' },
]
