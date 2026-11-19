import * as THREE from 'three'
import JSON5 from 'json5'
import type { ZodType } from 'zod'
import { EventBus } from './events/EventBus'
import { Hooks } from './events/Hooks'
import { RegistryHub } from './registry/RegistryHub'
import type { Registry, RegistryEntry } from './registry/Registry'
import { Entities } from './ecs/Entities'
import { Scheduler } from './loop/Scheduler'
import { GameLoop } from './loop/GameLoop'
import { ConfigService } from './config/ConfigService'
import { ContentLoader } from './content/ContentLoader'
import { Input } from './input/Input'
import { Renderer } from './render/Renderer'
import { DebugPanel } from './debug/DebugPanel'
import { DevConsole } from './debug/Console'
import { builtinCommands } from './debug/builtinCommands'
import { PluginManager, type PluginDefinition, type PluginScope } from './plugins/PluginManager'
import type { PluginApi } from './plugins/PluginApi'
import { EngineConfigSchema, WorldConfigSchema, type EngineConfig, type WorldConfig } from './engineConfig'
import { TextureSchema, type PatternFn, type TextureDef } from './render/textures'
import { WorldService } from './world/WorldService'
import type { WorldGenStep } from './world/WorldGen'
import { AIR } from './world/BlockPalette'
import { ModelDefSchema, RigDefSchema, type ModelDef, type RigDef } from './models/defs'
import { ModelLibrary } from './models/ModelLibrary'
import { ItemDefSchema, type ItemDef } from './items/defs'
import { Interactions, type InteractionContext, type InteractionDef } from './interact/Interactions'
import { UiHost } from './ui/UiHost'
import { IconService } from './ui/IconService'
import { SaveService, type SaverDef } from './save/SaveService'
import { IndexedDbStorage, type SaveStorage } from './save/storage'
import { decodeWorld, restoreEntities, saveFromJson, saveToJson } from './save/codec'
import type { SaveData, SaveMeta } from './save/format'
import { GAME_VERSION } from './version'
import { SaveMenu } from './save/SaveMenu'
import { h } from 'preact'
import { BlockSchema, PrefabSchema, type BlockDef, type CommandDef, type Entity, type GameEvents, type GameHooks, type PrefabDef } from './types'
import { DisposableStack } from './util/disposables'
import { createLogger } from './util/log'
import { isPlainObject } from './util/objects'

export type GamePlugin = PluginDefinition<PluginApi>

export interface BootOptions {
  plugins: GamePlugin[]
  /** `{ '/content/<pack>/<registry>.json5': rawText }` */
  contentFiles: Record<string, string>
  /** `{ '/config/<id>.json5': rawText }` */
  configFiles: Record<string, string>
  /** `{ '/content/<pack>/textures/<name>.png': url }` */
  assetFiles?: Record<string, string>
}

const log = createLogger('engine')

/** Composition root: creates the services and hands each plugin a scoped API. */
export class Game {
  readonly events = new EventBus<GameEvents>()
  readonly hooks = new Hooks<GameHooks>()
  readonly registries = new RegistryHub()
  readonly blocks: Registry<BlockDef>
  readonly prefabs: Registry<PrefabDef>
  readonly commands: Registry<CommandDef>
  readonly textures: Registry<TextureDef>
  readonly worldgen: Registry<WorldGenStep>
  readonly models: Registry<ModelDef>
  readonly rigs: Registry<RigDef>
  readonly modelLibrary: ModelLibrary
  readonly items: Registry<ItemDef>
  readonly interactionDefs: Registry<InteractionDef>
  readonly interactions: Interactions
  readonly ui = new UiHost()
  readonly icons: IconService
  readonly saves = new SaveService()
  storage: SaveStorage = new IndexedDbStorage()
  /** The island being played: which slot it saves to, and since when. */
  session = { loaded: false, slot: 'slot1', name: 'Мой остров', createdAt: Date.now(), playTime: 0 }
  /** True while a session is being (re)built — saving is skipped meanwhile. */
  private switching = false
  /** Plugin-provided services (see `api.services`). */
  private services = new Map<string, { impl: unknown; owner: string }>()
  readonly worldConfig: WorldConfig
  readonly world: WorldService
  readonly entities: Entities
  readonly scheduler = new Scheduler()
  readonly loop: GameLoop
  readonly config = new ConfigService()
  readonly engineConfig: EngineConfig
  readonly content: ContentLoader
  readonly input = new Input()
  readonly renderer: Renderer
  readonly plugins: PluginManager<PluginApi>
  readonly panel: DebugPanel
  readonly devConsole: DevConsole

