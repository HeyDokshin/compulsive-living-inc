/**
 * Emotes and short speech over heads. The player picks one (T); anyone can show one through the
 * `emotes:show` service. Emotes are data: content/emotes/emotes.emotes.json5.
 */
import { definePlugin, ui, z, type Entity, type RegistryEntry } from '@sdk'
import { glyphBubble, textBubble } from './bubble'

export interface EmoteDef extends RegistryEntry {
  glyph: string
  name: string
  /** Place among the player's emotes (none: only others show it). */
  wheel?: number
  anim?: 'wave' | 'cheer' | 'nod' | 'sad' | 'clap'
  sound?: string
  reply: string[]
}

export interface Emotes {
  /** Show an emote over an entity (`height` = blocks above its feet). */
  show(entity: Entity, id: string, opts?: { seconds?: number; height?: number; silent?: boolean }): void
  /** A short line over an entity. */
  say(entity: Entity, text: string, seconds?: number): void
}

declare module '@sdk' {
  interface Registries {
    'emotes:emotes': EmoteDef
  }
  interface Services {
    'emotes:show': Emotes
  }
  interface GameEvents {
    'emotes:shown': { entity: Entity; id: string }
    /** A line was said over a head (as written, a leading [mood] tag included). */
    'emotes:said': { entity: Entity; text: string }
  }
}

const Config = z.object({
  seconds: z.number().min(0.3).max(10).default(2).meta({ step: 0.1 }),
  /** Seconds a line of speech stays, plus this per letter. */
  saySeconds: z.number().min(0.5).max(10).default(1.8).meta({ label: 'speech (s)', step: 0.1 }),
  sayPerLetter: z.number().min(0).max(0.2).default(0.045).meta({ label: 'speech per letter (s)', step: 0.005 }),
  height: z.number().min(0.5).max(4).default(1.85).meta({ step: 0.05 }),
  /** Height of an emote bubble on screen (blocks at zoom 4). */
  size: z.number().min(0.1).max(2).default(0.62).meta({ step: 0.02 }),
  /** Height of one row of speech. */
  textSize: z.number().min(0.05).max(1).default(0.2).meta({ label: 'text size', step: 0.01 }),
})

