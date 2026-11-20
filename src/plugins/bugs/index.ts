/**
 * Bugs around the player: butterflies on flowers, dragonflies in the air, cicadas on trees, crickets in
 * the grass, pill bugs by rocks, pond skaters on water. Which species appear depends on the place,
 * season, hour and weather (collection plugin). Running scares them off; walk up slowly and swing
 * the net. Bugs are not saved — new ones keep arriving.
 */
import { definePlugin, z, type Entity, type PluginApi, type Services } from '@sdk'

type SpeciesDef = NonNullable<ReturnType<Services['collection:catalog']['get']>>
type Three = PluginApi['render']['three']
type Obj = InstanceType<Three['Object3D']>

const Config = z.object({
  maxBugs: z.number().int().min(0).max(40).default(9).meta({ label: 'max bugs', step: 1 }),
  radius: z.number().min(5).max(40).default(15).meta({ step: 1 }),
  spawnEvery: z.number().min(0.1).max(30).default(1.6).meta({ label: 'spawn every (s)', step: 0.1 }),
  /** Bugs never appear closer than this to the player. */
  minSpawnDistance: z.number().min(0).max(20).default(5).meta({ label: 'min spawn distance', step: 0.5 }),
  /** Player speed (blocks/s) that scares bugs — walking is fine, running is not. */
  scareSpeed: z.number().min(0.5).max(20).default(4.2).meta({ label: 'scare speed', step: 0.1 }),
  scareRadius: z.number().min(0.5).max(10).default(3.2).meta({ label: 'scare radius', step: 0.1 }),
  /** The net catches bugs this close to the swing point in front of the player. */
  netReach: z.number().min(0.3).max(3).default(1.05).meta({ label: 'net reach', step: 0.05 }),
  scale: z.number().min(0.2).max(2).default(0.95).meta({ label: 'bug scale', step: 0.05 }),
  /** Brightness of glowing bugs (fireflies, moths) at night. */
  glow: z.number().min(0).max(2).default(1).meta({ step: 0.05 }),
  flySpeed: z.number().min(0.1).max(6).default(1.1).meta({ label: 'fly speed', step: 0.1 }),
  crawlSpeed: z.number().min(0.05).max(3).default(0.35).meta({ label: 'crawl speed', step: 0.05 }),
  /** Seconds a bug stays before it may leave (when the player isn't close). */
  lifeMin: z.number().min(5).max(600).default(50).meta({ step: 5 }),
  lifeMax: z.number().min(5).max(900).default(140).meta({ step: 5 }),
})
type Config = z.infer<typeof Config>

const PLACES = ['flowers', 'trees', 'air', 'ground', 'rocks', 'water', 'beach'] as const
type Place = (typeof PLACES)[number]

interface Bug {
  species: SpeciesDef
  place: Place
  obj: Obj
  /** Wing parts of a rigged bug (flap), if any. */
  wings: [Obj, Obj] | null
  halo: InstanceType<Three['Sprite']> | null
  x: number
  y: number
  z: number
  /** Where it lives (flower, tree…), it returns to or circles around it. */
  home: { x: number; y: number; z: number }
  host: Entity | null
  heading: number
  tx: number
  ty: number
  tz: number
  rest: number
  t: number
  life: number
  flying: boolean
  fleeing: number
}

