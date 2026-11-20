import JSON5 from 'json5'
import type { ZodType } from 'zod'
import { h } from 'preact'
import { EventBus } from './events/EventBus'
import { Hooks } from './events/Hooks'
import { RegistryHub } from './registry/RegistryHub'
import type { Registry } from './registry/Registry'
import { Entities } from './ecs/Entities'
import { Scheduler } from './loop/Scheduler'
import { GameLoop } from './loop/GameLoop'
import { ConfigService } from './config/ConfigService'
import { ContentLoader } from './content/ContentLoader'
import { Input } from './input/Input'
import { Renderer } from './render/Renderer'
import { CameraController } from './render/CameraController'
import { DebugPanel } from './debug/DebugPanel'
import { DevConsole } from './debug/Console'
import { builtinCommands } from './debug/builtinCommands'
import { PluginManager, type PluginDefinition } from './plugins/PluginManager'
import type { PluginApi } from './plugins/PluginApi'
import { createPluginScope } from './plugins/createPluginApi'
import { ServiceRegistry } from './plugins/ServiceRegistry'
import { EngineConfigSchema, WorldConfigSchema, type EngineConfig, type WorldConfig } from './engineConfig'
import { TextureSchema, type TextureDef } from './render/textures'
import { WorldService } from './world/WorldService'
import type { WorldGenStep } from './world/WorldGen'
import { ModelDefSchema, RigDefSchema, type ModelDef, type RigDef } from './models/defs'
import { ModelLibrary } from './models/ModelLibrary'
import { ItemDefSchema, type ItemDef } from './items/defs'
import { Interactions, type InteractionDef } from './interact/Interactions'
import { UiHost } from './ui/UiHost'
import { IconService } from './ui/IconService'
import { FpsMeter } from './ui/FpsMeter'
import { SessionManager } from './session/SessionManager'
import { GameMenu } from './session/GameMenu'
import { applyUserSettings } from './session/settings'
import { Audio } from './audio/Audio'
import { SoundDefSchema, type SoundDef } from './audio/defs'
import { Particles } from './fx/Particles'
import { ParticleDefSchema, type ParticleDef } from './fx/defs'
import { BlockSchema, PrefabSchema, type BlockDef, type CommandDef, type GameEvents, type GameHooks, type PrefabDef } from './types'
import { createLogger } from './util/log'
import { TimeService, type SavedTime } from './time/TimeService'
import { Clock } from './time/Clock'
import { Blockers } from './world/Blockers'
import { isPlainObject } from './util/objects'

export type GamePlugin = PluginDefinition<PluginApi>

export interface BootOptions {
  plugins: GamePlugin[]
  /** `{ '/content/<pack>/<registry>.json5': rawText }` */
  contentFiles: Record<string, string>
  /** `{ '/config/<id>.json5': rawText }` */
  configFiles: Record<string, string>
  /** `{ '/content/<pack>/textures/<name>.png': url }` and `.vox` models */
  assetFiles?: Record<string, string>
}

const log = createLogger('engine')

/**
 * Composition root: creates the engine services, wires them together and hands each plugin a
 * scoped API. Feature logic lives in the services (sessions, camera, renderer…), not here.
 */
export class Game {
  readonly events = new EventBus<GameEvents>()
  readonly hooks = new Hooks<GameHooks>()
  readonly registries = new RegistryHub()
  readonly config = new ConfigService()
  readonly scheduler = new Scheduler()
  readonly input = new Input()
  readonly ui = new UiHost()
  readonly services = new ServiceRegistry()

  // registries
  readonly blocks: Registry<BlockDef>
  readonly prefabs: Registry<PrefabDef>
  readonly commands: Registry<CommandDef>
  readonly textures: Registry<TextureDef>
  readonly worldgen: Registry<WorldGenStep>
  readonly models: Registry<ModelDef>
  readonly rigs: Registry<RigDef>
  readonly items: Registry<ItemDef>
  readonly interactionDefs: Registry<InteractionDef>
  readonly sounds: Registry<SoundDef>
  readonly particleDefs: Registry<ParticleDef>

  // services
  readonly engineConfig: EngineConfig
  readonly worldConfig: WorldConfig
  readonly entities: Entities
  readonly content: ContentLoader
  readonly world: WorldService
  readonly loop: GameLoop
  readonly modelLibrary: ModelLibrary
  readonly renderer: Renderer
  readonly camera: CameraController
  readonly interactions: Interactions
  readonly icons: IconService
  readonly audio: Audio
  readonly particles: Particles
  readonly sessions: SessionManager
  readonly time: TimeService
  readonly blockers: Blockers
  readonly plugins: PluginManager<PluginApi>
  readonly panel: DebugPanel
  readonly devConsole: DevConsole

