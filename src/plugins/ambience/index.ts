/**
 * Soundscape: generative background music (day/night moods), surf near water, birds by day,
 * crickets at night. Everything follows the time of day (`engine → light.time`).
 */
import { definePlugin, z, type LoopHandle, type PluginApi } from '@sdk'
import { Composer, DAY, NIGHT, midiToHz, type MusicNote } from './music'

const Config = z.object({
  music: z.boolean().default(true),
  /** Seconds of silence after each long phrase block (music that doesn't nag). */
  musicPause: z.number().min(0).max(120).default(20).meta({ label: 'pause between pieces (s)', step: 1 }),
  surf: z.number().min(0).max(1).default(0.22).meta({ label: 'surf volume', step: 0.01 }),
  birds: z.boolean().default(true),
  crickets: z.boolean().default(true),
})
type Config = z.infer<typeof Config>

export default definePlugin({
  id: 'ambience',
  version: '0.1.0',
  description: 'Фоновая музыка, прибой, птицы и сверчки',

  setup(api) {
    const cfg = api.config.define(Config)
    const music = new MusicPlayer(api, cfg)
    const nature = new Nature(api, cfg)
    api.systems.add({
      id: 'soundscape',
      phase: 'render',
      run: ({ dt }) => {
        if (!api.audio.ready) return
        music.update()
        nature.update(dt)
      },
    })
  },
})

const hour = (api: PluginApi) => api.engineConfig.light.time
const isNight = (h: number) => h >= 19.5 || h < 5.5

class MusicPlayer {
  private composer = new Composer()
  private step = 0
  private next = 0
  private restUntil = 0

  constructor(
    private api: PluginApi,
    private cfg: Config,
  ) {}

  update(): void {
    const a = this.api.audio
    if (!this.cfg.music) return
    const now = a.time
    if (now < this.restUntil) return
    if (this.next < now) this.next = now + 0.1
    // Schedule a little ahead of the audio clock for steady timing.
    while (this.next < now + 0.3) {
      const mood = isNight(hour(this.api)) ? NIGHT : DAY
      const eighth = 30 / mood.bpm
      for (const n of this.composer.notesAt(this.step, mood)) this.play(n, this.next - now, eighth * 2)
      this.step++
      this.next += eighth
      // After 8 phrases (~4 min) take a break, like cozy game music does.
      if (this.step % 512 === 0) {
        this.restUntil = this.next + this.cfg.musicPause
        this.next = this.restUntil
        break
      }
    }
  }

  private play(n: MusicNote, at: number, beat: number): void {
    const freq = midiToHz(n.midi)
    const a = this.api.audio
    if (n.voice === 'pad') {
      a.note({ at, wave: 'triangle', freq, attack: 0.8, duration: n.length * beat, gain: 0.03, filter: { type: 'lowpass', freq: 900, q: 0.7 } })
    } else if (n.voice === 'bass') {
      a.note({ at, wave: 'sine', freq, attack: 0.02, duration: n.length * beat, gain: 0.08 })
    } else {
      // music-box bell: sine + soft octave shimmer
      a.note({ at, wave: 'sine', freq, attack: 0.005, duration: 0.9, gain: 0.06 })
      a.note({ at, wave: 'sine', freq: freq * 2, attack: 0.005, duration: 0.35, gain: 0.015 })
    }
  }
}

class Nature {
  private surf: LoopHandle | null = null
  private sample = 0
  private shore = 0
  private time = 0
  private birdIn = 2
  private cricketIn = 1

  constructor(
    private api: PluginApi,
    private cfg: Config,
  ) {
    api.onDispose(() => this.surf?.stop())
  }

  update(dt: number): void {
    this.time += dt
    this.updateSurf(dt)
    const h = hour(this.api)
    const day = h >= 6 && h < 18.5
    const at = this.api.render.camera.target
    if (this.cfg.birds && day && (this.birdIn -= dt) <= 0) {
      this.birdIn = 2.5 + Math.random() * 5
      const a = Math.random() * Math.PI * 2
      this.api.audio.play(Math.random() < 0.7 ? 'ambience:bird' : 'ambience:bird_whistle', {
        at: { x: at.x + Math.cos(a) * 8, z: at.z + Math.sin(a) * 8 },
        volume: 0.6 + Math.random() * 0.4,
      })
    }
    if (this.cfg.crickets && isNight(h) && (this.cricketIn -= dt) <= 0) {
      this.cricketIn = 0.4 + Math.random() * 1.1
      this.api.audio.play('ambience:cricket', { volume: 0.4 + Math.random() * 0.5 })
    }
  }

  /** Surf: louder the more water is around the camera, swelling like waves. */
  private updateSurf(dt: number): void {
    if (!this.surf) this.surf = this.api.audio.loop({ wave: 'noise', filter: { type: 'lowpass', freq: 480, q: 0.6 } })
    if (!this.surf) return
    this.sample -= dt
    if (this.sample <= 0) {
      this.sample = 1
      this.shore = waterAround(this.api, 12)
    }
    const swell = 0.65 + 0.35 * Math.sin((this.time * Math.PI * 2) / 7)
    this.surf.setGain(this.cfg.surf * Math.min(1, this.shore * 1.8) * swell, 0.8)
    this.surf.setFilter(380 + 260 * swell, 0.8)
  }
}

/** Share of sampled columns around the camera whose top is liquid. */
function waterAround(api: PluginApi, radius: number): number {
  const c = api.render.camera.target
  const blocks = api.registry('blocks')
  let water = 0
  let total = 0
  for (let dz = -radius; dz <= radius; dz += 3) {
    for (let dx = -radius; dx <= radius; dx += 3) {
      if (dx * dx + dz * dz > radius * radius) continue
      const x = Math.floor(c.x + dx)
      const z = Math.floor(c.z + dz)
      total++
      for (let y = api.world.height - 1; y >= 0; y--) {
        const id = api.world.getBlock(x, y, z)
        if (id === api.world.AIR) continue
        if (blocks.isTagged(id, '#core:liquid')) water++
        break
      }
      // outside the world is sea too
      if (x < 0 || z < 0 || x >= api.world.sizeX || z >= api.world.sizeZ) water++
    }
  }
  return total ? Math.min(1, water / total) : 0
}
