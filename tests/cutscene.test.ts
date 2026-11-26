import { describe, expect, it } from 'vitest'
import { angleDiff, shotFor, type ShotInput } from '../src/plugins/cutscene/shot'

const cfg = { zoom: 7, fit: 2, pitch: 15, overShoulder: 30, leanSpeaker: 0.15, eyeHeight: 1, clearance: 0.9 }
const base: ShotInput = { px: 0, py: 8, pz: 0, nx: 2, ny: 8, nz: 0, speaking: true, viewYaw: 45, flip: false, cfg }
/** Unit vector from the shot's focus to the camera. */
const camDir = (yaw: number) => [Math.sin((yaw * Math.PI) / 180), Math.cos((yaw * Math.PI) / 180)] as const

describe('conversation close-up', () => {
  it('looks between the two, leaning to the speaker, at face height', () => {
    const s = shotFor(base)
    expect(s.x).toBeCloseTo(1.3)
    expect(s.y).toBeCloseTo(9)
    expect(shotFor({ ...base, speaking: false }).x).toBeCloseTo(0.7)
  })

  it('films from the side nearest the current view, over the listener', () => {
    // they stand along x: the side views look along z; the camera was at +z (yaw 45)
    const them = { ...shotFor(base) } // shotFor reuses its result
    const [cx, cz] = camDir(them.yaw)
    expect(cz).toBeGreaterThan(0.5) // stays on the +z side
    expect(cx).toBeLessThan(0) // swung behind the player (at -x) while the other speaks
    const you = { ...shotFor({ ...base, speaking: false }) }
    expect(camDir(you.yaw)[0]).toBeGreaterThan(0) // behind the other one while the player answers
    expect(Math.abs(angleDiff(them.yaw, you.yaw))).toBeCloseTo(60)
    // from the other side if the camera was there
    expect(camDir(shotFor({ ...base, viewYaw: 225 }).yaw)[1]).toBeLessThan(-0.5)
    // or from the other side when that one is blocked
    expect(camDir(shotFor({ ...base, flip: true }).yaw)[1]).toBeLessThan(-0.5)
  })

  it('turns less when they stand close, so one head never hides the other face', () => {
    const close = shotFor({ ...base, nx: 1 }).yaw
    const side = 0 // camera at +z for two standing along x
    expect(Math.abs(angleDiff(close, side))).toBeLessThanOrEqual((Math.acos(0.9) * 180) / Math.PI + 1e-6)
    expect(Math.abs(angleDiff(shotFor({ ...base, nx: 0.8 }).yaw, side))).toBe(0)
  })

  it('widens when they stand far apart', () => {
    expect(shotFor(base).zoom).toBeCloseTo(7)
    expect(shotFor({ ...base, nx: 4 }).zoom).toBeCloseTo(3.5)
  })
})
