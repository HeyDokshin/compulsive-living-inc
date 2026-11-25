/**
 * Crafting at the workbench. Recipes are data (content/crafting/crafting.recipes.json5): a decor piece
 * (you choose its color) or a plain item, from items or tags. Some are known from the start, the
 * rest come on recipe cards (`crafting:card_<name>`, sold in the shop) — hold one and press the
 * action key to learn it. Paint repaints a decor piece in another color.
 * A workbench stands near the middle of every new island.
 */
import { definePlugin, z, type Entity, type RegistryEntry } from '@sdk'
import { Bench } from './bench'
import type { Ingredient } from './recipes'

export interface RecipeDef extends RegistryEntry {
  /** A decor piece (pick a color when crafting)… */
  piece?: string
  /** …or a plain item. */
  item?: string
  count: number
  ingredients: Ingredient[]
  learned: 'start' | 'card'
  cardPrice: number
}

export interface Crafting {
  knows(recipeId: string): boolean
  learn(recipeId: string): boolean
  /** Item id of a recipe's card. */
  cardOf(recipeId: string): string
}

declare module '@sdk' {
  interface Registries {
    'crafting:recipes': RecipeDef
  }
  interface Services {
    'crafting:book': Crafting
  }
  interface GameEvents {
    'crafting:crafted': { actor: Entity; recipe: string; item: string; count: number }
  }
}

const RecipeSchema = z.looseObject({
  id: z.string(),
  tags: z.array(z.string()).optional(),
  piece: z.string().optional(),
  item: z.string().optional(),
  count: z.number().int().min(1).default(1),
  ingredients: z.array(z.object({ item: z.string().optional(), tag: z.string().optional(), count: z.number().int().min(1).default(1) })).min(1),
  learned: z.enum(['start', 'card']).default('start'),
  cardPrice: z.number().int().min(0).default(500),
})

const Config = z.object({
  /** Decor piece that works as a workbench. */
  benchPiece: z.string().default('decor:workbench'),
  /** Item spent to repaint a piece. */
  paint: z.string().default('crafting:paint'),
  /** Keep this many cells around the starting workbench free of big buildings. */
  clearance: z.number().int().min(0).max(10).default(4).meta({ step: 1 }),
})
export type CraftingConfig = z.infer<typeof Config>

export const cardId = (recipeId: string) => `crafting:card_${recipeId.split(':').pop()}`

