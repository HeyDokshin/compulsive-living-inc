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
import { MaterialSchema, type MaterialDef } from './materials/schema'
import { MaterialService } from './materials/MaterialService'
import { AtlasDetail } from './render/AtlasDetail'
import { FabricTextures } from './render/fabric'
import { TerrainDetail } from './render/terrainDetail'
import { WorldService } from './world/WorldService'
import type { WorldGenStep } from './world/WorldGen'
import { ModelDefSchema, RigDefSchema, type ModelDef, type RigDef } from './models/defs'
import { ModelLibrary } from './models/ModelLibrary'
import { ItemDefSchema, type ItemDef } from './items/defs'
import { Interactions, type InteractionDef } from './interact/Interactions'
import { UiHost } from './ui/UiHost'
import { IconService } from './ui/IconService'
import { FpsMeter } from './ui/FpsMeter'
import { ModManager } from './mods/ModManager'
import { Options, type OptionDef } from './session/options'
import { Title } from './session/Title'
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
import { Interiors, type Place, type SavedInteriors } from './world/Interiors'
import { isPlainObject, type PlainObject } from './util/objects'

export type GamePlugin = PluginDefinition<PluginApi>

export interface BootOptions {
  plugins: GamePlugin[]
  /** `{ '/content/<pack>/<registry>.json5': rawText }` */
  contentFiles: Record<string, string>
  /** `{ '/config/<id>.json5': rawText }` */
  configFiles: Record<string, string>
  /** `{ '/content/<pack>/textures/<name>.png': url }` and `.vox` models */
  assetFiles: Record<string, string>
  /** `{ '/mods/<id>/<file>': rawText }` and binary files as URLs */
  modFiles: Record<string, string>
  modAssets: Record<string, string>
  /** Everything `@sdk` exports — mods import it. */
  sdk: object
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
  /** Settings plugins added, as the player chose them. */
  readonly options = new Options()

  // registries
  readonly blocks: Registry<BlockDef>
  readonly prefabs: Registry<PrefabDef>
  readonly commands: Registry<CommandDef>
  readonly optionDefs: Registry<OptionDef>
  readonly textures: Registry<TextureDef>
  readonly materialDefs: Registry<MaterialDef>
  /** Procedural materials rendered at any size (off the main thread). */
  readonly materials: MaterialService
  /** Close-up detail of the rounded island (from materials). */
  private terrainDetail!: TerrainDetail
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
  readonly title: Title
  readonly time: TimeService
  readonly blockers: Blockers
  readonly interiors: Interiors
  readonly plugins: PluginManager<PluginApi>
  readonly mods: ModManager
  readonly panel: DebugPanel
  readonly devConsole: DevConsole

  /** Ids mods can't take. */
  private builtIn = new Set<string>(['engine', 'world', 'core', 'mods'])
  /** What `@sdk` is for mods (handed over at boot: the SDK sits above the engine). */
  private sdk: Record<string, unknown> = {}
  private files: Pick<BootOptions, 'contentFiles' | 'configFiles' | 'assetFiles'> = { contentFiles: {}, configFiles: {}, assetFiles: {} }
  /** Plugins that came from mods. */
  private modPlugins: string[] = []

  constructor(container: HTMLElement) {
    const reg = <T extends { id: string }>(name: string, schema?: ZodType<T>) => this.registries.create<T>(name, schema, 'engine')
    this.blocks = reg('blocks', BlockSchema as ZodType<BlockDef>)
    this.prefabs = reg('prefabs', PrefabSchema as ZodType<PrefabDef>)
    this.commands = reg<CommandDef>('commands')
    this.optionDefs = reg<OptionDef>('options')
    this.textures = reg('textures', TextureSchema as ZodType<TextureDef>)
    this.materialDefs = reg('materials', MaterialSchema as ZodType<MaterialDef>)
    this.materials = new MaterialService(this.materialDefs)
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
    this.modelLibrary.fabrics = new FabricTextures(this.materials)
    this.terrainDetail = new TerrainDetail(this.materials)
    this.renderer.detail = new AtlasDetail(this.renderer.atlas, this.materials, (id) => this.textures.get(id))
    this.camera = new CameraController(this.renderer.iso, this.engineConfig.camera, this.input, this.entities, this.world)
    this.interactions = new Interactions(this.interactionDefs, this.items, this.blocks, this.hooks, this.events)
    this.icons = new IconService(this.items, this.blocks, this.modelLibrary, this.renderer.atlas)
    this.audio = new Audio(this.sounds, this.engineConfig.audio)
    this.particles = new Particles(this.renderer.scene, this.particleDefs)
    this.mods = new ModManager({
      isBuiltIn: (id) => this.builtIn.has(id),
      sdk: this.sdk,
      maxBytes: () => this.engineConfig.mods.maxMegabytes * 1024 * 1024,
    })
    this.content.onError = (pack, message) => this.mods.report(pack, message)
    this.sessions = new SessionManager(this)
    this.title = new Title(this)
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
    this.interiors = this.createInteriors()
    this.camera.insideRoom = () => this.interiors.current !== null
    this.panel = new DebugPanel(this.config)
    this.devConsole = new DevConsole(this.commands)
    this.plugins = new PluginManager((def) => createPluginScope(this, def))

    this.ui.mount(document.body)
    this.ui.onSound = (id) => this.sounds.has(id) && this.audio.play(id)
    this.input.capture = (code) => this.ui.navigate(code)
    this.ui.onWindow = (id, open) => this.events.emit(open ? 'ui:opened' : 'ui:closed', { id })
    this.camera.onZoom = () => this.panel.refresh()
    for (const c of builtinCommands(this)) this.commands.register({ ...c, id: `debug:${c.name}` }, 'engine')
    this.wireEvents()
    this.installEngineSystems()
    this.applyEngineConfig()
  }

