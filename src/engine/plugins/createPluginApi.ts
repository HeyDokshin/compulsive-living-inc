import * as THREE from 'three'
import type { ZodType } from 'zod'
import type { Game, GamePlugin } from '../Game'
import type { RegistryEntry } from '../registry/Registry'
import type { SaverDef } from '../save/SaveService'
import type { PatternFn } from '../render/textures'
import { AIR } from '../world/BlockPalette'
import { cellContext } from '../interact/cellContext'
import { DisposableStack } from '../util/disposables'
import { createLogger } from '../util/log'
import type { PluginApi } from './PluginApi'
import type { PluginScope } from './PluginManager'

/**
 * The API object one plugin gets. Every registration made through it is tracked and undone
 * when the plugin unloads (hot reload, session restart) — plugins never clean up by hand.
 */
export function createPluginScope(game: Game, def: GamePlugin): PluginScope<PluginApi> {
  const owner = def.id
  const stack = new DisposableStack()
  const track = <T extends () => void>(fn: T): T => (stack.add(fn), fn)
  const ns = (name: string) => (name.includes(':') ? name : `${owner}:${name}`)

  const api: PluginApi = {
    id: owner,
    log: createLogger(owner),
    engineConfig: game.engineConfig,

    registry: (name) => game.registries.get<never>(name).view(owner, track) as never,
    createRegistry: <T extends RegistryEntry>(name: string, schema?: ZodType<T>) => {
      if (!name.startsWith(owner + ':')) throw new Error(`Registry "${name}" must be namespaced "${owner}:…"`)
      return game.registries.create<T>(name, schema, owner).view(owner, track)
    },

    events: {
      on: (n, fn) => track(game.events.on(n, fn)),
      once: (n, fn) => track(game.events.once(n, fn)),
      emit: (n, p) => game.events.emit(n, p),
    },
    hooks: {
      tap: (n, fn, o) => track(game.hooks.tap(n, fn, o)),
      run: (n, v, c) => game.hooks.run(n, v, c),
    },
    systems: {
      add: (s) => track(game.scheduler.add({ ...s, id: ns(s.id) }, owner)),
    },
    components: {
      define: (name, schema, o) => void track(game.entities.define(name, owner, schema, o?.persistent ?? true)),
    },
    entities: {
      world: game.entities.world,
      spawn: (src, over) => game.entities.spawn(src, over),
      despawn: (e) => game.entities.despawn(e),
    },
    config: {
      define: (schema) => game.config.define(owner, schema, owner),
      onChange: (fn) => track(game.config.onChange(owner, fn)),
    },
    input: {
      stick: game.input.stick,
      pointer: game.input.pointer,
      action: (name, keys) => {
        const id = ns(name)
        track(game.input.define(id, keys, owner))
        return id
      },
      isDown: (a) => game.input.isDown(a),
      wasPressed: (a) => game.input.wasPressed(a),
      on: (a, fn) => track(game.input.on(a, fn)),
      consumeWheel: () => game.input.consumeWheel(),
    },
    commands: {
      register: (cmd) => game.commands.register({ ...cmd, id: cmd.id ?? `${owner}:${cmd.name}` }, owner),
    },
    render: {
      three: THREE,
      scene: game.renderer.scene,
      camera: game.renderer.iso,
      stylize: (material, opts) => game.renderer.stylize(material, opts),
      voxelModel: (id, opts) => game.modelLibrary.createVoxel(id, opts),
      rigModel: (id, opts) => game.modelLibrary.createRig(id, opts),
      refreshView: (e) => game.renderer.entityRenderer.refresh(e),
      setModel: (e, model) => {
        // a plain assignment would not put a new component into the ECS queries (nothing would draw it)
        if (e.model) {
          e.model = model
          game.renderer.entityRenderer.refresh(e)
        } else game.entities.world.addComponent(e, 'model', model)
      },
      modelInfo: async (id) => {
        const m = await game.modelLibrary.getModel(id)
        if (!m) return null
        const [sx, , sz] = m.model.size
        return { size: m.model.size, pivot: m.def.pivot ?? [sx / 2, 0, sz / 2], scale: m.def.scale }
      },
      shake: (amplitude, seconds) => {
        if (game.engineConfig.camera.shake > 0) game.renderer.iso.shake(amplitude * game.engineConfig.camera.shake, seconds)
      },
      setZoom: (zoom) => {
        const c = game.engineConfig.camera
        game.config.set('engine', 'camera.zoom', Math.min(c.maxZoom, Math.max(c.minZoom, zoom)))
      },
      follow: (entity) => {
        game.camera.follow = entity
        if (entity) game.camera.placed = true
        track(() => {
          if (game.camera.follow === entity) game.camera.follow = null
        })
      },
      blockSurface: (blockId, rects, y, opts) => {
        const block = game.blocks.get(blockId)
        const mesh = game.renderer.createBlockSurface(blockId, rects, y, opts?.transparent ?? !!block?.transparent)
        game.renderer.scene.add(mesh)
        track(() => {
          mesh.removeFromParent()
          mesh.geometry.dispose()
        })
        return mesh
      },
      add: (obj) => {
        game.renderer.scene.add(obj)
        track(() => {
          obj.removeFromParent()
          obj.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.())
        })
        return obj
      },
    },
    world: {
      get sizeX() {
        return game.world.voxels.sizeX
      },
      get sizeZ() {
        return game.world.voxels.sizeZ
      },
      get height() {
        return game.world.voxels.height
      },
      AIR,
      get seed() {
        return game.worldConfig.seed
      },
      pick: (clientX, clientY) => game.renderer.pick(clientX, clientY),
      blockerAt: (x, z) => game.blockers.at(x, z),
      getBlock: (x, y, z) => game.world.getBlock(x, y, z),
      setBlock: (x, y, z, id) => game.world.setBlock(x, y, z, id),
      isSolid: (x, y, z) => game.world.isSolid(x, y, z),
      surfaceY: (x, z) => game.world.surfaceY(x, z),
      regenerate: (seed) => game.world.regenerate(seed),
      regenerateSoon: () => game.world.regenerateSoon(),
      voxels: game.world.voxels,
    },
    textures: {
      pattern: (name: string, fn: PatternFn) => {
        const patterns = game.renderer.atlas.patterns
        if (patterns.has(name)) throw new Error(`Texture pattern "${name}" already exists`)
        patterns.set(name, fn)
        game.scheduleAtlas()
        track(() => {
          patterns.delete(name)
          game.scheduleAtlas()
        })
      },
    },
    time: {
      now: () => game.time.now(),
      get hour() {
        return game.time.now().hour
      },
      get dayIndex() {
        return game.time.now().dayIndex
      },
      get season() {
        return game.time.now().season
      },
      shift: (ms) => game.time.shift(ms),
    },
    audio: {
      play: (id, opts) => game.audio.play(id, opts),
      note: (n) => game.audio.note(n),
      loop: (o) => {
        const h = game.audio.loop(o)
        if (h) track(() => h.stop())
        return h
      },
      get ready() {
        return game.audio.ready
      },
      get time() {
        return game.audio.time
      },
    },
    fx: {
      burst: (id, at, opts) => game.particles.burst(id, at, opts),
    },
    ui: {
      slot: (slot, component, opts) => void track(game.ui.slot(slot, component, owner, opts?.order)),
      window: (w) => void track(game.ui.window(w, owner)),
      open: (id) => game.ui.open(id),
      close: () => game.ui.close(),
      toggle: (id) => game.ui.toggle(id),
      toast: (text, opts) => game.ui.toast(text, opts),
      modalOpen: game.ui.modalOpen,
      itemIcon: (id) => game.icons.item(id),
    },
    interactions: {
      find: (ctx) => game.interactions.find(ctx),
      perform: (ctx) => game.interactions.perform(ctx),
      label: (d, ctx) => game.interactions.label(d, ctx),
      held: (actor) => game.hooks.run('interaction:held', null, { actor }),
      at: (actor, x, z) => cellContext(game.world.voxels, game.entities, game.hooks, actor, x, z, (cx, cz) => game.blockers.at(cx, cz)),
    },
    interiors: {
      area: (id) => game.interiors.area(id),
      get current() {
        return game.interiors.current
      },
      enter: (id, actor, at) => {
        const t = actor.transform
        if (!t) return
        game.interiors.enter(id, { x: t.x, y: t.y, z: t.z, rotY: t.rotY })
        game.moveActor(actor, at)
      },
      exit: (actor) => {
        const id = game.interiors.current
        const back = game.interiors.exit()
        if (back) game.moveActor(actor, back)
        if (id) game.restoreSea(game.interiors.area(id))
      },
    },
    save: {
      register: (d: SaverDef, name?: string) => void track(game.sessions.saves.register(name ? `${owner}:${name}` : owner, d, owner)),
      get loaded() {
        return game.sessions.session.loaded
      },
      get hasData() {
        return game.sessions.saves.loadedKeys.has(owner)
      },
      saveNow: () => game.sessions.save().then(() => undefined),
    },
    services: {
      provide: (name, impl) => void track(game.services.provide(name, impl, owner)),
      get: (name) => game.services.get(name),
      has: (name) => game.services.has(name),
    },
    onDispose: (fn) => void track(fn),
  }

  return {
    api,
    dispose: () => {
      stack.dispose()
      game.registries.removeOwner(owner)
      game.events.emit('plugin:unloaded', { id: owner })
    },
  }
}
