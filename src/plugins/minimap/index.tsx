/**
 * A round mini-map in the corner: the island around the player, turned the way the camera looks,
 * with neighbours and buildings marked; click it (or open «Карта» on the phone) for the whole
 * island. The picture of the island is drawn from the blocks' colors and redrawn when land
 * changes (terraforming, paths, a new island).
 */
import { definePlugin, useEffect, useRef, z, type PluginApi } from '@sdk'

const Config = z.object({
  /** Blocks from the player to the edge of the round map. */
  radius: z.number().min(6).max(64).default(22).meta({ step: 1 }),
  /** Diameter on screen (CSS pixels). */
  size: z.number().int().min(80).max(320).default(150).meta({ step: 2 }),
  /** Seconds after a change before the island picture is redrawn. */
  redraw: z.number().min(0.1).max(10).default(1).meta({ label: 'redraw after (s)', step: 0.1 }),
})

type Cfg = z.infer<typeof Config>

/** The island as a picture: one pixel per block, colored by what lies on top, lighter higher up. */
class IslandPicture {
  readonly canvas = document.createElement('canvas')
  version = 0
  constructor(private api: PluginApi) {}

  draw(): void {
    const w = this.api.world
    const blocks = this.api.registry('blocks')
    const sx = w.sizeX
    const sz = w.sizeZ
    this.canvas.width = sx
    this.canvas.height = sz
    const g = this.canvas.getContext('2d')!
    const img = g.createImageData(sx, sz)
    const cache = new Map<string, [number, number, number]>()
    const rgb = (id: string): [number, number, number] => {
      let c = cache.get(id)
      if (!c) {
        const hex = (blocks.get(id)?.color ?? '#9bd67a').replace('#', '')
        const n = parseInt(hex.slice(0, 6), 16)
        c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
        cache.set(id, c)
      }
      return c
    }
    const ground = w.ground
    for (let z = 0; z < sz; z++)
      for (let x = 0; x < sx; x++) {
        const y = w.surfaceY(x, z)
        const top = y > 0 ? w.getBlock(x, y - 1, z) : w.AIR
        const water = blocks.get(top)?.liquid
        let [r, gg, b] = water ? [127, 205, 230] : rgb(top)
        // higher land lighter, the sea deeper further out
        const k = water ? 1 : 1 + Math.max(-2, Math.min(4, y - ground)) * 0.07
        r = Math.min(255, r * k)
        gg = Math.min(255, gg * k)
        b = Math.min(255, b * k)
        const o = (z * sx + x) * 4
        img.data[o] = r
        img.data[o + 1] = gg
        img.data[o + 2] = b
        img.data[o + 3] = 255
      }
    g.putImageData(img, 0, 0)
    this.version++
  }
}

/** Draws the map (part of the island around a point, turned) with markers into a canvas. */
function paint(api: PluginApi, picture: IslandPicture, c: HTMLCanvasElement, opts: { radius: number | null; turn: boolean }): void {
  if (!picture.version) picture.draw()
  const g = c.getContext('2d')!
  const W = c.width
  const H = c.height
  g.clearRect(0, 0, W, H)
  const player = [...api.entities.world.with('player', 'transform')][0]
  const px = player?.transform.x ?? api.world.sizeX / 2
  const pz = player?.transform.z ?? api.world.sizeZ / 2
  const whole = opts.radius === null
  const radius = opts.radius ?? Math.max(api.world.sizeX, api.world.sizeZ) / 2
  const scale = Math.min(W, H) / 2 / radius
  const cx = whole ? api.world.sizeX / 2 : px
  const cz = whole ? api.world.sizeZ / 2 : pz
  // the camera's forward is up on the map
  const f = api.render.camera.forwardXZ()
  const turn = opts.turn ? -Math.PI / 2 - Math.atan2(f.z, f.x) : 0
  g.save()
  g.translate(W / 2, H / 2)
  g.rotate(turn)
  g.scale(scale, scale)
  g.translate(-cx, -cz)
  // the sea all around, then the island, softly (no pixels)
  g.fillStyle = '#7fcde6'
  g.fillRect(cx - radius * 2, cz - radius * 2, radius * 4, radius * 4)
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  g.drawImage(picture.canvas, 0, 0)
  // buildings and big things: soft rounded squares
  g.fillStyle = 'rgba(255, 250, 240, 0.9)'
  for (const e of api.entities.world.with('blocker', 'transform')) {
    const b = e.blocker
    const w = b.w ?? 1
    const d = b.d ?? 1
    if (w * d < 4) continue
    roundRect(g, e.transform.x - w / 2, e.transform.z - d / 2, w, d, 0.8)
  }
  // neighbours: little dots
  g.fillStyle = '#f08a6c'
  for (const e of api.entities.world.with('villager', 'transform')) {
    g.beginPath()
    g.arc(e.transform.x, e.transform.z, 1.3, 0, Math.PI * 2)
    g.fill()
  }
  g.restore()
  // the player: a pin in the middle (or where they are on the whole map), pointing where they face
  const sp = toScreen(px, pz, cx, cz, scale, turn, W, H)
  g.save()
  g.translate(sp[0], sp[1])
  g.rotate(turn + Math.PI - (player?.transform.rotY ?? 0))
  g.fillStyle = '#ff9f43'
  g.strokeStyle = '#fffaf0'
  g.lineWidth = 2.5
  g.beginPath()
  g.moveTo(0, -9)
  g.lineTo(7, 7)
  g.lineTo(0, 3)
  g.lineTo(-7, 7)
  g.closePath()
  g.fill()
  g.stroke()
  g.restore()
}

