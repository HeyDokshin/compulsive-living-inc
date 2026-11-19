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

/** Interpolate the keyframe curve at `hour` (wraps around midnight). */
export function sampleLight(keys: LightKey[], hour: number, azimuthDeg: number, maxElevationDeg: number): LightState {
  const sorted = [...keys].sort((x, y) => x.t - y.t)
  const h = ((hour % 24) + 24) % 24
  let i = sorted.findIndex((k) => k.t > h)
  if (i === -1) i = 0
  const next = sorted[i]!
  const prev = sorted[(i - 1 + sorted.length) % sorted.length]!
  const span = (next.t - prev.t + 24) % 24 || 24
  const k = ((h - prev.t + 24) % 24) / span

  const mix = (p: string, n: string) => new Color().copy(a.set(p)).lerp(b.set(n), k)
  const lerp = (p: number, n: number) => p + (n - p) * k

  // Sun rises at 6, peaks at 12, sets at 18. At night the moon takes the opposite arc.
  const dayPhase = (h - 6) / 12
  const isNight = dayPhase < 0 || dayPhase > 1
  const phase = isNight ? (((h + 6) % 24) / 12) : dayPhase
  const elevation = Math.max(0.12, Math.sin(phase * Math.PI)) * (maxElevationDeg * Math.PI) / 180
  const az = ((azimuthDeg + (phase - 0.5) * 140) * Math.PI) / 180
  const dir: [number, number, number] = [Math.cos(elevation) * Math.sin(az), Math.sin(elevation), Math.cos(elevation) * Math.cos(az)]

  return {
    sun: mix(prev.sun, next.sun),
    sunIntensity: lerp(prev.sunIntensity, next.sunIntensity),
    sky: mix(prev.sky, next.sky),
    ground: mix(prev.ground, next.ground),
    ambient: lerp(prev.ambient, next.ambient),
    background: mix(prev.background, next.background),
    dir,
    isNight,
  }
}

export const DEFAULT_LIGHT_KEYS: LightKey[] = [
  { t: 0, sun: '#8fa6ff', sunIntensity: 0.35, sky: '#2a3a6a', ground: '#1c1a26', ambient: 0.55, background: '#141c33' },
  { t: 5, sun: '#9fb0ff', sunIntensity: 0.3, sky: '#3a4a7a', ground: '#25222e', ambient: 0.6, background: '#26304f' },
  { t: 6.5, sun: '#ffb27a', sunIntensity: 1.2, sky: '#f5b8a0', ground: '#5c4a44', ambient: 0.8, background: '#f2b8a2' },
  { t: 9, sun: '#fff1d6', sunIntensity: 2.0, sky: '#cfe8ff', ground: '#7a6a52', ambient: 1.05, background: '#a8d8ea' },
  { t: 12, sun: '#fff8ec', sunIntensity: 2.3, sky: '#d6ecff', ground: '#7d6d55', ambient: 1.15, background: '#9fd3e6' },
  { t: 16, sun: '#ffe9c4', sunIntensity: 2.0, sky: '#d3e6f7', ground: '#7a6a52', ambient: 1.05, background: '#a5d2e3' },
  { t: 18.3, sun: '#ff9a5c', sunIntensity: 1.2, sky: '#f0a890', ground: '#5a463f', ambient: 0.8, background: '#ee9f86' },
  { t: 20, sun: '#8f9cff', sunIntensity: 0.45, sky: '#3c3f78', ground: '#24202c', ambient: 0.6, background: '#2b2f5c' },
]
