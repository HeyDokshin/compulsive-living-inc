/**
 * Fishing. Fish shadows swim in rivers, ponds and the sea around the player (which species depends on
 * the water, season, hour and weather — see the collection plugin). Cast the rod at water: a shadow
 * notices the bobber, comes closer, nibbles a few times and then bites. Press the action key right on
 * the bite to hook it; too early or too late and it swims off. Walking away reels the line in.
 */
import { definePlugin, z, type Entity, type PluginApi, type Services } from '@sdk'
import { judgeReel, planBite, type BitePlan } from './bite'
import { WaterFx } from './fx'

const Config = z.object({
  maxFish: z.number().int().min(0).max(40).default(10).meta({ label: 'max shadows', step: 1 }),
  /** At most this share of the shadows in one kind of water (sea, river, pond). */
  maxShare: z.number().min(0.1).max(1).default(0.6).meta({ label: 'max share per water', step: 0.05 }),
  /** Random cells looked at per spawn attempt. */
  spawnSamples: z.number().int().min(1).max(200).default(40).meta({ label: 'spawn samples', step: 1 }),
  /** Shadows live within this many blocks of the player. */
  radius: z.number().min(4).max(40).default(14).meta({ step: 1 }),
  spawnEvery: z.number().min(0.1).max(20).default(1.2).meta({ label: 'spawn every (s)', step: 0.1 }),
  swimSpeed: z.number().min(0.05).max(4).default(0.45).meta({ label: 'swim speed', step: 0.05 }),
  approachSpeed: z.number().min(0.1).max(4).default(0.8).meta({ label: 'approach speed', step: 0.05 }),
  /** A shadow this close to the bobber may notice it. */
  noticeRadius: z.number().min(1).max(10).default(4.5).meta({ label: 'notice radius', step: 0.5 }),
  noticeMin: z.number().min(0).max(20).default(1).meta({ label: 'notice after min (s)', step: 0.1 }),
  noticeMax: z.number().min(0).max(20).default(3.5).meta({ label: 'notice after max (s)', step: 0.1 }),
  minNibbles: z.number().int().min(0).max(6).default(0).meta({ step: 1 }),
  maxNibbles: z.number().int().min(0).max(8).default(3).meta({ step: 1 }),
  gapMin: z.number().min(0.2).max(5).default(0.8).meta({ label: 'nibble gap min (s)', step: 0.1 }),
  gapMax: z.number().min(0.2).max(8).default(2.2).meta({ label: 'nibble gap max (s)', step: 0.1 }),
  /** Seconds after the bite during which reeling hooks the fish. */
  biteWindow: z.number().min(0.15).max(3).default(0.8).meta({ label: 'bite window (s)', step: 0.05 }),
  /** Neighbouring cells of the same water a shadow needs (rivers are narrow, the sea is wide). */
  inlandNeighbours: z.number().int().min(0).max(4).default(2).meta({ label: 'inland neighbours', step: 1 }),
  seaNeighbours: z.number().int().min(0).max(4).default(3).meta({ label: 'sea neighbours', step: 1 }),
  /** If no fish noticed the bobber after this many seconds, one may swim in from nearby (small ponds, river mouths). */
  helpAfter: z.number().min(0).max(60).default(5).meta({ label: 'fish swims in after (s)', step: 0.5 }),
  helpChance: z.number().min(0).max(1).default(0.85).meta({ label: 'swim-in chance', step: 0.05 }),
  /** Seconds a new shadow takes to fade in. */
  fadeIn: z.number().min(0.05).max(5).default(1.2).meta({ label: 'fade in (s)', step: 0.05 }),
  shake: z.number().min(0).max(0.5).default(0.07).meta({ label: 'bite shake', step: 0.01 }),
  /** A fish lured by bait appears within this many blocks. */
  baitRadius: z.number().min(1.5).max(8).default(3).meta({ label: 'bait radius', step: 0.5 }),
  shadowOpacity: z.number().min(0).max(1).default(0.36).meta({ label: 'shadow opacity', step: 0.01 }),
  /** Shadow length for size 1 and 6 (blocks). */
  shadowMin: z.number().min(0.1).max(2).default(0.35).meta({ step: 0.05 }),
  shadowMax: z.number().min(0.2).max(3).default(1.3).meta({ step: 0.05 }),
})
type Config = z.infer<typeof Config>
type SpeciesDef = NonNullable<ReturnType<Services['collection:catalog']['get']>>

type Three = PluginApi['render']['three']
type Obj = InstanceType<Three['Object3D']>

