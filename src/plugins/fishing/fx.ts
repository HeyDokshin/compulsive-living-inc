/**
 * Fishing visuals that are not the fish: rings spreading on the water and the "!" mark over the
 * bobber on a bite. Objects are pooled — nothing is allocated per frame.
 */
import type { PluginApi } from '@sdk'

type Three = PluginApi['render']['three']
type Group = InstanceType<Three['Group']>

interface Ripple {
  mesh: InstanceType<Three['Mesh']>
  mat: InstanceType<Three['MeshBasicMaterial']>
  t: number
  life: number
  size: number
}

export class WaterFx {
  private ripples: Ripple[] = []
  private mark: InstanceType<Three['Sprite']>
  private markT = -1

  constructor(api: PluginApi, group: Group, pool = 10) {
    const T = api.render.three
    const geo = new T.RingGeometry(0.44, 0.5, 28)
    geo.rotateX(-Math.PI / 2)
    for (let i = 0; i < pool; i++) {
      const mat = api.render.stylize(new T.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }))
      const mesh = new T.Mesh(geo, mat)
      mesh.visible = false
      mesh.renderOrder = 3
      group.add(mesh)
      this.ripples.push({ mesh, mat, t: 1, life: 1, size: 1 })
    }
    const tex = new T.CanvasTexture(markCanvas())
    tex.colorSpace = T.SRGBColorSpace
    this.mark = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
    this.mark.visible = false
    this.mark.renderOrder = 10
    group.add(this.mark)
    api.onDispose(() => {
      geo.dispose()
      tex.dispose()
      this.mark.material.dispose()
      for (const r of this.ripples) r.mat.dispose()
    })
  }

  /** A ring spreading from (x, y, z): `size` = final diameter in blocks. */
  ripple(x: number, y: number, z: number, size = 1.2, life = 0.9, delay = 0): void {
    const r = this.ripples.reduce((a, b) => (b.t / b.life > a.t / a.life ? b : a))
    r.t = -delay
    r.life = life
    r.size = size
    r.mesh.position.set(x, y, z)
  }

  /** Show the "!" over a point until `hideMark()`. */
  showMark(x: number, y: number, z: number): void {
    this.mark.position.set(x, y, z)
    this.mark.visible = true
    this.markT = 0
  }

  hideMark(): void {
    this.mark.visible = false
    this.markT = -1
  }

  update(dt: number): void {
    for (const r of this.ripples) {
      if (r.t >= r.life) {
        r.mesh.visible = false
        continue
      }
      r.t += dt
      const k = Math.max(0, r.t / r.life)
      r.mesh.visible = r.t > 0
      r.mesh.scale.setScalar(0.15 + k * r.size)
      r.mat.opacity = 0.75 * (1 - k)
    }
    if (this.markT >= 0) {
      this.markT += dt
      // pop in with a little overshoot, then bob
      const pop = this.markT < 0.25 ? Math.sin((this.markT / 0.25) * Math.PI * 0.75) * 1.25 : 1 + Math.sin(this.markT * 9) * 0.05
      this.mark.scale.setScalar(0.62 * pop)
    }
  }
}

function markCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 96
  const g = c.getContext('2d')!
  g.fillStyle = 'rgba(80,50,40,0.25)'
  g.beginPath()
  g.arc(48, 52, 38, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#fffaf0'
  g.beginPath()
  g.arc(48, 48, 38, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#ff5a5a'
  g.font = '900 60px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('!', 48, 51)
  return c
}