  constructor(container: HTMLElement) {
    const reg = <T extends { id: string }>(name: string, schema?: ZodType<T>) => this.registries.create<T>(name, schema, 'engine')
    this.blocks = reg('blocks', BlockSchema as ZodType<BlockDef>)
    this.prefabs = reg('prefabs', PrefabSchema as ZodType<PrefabDef>)
    this.commands = reg<CommandDef>('commands')
    this.textures = reg('textures', TextureSchema as ZodType<TextureDef>)
    this.worldgen = reg<WorldGenStep>('worldgen')
    this.models = reg('models', ModelDefSchema as ZodType<ModelDef>)
    this.rigs = reg('rigs', RigDefSchema as ZodType<RigDef>)
    this.items = reg('items', ItemDefSchema as ZodType<ItemDef>)
    this.interactionDefs = reg<InteractionDef>('interactions')
    this.sounds = reg('sounds', SoundDefSchema as ZodType<SoundDef>)
    this.particleDefs = reg('particles', ParticleDefSchema as ZodType<ParticleDef>)

    this.engineConfig = this.config.define('engine', EngineConfigSchema, 'engine')
    this.worldConfig = this.config.define('world', WorldConfigSchema, 'engine')
    this.entities = new Entities(this.prefabs, this.events, this.hooks)
    this.content = new ContentLoader(this.registries)
    this.world = new WorldService(this.worldConfig, this.blocks, this.worldgen, this.events, this.hooks)
    this.loop = new GameLoop(this.scheduler, { tickRate: this.engineConfig.loop.tickRate, onTickEnd: () => this.input.endTick() })
    this.modelLibrary = new ModelLibrary(this.models, this.rigs)
    this.renderer = new Renderer(container, this.engineConfig, this.entities, this.world.voxels, this.modelLibrary)
    this.input.attach(this.renderer.renderer.domElement)
    this.camera = new CameraController(this.renderer.iso, this.engineConfig.camera, this.input, this.entities, this.world)
    this.interactions = new Interactions(this.interactionDefs, this.items, this.blocks, this.hooks, this.events)
    this.icons = new IconService(this.items, this.blocks, this.modelLibrary, this.renderer.atlas)
    this.audio = new Audio(this.sounds, this.engineConfig.audio)
    this.particles = new Particles(this.renderer.scene, this.particleDefs)
    this.sessions = new SessionManager(this)
    this.time = new TimeService(this.engineConfig.time, this.events)
    this.blockers = new Blockers(this.entities)
    // Engine-level answer: entities with a `blocker` footprint are walked around.
    this.hooks.tap('movement:blocked', (b, { x, y, z }) => b || this.blockers.isBlocked(x, y, z), { priority: -100 })
    // The clock is part of every save; days missed while away are replayed after the session starts.
    this.sessions.saves.register(
      'engine:time',
      { version: 1, save: () => this.time.save(), load: (d) => this.time.load(d as SavedTime) },
      'engine',
    )
    this.renderer.adjustLight = (state, hour) => this.hooks.run('light:adjust', state, { hour })
    this.panel = new DebugPanel(this.config)
    this.devConsole = new DevConsole(this.commands)
    this.plugins = new PluginManager((def) => createPluginScope(this, def))

    this.ui.mount(document.body)
    this.ui.onSound = (id) => this.sounds.has(id) && this.audio.play(id)
    this.ui.onWindow = (id, open) => this.events.emit(open ? 'ui:opened' : 'ui:closed', { id })
    this.camera.onZoom = () => this.panel.refresh()
    for (const c of builtinCommands(this)) this.commands.register({ ...c, id: `debug:${c.name}` }, 'engine')
    this.wireEvents()
    this.installEngineSystems()
    this.applyEngineConfig()
  }

  async boot(opts: BootOptions): Promise<void> {
    this.setConfigFiles(opts.configFiles)
    applyUserSettings(this) // per-device preferences (quality, volume) over the config files
    // Registered after the initial file load so it only reacts to later edits.
    this.config.onChange('world', () => this.world.regenerateSoon())
    this.content.setFiles(opts.contentFiles, opts.assetFiles)
    for (const p of opts.plugins) this.plugins.register(p)

    await this.sessions.start(await this.sessions.latest())
    this.sessions.installSaveOnHide()
    this.installMenu()
    this.loop.start()
    this.events.emit('engine:started', {})
    log.info(`ready: ${this.plugins.loadedIds().length} plugins, ${this.entities.world.entities.length} entities`)
  }