export default definePlugin({
  id: 'bugs',
  version: '0.1.0',
  description: 'Насекомые: появляются по месту, времени и погоде, ловятся сачком',
  dependsOn: ['items', 'collection'],
  optionalDependsOn: ['terrain', 'garden', 'nature'],

  setup(api) {
    const cfg = api.config.define(Config)
    const T = api.render.three
    const catalog = () => api.services.get('collection:catalog')
    const blocks = api.registry('blocks')
    const group = api.render.add(new T.Group())
    // indoors only the room is drawn
    group.visible = !api.interiors.current
    api.events.on('interior:changed', ({ id }) => void (group.visible = !id))
    const haloTexture = new T.CanvasTexture(haloCanvas())
    api.onDispose(() => haloTexture.dispose())
    /** 0 by day, 1 at night (glowing bugs show then). */
    const night = () => {
      const h = api.time.hour
      return Math.min(1, Math.max(0, (Math.abs(h - 12.5) - 5.5) / 1.5))
    }
    const bugs: Bug[] = []
    const hosts = new Set<Entity>()

    const player = () => {
      for (const e of api.entities.world.with('player', 'transform')) return e
      return undefined
    }

    // --- where bugs can be ---------------------------------------------------------------------
    const topBlock = (x: number, z: number) => {
      const y = api.world.surfaceY(x, z)
      return { y, block: api.world.getBlock(x, y - 1, z), above: api.world.getBlock(x, y, z) }
    }
    const ringCell = (px: number, pz: number) => {
      const a = Math.random() * Math.PI * 2
      const d = cfg.minSpawnDistance + Math.random() * Math.max(0, cfg.radius - cfg.minSpawnDistance)
      return { x: Math.floor(px + Math.cos(a) * d), z: Math.floor(pz + Math.sin(a) * d) }
    }
    const inRing = (e: Entity, px: number, pz: number) => {
      const d = Math.hypot(e.transform!.x - px, e.transform!.z - pz)
      return d >= cfg.minSpawnDistance && d <= cfg.radius
    }
    const nearHost = (component: 'flower' | 'tree' | 'rock', px: number, pz: number): Entity | null => {
      const list = [...api.entities.world.with(component, 'transform')].filter((e) => !hosts.has(e) && inRing(e, px, pz))
      if (component === 'tree') return list.filter((e) => e.blocker).sort(() => Math.random() - 0.5)[0] ?? null
      return list[Math.floor(Math.random() * list.length)] ?? null
    }
    type Spot = { x: number; y: number; z: number; host: Entity | null; heading: number }
    const findSpot = (place: Place, px: number, pz: number): Spot | null => {
      const heading = Math.random() * Math.PI * 2
      switch (place) {
        case 'flowers': {
          const f = nearHost('flower', px, pz)
          return f ? { x: f.transform!.x, y: f.transform!.y + 0.5, z: f.transform!.z, host: f, heading } : null
        }
        case 'trees': {
          const t = nearHost('tree', px, pz)
          if (!t) return null
          // on the trunk, on the side facing the camera-ish (south/east) so it can be seen
          const side = Math.random() < 0.5 ? 0 : Math.PI / 2
          return { x: t.transform!.x + Math.sin(side) * 0.3, y: t.transform!.y + 0.75 + Math.random() * 0.35, z: t.transform!.z + Math.cos(side) * 0.3, host: t, heading: side }
        }
        case 'rocks': {
          const r = nearHost('rock', px, pz)
          if (!r) return null
          const side = Math.floor(Math.random() * 4) * (Math.PI / 2)
          const x = r.transform!.x + Math.sin(side) * 0.62
          const z = r.transform!.z + Math.cos(side) * 0.62
          return { x, y: api.world.surfaceY(x, z), z, host: r, heading: side + Math.PI }
        }
        default: {
          for (let i = 0; i < 6; i++) {
            const c = ringCell(px, pz)
            const top = topBlock(c.x, c.z)
            if (top.y <= 0 || api.world.blockerAt(c.x, c.z)) continue
            const liquid = blocks.isTagged(top.above, '#core:liquid')
            const spot = { x: c.x + 0.5, y: top.y, z: c.z + 0.5, host: null, heading }
            if (place === 'water') {
              const kind = api.services.has('terrain:water') ? api.services.get('terrain:water').kindAt(c.x, c.z) : null
              if (liquid && (kind === 'river' || kind === 'pond')) return { ...spot, y: top.y + 0.84 }
              continue
            }
            if (liquid) continue
            if (place === 'ground' && top.block === 'core:grass') return spot
            if (place === 'beach' && top.block === 'core:sand') return spot
            if (place === 'air' && (top.block === 'core:grass' || top.block === 'core:sand')) return { ...spot, y: top.y + 1.3 + Math.random() }
          }
          return null
        }
      }
    }

    const flies = (s: SpeciesDef, place: Place) => place === 'air' || (place === 'flowers' && s.model !== 'collection:ladybug')

    const spawn = (px: number, pz: number) => {
      const order = [...PLACES].sort(() => Math.random() - 0.5)
      for (const place of order) {
        const species = catalog().pick('bug', place)
        if (!species) continue
        const spot = findSpot(place, px, pz)
        if (!spot) continue
        const rigged = api.registry('rigs').has(species.model)
        const obj = rigged ? api.render.rigModel(species.model) : api.render.voxelModel(species.model)
        group.add(obj)
        const wingL = rigged ? obj.getObjectByName('wingL') : undefined
        const wingR = rigged ? obj.getObjectByName('wingR') : undefined
        let halo: Bug['halo'] = null
        if (species.glow) {
          halo = new T.Sprite(new T.SpriteMaterial({ map: haloTexture, color: species.glow.color, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0 }))
          halo.scale.setScalar(species.glow.size)
          group.add(halo)
        }
        const b: Bug = {
          species,
          place,
          obj,
          wings: wingL && wingR ? [wingL, wingR] : null,
          halo,
          x: spot.x,
          y: spot.y,
          z: spot.z,
          home: { x: spot.x, y: spot.y, z: spot.z },
          host: spot.host,
          heading: spot.heading,
          tx: spot.x,
          ty: spot.y,
          tz: spot.z,
          rest: 1 + Math.random() * 3,
          t: Math.random() * 10,
          life: cfg.lifeMin + Math.random() * Math.max(0, cfg.lifeMax - cfg.lifeMin),
          flying: place === 'air',
          fleeing: 0,
        }
        if (b.host) hosts.add(b.host)
        bugs.push(b)
        return
      }
    }

    const remove = (b: Bug) => {
      b.obj.removeFromParent()
      if (b.halo) {
        b.halo.removeFromParent()
        b.halo.material.dispose()
      }
      if (b.host) hosts.delete(b.host)
      const i = bugs.indexOf(b)
      if (i >= 0) bugs.splice(i, 1)
    }
    const clear = () => {
      for (const b of [...bugs]) remove(b)
    }
    api.events.on('session:started', clear)
    api.events.on('world:generated', clear)
    api.events.on('entity:despawned', ({ entity }) => {
      for (const b of bugs) if (b.host === entity) flee(b)
    })
    api.onDispose(clear)

    const flee = (b: Bug) => {
      if (b.fleeing) return
      b.fleeing = 0.001
      if (b.host) hosts.delete(b.host)
      b.host = null
      const p = player()
      const away = p ? Math.atan2(b.x - p.transform.x, b.z - p.transform.z) : b.heading
      b.heading = away
      b.flying = b.place !== 'ground' && b.place !== 'rocks' && b.place !== 'water' && b.place !== 'beach'
    }

    // --- net -------------------------------------------------------------------------------------
    const inReach = (ctx: { actor: Entity; x: number; z: number }) => {
      const t = ctx.actor.transform!
      // the net sweeps the cell in front: anything near its center or right in front of the actor
      const fx = t.x + Math.sin(t.rotY) * 0.95
      const fz = t.z + Math.cos(t.rotY) * 0.95
      let best: Bug | null = null
      let bestD = cfg.netReach
      for (const b of bugs) {
        if (b.fleeing) continue
        if (b.y - t.y > 2.8 || b.y - t.y < -1.2) continue
        const d = Math.min(Math.hypot(b.x - fx, b.z - fz), Math.hypot(b.x - (ctx.x + 0.5), b.z - (ctx.z + 0.5)))
        if (d < bestD) (best = b), (bestD = d)
      }
      return best
    }
    const interactions = api.registry('interactions')
    interactions.register({
      id: 'bugs:catch',
      tool: '#core:nets',
      priority: 40,
      label: 'Поймать сачком',
      sound: 'core:swing',
      when: (ctx) => !!inReach(ctx),
      run: (ctx) => {
        const b = inReach(ctx)
        if (!b) return false
        remove(b)
        catalog().celebrate(ctx.actor, b.species.id, { x: b.x, y: b.y - 1, z: b.z })
      },
    })
    // A miss scares bugs nearby.
    api.events.on('interaction:performed', ({ ctx, id }) => {
      if (id !== 'tools:net_swing') return
      const t = ctx.actor.transform
      if (!t) return
      for (const b of bugs) if (Math.hypot(b.x - t.x, b.z - t.z) < cfg.scareRadius) flee(b)
    })

    // --- per frame -------------------------------------------------------------------------------
    let spawnIn = 0
    let last: { x: number; z: number } | null = null
    let playerSpeed = 0
    api.systems.add({
      id: 'bugs',
      phase: 'render',
      run: ({ dt }) => {
        const p = player()
        if (!p || dt <= 0) return
        const px = p.transform.x
        const pz = p.transform.z
        if (last) playerSpeed = playerSpeed * 0.7 + (Math.hypot(px - last.x, pz - last.z) / dt) * 0.3
        last = { x: px, z: pz }

        if ((spawnIn -= dt) <= 0) {
          spawnIn = cfg.spawnEvery
          if (bugs.length < cfg.maxBugs) spawn(px, pz)
        }

        for (let i = bugs.length - 1; i >= 0; i--) {
          const b = bugs[i]!
          b.t += dt
          b.life -= dt
          const dist = Math.hypot(b.x - px, b.z - pz)
          if (dist > cfg.radius * 1.5 || (b.life < 0 && dist > 8)) {
            remove(b)
            continue
          }
          if (!b.fleeing && dist < cfg.scareRadius && playerSpeed > cfg.scareSpeed) flee(b)
          update(b, dt)
          if (b.fleeing > 2.2) remove(b)
        }
      },
    })

    const update = (b: Bug, dt: number) => {
      const s = cfg.scale
      const flyer = flies(b.species, b.place)
      if (b.fleeing) {
        b.fleeing += dt
        const speed = b.flying ? cfg.flySpeed * 3 : cfg.crawlSpeed * 5
        b.x += Math.sin(b.heading) * speed * dt
        b.z += Math.cos(b.heading) * speed * dt
        if (b.flying) b.y += dt * 1.6
        const k = Math.max(0, 1 - b.fleeing / 2.2)
        place(b, s * k, flyer || b.flying)
        return
      }
      switch (b.place) {
        case 'air': {
          if (moveTo(b, cfg.flySpeed, dt) < 0.1) {
            b.tx = b.home.x + (Math.random() * 2 - 1) * 3.5
            b.tz = b.home.z + (Math.random() * 2 - 1) * 3.5
            const g = api.world.surfaceY(b.tx, b.tz)
            b.ty = Math.max(g, b.home.y - 1.3) + 1.1 + Math.random() * 1.2
          }
          b.y += (b.ty - b.y) * Math.min(1, dt * 1.5)
          break
        }
        case 'flowers': {
          // sit, then flutter around the flower for a while and land again
          if (b.rest > 0) {
            b.rest -= dt
            if (b.rest <= 0 && flyer) {
              b.flying = true
              b.rest = -(2 + Math.random() * 3)
            } else if (b.rest <= 0) b.rest = 2 + Math.random() * 3
          } else {
            b.rest += dt
            const a = b.t * 1.7
            b.tx = b.home.x + Math.sin(a) * 0.55
            b.tz = b.home.z + Math.cos(a) * 0.55
            b.ty = b.home.y + 0.35 + Math.sin(b.t * 3.1) * 0.15
            moveTo(b, cfg.flySpeed * 0.8, dt)
            b.y += (b.ty - b.y) * Math.min(1, dt * 3)
            if (b.rest >= 0) {
              b.flying = false
              b.x = b.home.x
              b.y = b.home.y
              b.z = b.home.z
              b.rest = 3 + Math.random() * 5
            }
          }
          break
        }
        case 'ground':
        case 'beach':
        case 'water': {
          if (b.rest > 0) b.rest -= dt
          else if (moveTo(b, b.place === 'water' ? cfg.crawlSpeed * 2.2 : cfg.crawlSpeed, dt) < 0.05) {
            b.rest = 0.6 + Math.random() * 2.5
            for (let k = 0; k < 4; k++) {
              const x = b.home.x + (Math.random() * 2 - 1) * 2
              const z = b.home.z + (Math.random() * 2 - 1) * 2
              const top = topBlock(Math.floor(x), Math.floor(z))
              const liquid = blocks.isTagged(top.above, '#core:liquid')
              if (api.world.blockerAt(Math.floor(x), Math.floor(z)) || liquid !== (b.place === 'water')) continue
              if (!liquid && Math.abs(top.y - b.home.y) > 0.5) continue
              b.tx = x
              b.tz = z
              break
            }
          }
          break
        }
        default:
          // trees and rocks: sit still, now and then a little shuffle
          b.y = b.home.y + (b.place === 'trees' ? Math.sin(b.t * 0.7) * 0.04 : 0)
      }
      place(b, s, b.flying)
    }

    const moveTo = (b: Bug, speed: number, dt: number) => {
      const dx = b.tx - b.x
      const dz = b.tz - b.z
      const d = Math.hypot(dx, dz)
      if (d < 1e-3) return 0
      b.heading = Math.atan2(dx, dz)
      const step = Math.min(d, speed * dt)
      b.x += (dx / d) * step
      b.z += (dz / d) * step
      return d - step
    }

    const place = (b: Bug, s: number, flying: boolean) => {
      const o = b.obj
      o.position.set(b.x, b.y, b.z)
      o.rotation.set(0, b.heading - Math.PI / 2, 0)
      if (b.place === 'trees' && !b.fleeing) o.rotation.z = 1.25 // clinging, head up the trunk
      o.scale.setScalar(s)
      if (b.wings) {
        // flutter: big slow beats; buzz: a blur of small fast ones; at rest the wings open and close lazily
        const buzz = b.species.flap === 'buzz'
        const a = flying ? (buzz ? 0.35 + 0.35 * Math.sin(b.t * 70) : 0.15 + 0.85 * Math.abs(Math.sin(b.t * 13))) : buzz ? 0 : 0.35 + 0.3 * Math.sin(b.t * 1.7)
        b.wings[0].rotation.x = a
        b.wings[1].rotation.x = -a
      }
      if (b.halo) {
        const g = b.species.glow!
        const pulse = g.pulse ? 0.55 + 0.45 * Math.sin(b.t * 3.1) : 1
        b.halo.position.set(b.x, b.y + 0.12, b.z)
        b.halo.material.opacity = Math.min(1, cfg.glow * night() * pulse * (s / cfg.scale))
        b.halo.visible = b.halo.material.opacity > 0.01
      }
    }

    api.commands.register({
      name: 'bugs',
      description: 'Насекомые рядом',
      run: () => bugs.map((b) => `${b.species.name} (${b.place}) @ ${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)}${b.fleeing ? ' убегает' : ''}`).join('\n') || 'рядом никого',
    })
  },
})

/** A soft round light: white center fading out (tinted per species by the sprite color). */
function haloCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,0.95)')
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return c
}
