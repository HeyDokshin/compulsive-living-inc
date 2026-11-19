/**
 * What tools do — entries of the interaction matrix (tool × target → effect).
 * The shovel really digs and fills holes; the other tools answer with a friendly note until
 * their stage arrives (trees — stage 5, fish and bugs — stage 6). Adding a tool action is one
 * `interactions.register(...)` call, from any plugin.
 */
import { definePlugin, z } from '@sdk'

const Config = z.object({
  /** Tool notes are shown at most once per this many seconds. */
  noteCooldown: z.number().min(0).max(30).default(2.5).meta({ label: 'note cooldown (s)', step: 0.5 }),
})

interface Hole {
  y: number
  block: string
}

export default definePlugin({
  id: 'tools',
  version: '0.1.0',
  description: 'Действия инструментов: лопата копает, остальные — заглушки до своих этапов',
  dependsOn: ['items'],

  setup(api) {
    const cfg = api.config.define(Config)
    const interactions = api.registry('interactions')
    const holes = new Map<string, Hole>()
    const key = (x: number, z: number) => `${x},${z}`
    api.events.on('world:generated', () => holes.clear())
    // Holes are walked around (like in cozy island games): the air just above a hole counts as a wall.
    api.hooks.tap('movement:blocked', (blocked, { x, y, z }) => {
      if (blocked) return blocked
      const h = holes.get(key(x, z))
      return !!h && (y === h.y || y === h.y + 1)
    })
    api.save.register<Array<[string, Hole]>>({
      version: 1,
      save: () => [...holes],
      load: (data) => {
        holes.clear()
        for (const [k, h] of data) holes.set(k, h)
      },
    })

    let lastNote = 0
    const note = (text: string) => {
      const now = performance.now() / 1000
      if (now - lastNote < cfg.noteCooldown) return
      lastNote = now
      api.ui.toast(text)
    }

    // --- shovel ---------------------------------------------------------------------------
    interactions.register({
      id: 'tools:fill_hole',
      tool: '#core:shovels',
      priority: 20,
      label: 'Закопать',
      when: (ctx) => {
        const h = holes.get(key(ctx.x, ctx.z))
        return !!h && ctx.y === h.y - 1 && ctx.entities.length === 0
      },
      run: (ctx) => {
        const h = holes.get(key(ctx.x, ctx.z))!
        holes.delete(key(ctx.x, ctx.z))
        return api.world.setBlock(ctx.x, h.y, ctx.z, h.block)
      },
    })
    interactions.register({
      id: 'tools:dig',
      tool: '#core:shovels',
      block: '#core:diggable',
      priority: 10,
      label: 'Копать',
      when: (ctx) => {
        if (ctx.entities.length || holes.has(key(ctx.x, ctx.z)) || ctx.y < 1) return false
        // only where the actor stands about level with the ground
        const t = ctx.actor.transform!
        return Math.abs(t.y - (ctx.y + 1)) <= 1
      },
      run: (ctx) => {
        if (!api.world.setBlock(ctx.x, ctx.y, ctx.z, api.world.AIR)) return false
        holes.set(key(ctx.x, ctx.z), { y: ctx.y, block: ctx.block })
      },
    })

    // --- stubs until their stages ----------------------------------------------------------
    interactions.register({
      id: 'tools:cast',
      tool: '#core:rods',
      block: '#core:liquid',
      label: 'Забросить удочку',
      run: () => note('Поплавок качается… Рыбалка появится на этапе 6.'),
    })
    interactions.register({
      id: 'tools:water',
      tool: '#core:watering_cans',
      block: '#core:flora_soil',
      label: 'Полить',
      run: () => note('Трава благодарна. Цветы появятся на этапе 5.'),
    })
    interactions.register({
      id: 'tools:net_swing',
      tool: '#core:nets',
      priority: -10,
      label: 'Взмахнуть сачком',
      run: () => note('Никого не поймали. Насекомые прилетят на этапе 6.'),
    })
    interactions.register({
      id: 'tools:axe_swing',
      tool: '#core:axes',
      priority: -10,
      label: 'Взмахнуть топором',
      run: () => note('Рубить пока нечего — деревья вырастут на этапе 5.'),
    })
    // Any tool, nothing to do: just a swing (keeps the controls feeling alive).
    interactions.register({
      id: 'tools:swing',
      tool: '#core:tools',
      priority: -100,
      label: 'Взмахнуть',
      run: () => undefined,
    })

    api.commands.register({
      name: 'holes',
      description: 'Сколько ямок выкопано',
      run: () => `holes: ${holes.size}`,
    })
  },
})