  constructor(container: HTMLElement) {
    this.blocks = this.registries.create('blocks', BlockSchema as ZodType<BlockDef>, 'engine')
    this.prefabs = this.registries.create('prefabs', PrefabSchema as ZodType<PrefabDef>, 'engine')
    this.commands = this.registries.create<CommandDef>('commands', undefined, 'engine')
    this.textures = this.registries.create('textures', TextureSchema as ZodType<TextureDef>, 'engine')
    this.worldgen = this.registries.create<WorldGenStep>('worldgen', undefined, 'engine')
    this.models = this.registries.create('models', ModelDefSchema as ZodType<ModelDef>, 'engine')
    this.rigs = this.registries.create('rigs', RigDefSchema as ZodType<RigDef>, 'engine')
    this.modelLibrary = new ModelLibrary(this.models, this.rigs)
    this.items = this.registries.create('items', ItemDefSchema as ZodType<ItemDef>, 'engine')
    this.interactionDefs = this.registries.create<InteractionDef>('interactions', undefined, 'engine')
    this.interactions = new Interactions(this.interactionDefs, this.items, this.blocks, this.hooks, this.events)
    this.entities = new Entities(this.prefabs, this.events, this.hooks)
    this.content = new ContentLoader(this.registries)
    this.engineConfig = this.config.define('engine', EngineConfigSchema, 'engine')
    this.worldConfig = this.config.define('world', WorldConfigSchema, 'engine')
    this.world = new WorldService(this.worldConfig, this.blocks, this.worldgen, this.events, this.hooks)
    this.loop = new GameLoop(this.scheduler, {
      tickRate: this.engineConfig.loop.tickRate,
      onTickEnd: () => this.input.endTick(),
    })
    this.renderer = new Renderer(container, this.engineConfig, this.entities, this.world.voxels, this.modelLibrary)
    this.input.attach(this.renderer.renderer.domElement)
    this.icons = new IconService(this.items, this.blocks, this.modelLibrary, this.renderer.atlas)
    this.ui.mount(document.body)
    this.items.onChange(() => this.icons.clear())
    this.panel = new DebugPanel(this.config)
    this.devConsole = new DevConsole(this.commands)
    this.plugins = new PluginManager((def) => this.createScope(def))

    for (const c of builtinCommands(this)) this.commands.register({ ...c, id: `debug:${c.name}` }, 'engine')
    this.config.onChange('engine', () => this.applyEngineConfig())
    this.blocks.onChange(() => this.scheduleAtlas())
    this.textures.onChange(() => this.scheduleAtlas())
    this.models.onChange(() => this.scheduleModels())
    this.rigs.onChange(() => this.scheduleModels())
    let chunkCount = -1
    this.events.on('world:generated', ({ seed }) => {
      if (this.renderer.tintSeed !== seed) {
        this.renderer.tintSeed = seed
        this.renderer.applyConfig()
      }
      // Same size: old meshes stay visible until replaced. New size: start clean.
      if (this.world.voxels.chunks.length !== chunkCount) this.renderer.chunks.reset()
      chunkCount = this.world.voxels.chunks.length
      if (!this.cameraPlaced) this.centerCamera()
      this.renderer.chunks.update(this.renderer.iso.target.x, this.renderer.iso.target.z)
    })
    this.installEngineSystems()
    this.applyEngineConfig()
  }

  async boot(opts: BootOptions): Promise<void> {
    this.setConfigFiles(opts.configFiles)
    // Registered after the initial file load so it only reacts to later edits.
    this.config.onChange('world', () => this.world.regenerateSoon())
    this.content.setFiles(opts.contentFiles, opts.assetFiles)
    for (const p of opts.plugins) this.plugins.register(p)

    let save: SaveData | null = null
    if (this.engineConfig.save.autoLoad) {
      try {
        const latest = (await this.storage.list())[0]
        if (latest) save = await this.storage.read(latest.slot)
      } catch (e) {
        log.error('could not read saves:', e)
      }
    }
    await this.startSession(save)
    this.installAutosave()
    this.loop.start()
    this.events.emit('engine:started', {})
    log.info(`ready: ${this.plugins.loadedIds().length} plugins, ${this.entities.world.entities.length} entities`)
  }