function toScreen(x: number, z: number, cx: number, cz: number, scale: number, turn: number, W: number, H: number): [number, number] {
  const dx = (x - cx) * scale
  const dz = (z - cz) * scale
  return [W / 2 + dx * Math.cos(turn) - dz * Math.sin(turn), H / 2 + dx * Math.sin(turn) + dz * Math.cos(turn)]
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath()
  g.roundRect(x, y, w, h, r)
  g.fill()
}

function MapCanvas({ api, picture, size, radius, turn }: { api: PluginApi; picture: IslandPicture; size: number; radius: number | null; turn: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let raf = 0
    let last = 0
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      if (t - last < 66) return // ~15 times a second is plenty for a map
      last = t
      if (ref.current) paint(api, picture, ref.current, { radius, turn })
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [radius, turn])
  const ratio = Math.min(2, window.devicePixelRatio || 1)
  return <canvas ref={ref} width={size * ratio} height={size * ratio} style={{ width: `${size}px`, height: `${size}px`, display: 'block' }} />
}

export default definePlugin({
  id: 'minimap',
  version: '0.1.0',
  description: 'Круглая мини-карта и карта острова',

  setup(api) {
    const cfg: Cfg = api.config.define(Config)
    const picture = new IslandPicture(api)
    let pending = 0
    const soon = () => {
      window.clearTimeout(pending)
      pending = window.setTimeout(() => picture.draw(), cfg.redraw * 1000)
    }
    api.events.on('world:generated', () => picture.draw())
    api.events.on('save:loaded', () => picture.draw())
    api.events.on('world:blockChanged', soon)
    api.onDispose(() => window.clearTimeout(pending))

    api.ui.slot(
      'hud.bottomRight',
      () => (
        <button
          type="button"
          title="Карта острова"
          onClick={() => api.ui.open('minimap:full')}
          style={{
            pointerEvents: 'auto',
            padding: 0,
            border: '6px solid #fffaf0',
            borderRadius: '50%',
            overflow: 'hidden',
            cursor: 'pointer',
            background: '#7fcde6',
            boxShadow: '0 8px 24px rgba(70, 50, 30, 0.3)',
          }}
        >
          <MapCanvas api={api} picture={picture} size={cfg.size} radius={cfg.radius} turn />
        </button>
      ),
      { order: 10 },
    )
    api.ui.window({
      id: 'minimap:full',
      title: 'Карта острова',
      component: () => (
        <div style={{ borderRadius: '28px', overflow: 'hidden', boxShadow: 'inset 0 0 0 4px #fffaf0' }}>
          <MapCanvas api={api} picture={picture} size={Math.min(520, Math.floor(window.innerHeight * 0.6))} radius={null} turn={false} />
        </div>
      ),
    })
  },
})
