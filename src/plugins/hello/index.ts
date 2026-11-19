/**
 * Sample plugin: shows the extension points end-to-end.
 * - config with live sliders (debug panel → "config · hello")
 * - a component + system (`spin`)
 * - reading the world (toys stand on the ground, never in water) and reacting to `world:generated`
 * - a hook (random tint on spawn), an event, an input action and a console command
 */
import { definePlugin, z, type Entity, type PluginApi } from '@sdk'

declare module '@sdk' {
  interface Components {
    spin?: { speed: number; bob: number; baseY?: number; phase?: number }
  }
  interface GameEvents {
    'hello:toyAdded': { uid: number }
  }
}

const Config = z.object({
  toys: z.number().int().min(0).max(300).default(8).meta({ step: 1 }),
  spreadRadius: z.number().min(2).max(100).default(18).meta({ label: 'spread radius', step: 1 }),
  spinMultiplier: z.number().min(0).max(10).default(1).meta({ step: 0.1 }),
  randomTint: z.boolean().default(true),
})
type Config = z.infer<typeof Config>

const SpinSchema = z.object({
  speed: z.number().default(1),
  bob: z.number().default(0.1),
  baseY: z.number().optional(),
  phase: z.number().optional(),
})

export default definePlugin({
  id: 'hello',
  version: '0.2.0',
  description: 'Пример плагина: крутилки на острове, команда /toy, клавиша T',

  setup(api) {
    const cfg = api.config.define(Config)
    api.components.define('spin', SpinSchema)

    api.systems.add({
      id: 'spin',
      phase: 'update',
      run: ({ dt, time }) => {
        for (const e of api.entities.world.with('spin', 'transform')) {
          e.spin.phase ??= Math.random() * Math.PI * 2
          e.spin.baseY ??= e.transform.y
          e.transform.rotY += e.spin.speed * cfg.spinMultiplier * dt
          e.transform.y = e.spin.baseY + 0.15 + Math.sin(time * 2 + e.spin.phase) * e.spin.bob
        }
      },
    })

    api.hooks.tap('entity:beforeSpawn', (comps, { prefab }) => {
      if (!cfg.randomTint || !prefab || !api.registry('prefabs').isTagged(prefab, '#hello:toys') || !comps.model) {
        return comps
      }
      const hue = Math.floor(Math.random() * 360)
      return { ...comps, model: { ...comps.model, color: `hsl(${hue}, 70%, 75%)` } }
    })

    const toyAction = api.input.action('spawnToy', ['KeyT'])
    api.input.on(toyAction, () => spawnToy(api, 4))

    api.commands.register({
      name: 'toy',
      description: 'Создать крутилку рядом с камерой (или N штук)',
      usage: '[count]',
      run: ([n]) => {
        const count = Number(n ?? 1)
        for (let i = 0; i < count; i++) spawnToy(api, 6)
        return `+${count}`
      },
    })
  },

  start(api) {
    const cfg = api.config.define(Config)
    const toys: Entity[] = []
    const sync = () => {
      while (toys.length < cfg.toys) toys.push(spawnToy(api, cfg.spreadRadius, true))
      while (toys.length > cfg.toys) api.entities.despawn(toys.pop()!)
    }
    sync()
    api.config.onChange(sync)
    // New island: put every toy back on solid ground.
    api.events.on('world:generated', () => {
      for (const t of toys) placeOnGround(api, t, cfg, true)
    })
    // This plugin owns its toys: on hot reload they go away and come back with the new code.
    api.onDispose(() => toys.forEach((t) => api.entities.despawn(t)))
  },
})

function spawnToy(api: PluginApi, radius: number, aroundCenter = false): Entity {
  const e = api.entities.spawn('hello:spinner', {
    transform: { x: 0, y: 0, z: 0, rotY: 0 },
    spin: { speed: 0.5 + Math.random() * 2, bob: 0.05 + Math.random() * 0.2 },
  })
  placeOnGround(api, e, { spreadRadius: radius } as Config, aroundCenter)
  api.events.emit('hello:toyAdded', { uid: e.uid! })
  return e
}

/** Random dry spot near the camera (or the island center). */
function placeOnGround(api: PluginApi, e: Entity, cfg: Pick<Config, 'spreadRadius'>, aroundCenter: boolean): void {
  const w = api.world
  const c = aroundCenter ? { x: w.sizeX / 2, z: w.sizeZ / 2 } : api.render.camera.target
  const blocks = api.registry('blocks')
  for (let tries = 0; tries < 50; tries++) {
    const a = Math.random() * Math.PI * 2
    const r = Math.sqrt(Math.random()) * cfg.spreadRadius
    const x = Math.floor(c.x + Math.cos(a) * r)
    const z = Math.floor(c.z + Math.sin(a) * r)
    const y = w.surfaceY(x, z)
    if (y === 0 || blocks.isTagged(w.getBlock(x, y, z), '#core:liquid')) continue
    e.transform!.x = x + 0.5
    e.transform!.z = z + 0.5
    e.transform!.y = y
    if (e.spin) e.spin.baseY = y
    return
  }
}