  /**
   * (Re)build the whole game: unload plugins, clear entities, then load plugins again on top of
   * either a fresh island or a save (world voxels → entities → plugin data → plugin start).
   */
  async startSession(save: SaveData | null, opts: { seed?: number; slot?: string; name?: string } = {}): Promise<void> {
    this.switching = true
    try {
      if (save) save = this.saves.upgrade(save)
      this.plugins.unloadAll()
      this.entities.clear()
      this.followEntity = null
      this.saves.reset()
      this.ui.close()
      if (save) {
        this.session = { loaded: true, slot: save.meta.slot, name: save.meta.name, createdAt: save.meta.createdAt, playTime: save.meta.playTime }
        Object.assign(this.worldConfig, save.world.config) // silently: no regenerate-on-change
      } else {
        this.session = { loaded: false, slot: opts.slot ?? this.session.slot, name: opts.name ?? 'Мой остров', createdAt: Date.now(), playTime: 0 }
        if (opts.seed !== undefined) this.worldConfig.seed = opts.seed
      }
      this.panel.refresh()
      await this.plugins.loadAll(async () => {
        this.reloadContent()
        await this.world.regenerate()
        if (save) {
          decodeWorld(save.world, this.world.voxels)
          restoreEntities(save.entities, this.entities)
          this.saves.loadPlugins(save.plugins)
          this.renderer.chunks.update()
          this.events.emit('save:loaded', { slot: save.meta.slot })
        }
      })
      for (const id of this.plugins.loadedIds()) this.events.emit('plugin:loaded', { id })
      this.panel.sync()
      this.cameraPlaced = false
      if (!this.followEntity) this.centerCamera()
      this.events.emit('session:started', { loaded: !!save, slot: this.session.slot })
      log.info(save ? `loaded "${save.meta.name}" (${save.meta.slot})` : `new island, seed ${this.worldConfig.seed}`)
    } finally {
      this.switching = false
    }
  }

  /** Save the current island into a slot (default: the session's slot). */
  async saveGame(slot = this.session.slot): Promise<SaveMeta | null> {
    if (this.switching) return null
    const meta: SaveMeta = {
      slot,
      name: this.session.name,
      createdAt: this.session.createdAt,
      savedAt: Date.now(),
      playTime: Math.round(this.session.playTime),
      seed: this.worldConfig.seed,
      gameVersion: GAME_VERSION,
    }
    const data = this.saves.collect(meta, this.world.voxels, this.worldConfig, this.entities)
    await this.storage.write(data)
    this.session.slot = slot
    this.events.emit('save:saved', { slot })
    return meta
  }

  async loadGame(slot: string): Promise<void> {
    const data = await this.storage.read(slot)
    if (!data) throw new Error(`slot "${slot}" is empty`)
    await this.startSession(data)
  }

  async newGame(opts: { seed?: number; slot?: string; name?: string } = {}): Promise<void> {
    await this.startSession(null, { seed: opts.seed ?? Math.floor(Math.random() * 2 ** 31), slot: opts.slot, name: opts.name })
    await this.saveGame()
  }

  async exportSave(slot: string): Promise<string> {
    const data = await this.storage.read(slot)
    if (!data) throw new Error(`slot "${slot}" is empty`)
    return saveToJson(data)
  }

  async importSave(text: string, slot: string): Promise<void> {
    const data = this.saves.upgrade(saveFromJson<SaveData>(text))
    data.meta = { ...data.meta, slot }
    await this.storage.write(data)
  }

  slotIds(): string[] {
    return Array.from({ length: this.engineConfig.save.slots }, (_, i) => `slot${i + 1}`)
  }