  /** Rooms in reserved world corners: what is drawn, light inside, and the saved state. */
  private createInteriors(): Interiors {
    const interiors = new Interiors(() => ({ x: this.worldConfig.chunksX, z: this.worldConfig.chunksZ }))
    interiors.onChange = (id) => {
      this.events.emit('interior:changed', { id })
    }
    this.renderer.chunks.isVisible = (cx, cz) => interiors.chunkVisible(cx, cz)
    this.renderer.entityRenderer.visibleAt = (x, z) => interiors.pointVisible(x, z)
    this.hooks.tap(
      'light:adjust',
      (st) => {
        if (!interiors.current) return st
        const c = this.engineConfig.interior
        st.background.set(c.background)
        st.ambient = Math.max(st.ambient, c.minAmbient)
        st.sunIntensity *= c.sun
        return st
      },
      { priority: 1000 }, // after weather and other tweaks: inside, the sky doesn't matter
    )
    this.sessions.saves.register(
      'engine:interiors',
      { version: 1, save: () => interiors.save(), load: (d) => interiors.load(d as SavedInteriors) },
      'engine',
    )
    return interiors
  }

  /** Give a room's corner back to the sea: every column becomes a copy of the column just outside it. */
  restoreSea(box: { x: number; z: number; w: number; d: number }): void {
    const v = this.world.voxels
    const refX = box.x + box.w < v.sizeX ? box.x + box.w : box.x - 1
    for (let z = box.z; z < box.z + box.d; z++)
      for (let x = box.x; x < box.x + box.w; x++)
        for (let y = 0; y < v.height; y++) {
          const id = this.world.getBlock(refX, y, z)
          if (this.world.getBlock(x, y, z) !== id) this.world.setBlock(x, y, z, id)
        }
  }

  /** Move an actor into a room (or back out): teleport, snap the camera, no interpolation sweep. */
  moveActor(actor: { transform?: Place }, to: Place): void {
    if (!actor.transform) return
    Object.assign(actor.transform, to)
    this.renderer.entityRenderer.snapshot()
    this.camera.snap()
    // no hard cut: the new place fades in
    this.ui.flash()
  }

