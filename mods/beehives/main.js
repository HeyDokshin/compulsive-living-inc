// @ts-check
/**
 * Hives make honey out of the flowers around. What the mod shows:
 * a config with sliders (F2), a saved component, a daily event, an interaction, a daily note and a command.
 * The hive, its recipe, models, sounds and villagers' lines are data in content/.
 */
import { definePlugin, z } from '@sdk'
import { afterNight } from './lib/honey.js'

const HIVE = 'beehives:hive'
const HONEY = 'beehives:honey'

export default definePlugin({
  id: 'beehives',
  description: 'Ульи: мёд по утрам',
  dependsOn: ['items', 'decor'],
  optionalDependsOn: ['garden', 'daily'],

  setup(api) {
    const cfg = api.config.define(
      z.object({
        /** Flowers this close to a hive count (cells). */
        radius: z.number().int().min(1).max(12).default(4).meta({ step: 1 }),
        flowersPerJar: z.number().int().min(1).max(20).default(3).meta({ label: 'flowers per jar', step: 1 }),
        maxJars: z.number().int().min(1).max(20).default(3).meta({ label: 'max jars', step: 1 }),
      }),
    )
    // The component is saved with the hive.
    api.components.define('beehive', z.object({ jars: z.number().int().min(0) }))

    const hives = () => [...api.entities.world.with('decor', 'transform')].filter((e) => e.decor.piece === HIVE)
    /** @param {import('@sdk').Entity} hive */
    const jarsIn = (hive) => hive.beehive?.jars ?? 0
    /** @param {import('@sdk').Entity} hive @param {number} jars */
    const setJars = (hive, jars) => {
      if (hive.beehive) hive.beehive.jars = jars
      else api.entities.world.addComponent(hive, 'beehive', { jars })
    }
    const night = () => {
      const flowers = [...api.entities.world.with('flower', 'transform')]
      for (const hive of hives()) {
        const near = flowers.filter((f) => Math.hypot(f.transform.x - hive.transform.x, f.transform.z - hive.transform.z) <= cfg.radius)
        setJars(hive, afterNight(jarsIn(hive), near.length, cfg))
      }
    }
    api.events.on('time:day', night)

    // Space at a hive with honey collects it; an empty one behaves like any other piece.
    api.registry('interactions').register({
      id: 'beehives:collect',
      entity: 'decor',
      priority: 40,
      label: 'Собрать мёд',
      sound: 'beehives:buzz',
      anim: 'pickup',
      when: (ctx) => ctx.target?.decor?.piece === HIVE && jarsIn(ctx.target) > 0,
      run: (ctx) => {
        if (!ctx.target) return false
        const jars = jarsIn(ctx.target)
        const left = api.services.get('items:inventory').add(ctx.actor, HONEY, jars)
        setJars(ctx.target, left)
        return left < jars
      },
    })

    try {
      api.registry('daily:sections').register({
        id: 'beehives:today',
        order: 50,
        line: () => {
          const jars = hives().reduce((n, h) => n + jarsIn(h), 0)
          return jars ? { icon: '🍯', text: `В ульях готов мёд: ${jars}.` } : null
        },
      })
    } catch {
      // no daily notes in this game
    }

    api.commands.register({
      name: 'honey',
      description: 'Ульи: пусть пройдёт ночь',
      run: () => {
        night()
        return `ульев: ${hives().length}, мёда: ${hives().reduce((n, h) => n + jarsIn(h), 0)}`
      },
    })
  },
})