  /** Session switches and hot reloads run one at a time (two quick file saves must not interleave). */
  private queue: Promise<unknown> = Promise.resolve()
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn)
    this.queue = next.catch(() => undefined)
    return next
  }

  /** Hot reload: plugin code changed. */
  reloadPlugins(defs: GamePlugin[]): Promise<string[]> {
    return this.serial(async () => {
      const state = this.sessions.saves.snapshot()
      const ids = await this.plugins.reload(defs, async () => {
        this.reloadContent()
        await this.world.regenerateIfStepsChanged()
      })
      this.sessions.saves.restore(state, ids)
      for (const id of this.config.ids()) {
        if (id !== 'engine' && id !== 'world' && !this.plugins.isLoaded(id)) this.config.undefine(id)
      }
      for (const id of ids) {
        this.panel.rebuild(id)
        if (this.plugins.isLoaded(id)) this.events.emit('plugin:loaded', { id })
      }
      this.panel.sync()
      return ids
    })
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

  private atlasScheduled = false
  /** Coalesce many registry changes (e.g. a content reload) into one atlas rebuild. */
  scheduleAtlas(): void {
    if (this.atlasScheduled) return
    this.atlasScheduled = true
    setTimeout(async () => {
      this.atlasScheduled = false
      const ok = await this.renderer.atlas.rebuild(this.blocks.all(), (id) => this.textures.get(id), this.world.voxels.palette)
      if (!ok) return
      this.icons.clear()
      this.renderer.refreshSurfaces()
      this.renderer.chunks.remeshAll()
      this.renderer.chunks.update()
    })
  }

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
    this.audio.applySettings()
    this.panel.visible = c.debug.showPanel
  }

  private wireEvents(): void {
    this.config.onChange('engine', () => this.applyEngineConfig())
    this.blocks.onChange(() => this.scheduleAtlas())
    this.textures.onChange(() => this.scheduleAtlas())
    this.models.onChange(() => this.scheduleModels())
    this.rigs.onChange(() => this.scheduleModels())
    this.items.onChange(() => this.icons.clear())

    // Interaction effects declared in data: sound + particles at the target.
    this.events.on('interaction:performed', ({ id, ctx }) => {
      const def = this.interactionDefs.get(id)
      if (!def) return
      const at = { x: ctx.x + 0.5, y: ctx.y + 1, z: ctx.z + 0.5 }
      if (def.sound) this.audio.play(def.sound, { at })
      if (def.particles) {
        const color = def.particleColor === 'block' ? this.blocks.get(ctx.block)?.color : undefined
        this.particles.burst(def.particles, at, { color })
      }
    })

    let chunkCount = -1
    this.events.on('world:generated', ({ seed }) => {
      if (this.renderer.tintSeed !== seed) {
        this.renderer.tintSeed = seed
        this.renderer.applyConfig()
      }
      // Same size: old meshes stay visible until replaced. New size: start clean.
      if (this.world.voxels.chunks.length !== chunkCount) this.renderer.chunks.reset()
      chunkCount = this.world.voxels.chunks.length
      if (!this.camera.placed) this.camera.center()
      this.renderer.chunks.update(this.renderer.iso.target.x, this.renderer.iso.target.z)
    })
  }

  private installEngineSystems(): void {
    this.input.define('debug:console', ['Backquote'], 'engine')
    this.input.define('debug:panel', ['F2'], 'engine')
    this.input.on('debug:console', () => this.devConsole.toggle())
    this.input.on('debug:panel', () => this.config.set('engine', 'debug.showPanel', !this.engineConfig.debug.showPanel))

    const add = (id: string, phase: 'input' | 'render', priority: number, run: Parameters<Scheduler['add']>[0]['run']) =>
      this.scheduler.add({ id, phase, priority, run }, 'engine')

    add('engine:snapshot', 'input', -1000, () => this.renderer.snapshot())
    add('engine:gamepad', 'input', -999, () => this.input.pollGamepad())
    add('engine:camera', 'render', 900, (ctx) => !this.devConsole.open && this.camera.update(ctx))
    let panelRefresh = 0
    add('engine:render', 'render', 1000, (ctx) => {
      this.particles.update(ctx.dt)
      this.audio.listener.x = this.renderer.iso.target.x
      this.audio.listener.z = this.renderer.iso.target.z
      this.time.tick(ctx.dt, this.loop.paused)
      if (this.engineConfig.time.drivesLight) this.engineConfig.light.time = this.time.now().hour
      this.renderer.render(ctx)
      this.sessions.tick(ctx.dt, this.loop.paused)
      if (!this.engineConfig.debug.showPanel) return
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

  /** Esc menu (saves, settings) and the optional FPS counter. */
  private installMenu(): void {
    const toggleMenu = () => {
      if (!this.devConsole.open) this.ui.toggle('engine:menu')
    }
    this.ui.onIdleEscape = toggleMenu
    this.input.define('engine:menu', ['Pad9'], 'engine')
    this.input.on('engine:menu', toggleMenu)
    this.ui.window({ id: 'engine:menu', title: 'Меню', component: () => h(GameMenu, { game: this }) }, 'engine')
    this.ui.slot('hud.topRight', () => h(Clock, { game: this }), 'engine', 0)
    this.ui.slot('hud.topRight', () => h(FpsMeter, { game: this }), 'engine', 100)
  }
}