export default definePlugin({
  id: 'crafting',
  version: '0.1.0',
  description: 'Крафт: верстак, рецепты и открытки с рецептами, перекраска поделок',
  dependsOn: ['items', 'decor'],
  // placed after the museum, the shop and the sell box so the workbench doesn't take their spots
  optionalDependsOn: ['museum', 'economy', 'shop', 'tutorial', 'daily'],

  setup(api) {
    const cfg = api.config.define(Config)
    const recipes = api.createRegistry<RecipeDef>('crafting:recipes', RecipeSchema as never)
    const decor = () => api.services.get('decor:pieces')
    const known = new Set<string>()
    api.save.register<string[]>({
      version: 1,
      save: () => [...known],
      load: (ids) => {
        known.clear()
        for (const id of ids) known.add(id)
      },
    })

    const resultName = (r: RecipeDef) => (r.piece ? decor().get(r.piece)?.name : api.registry('items').get(r.item ?? '')?.name) ?? r.id
    const book: Crafting = {
      knows: (id) => known.has(id) || recipes.get(id)?.learned === 'start',
      learn: (id) => {
        if (book.knows(id)) return false
        known.add(id)
        return true
      },
      cardOf: cardId,
    }
    api.services.provide('crafting:book', book)

    // Recipe cards: one item per card recipe.
    const cards = new Map<string, string>() // card item → recipe
    const registerCards = () => {
      const items = api.registry('items')
      cards.clear()
      for (const r of recipes.all()) {
        if (r.learned !== 'card') continue
        const id = cardId(r.id)
        cards.set(id, r.id)
        if (items.has(id)) continue
        items.register({
          id,
          name: `Рецепт: ${resultName(r)}`,
          description: 'Возьмите в руки и нажмите действие, чтобы выучить.',
          stack: 1,
          model: 'crafting:card',
          price: r.cardPrice,
          tags: ['crafting:cards'],
          held: { tilt: 0, scale: 1 },
          ground: { lie: false },
        })
      }
    }
    api.events.on('content:loaded', registerCards)
    registerCards()

    const inventory = () => api.services.get('items:inventory')
    const interactions = api.registry('interactions')
    interactions.register({
      id: 'crafting:learn',
      tool: '#crafting:cards',
      priority: 90,
      anim: 'none',
      label: 'Выучить рецепт',
      run: (ctx) => {
        const recipe = cards.get(ctx.held ?? '')
        const r = recipe ? recipes.get(recipe) : undefined
        if (!r) return false
        if (!book.learn(r.id)) {
          api.ui.toast('Этот рецепт вы уже знаете.')
          return false
        }
        inventory().remove(ctx.actor, ctx.held!, 1)
        api.ui.toast(`Новый рецепт: ${resultName(r)}! Смастерить можно на верстаке.`, { ms: 3200 })
        api.audio.play('ui:pop')
      },
    })
    interactions.register({
      id: 'crafting:bench',
      entity: 'decor',
      priority: 40,
      anim: 'none',
      sound: 'ui:open',
      label: 'Мастерить',
      when: (ctx) => ctx.target?.decor?.piece === cfg.benchPiece,
      run: () => void api.ui.open('crafting:bench'),
    })
    // The bench takes the main action, so taking it goes on the second one.
    interactions.register({
      id: 'crafting:bench_take',
      entity: 'decor',
      button: 'secondary',
      priority: 20,
      anim: 'pickup',
      sound: 'core:pickup',
      label: 'Забрать верстак',
      when: (ctx) => ctx.target?.decor?.piece === cfg.benchPiece,
      run: (ctx) => decor().take(ctx.actor, ctx.target!),
    })

    api.ui.window({
      id: 'crafting:bench',
      title: 'Верстак',
      component: () => <Bench api={api} cfg={cfg} recipes={() => recipes.all()} book={book} resultName={resultName} />,
    })

    // A workbench near the middle of a new island (and of older saves that have none).
    const benches = () => [...api.entities.world.with('decor')].filter((e) => e.decor.piece === cfg.benchPiece)
    const placeBench = () => {
      const cx = Math.floor(api.world.sizeX / 2)
      const cz = Math.floor(api.world.sizeZ / 2)
      const ok = (x: number, z: number) => {
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (decor().freeCell(x + dx, z + dz) === null) return false
        const r = cfg.clearance
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if ((api.world.blockerAt(x + dx, z + dz)?.blocker?.w ?? 1) > 1) return false
        return true
      }
      for (let r = 3; r < api.world.sizeX / 2; r++)
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || !ok(cx + dx, cz + dz)) continue
            return decor().place(cfg.benchPiece, 'natural', cx + dx, cz + dz, 0)
          }
      return null
    }
    api.events.on('session:started', () => {
      if (!api.save.hasData && !benches().length && !placeBench()) api.log.warn('no place for the workbench')
    })

    try {
      api.registry('tutorial:steps').register({
        id: 'crafting:tutorial_craft',
        order: 85,
        day: 2,
        text: 'Смастерите что-нибудь на верстаке — например, скамейку из древесины.',
        keys: ['Space'],
        event: 'crafting:crafted',
      })
      api.registry('tutorial:steps').register({
        id: 'crafting:tutorial_place',
        order: 94,
        day: 3,
        text: 'Поставьте поделку на острове или дома: возьмите её в руки из карманов.',
        keys: ['Space'],
        event: 'interaction:performed',
        when: (p: { id: string }) => p.id === 'decor:place',
      })
    } catch {
      // no tutorial
    }

    api.commands.register({
      name: 'recipes',
      description: 'Рецепты: recipes (список) · recipes all (выучить все)',
      usage: '[all]',
      run: ([what]) => {
        if (what === 'all') for (const r of recipes.all()) known.add(r.id)
        return recipes
          .all()
          .map((r) => `${book.knows(r.id) ? '✓' : '·'} ${r.id.padEnd(22)} ${resultName(r)}`)
          .join('\n')
      },
    })
  },
})