interface Fish {
  species: SpeciesDef
  kind: string
  x: number
  z: number
  y: number
  heading: number
  tx: number
  tz: number
  rest: number
  state: 'swim' | 'approach' | 'nibble' | 'flee'
  mesh: InstanceType<Three['Mesh']>
  /** Little dart forward on a nibble. */
  bump: number
  /** Shadow length (blocks) and visibility 0…1 (fades in when it appears, out when it flees). */
  len: number
  fade: number
}

interface Cast {
  actor: Entity
  from: { x: number; z: number }
  x: number
  y: number
  z: number
  kind: string
  t: number
  noticeAt: number
  fish: Fish | null
  plan: BitePlan | null
  /** Seconds since the fish reached the bobber. */
  since: number
  nextNibble: number
  bit: boolean
  bobber: Obj
  line: InstanceType<Three['Line']>
  dip: number
  helped: boolean
}

export default definePlugin({
  id: 'fishing',
  version: '0.1.0',
  description: 'Рыбалка: тени рыб, поплавок, поклёвка и подсечка',
  dependsOn: ['items', 'collection', 'terrain'],

  setup(api) {
    const cfg = api.config.define(Config)
    const T = api.render.three
    const catalog = () => api.services.get('collection:catalog')
    const water = () => api.services.get('terrain:water')
    const liquid = (id: string) => api.registry('blocks').isTagged(id, '#core:liquid')

    /** Top water cell of a column (y), or -1. */
    const waterTop = (x: number, z: number): number => {
      let y = api.world.surfaceY(x, z)
      if (!liquid(api.world.getBlock(x, y, z))) return -1
      while (y + 1 < api.world.height && liquid(api.world.getBlock(x, y + 1, z))) y++
      return y
    }
    /** Open water of a kind: the cell and enough of its 4 neighbours hold that water. */
    const openWater = (x: number, z: number, kind: string) => {
      const w = water()
      if (w.kindAt(x, z) !== kind) return false
      let n = 0
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (w.kindAt(x + dx, z + dz) === kind) n++
      return n >= (kind === 'sea' ? cfg.seaNeighbours : cfg.inlandNeighbours)
    }

    // --- shadows -------------------------------------------------------------------------------
    const geo = new T.CircleGeometry(0.5, 18)
    geo.rotateX(-Math.PI / 2)
    const mat = api.render.stylize(new T.MeshBasicMaterial({ color: '#173847', transparent: true, opacity: cfg.shadowOpacity, depthWrite: false }))
    api.config.onChange(() => (mat.opacity = cfg.shadowOpacity))
    const fish: Fish[] = []
    // One tracked container: shadows, bobber and line come and go as its children.
    const group = api.render.add(new T.Group())
    // indoors only the room is drawn
    group.visible = !api.interiors.current
    api.events.on('interior:changed', ({ id }) => void (group.visible = !id))

    const player = () => {
      for (const e of api.entities.world.with('player', 'transform')) return e
      return undefined
    }

    // Sample cells around the player, then choose the kind of water evenly among those found — so a
    // small pond or a river next to the sea still gets its own fish.
    const byKind = new Map<string, Array<[number, number]>>()
    const spawnFish = (px: number, pz: number) => {
      byKind.clear()
      for (let tries = 0; tries < cfg.spawnSamples; tries++) {
        const a = Math.random() * Math.PI * 2
        const d = 3 + Math.random() * (cfg.radius - 3)
        const x = Math.floor(px + Math.cos(a) * d)
        const z = Math.floor(pz + Math.sin(a) * d)
        const kind = water().kindAt(x, z)
        if (!kind || !openWater(x, z, kind)) continue
        let list = byKind.get(kind)
        if (!list) byKind.set(kind, (list = []))
        list.push([x, z])
      }
      const kinds = [...byKind.keys()].filter((k) => fish.filter((f) => f.kind === k).length < Math.ceil(cfg.maxFish * cfg.maxShare))
      const kind = kinds[Math.floor(Math.random() * kinds.length)]
      if (!kind) return
      const cells = byKind.get(kind)!
      const [x, z] = cells[Math.floor(Math.random() * cells.length)]!
      spawnAt(x, z, kind)
    }
    const spawnAt = (x: number, z: number, kind: string): Fish | null => {
      const species = catalog().pick('fish', kind)
      if (!species) return null
      const y = waterTop(x, z)
      const len = cfg.shadowMin + ((species.size - 1) / 5) * (cfg.shadowMax - cfg.shadowMin)
      const mesh = new T.Mesh(geo, mat)
      mesh.scale.setScalar(0.001)
      mesh.renderOrder = 2
      group.add(mesh)
      const f: Fish = { species, kind, x: x + 0.5, z: z + 0.5, y: y + 0.66, heading: Math.random() * Math.PI * 2, tx: x + 0.5, tz: z + 0.5, rest: Math.random() * 2, state: 'swim', mesh, bump: 0, len, fade: 0 }
      fish.push(f)
      return f
    }
    /** A fish swims in towards a bobber in water too small for regular spawns. */
    const spawnNear = (cx: number, cz: number, kind: string, maxR: number): Fish | null => {
      const cells: Array<[number, number]> = []
      const r = Math.ceil(maxR)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          const d = Math.hypot(dx, dz)
          if (d >= 1.5 && d <= maxR && water().kindAt(Math.floor(cx) + dx, Math.floor(cz) + dz) === kind) cells.push([Math.floor(cx) + dx, Math.floor(cz) + dz])
        }
      const cell = cells[Math.floor(Math.random() * cells.length)]
      return cell ? spawnAt(cell[0], cell[1], kind) : null
    }
    const removeFish = (f: Fish) => {
      f.mesh.removeFromParent()
      const i = fish.indexOf(f)
      if (i >= 0) fish.splice(i, 1)
    }
    const clearFish = () => {
      for (const f of [...fish]) removeFish(f)
    }
    api.events.on('world:generated', clearFish)
    api.events.on('session:started', clearFish)
    api.onDispose(clearFish)

    const pickTarget = (f: Fish) => {
      for (let i = 0; i < 6; i++) {
        const x = Math.floor(f.x + (Math.random() * 2 - 1) * 3)
        const z = Math.floor(f.z + (Math.random() * 2 - 1) * 3)
        if (water().kindAt(x, z) === f.kind && openWater(x, z, f.kind)) {
          f.tx = x + 0.5 + (Math.random() - 0.5) * 0.6
          f.tz = z + 0.5 + (Math.random() - 0.5) * 0.6
          return
        }
      }
    }

    /** Move towards (tx, tz); returns the remaining distance. */
    const swimTo = (f: Fish, tx: number, tz: number, speed: number, dt: number) => {
      const dx = tx - f.x
      const dz = tz - f.z
      const d = Math.hypot(dx, dz)
      if (d < 1e-3) return 0
      const want = Math.atan2(dx, dz)
      let turn = want - f.heading
      turn = Math.atan2(Math.sin(turn), Math.cos(turn))
      f.heading += turn * Math.min(1, dt * 4)
      const step = Math.min(d, speed * dt * (Math.abs(turn) > 1.2 ? 0.3 : 1))
      f.x += (dx / d) * step
      f.z += (dz / d) * step
      return d - step
    }

    const fx = new WaterFx(api, group)

    // --- casting -------------------------------------------------------------------------------
    let cast: Cast | null = null
    const lineGeo = new T.BufferGeometry()
    const linePos = new Float32Array(6)
    lineGeo.setAttribute('position', new T.BufferAttribute(linePos, 3))
    const lineMat = new T.LineBasicMaterial({ color: '#f4f0e6', transparent: true, opacity: 0.85 })
    api.onDispose(() => (lineGeo.dispose(), lineMat.dispose(), mat.dispose()))

    const endCast = () => {
      if (!cast) return
      cast.bobber.removeFromParent()
      cast.line.removeFromParent()
      fx.hideMark()
      if (cast.fish && cast.fish.state !== 'flee') cast.fish.state = 'swim'
      cast = null
    }
    api.onDispose(endCast)
    api.events.on('session:started', endCast)

    const scare = (f: Fish | null) => {
      if (!f) return
      f.state = 'flee'
      f.heading += Math.PI
      f.tx = f.x + Math.sin(f.heading) * 6
      f.tz = f.z + Math.cos(f.heading) * 6
    }

    const startCast = (actor: Entity, cx: number, cz: number, kind: string) => {
      endCast()
      const t = actor.transform!
      // land the bobber one cell further out when that is still the same water
      const dirX = Math.round(Math.sin(t.rotY))
      const dirZ = Math.round(Math.cos(t.rotY))
      if (water().kindAt(cx + dirX, cz + dirZ) === kind) {
        cx += dirX
        cz += dirZ
      }
      const y = waterTop(cx, cz)
      if (y < 0) return false
      const bobber = api.render.voxelModel('fishing:bobber')
      group.add(bobber)
      bobber.position.set(cx + 0.5, y + 0.82, cz + 0.5)
      const line = new T.Line(lineGeo, lineMat)
      group.add(line)
      line.frustumCulled = false
      cast = {
        actor,
        from: { x: t.x, z: t.z },
        x: cx + 0.5,
        y: y + 0.82,
        z: cz + 0.5,
        kind,
        t: 0,
        noticeAt: cfg.noticeMin + Math.random() * Math.max(0, cfg.noticeMax - cfg.noticeMin),
        fish: null,
        plan: null,
        since: 0,
        nextNibble: 0,
        bit: false,
        bobber,
        line,
        dip: 0,
        helped: false,
      }
      fx.ripple(cx + 0.5, y + 0.9, cz + 0.5, 1.4)
      api.audio.play('fishing:cast', { at: { x: cx + 0.5, z: cz + 0.5 } })
      api.fx.burst('core:splash', { x: cx + 0.5, y: y + 0.85, z: cz + 0.5 }, { amount: 0.4, scale: 0.6 })
      return true
    }

    const reel = () => {
      const c = cast
      if (!c) return false
      const at = { x: c.x, y: c.y, z: c.z }
      if (c.fish && c.plan && c.fish.state === 'nibble') {
        const result = judgeReel(c.since, c.plan.biteAt, cfg.biteWindow)
        if (result === 'hit') {
          const f = c.fish
          removeFish(f)
          c.fish = null
          endCast()
          api.fx.burst('core:splash', at, { amount: 1.2 })
          fx.ripple(at.x, at.y + 0.08, at.z, 2)
          api.render.shake(cfg.shake * 0.6, 0.25)
          catalog().celebrate(c.actor, f.species.id, at)
          return true
        }
        scare(c.fish)
        api.ui.toast(result === 'early' ? 'Слишком рано — рыба уплыла…' : 'Сорвалась…')
      } else if (c.fish) {
        scare(c.fish)
      }
      endCast()
      return true
    }

    const interactions = api.registry('interactions')
    interactions.register({
      id: 'fishing:reel',
      tool: '#core:rods',
      priority: 100,
      label: () => (cast?.bit ? 'Подсечь!' : 'Вытянуть удочку'),
      sound: 'core:swing',
      when: (ctx) => !!cast && cast.actor === ctx.actor,
      run: () => reel(),
    })
    // Bait (crafted from shells): toss it in and a fish swims up.
    interactions.register({
      id: 'fishing:bait',
      tool: '#fishing:baits',
      block: '#core:liquid',
      priority: 15,
      label: 'Бросить наживку',
      sound: 'fishing:plop',
      when: (ctx) => !!water().kindAt(ctx.x, ctx.z),
      run: (ctx) => {
        const kind = water().kindAt(ctx.x, ctx.z)!
        if (api.services.get('items:inventory').remove(ctx.actor, ctx.held!, 1) < 1) return false
        const y = waterTop(ctx.x, ctx.z)
        fx.ripple(ctx.x + 0.5, y + 0.9, ctx.z + 0.5, 1.6)
        if (!spawnNear(ctx.x + 0.5, ctx.z + 0.5, kind, cfg.baitRadius)) api.ui.toast('Никто не приплыл… Попробуйте в другом месте.')
      },
    })
    interactions.register({
      id: 'fishing:cast',
      tool: '#core:rods',
      block: '#core:liquid',
      priority: 10,
      label: 'Забросить удочку',
      when: (ctx) => !cast && !!water().kindAt(ctx.x, ctx.z),
      run: (ctx) => startCast(ctx.actor, ctx.x, ctx.z, water().kindAt(ctx.x, ctx.z)!),
    })

    // --- per frame -----------------------------------------------------------------------------
    let spawnIn = 0
    let time = 0
    api.systems.add({
      id: 'fishing',
      outdoors: true, // the island waits while you're in a room
      phase: 'render',
      run: ({ dt }) => {
        time += dt
        fx.update(dt)
        const p = player()
        if (!p) return
        const px = p.transform.x
        const pz = p.transform.z

        if ((spawnIn -= dt) <= 0) {
          spawnIn = cfg.spawnEvery
          if (fish.length < cfg.maxFish) spawnFish(px, pz)
        }

        for (let i = fish.length - 1; i >= 0; i--) {
          const f = fish[i]!
          const far = Math.hypot(f.x - px, f.z - pz) > cfg.radius * 1.4
          if (far && f !== cast?.fish) {
            removeFish(f)
            continue
          }
          if (f.state === 'swim') {
            if (f.rest > 0) f.rest -= dt
            else if (swimTo(f, f.tx, f.tz, cfg.swimSpeed, dt) < 0.05) {
              f.rest = 0.5 + Math.random() * 2.5
              pickTarget(f)
            }
          } else if (f.state === 'flee') {
            swimTo(f, f.tx, f.tz, cfg.swimSpeed * 5, dt)
            f.fade -= dt * 0.8
            if (f.fade <= 0) {
              removeFish(f)
              continue
            }
          }
          if (f.state !== 'flee' && f.fade < 1) f.fade = Math.min(1, f.fade + dt / cfg.fadeIn)
          f.mesh.scale.set(f.len * f.fade, 1, f.len * 0.48 * f.fade)
          f.bump = Math.max(0, f.bump - dt * 3)
          const bx = Math.sin(f.heading) * f.bump * 0.18
          const bz = Math.cos(f.heading) * f.bump * 0.18
          f.mesh.position.set(f.x + bx, f.y + Math.sin(time * 2 + i) * 0.01, f.z + bz)
          f.mesh.rotation.y = f.heading - Math.PI / 2
        }

        const c = cast
        if (!c) return
        // walking away reels in
        if (Math.hypot(p.transform.x - c.from.x, p.transform.z - c.from.z) > 0.35 && c.actor === p) {
          scare(c.fish)
          endCast()
          return
        }
        c.t += dt
        if (!c.fish && c.t >= c.noticeAt) {
          let best: Fish | null = null
          let bestD = cfg.noticeRadius
          for (const f of fish) {
            if (f.state !== 'swim' || f.kind !== c.kind) continue
            const d = Math.hypot(f.x - c.x, f.z - c.z)
            if (d < bestD) (best = f), (bestD = d)
          }
          if (!best && !c.helped && c.t >= cfg.helpAfter) {
            c.helped = true
            if (Math.random() < cfg.helpChance) best = spawnNear(c.x, c.z, c.kind, cfg.noticeRadius)
          }
          if (best) {
            best.state = 'approach'
            c.fish = best
          } else c.noticeAt = c.t + 1 // look again a bit later
        }
        const f = c.fish
        if (f && f.state === 'approach') {
          // stop with the nose at the bobber
          const len = f.len * 0.5
          const ang = Math.atan2(f.x - c.x, f.z - c.z)
          if (swimTo(f, c.x + Math.sin(ang) * len, c.z + Math.cos(ang) * len, cfg.approachSpeed, dt) < 0.04) {
            f.state = 'nibble'
            f.heading = Math.atan2(c.x - f.x, c.z - f.z)
            c.plan = planBite(cfg, Math.random)
            c.since = 0
            c.nextNibble = 0
          }
        } else if (f && f.state === 'nibble' && c.plan) {
          c.since += dt
          const next = c.plan.nibbles[c.nextNibble]
          if (next !== undefined && c.since >= next) {
            c.nextNibble++
            c.dip = 0.35
            f.bump = 1
            fx.ripple(c.x, c.y + 0.08, c.z, 0.9, 0.7)
            api.audio.play('fishing:plop', { at: { x: c.x, z: c.z } })
          }
          if (!c.bit && c.since >= c.plan.biteAt) {
            c.bit = true
            c.dip = 1
            f.bump = 1
            api.audio.play('fishing:bite', { at: { x: c.x, z: c.z } })
            api.fx.burst('core:splash', { x: c.x, y: c.y, z: c.z }, { amount: 0.8 })
            fx.ripple(c.x, c.y + 0.08, c.z, 1.6, 0.8)
            fx.ripple(c.x, c.y + 0.08, c.z, 2.4, 1.1, 0.15)
            fx.showMark(c.x, c.y + 1.15, c.z)
            api.render.shake(cfg.shake, 0.3)
          }
          if (c.bit && judgeReel(c.since, c.plan.biteAt, cfg.biteWindow) === 'late') {
            scare(f)
            c.fish = null
            endCast()
            api.ui.toast('Сорвалась…')
            return
          }
        }

        // bobber: gentle float, dips on nibbles, held under while biting
        c.dip = c.bit ? 1 : Math.max(0, c.dip - dt * 2.5)
        c.bobber.position.y = c.y + Math.sin(c.t * 2.2) * 0.02 - c.dip * 0.22
        // line from the rod tip to the bobber
        const t = p.transform
        linePos[0] = t.x + Math.sin(t.rotY) * 0.85
        linePos[1] = t.y + 1.75
        linePos[2] = t.z + Math.cos(t.rotY) * 0.85
        linePos[3] = c.x
        linePos[4] = c.bobber.position.y + 0.25
        linePos[5] = c.z
        lineGeo.attributes.position!.needsUpdate = true
      },
    })

    api.commands.register({
      name: 'fish',
      description: 'Тени рыб рядом: вид и вода',
      run: () => fish.map((f) => `${f.species.name} (${f.kind}) ${f.state} @ ${f.x.toFixed(1)},${f.z.toFixed(1)}`).join('\n') || 'рядом нет рыб',
    })
  },
})