  async boot(opts: BootOptions): Promise<void> {
    this.files = { contentFiles: opts.contentFiles, configFiles: opts.configFiles, assetFiles: opts.assetFiles }
    Object.assign(this.sdk, opts.sdk)
    for (const p of opts.plugins) this.builtIn.add(p.id)
    for (const path of Object.keys(opts.contentFiles)) {
      const pack = /content\/([a-z0-9_-]+)\//.exec(path)?.[1]
      if (pack) this.builtIn.add(pack)
    }
    for (const p of opts.plugins) this.plugins.register(p)
    await this.mods.init(opts.modFiles, opts.modAssets)
    this.mods.guard(true)
    await this.loadMods()
    this.setConfigFiles()
    applyUserSettings(this) // per-device preferences (quality, volume) over the config files
    // Registered after the initial file load so it only reacts to later edits.
    this.config.onChange('world', () => this.world.regenerateSoon())
    const latest = await this.sessions.latest()
    const title = this.engineConfig.title.enabled
    if (title) this.title.show() // before the island: plugins shouldn't open windows over it
    await this.sessions.start(latest, { demo: title })
    this.sessions.installSaveOnHide()
    this.installMenu()
    this.loop.start()
    this.reportModPlugins()
    this.mods.guard(false)
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

  /**
   * Reload plugins and everything that depends on them, keeping their state. Hot reload of code also
   * regenerates the island when generation steps changed; `keepWorld` never touches it.
   */
  reloadPlugins(defs: GamePlugin[], opts: { keepWorld?: boolean } = {}): Promise<string[]> {
    return this.serial(async () => {
      const state = this.sessions.saves.snapshot()
      this.sessions.switching = true // a save now would miss the plugins that are away
      let ids: string[]
      try {
        ids = await this.plugins.reload(defs, async () => {
          this.reloadContent()
          if (opts.keepWorld) this.world.acceptSteps()
          else await this.world.regenerateIfStepsChanged()
        })
        this.sessions.saves.restore(state, ids)
      } finally {
        this.sessions.switching = false
      }
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
  reloadData(contentFiles: Record<string, string>, configFiles: Record<string, string>, assetFiles: Record<string, string>): void {
    this.files = { contentFiles, configFiles, assetFiles }
    this.setContentFiles()
    this.reloadContent()
    this.setConfigFiles()
  }

  /** Content of the game and of the active mods. */
  private setContentFiles(): void {
    this.content.setFiles({ ...this.files.contentFiles, ...this.mods.contentFiles() }, { ...this.files.assetFiles, ...this.mods.assetFiles() })
  }

  /** (Re)load the code of the enabled mods and take their files into the content. */
  private async loadMods(): Promise<void> {
    this.plugins.unload(this.modPlugins)
    for (const id of this.modPlugins) this.plugins.unregister(id)
    const defs = await this.mods.activate()
    for (const def of defs) this.plugins.register(def)
    this.modPlugins = defs.map((d) => d.id)
    this.setContentFiles()
  }

  /** Tell the mods which of their plugins did not start. */
  private reportModPlugins(): void {
    for (const id of this.modPlugins) {
      const s = this.plugins.states.get(id)
      if (s && s.state !== 'loaded') this.mods.reportPlugin(id, s.reason ?? s.state)
    }
  }

  /** Mods were switched, added or removed: start the latest island again with them (title screen only). */
  async applyMods(): Promise<void> {
    this.mods.safeMode = false
    this.mods.guard(true)
    const touched = this.mods.configIds()
    await this.serial(async () => {
      this.plugins.unloadAll()
      await this.loadMods()
    })
    this.setConfigFiles([...new Set([...touched, ...this.mods.configIds()])])
    this.world.cancelSoon() // the island is about to be loaded: a mod's world settings are for new ones
    applyUserSettings(this)
    await this.sessions.start(await this.sessions.latest(), { demo: true })
    this.reportModPlugins()
    this.mods.guard(false)
  }

  /** Hot reload: files of mods/ changed. */
  async reloadModFolder(text: Record<string, string>, assets: Record<string, string>): Promise<void> {
    this.mods.setFolder(text, assets)
    const defs = await this.mods.activate()
    const gone = this.modPlugins.filter((id) => !defs.some((d) => d.id === id))
    this.plugins.unload(gone)
    for (const id of gone) this.plugins.unregister(id)
    this.modPlugins = defs.map((d) => d.id)
    this.setContentFiles()
    await this.reloadPlugins(defs) // keeps what the old code saved
    this.reportModPlugins()
  }

  /**
   * A file of an installed mod was edited in the game: take it over now. Registries of plugins need
   * their plugin restarted (it makes items out of its entries); engine ones just reload the pack.
   */
  async editMod(id: string, path: string, text: string | null): Promise<void> {
    await this.mods.write(id, path, text)
    this.setContentFiles()
    const registry = /^content\/([a-z0-9_]+)\.([a-z0-9_]+)\.json5$/.exec(path)
    const owner = registry && this.registries.has(`${registry[1]}:${registry[2]}`) ? this.plugins.get(this.registries.get(`${registry[1]}:${registry[2]}`).owner) : undefined
    if (owner) return void (await this.reloadPlugins([owner], { keepWorld: true }))
    this.content.reloadPack(id)
    this.events.emit('content:loaded', { packs: [id] })
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
      this.renderer.detail?.invalidate()
      void this.terrainDetail.build(this.renderer.atlas.detailMaterials)
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

  /** `config/<id>.json5` of the game with the active mods' values over them (all, or just some ids). */
  private setConfigFiles(only?: string[]): void {
    const base = new Map<string, PlainObject>()
    for (const [path, raw] of Object.entries(this.files.configFiles)) {
      const id = /config\/([a-z0-9_-]+)\.json5$/.exec(path)?.[1]
      if (!id) continue
      try {
        const data: unknown = JSON5.parse(raw)
        base.set(id, isPlainObject(data) ? data : {})
      } catch (e) {
        log.error(`${path}:`, e)
      }
    }
    for (const id of only ?? new Set([...base.keys(), ...this.mods.configIds()])) this.config.setFileData(id, this.mods.mergeConfig(id, base.get(id) ?? {}))
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
    this.materialDefs.onChange(() => {
      this.scheduleAtlas()
      this.modelLibrary.fabrics?.invalidate()
    })
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
    this.input.define('engine:menu', ['Pad9'], 'engine', 'Меню')
    this.input.on('engine:menu', toggleMenu)
    this.ui.window({ id: 'engine:menu', title: 'Меню', component: () => h(GameMenu, { game: this }) }, 'engine')
    this.ui.slot('hud.bottomLeft', () => h(Clock, { game: this }), 'engine', 10)
    this.ui.slot('hud.topRight', () => h(FpsMeter, { game: this }), 'engine', 100)
  }
}
