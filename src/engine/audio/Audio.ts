import type { Registry } from '../registry/Registry'
import type { SoundDef, SynthLayer } from './defs'
import { createLogger } from '../util/log'

const log = createLogger('audio')

export interface AudioSettings {
  muted: boolean
  master: number
  sfx: number
  ui: number
  ambient: number
  /** World sounds fade out over this many blocks from the camera focus. */
  hearingRange: number
}

export interface PlayOptions {
  /** World position: quieter with distance from the listener. */
  at?: { x: number; z: number }
  volume?: number
  /** Pitch multiplier. */
  pitch?: number
}

/**
 * Tiny WebAudio mixer playing sounds from the `sounds` registry: synthesized layers
 * (no asset files needed) or audio files. Starts on the first user gesture (browser rule).
 */
export class Audio {
  private ctx?: AudioContext
  private buses?: Record<'sfx' | 'ui' | 'ambient', GainNode>
  private master?: GainNode
  private noise?: AudioBuffer
  private files = new Map<string, Promise<AudioBuffer | null>>()
  private lastPlayed = new Map<string, number>()
  listener = { x: 0, z: 0 }

  constructor(
    private sounds: Registry<SoundDef>,
    private settings: AudioSettings,
  ) {
    const unlock = () => {
      this.ensure()
      void this.ctx?.resume()
    }
    window.addEventListener('pointerdown', unlock, { capture: true })
    window.addEventListener('keydown', unlock, { capture: true })
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running'
  }

  applySettings(): void {
    if (!this.ctx || !this.buses || !this.master) return
    const s = this.settings
    const t = this.ctx.currentTime
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master, t, 0.02)
    this.buses.sfx.gain.setTargetAtTime(s.sfx, t, 0.02)
    this.buses.ui.gain.setTargetAtTime(s.ui, t, 0.02)
    this.buses.ambient.gain.setTargetAtTime(s.ambient, t, 0.02)
  }

  play(id: string, opts: PlayOptions = {}): void {
    if (!this.ready) return
    const def = this.sounds.get(id)
    if (!def) {
      log.warn(`unknown sound "${id}"`)
      return
    }
    const ctx = this.ctx!
    const now = ctx.currentTime
    if (now - (this.lastPlayed.get(id) ?? -1) < def.cooldown) return
    this.lastPlayed.set(id, now)

    let vol = def.volume * (opts.volume ?? 1)
    if (opts.at) {
      const d = Math.hypot(opts.at.x - this.listener.x, opts.at.z - this.listener.z)
      vol *= Math.max(0, 1 - d / this.settings.hearingRange) ** 2
      if (vol <= 0.001) return
    }
    const pitch = (opts.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * def.pitchJitter)
    const out = ctx.createGain()
    out.gain.value = vol
    out.connect(this.buses![def.bus])

    if (def.url) {
      void this.file(def.url).then((buf) => {
        if (!buf) return
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.playbackRate.value = pitch
        src.connect(out)
        src.start()
      })
      return
    }
    for (const layer of def.layers) this.playLayer(layer, out, now, pitch)
    const total = Math.max(0.05, ...def.layers.map((l) => l.delay + l.attack + l.duration))
    setTimeout(() => out.disconnect(), (total + 0.2) * 1000)
  }

  private playLayer(l: SynthLayer, out: AudioNode, now: number, pitch: number): void {
    const ctx = this.ctx!
    const t0 = now + l.delay
    const t1 = t0 + l.attack
    const t2 = t1 + l.duration
    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, t0)
    env.gain.exponentialRampToValueAtTime(Math.max(0.0001, l.gain), t1)
    env.gain.exponentialRampToValueAtTime(0.0001, t2)

    let src: AudioScheduledSourceNode
    if (l.wave === 'noise') {
      const n = ctx.createBufferSource()
      n.buffer = this.noise!
      n.playbackRate.value = pitch
      src = n
    } else {
      const o = ctx.createOscillator()
      o.type = l.wave
      o.frequency.setValueAtTime(l.freq * pitch, t0)
      if (l.freqEnd) o.frequency.exponentialRampToValueAtTime(l.freqEnd * pitch, t2)
      src = o
    }
    let node: AudioNode = src
    if (l.filter) {
      const f = ctx.createBiquadFilter()
      f.type = l.filter.type
      f.Q.value = l.filter.q
      f.frequency.setValueAtTime(l.filter.freq * pitch, t0)
      if (l.filter.freqEnd) f.frequency.exponentialRampToValueAtTime(l.filter.freqEnd * pitch, t2)
      node.connect(f)
      node = f
    }
    node.connect(env)
    env.connect(out)
    src.start(t0)
    src.stop(t2 + 0.05)
  }

  private ensure(): void {
    if (this.ctx) return
    try {
      const ctx = new AudioContext()
      this.ctx = ctx
      this.master = ctx.createGain()
      this.master.connect(ctx.destination)
      const bus = () => {
        const g = ctx.createGain()
        g.connect(this.master!)
        return g
      }
      this.buses = { sfx: bus(), ui: bus(), ambient: bus() }
      // 1 s of white noise, reused by all noise layers
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
      this.noise = buf
      this.applySettings()
    } catch (e) {
      log.warn('audio unavailable:', e)
    }
  }

  private file(url: string): Promise<AudioBuffer | null> {
    let p = this.files.get(url)
    if (!p) {
      p = fetch(url)
        .then((r) => r.arrayBuffer())
        .then((b) => this.ctx!.decodeAudioData(b))
        .catch((e) => {
          log.error(`sound file ${url}:`, e)
          return null
        })
      this.files.set(url, p)
    }
    return p
  }
}
