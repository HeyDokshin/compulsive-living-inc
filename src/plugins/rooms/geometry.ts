/**
 * Geometry for room shells: boxes and panels with texture coordinates in world units (a material
 * tiles evenly over walls of any size, edges line up from piece to piece). Pure arrays; the plugin
 * turns them into three.js geometry.
 */

export class MeshBuilder {
  readonly pos: number[] = []
  readonly nor: number[] = []
  readonly uv: number[] = []
  readonly col: number[] = []
  readonly idx: number[] = []

  constructor(
    /** Texture repeats per world unit. */
    private scale = 1,
  ) {}

  get empty(): boolean {
    return this.idx.length === 0
  }

  /** A quad from 4 corners (counter-clockwise seen from the front), uv from world coordinates. */
  quad(
    p: ReadonlyArray<readonly [number, number, number]>,
    n: readonly [number, number, number],
    shade: readonly number[] = [1, 1, 1, 1],
  ): void {
    const base = this.pos.length / 3
    // uv: project on the plane the normal is most across
    const ax = Math.abs(n[0])
    const ay = Math.abs(n[1])
    for (let i = 0; i < 4; i++) {
      const [x, y, z] = p[i]!
      this.pos.push(x, y, z)
      this.nor.push(n[0], n[1], n[2])
      if (ay >= ax && ay >= Math.abs(n[2])) this.uv.push(x * this.scale, z * this.scale)
      else if (ax >= Math.abs(n[2])) this.uv.push(z * this.scale, y * this.scale)
      else this.uv.push(x * this.scale, y * this.scale)
      const s = shade[i] ?? 1
      this.col.push(s, s, s)
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  /** An axis-aligned box; `skip` leaves faces out (e.g. 'top' when a cap sits on it). */
  box(
    min: readonly [number, number, number],
    max: readonly [number, number, number],
    skip: ReadonlyArray<'top' | 'bottom' | 'px' | 'nx' | 'pz' | 'nz'> = [],
  ): void {
    const [x0, y0, z0] = min
    const [x1, y1, z1] = max
    if (x1 <= x0 || y1 <= y0 || z1 <= z0) return
    if (!skip.includes('top'))
      this.quad(
        [
          [x0, y1, z1],
          [x1, y1, z1],
          [x1, y1, z0],
          [x0, y1, z0],
        ],
        [0, 1, 0],
      )
    if (!skip.includes('bottom'))
      this.quad(
        [
          [x0, y0, z0],
          [x1, y0, z0],
          [x1, y0, z1],
          [x0, y0, z1],
        ],
        [0, -1, 0],
      )
    if (!skip.includes('pz'))
      this.quad(
        [
          [x0, y0, z1],
          [x1, y0, z1],
          [x1, y1, z1],
          [x0, y1, z1],
        ],
        [0, 0, 1],
      )
    if (!skip.includes('nz'))
      this.quad(
        [
          [x1, y0, z0],
          [x0, y0, z0],
          [x0, y1, z0],
          [x1, y1, z0],
        ],
        [0, 0, -1],
      )
    if (!skip.includes('px'))
      this.quad(
        [
          [x1, y0, z1],
          [x1, y0, z0],
          [x1, y1, z0],
          [x1, y1, z1],
        ],
        [1, 0, 0],
      )
    if (!skip.includes('nx'))
      this.quad(
        [
          [x0, y0, z0],
          [x0, y0, z1],
          [x0, y1, z1],
          [x0, y1, z0],
        ],
        [-1, 0, 0],
      )
  }

  /**
   * A hanging cloth panel (a curtain): `width` along the wall from `a`, hanging from `top` to
   * `bottom`, with `folds` soft waves of `depth`, its middle at `perp` across the wall.
   */
  cloth(
    alongX: boolean,
    a: number,
    width: number,
    perp: number,
    top: number,
    bottom: number,
    folds: number,
    depth: number,
    facing: 1 | -1,
  ): void {
    const n = Math.max(4, Math.round(folds * 6))
    const base = this.pos.length / 3
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const along = a + t * width
      // folds deepen towards the bottom (gathered at the rod, falling open)
      const wave = Math.sin(t * folds * Math.PI * 2) * depth
      const dw = Math.cos(t * folds * Math.PI * 2) * folds * Math.PI * 2 * depth
      for (const [y, grow] of [
        [top, 0.55],
        [bottom, 1],
      ] as const) {
        const off = perp + wave * grow * facing
        const nx = alongX ? -dw * grow : facing
        const nz = alongX ? facing : -dw * grow
        const len = Math.hypot(nx, nz) || 1
        if (alongX) this.pos.push(along, y, off)
        else this.pos.push(off, y, along)
        this.nor.push((alongX ? nx : nz) / len, 0, (alongX ? nz : nx) / len)
        this.uv.push(along * this.scale, y * this.scale)
        // inner folds a little darker
        const s = 0.86 + 0.14 * (0.5 + 0.5 * Math.sin(t * folds * Math.PI * 2 + Math.PI / 2))
        this.col.push(s, s, s)
      }
    }
    for (let i = 0; i < n; i++) {
      const p = base + i * 2
      // front faces towards `facing` (the winding flips between walls along x and along z)
      if (alongX ? facing === -1 : facing === 1) this.idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3)
      else this.idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2)
    }
  }
}
