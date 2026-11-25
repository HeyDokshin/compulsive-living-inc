import { describe, expect, it } from 'vitest'
import { inView, shadowHalf, type CullView } from '../src/engine/render/ViewCull'
import { tileRects } from '../src/plugins/terrain/gen'

const view: CullView = { x: 64, y: 10, z: 64, fx: 0, fz: -1, halfW: 6, halfH: 4, pitch: Math.PI / 4, curvature: 0, margin: 2 }

describe('view culling', () => {
  it('keeps what is in the picture and hides what is outside', () => {
    expect(inView(view, 64, 10, 64, 1)).toBe(true)
    expect(inView(view, 71, 10, 64, 1)).toBe(true) // just past the edge: the margin
    expect(inView(view, 80, 10, 64, 1)).toBe(false)
    expect(inView(view, 64, 10, 40, 1)).toBe(false)
    expect(inView(view, 80, 10, 64, 12)).toBe(true) // a big thing reaches in
  })
  it('knows far things sink on a curved world', () => {
    const wide = { ...view, halfW: 100, halfH: 60 }
    expect(inView(wide, 64, 10, 64 - 110, 1)).toBe(false)
    expect(inView({ ...wide, curvature: 0.0025 }, 64, 10, 64 - 110, 1)).toBe(true)
  })
  it('turns with the camera', () => {
    const east = { ...view, fx: 1, fz: 0 }
    expect(inView(east, 64, 10, 64 + 12, 1)).toBe(false) // now sideways
    expect(inView(view, 64 + 12, 10, 64, 1)).toBe(false)
  })
  it('fits the shadow map to the picture, up to a limit', () => {
    expect(shadowHalf(view, 4, 60)).toBe(16)
    expect(shadowHalf({ ...view, halfW: 500 }, 4, 60)).toBe(60)
  })
})

describe('sea tiles', () => {
  it('cover exactly the same ground', () => {
    const area = (r: readonly (readonly number[])[]) => r.reduce((s, [x0, z0, x1, z1]) => s + (x1! - x0!) * (z1! - z0!), 0)
    const rects: Array<[number, number, number, number, number]> = [[-24, -24, 152, 0, 1], [0, 0, 100, 50, 4]]
    const tiles = tileRects(rects, 16)
    expect(area(tiles)).toBe(area(rects))
    expect(tiles.every(([x0, z0, x1, z1, c]) => x1 - x0 <= 16 * c! && z1 - z0 <= 16 * c!)).toBe(true)
  })
})
