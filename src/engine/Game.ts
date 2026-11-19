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
import { BlockSchema, PrefabSchema, type BlockDef, type CommandDef, type GameEvents, type GameHooks, type PrefabDef } from './types'
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
    this.entities = new Entities(this.prefabs, this.events, this.hooks)
    this.content = new ContentLoader(this.registries)
    this.engineConfig = this.config.define('engine', EngineConfigSchema, 'engine')
    this.worldConfig = this.config.define('world', WorldConfigSchema, 'engine')
    this.world = new WorldService(this.worldConfig, this.blocks, this.worldgen, this.events, this.hooks)
    this.loop = new GameLoop(this.scheduler, {
      tickRate: this.engineConfig.loop.tickRate,
      onTickEnd: () => this.input.endTick(),
    })
    this.renderer = new Renderer(container, this.engineConfig, this.entities, this.world.voxels)
    this.input.attach(this.renderer.renderer.domElement)
    this.panel = new DebugPanel(this.config)
    this.devConsole = new DevConsole(this.commands)
    this.plugins = new PluginManager((def) => this.createScope(def))

    for (const c of builtinCommands(this)) this.commands.register({ ...c, id: `debug:${c.name}` }, 'engine')
    this.config.onChange('engine', () => this.applyEngineConfig())
    this.blocks.onChange(() => this.scheduleAtlas())
    this.textures.onChange(() => this.scheduleAtlas())
    let chunkCount = -1
    this.events.on('world:generated', () => {
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
    await this.plugins.loadAll(async () => {
      this.reloadContent()
      await this.world.regenerate()
    })
    for (const id of this.plugins.loadedIds()) this.events.emit('plugin:loaded', { id })
    this.panel.sync()
    this.loop.start()
    this.events.emit('engine:started', {})
    log.info(`ready: ${this.plugins.loadedIds().length} plugins, ${this.entities.world.entities.length} entities`)
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

  /** Point the camera at the middle of the island. */
  centerCamera(): void {
    const v = this.world.voxels
    const x = v.sizeX / 2
    const z = v.sizeZ / 2
    this.renderer.iso.target.set(x, this.world.surfaceY(x, z), z)
    this.cameraPlaced = true
  }

  private cameraPlaced = false
  private atlasScheduled = false

  /** Coalesce many registry changes (e.g. a content reload) into one atlas rebuild. */
  private scheduleAtlas(): void {
    if (this.atlasScheduled) return
    this.atlasScheduled = true
    setTimeout(async () => {
      this.atlasScheduled = false
      const ok = await this.renderer.atlas.rebuild(this.blocks.all(), (id) => this.textures.get(id), this.world.voxels.palette)
      if (ok) {
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
    // Free camera until there is a player to follow (stage 2).
    const dir = new THREE.Vector3()
    add('engine:cameraControls', 'render', 900, (ctx) => {
      if (this.devConsole.open) return
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
        this.panel.pane.refresh()
      }
    })
    add('engine:render', 'render', 1000, (ctx) => {
      this.renderer.render(ctx)
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