export default definePlugin({
  id: 'emotes',
  version: '0.1.0',
  description: 'Эмоции и реплики над головами (T)',
  dependsOn: ['characters'],
  optionalDependsOn: ['player'],

  setup(api) {
    const cfg = api.config.define(Config)
    const T = api.render.three
    const defs = api.createRegistry<EmoteDef>(
      'emotes:emotes',
      z.looseObject({
        id: z.string(),
        glyph: z.string(),
        name: z.string(),
        wheel: z.number().optional(),
        anim: z.enum(['wave', 'cheer', 'nod', 'sad', 'clap']).optional(),
        sound: z.string().optional(),
        reply: z.array(z.string()).default([]),
      }) as never,
    )
    const group = api.render.add(new T.Group())
    type Sprite = InstanceType<typeof T.Sprite>
    interface Shown {
      entity: Entity
      sprite: Sprite
      /** Size in blocks at zoom 4. */
      w: number
      h: number
      height: number
      age: number
      life: number
      texture: InstanceType<typeof T.CanvasTexture>
      /** Emote textures are kept, speech is thrown away. */
      keep: boolean
    }
    const shown = new Map<Entity, Shown>()
    const glyphs = new Map<string, InstanceType<typeof T.CanvasTexture>>()
    const toTexture = (canvas: HTMLCanvasElement) => {
      const t = new T.CanvasTexture(canvas)
      t.colorSpace = T.SRGBColorSpace
      return t
    }
    const remove = (s: Shown) => {
      s.sprite.removeFromParent()
      s.sprite.material.dispose()
      if (!s.keep) s.texture.dispose()
      if (shown.get(s.entity) === s) shown.delete(s.entity)
    }
    const clear = () => {
      for (const s of [...shown.values()]) remove(s)
    }
    api.onDispose(() => {
      clear()
      for (const t of glyphs.values()) t.dispose()
    })
    api.events.on('session:started', clear)
    api.events.on('interior:changed', clear)
    api.events.on('entity:despawned', ({ entity }) => {
      const s = shown.get(entity)
      if (s) remove(s)
    })
    defs.onChange(() => {
      clear()
      for (const t of glyphs.values()) t.dispose()
      glyphs.clear()
    })

    const put = (entity: Entity, texture: Shown['texture'], rowsHeight: number, life: number, height: number, keep: boolean) => {
      const old = shown.get(entity)
      if (old) remove(old)
      const img = texture.image as HTMLCanvasElement
      const sprite = new T.Sprite(new T.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }))
      sprite.center.set(0.5, 0)
      sprite.renderOrder = 30
      group.add(sprite)
      shown.set(entity, { entity, sprite, w: (rowsHeight * img.width) / img.height, h: rowsHeight, height, age: 0, life, texture, keep })
    }
    const service: Emotes = {
      show(entity, id, opts) {
        const d = defs.get(id)
        if (!d || !entity.transform) return
        let texture = glyphs.get(id)
        if (!texture) glyphs.set(id, (texture = toTexture(glyphBubble(d.glyph))))
        put(entity, texture, cfg.size, opts?.seconds ?? cfg.seconds, opts?.height ?? cfg.height, true)
        if (d.sound && !opts?.silent) api.audio.play(d.sound, { at: entity.transform })
        if (d.anim && entity.biped && !entity.biped.action) entity.biped.action = { name: d.anim, t: 0 }
        api.events.emit('emotes:shown', { entity, id })
      },
      say(entity, said, seconds) {
        if (!entity.transform || !said) return
        // [mood] tags are for the speaker's face (faces plugin), not for the bubble
        const text = said.replace(/\[[a-z]+\]\s*/g, '').trim()
        api.events.emit('emotes:said', { entity, text: said })
        const canvas = textBubble(text)
        // rows of 54 px in the canvas → `textSize` blocks each
        put(entity, toTexture(canvas), (canvas.height / 54) * cfg.textSize, seconds ?? cfg.saySeconds + text.length * cfg.sayPerLetter, cfg.height, false)
      },
    }
    api.services.provide('emotes:show', service)

    api.systems.add({
      id: 'bubbles',
      phase: 'render',
      priority: 700,
      run: ({ dt }) => {
        if (!shown.size) return
        // the same size on screen at any zoom
        const k = 4 / api.render.camera.currentZoom
        for (const s of shown.values()) {
          s.age += dt
          if (s.age >= s.life) {
            remove(s)
            continue
          }
          const t = s.entity.view?.position ?? s.entity.transform!
          const pop = Math.min(1, s.age / 0.16)
          const grow = pop < 1 ? 1 - (1 - pop) ** 2 * (1 - pop * 2.2) : 1
          s.sprite.material.opacity = Math.min(1, (s.life - s.age) / 0.25)
          s.sprite.scale.set(s.w * k * grow, s.h * k * grow, 1)
          s.sprite.position.set(t.x, t.y + s.height + Math.sin(s.age * 3) * 0.03, t.z)
        }
      },
    })

    // --- the player's own ------------------------------------------------------------------------
    const player = () => {
      for (const e of api.entities.world.with('player', 'transform')) return e
      return undefined
    }
    const key = api.input.action('wheel', ['KeyT', 'Pad10'], 'Эмоции')
    api.input.on(key, () => {
      if (!api.ui.modalOpen.value) api.ui.open('emotes:wheel')
    })
    api.ui.window({
      id: 'emotes:wheel',
      title: 'Эмоции',
      backdrop: 'clear',
      align: 'bottom',
      component: () => (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center', width: '520px' }}>
          {defs
            .all()
            .filter((d) => d.wheel !== undefined)
            .sort((a, b) => a.wheel! - b.wheel!)
            .map((d) => (
              <ui.Button
                key={d.id}
                secondary
                onClick={() => {
                  api.ui.close()
                  const p = player()
                  if (p) service.show(p, d.id)
                }}
              >
                {d.glyph} {d.name}
              </ui.Button>
            ))}
        </div>
      ),
    })
    api.commands.register({
      name: 'emote',
      description: 'Показать эмоцию: emote hello',
      usage: '<id>',
      run: ([id]) => {
        const full = id?.includes(':') ? id : `emotes:${id}`
        if (!defs.has(full)) throw new Error(`нет эмоции "${id}": ${defs.ids().join(', ')}`)
        const p = player()
        if (p) service.show(p, full)
        return 'ok'
      },
    })
  },
})
