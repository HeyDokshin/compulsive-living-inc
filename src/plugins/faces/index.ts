/**
 * Drawn faces for round characters: eyes, brows, mouth and blush painted in 2D onto the round heads
 * (heads whose model has a `face`). Faces blink, look at whoever they talk to, move their mouths
 * while a line is being typed, and show expressions — from emotes, from what is said
 * (`faces:control.ofLine`), or set by any plugin. The picture is redrawn only when something
 * changes, at a resolution that follows the zoom: tiny far away, crisp in a close-up.
 */
import { definePlugin, z, type Entity, type FaceSlot, type PluginApi } from '@sdk'
import { drawFace, type FacePose } from './draw'
import { EXPRESSIONS, moodOfLine, mouthFrame, stepBlink, stripTag, type Expression, type FaceClock } from './mood'

export type { Expression } from './mood'

type Obj = InstanceType<PluginApi['render']['three']['Object3D']>
/** A character: an entity (its view) or a rig model a plugin placed itself. */
export type Target = Entity | Obj

export interface Faces {
  /** Show an expression for `seconds` (default: until another one), then back to the mood. */
  show(target: Target, expr: Expression, seconds?: number): void
  /** The expression a face rests in (default neutral). */
  mood(target: Target, expr: Expression): void
  /** Moving lips (a line being said). */
  talk(target: Target, on: boolean): void
  /** Eyes follow this (null: look ahead). */
  look(target: Target, at: Target | null): void
  /** The expression a line suggests (a leading `[joy]` tag, words, punctuation) — null: none. */
  ofLine(text: string): Expression | null
  /** A line without its face tag, for showing. */
  clean(text: string): string
}

declare module '@sdk' {
  interface Services {
    'faces:control': Faces
  }
}

const Expr = z.enum(EXPRESSIONS)
const Config = z.object({
  /** Seconds between blinks (random in this range). */
  blinkMin: z.number().min(0.5).max(20).default(2.2).meta({ label: 'blink every (min s)', step: 0.1 }),
  blinkMax: z.number().min(0.5).max(30).default(5.5).meta({ label: 'blink every (max s)', step: 0.1 }),
  /** Face pictures: texels across the face per screen pixel, and the largest size. */
  detail: z.number().min(0.5).max(3).default(1.5).meta({ step: 0.1 }),
  maxSize: z.number().int().min(32).max(1024).default(512).meta({ label: 'max size', step: 32 }),
  minSize: z.number().int().min(16).max(256).default(32).meta({ label: 'min size', step: 16 }),
  /** How far the eyes turn towards what they look at (0…1). */
  lookAmount: z.number().min(0).max(1).default(0.8).meta({ step: 0.05 }),
  /** Expressions for emotes shown over a head (`emotes:show`). */
  emotes: z.record(z.string(), Expr).default({
    'emotes:hello': 'happy',
    'emotes:joy': 'joy',
    'emotes:love': 'love',
    'emotes:clap': 'joy',
    'emotes:surprise': 'surprised',
    'emotes:question': 'thinking',
    'emotes:sad': 'sad',
    'emotes:sleepy': 'sleepy',
    'emotes:note': 'happy',
    'emotes:idea': 'surprised',
    'emotes:shy': 'shy',
    'emotes:flower': 'happy',
    'emotes:rain': 'worried',
    'emotes:cold': 'worried',
    'emotes:gift': 'joy',
  }),
  /** Seconds an emote's expression stays. */
  emoteSeconds: z.number().min(0.2).max(20).default(2.4).meta({ step: 0.1 }),
})

interface FaceState extends FaceClock {
  mood: Expression
  expr: Expression | null
  until: number
  talking: boolean
  lookAt: Target | null
  lookX: number
  lookY: number
  canvas: HTMLCanvasElement | null
  texture: InstanceType<PluginApi['render']['three']['CanvasTexture']> | null
  /** What the picture shows now (redraw only when it changes). */
  key: number
}