  private installAutosave(): void {
    let sinceSave = 0
    this.scheduler.add(
      {
        id: 'engine:autosave',
        phase: 'render',
        priority: 1100,
        run: ({ dt }) => {
          if (this.switching) return
          if (!this.loop.paused) this.session.playTime += dt
          const every = this.engineConfig.save.autosaveMinutes * 60
          if (every <= 0) return
          sinceSave += dt
          if (sinceSave >= every) {
            sinceSave = 0
            void this.saveGame().catch((e) => log.error('autosave failed:', e))
          }
        },
      },
      'engine',
    )
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.engineConfig.save.autosaveMinutes > 0) {
        void this.saveGame().catch((e) => log.error('save on hide failed:', e))
      }
    })
    // Esc with no window open (handled by the UI host) or gamepad Start → menu (saves, new island).
    const openMenu = () => {
      if (!this.devConsole.open) this.ui.toggle('engine:menu')
    }
    this.ui.onIdleEscape = openMenu
    this.input.define('engine:menu', ['Pad9'], 'engine')
    this.input.on('engine:menu', openMenu)
    this.ui.window({ id: 'engine:menu', title: 'Меню', component: () => h(SaveMenu, { game: this }) }, 'engine')
  }

  /** Hot reload: plugin code changed. */
  async reloadPlugins(defs: GamePlugin[]): Promise<string[]> {
    const ids = await this.plugins.reload(defs, async () => {
      this.reloadContent()
      await this.world.regenerateIfStepsChanged()
    })
    for (const id of this.config.ids()) {
      if (id !== 'engine' && !this.plugins.isLoaded(id)) this.config.undefine(id)
    }
    for (const id of ids) {
      this.panel.rebuild(id)
      if (this.plugins.isLoaded(id)) this.events.emit('plugin:loaded', { id })
    }
    this.panel.sync()
    return ids
  }

  /** Hot reload: content or config files changed. */
  reloadData(contentFiles: Record<string, string>, configFiles: Record<string, string>, assetFiles?: Record<string, string>): void {
    this.content.setFiles(contentFiles, assetFiles)
    this.reloadContent()
    this.setConfigFiles(configFiles)
  }

  reloadContent(): string[] {
    const packs = this.content.reloadAll()
    this.events.emit('content:loaded', { packs })
    return packs
  }

  /** Interaction context for the column (x, z): its top block and the entities standing there. */
  cellContext(actor: Entity, x: number, z: number): InteractionContext {
    const v = this.world.voxels
    let y = -1
    for (let cy = v.height - 1; cy >= 0; cy--) {
      if (v.get(x, cy, z)) {
        y = cy
        break
      }
    }
    const entities: Entity[] = []
    for (const e of this.entities.world.with('transform')) {
      if (e === actor) continue
      const t = e.transform
      if (Math.floor(t.x) === x && Math.floor(t.z) === z && Math.abs(t.y - (y + 1)) < 2) entities.push(e)
    }
    return {
      actor,
      held: this.hooks.run('interaction:held', null, { actor }),
      x,
      y,
      z,
      block: y >= 0 ? v.getId(x, y, z) : AIR,
      entities,
    }
  }

  /** Point the camera at the middle of the island. */
  centerCamera(): void {
    const v = this.world.voxels
    const x = v.sizeX / 2
    const z = v.sizeZ / 2
    this.renderer.iso.target.set(x, this.world.surfaceY(x, z), z)
    this.cameraPlaced = true
  }

  private cameraPlaced = false
  /** Entity the camera follows (set by `api.render.follow`). */
  followEntity: Entity | null = null
  private modelsScheduled = false

  /** Models or rigs changed (e.g. content hot reload): rebuild every entity view once. */
  private scheduleModels(): void {
    if (this.modelsScheduled) return
    this.modelsScheduled = true
    setTimeout(() => {
      this.modelsScheduled = false
      this.modelLibrary.clear()
      this.icons.clear()
      this.renderer.entityRenderer.rebuildAll()
    })
  }

  private atlasScheduled = false

  /** Coalesce many registry changes (e.g. a content reload) into one atlas rebuild. */
  private scheduleAtlas(): void {
    if (this.atlasScheduled) return
    this.atlasScheduled = true
    setTimeout(async () => {
      this.atlasScheduled = false
      const ok = await this.renderer.atlas.rebuild(this.blocks.all(), (id) => this.textures.get(id), this.world.voxels.palette)
      if (ok) {
        this.icons.clear()
        this.renderer.refreshSurfaces()
        this.renderer.chunks.remeshAll()
        this.renderer.chunks.update()
      }
    })
  }

  private setConfigFiles(files: Record<string, string>): void {
    for (const [path, raw] of Object.entries(files)) {
      const id = /config\/([a-z0-9_-]+)\.json5$/.exec(path)?.[1]
      if (!id) continue
      try {
        const data: unknown = JSON5.parse(raw)
        this.config.setFileData(id, isPlainObject(data) ? data : {})
      } catch (e) {
        log.error(`${path}:`, e)
      }
    }
  }

  private applyEngineConfig(): void {
    const c = this.engineConfig
    this.loop.opts.tickRate = c.loop.tickRate
    this.loop.timeScale = c.loop.timeScale
    this.renderer.applyConfig()
    this.panel.visible = c.debug.showPanel
  }

  private installEngineSystems(): void {
    const iso = this.renderer.iso
    const actions = {
      rotL: 'camera:rotateLeft',
      rotR: 'camera:rotateRight',
      up: 'camera:panUp',
      down: 'camera:panDown',
      left: 'camera:panLeft',
      right: 'camera:panRight',
      console: 'debug:console',
      panel: 'debug:panel',
    }
    this.input.define(actions.rotL, ['KeyQ'], 'engine')
    this.input.define(actions.rotR, ['KeyE'], 'engine')
    this.input.define(actions.up, ['KeyW', 'ArrowUp'], 'engine')
    this.input.define(actions.down, ['KeyS', 'ArrowDown'], 'engine')
    this.input.define(actions.left, ['KeyA', 'ArrowLeft'], 'engine')
    this.input.define(actions.right, ['KeyD', 'ArrowRight'], 'engine')
    this.input.define(actions.console, ['Backquote'], 'engine')
    this.input.define(actions.panel, ['F2'], 'engine')
    this.input.on(actions.rotL, () => iso.rotate(-1))
    this.input.on(actions.rotR, () => iso.rotate(1))
    this.input.on(actions.console, () => this.devConsole.toggle())
    this.input.on(actions.panel, () => this.config.set('engine', 'debug.showPanel', !this.engineConfig.debug.showPanel))

    const add = (id: string, phase: 'input' | 'render', priority: number, run: Parameters<Scheduler['add']>[0]['run']) =>
      this.scheduler.add({ id, phase, priority, run }, 'engine')

    add('engine:snapshot', 'input', -1000, () => this.renderer.snapshot())
    add('engine:gamepad', 'input', -999, () => this.input.pollGamepad())
    // Free camera unless something is followed (api.render.follow).
    const dir = new THREE.Vector3()
    const followVel = new THREE.Vector3()
    const followLast = new THREE.Vector3()
    const followGoal = new THREE.Vector3()
    add('engine:cameraControls', 'render', 900, (ctx) => {
      if (this.devConsole.open) return
      // Following an entity (the player): smooth chase, no free panning.
      const fe = this.followEntity
      if (fe && this.entities.world.has(fe) && fe.view) {
        const cam = this.engineConfig.camera
        // Smoothed velocity of the followed view → look ahead in the direction of travel.
        const pos = fe.view.position
        if (ctx.dt > 0) {
          const kv = 1 - Math.exp(-6 * ctx.dt)
          followVel.x += ((pos.x - followLast.x) / ctx.dt - followVel.x) * kv
          followVel.z += ((pos.z - followLast.z) / ctx.dt - followVel.z) * kv
        }
        followLast.copy(pos)
        if (Math.hypot(followVel.x, followVel.z) > 30) followVel.set(0, 0, 0) // teleport, not travel
        followGoal.set(pos.x + followVel.x * cam.lookAhead, pos.y + cam.focusHeight, pos.z + followVel.z * cam.lookAhead)
        const k = 1 - Math.exp(-cam.followSmoothing * ctx.dt)
        iso.target.lerp(followGoal, k)
        const wheel = this.input.consumeWheel()
        if (wheel) {
          iso.zoomBy(wheel)
          this.panel.refresh()
        }
        return
      }
      const i = this.input
      const r = Number(i.isDown(actions.right)) - Number(i.isDown(actions.left))
      const u = Number(i.isDown(actions.up)) - Number(i.isDown(actions.down))
      if (r || u) {
        iso.screenToWorldDir(r, u, dir).normalize()
        iso.target.addScaledVector(dir, (this.engineConfig.camera.panSpeed / this.engineConfig.camera.zoom) * ctx.dt)
        const v = this.world.voxels
        iso.target.x = Math.max(0, Math.min(v.sizeX, iso.target.x))
        iso.target.z = Math.max(0, Math.min(v.sizeZ, iso.target.z))
      }
      // Ease the focus height towards the ground under it.
      const ground = this.world.surfaceY(iso.target.x, iso.target.z)
      iso.target.y += (ground - iso.target.y) * Math.min(1, ctx.dt * 4)
      const wheel = i.consumeWheel()
      if (wheel) {
        iso.zoomBy(wheel)
        this.panel.refresh()
      }
    })
    let panelRefresh = 0
    add('engine:render', 'render', 1000, (ctx) => {
      this.renderer.render(ctx)
      // Values that change by themselves (time of day) — keep the panel in sync twice a second.
      if (this.engineConfig.light.timeSpeed > 0 && (panelRefresh += ctx.dt) > 0.5) {
        panelRefresh = 0
        this.panel.refresh()
      }
      this.panel.frame()
      this.panel.stats.tick = this.loop.tick
      this.panel.stats.entities = this.entities.world.entities.length
      this.panel.stats.systems = this.scheduler.list().length
    })
  }

  private createScope(def: GamePlugin): PluginScope<PluginApi> {
    const owner = def.id
    const stack = new DisposableStack()
    const track = <T extends () => void>(fn: T): T => (stack.add(fn), fn)
    const ns = (name: string) => (name.includes(':') ? name : `${owner}:${name}`)
    const game = this

    const api: PluginApi = {
      id: owner,
      log: createLogger(owner),
      engineConfig: this.engineConfig,

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
        define: (schema) => {
          const values = game.config.define(owner, schema, owner)
          return values
        },
        onChange: (fn) => track(game.config.onChange(owner, fn)),
      },
      input: {
        stick: game.input.stick,
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
        register: (cmd) => {
          const id = cmd.id ?? `${owner}:${cmd.name}`
          game.commands.register({ ...cmd, id }, owner)
        },
      },
      render: {
        three: THREE,
        scene: game.renderer.scene,
        camera: game.renderer.iso,
        stylize: (material, opts) => game.renderer.stylize(material, opts),
        voxelModel: (id, opts) => game.modelLibrary.createVoxel(id, opts),
        follow: (entity) => {
          game.followEntity = entity
          if (entity) game.cameraPlaced = true
          track(() => {
            if (game.followEntity === entity) game.followEntity = null
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
            obj.traverse((o) => {
              const m = o as THREE.Mesh
              m.geometry?.dispose?.()
            })
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
      ui: {
        slot: (slot, component, opts) => void track(game.ui.slot(slot, component, owner, opts?.order)),
        window: (def) => void track(game.ui.window(def, owner)),
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
        label: (def, ctx) => game.interactions.label(def, ctx),
        held: (actor) => game.hooks.run('interaction:held', null, { actor }),
        at: (actor, x, z) => game.cellContext(actor, x, z),
      },
      save: {
        register: (def: SaverDef, name?: string) => void track(game.saves.register(name ? `${owner}:${name}` : owner, def, owner)),
        get loaded() {
          return game.session.loaded
        },
        saveNow: () => game.saveGame().then(() => undefined),
      },
      services: {
        provide: (name, impl) => {
          const existing = game.services.get(name)
          if (existing && existing.owner !== owner) throw new Error(`Service "${name}" is already provided by "${existing.owner}"`)
          game.services.set(name, { impl, owner })
          track(() => {
            if (game.services.get(name)?.owner === owner) game.services.delete(name)
          })
        },
        get: (name) => {
          const s = game.services.get(name)
          if (!s) throw new Error(`Service "${name}" is not available (is its plugin loaded and in dependsOn?)`)
          return s.impl as never
        },
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
}