export default definePlugin({
  id: 'faces',
  version: '0.1.0',
  description: 'Нарисованные лица круглых персонажей: мимика, моргание, взгляд, речь',

  setup(api) {
    const cfg = api.config.define(Config)
    const T = api.render.three
    const states = new WeakMap<object, FaceState>()
    /** Faces holding a picture, with their rig (to free the picture when the rig is gone). */
    const textures = new Map<FaceState, Obj>()
    let time = 0
    let frameDt = 0
    let frames = 0

    const isObj = (t: Target): t is Obj => (t as Obj).isObject3D === true
    const rootOf = (t: Target): Obj | null => (isObj(t) ? t : (t.view ?? null))
    const stateOf = (root: object): FaceState => {
      let s = states.get(root)
      if (!s) {
        s = {
          mood: 'neutral',
          expr: null,
          until: 0,
          talking: false,
          lookAt: null,
          lookX: 0,
          lookY: 0,
          blinkIn: 1 + Math.random() * 3,
          blinkLeft: 0,
          talkTime: 0,
          canvas: null,
          texture: null,
          key: -1,
        }
        states.set(root, s)
      }
      return s
    }
    const withState = (t: Target, fn: (s: FaceState) => void) => {
      const root = rootOf(t)
      if (root) fn(stateOf(root))
    }

    const control: Faces = {
      show: (t, expr, seconds) => withState(t, (s) => ((s.expr = expr), (s.until = seconds ? time + seconds : Infinity))),
      mood: (t, expr) => withState(t, (s) => void (s.mood = expr)),
      talk: (t, on) =>
        withState(t, (s) => {
          if (on && !s.talking) s.talkTime = 0
          s.talking = on
        }),
      look: (t, at) => withState(t, (s) => void (s.lookAt = at)),
      ofLine: moodOfLine,
      clean: stripTag,
    }
    api.services.provide('faces:control', control)

    // a line over the head: the lips move for a moment, the face shows what it says
    const saying = new Map<Target, number>()
    api.events.on('emotes:said', ({ entity, text }) => {
      const expr = moodOfLine(text)
      if (expr) control.show(entity, expr, cfg.emoteSeconds)
      control.talk(entity, true)
      saying.set(entity, time + Math.min(2.5, 0.4 + stripTag(text).length * 0.05))
    })
    api.events.on('emotes:shown', ({ entity, id }) => {
      const expr = cfg.emotes[id]
      if (expr) control.show(entity, expr, cfg.emoteSeconds)
    })

    // --- every frame: pose, then repaint the faces whose picture changed -----------------------------
    const pose: FacePose = { expr: 'neutral', blink: false, mouth: 0, lookX: 0, lookY: 0 }
    const v = new T.Vector3()
    const blinkRange: [number, number] = [2, 5]
    const paint = (slot: FaceSlot) => {
      const root = slot.root
      if (!root.visible) return
      const s = stateOf(root)
      // size on screen → picture size
      const e = slot.mesh.matrixWorld.elements
      const scale = Math.hypot(e[0]!, e[1]!, e[2]!)
      const px = slot.face.size[0] * scale * api.render.pixelsPerBlock * cfg.detail
      if (!(px > 0)) return // not placed yet
      const res = Math.min(cfg.maxSize, Math.max(cfg.minSize, 2 ** Math.ceil(Math.log2(Math.max(1, px)))))
      // eyes towards what they look at, in the head's own space (front = +z)
      let lx = 0
      let ly = 0
      const atObj = s.lookAt ? rootOf(s.lookAt) : null
      if (atObj) {
        atObj.getWorldPosition(v)
        v.y += 0.8 // their face, roughly
        slot.mesh.worldToLocal(v)
        const d = Math.max(1, Math.hypot(v.x, v.z))
        lx = Math.max(-1, Math.min(1, (v.x / d) * 2)) * cfg.lookAmount
        ly = Math.max(-1, Math.min(1, (v.y - slot.face.center[1]) / d)) * cfg.lookAmount
      }
      // ease the eyes (quantized below, so they move in small steps, not every frame)
      s.lookX += (lx - s.lookX) * 0.2
      s.lookY += (ly - s.lookY) * 0.2
      if (s.expr && time > s.until) s.expr = null
      pose.expr = s.expr ?? s.mood
      pose.blink = pose.expr !== 'happy' && pose.expr !== 'joy' && stepBlink(s, frameDt, Math.random, blinkRange)
      if (s.talking) s.talkTime += frameDt
      pose.mouth = mouthFrame(s.talking, s.talkTime)
      const qx = Math.round(s.lookX * 4)
      const qy = Math.round(s.lookY * 4)
      pose.lookX = qx / 4
      pose.lookY = qy / 4
      const key = ((((EXPRESSIONS.indexOf(pose.expr) * 2 + (pose.blink ? 1 : 0)) * 3 + pose.mouth) * 9 + qx + 4) * 9 + qy + 4) * 2048 + res
      if (key === s.key) return
      s.key = key
      const h = Math.max(8, Math.round((res * slot.face.size[1]) / slot.face.size[0]))
      if (!s.canvas || s.canvas.width !== res) {
        s.canvas ??= document.createElement('canvas')
        s.canvas.width = res
        s.canvas.height = h
        s.texture?.dispose()
        s.texture = new T.CanvasTexture(s.canvas)
        s.texture.colorSpace = T.SRGBColorSpace
        s.texture.generateMipmaps = false
        s.texture.minFilter = T.LinearFilter
        textures.set(s, root)
      }
      drawFace(s.canvas.getContext('2d')!, res, h, slot.face, pose)
      s.texture!.needsUpdate = true
      slot.picture(s.texture)
    }
    api.systems.add({
      id: 'faces',
      phase: 'render',
      priority: 600,
      run: ({ dt }) => {
        time += dt
        frameDt = dt
        for (const [who, until] of saying) {
          if (time < until) continue
          control.talk(who, false)
          saying.delete(who)
        }
        // now and then: free the pictures of characters that are gone
        if (++frames % 300 === 0) {
          for (const [s, root] of textures) {
            let top: Obj = root
            while (top.parent) top = top.parent
            if ((top as { isScene?: boolean }).isScene) continue
            s.texture?.dispose()
            s.texture = null
            s.canvas = null
            s.key = -1
            textures.delete(s)
          }
        }
        blinkRange[0] = cfg.blinkMin
        blinkRange[1] = Math.max(cfg.blinkMin, cfg.blinkMax)
        api.render.eachFace(paint)
      },
    })
    api.onDispose(() => {
      for (const s of textures.keys()) s.texture?.dispose()
      textures.clear()
    })
  },
})
