import type { Registry } from '../registry/Registry'
import { SynthLayerSchema, type SoundDef, type SynthLayer } from './defs'
import { createLogger } from '../util/log'

const log = createLogger('audio')

export type Bus = 'sfx' | 'ui' | 'ambient' | 'music'

export interface AudioSettings {
  muted: boolean
  master: number
  sfx: number
  ui: number
  ambient: number
  music: number
  /** World sounds fade out over this many blocks from the camera focus. */
  hearingRange: number
  /** Room echo: seconds between reflections, and how much of each comes back (0…0.9). */
  echoDelay: number
  echoTail: number
}

/** One scheduled note (generative music, chimes…). */
export interface NoteOptions extends Partial<SynthLayer> {
  /** Seconds from now. */
  at?: number
  bus?: Bus
}

/** A continuous sound (e.g. surf) whose loudness and brightness can be steered. */
export interface LoopHandle {
  setGain(gain: number, seconds?: number): void
  setFilter(freq: number, seconds?: number): void
  stop(): void
}

export interface LoopOptions {
  wave?: 'noise' | 'sine' | 'triangle'
  freq?: number
  filter?: { type: BiquadFilterType; freq: number; q?: number }
  bus?: Bus
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
  private buses?: Record<Bus, GainNode>
  private master?: GainNode
  private noise?: AudioBuffer
  /** Room echo on world sounds: the send into it and its feedback. */
  private echo?: { send: GainNode; delay: DelayNode; feedback: GainNode }
  private echoAmount = 0
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
    this.buses.music.gain.setTargetAtTime(s.music, t, 0.05)
    if (this.echo) {
      this.echo.delay.delayTime.setTargetAtTime(s.echoDelay, t, 0.05)
      this.echo.feedback.gain.setTargetAtTime(Math.min(0.9, s.echoTail), t, 0.05)
      this.echo.send.gain.setTargetAtTime(this.echoAmount * 0.6, t, 0.25)
    }
  }

  /** How much world sounds (steps, tools) echo: 0 outdoors, more in bigger, barer rooms. */
  setEcho(amount: number): void {
    this.echoAmount = Math.max(0, Math.min(1, amount))
    this.applySettings()
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

  /** Audio clock (seconds) — schedule notes against it. */
  get time(): number {
    return this.ctx?.currentTime ?? 0
  }

  /** Play one synthesized note. No-op until audio is unlocked. */
  note(n: NoteOptions): void {
    if (!this.ready) return
    const layer = SynthLayerSchema.parse(n)
    const out = this.ctx!.createGain()
    out.connect(this.buses![n.bus ?? 'music'])
    this.playLayer(layer, out, this.ctx!.currentTime + (n.at ?? 0), 1)
    setTimeout(() => out.disconnect(), ((n.at ?? 0) + layer.delay + layer.attack + layer.duration + 0.3) * 1000)
  }

  /** Start a continuous sound (silent at first — fade it in with setGain). Null until audio is unlocked. */
  loop(o: LoopOptions = {}): LoopHandle | null {
    if (!this.ready) return null
    const ctx = this.ctx!
    let src: AudioScheduledSourceNode
    if (!o.wave || o.wave === 'noise') {
      const n = ctx.createBufferSource()
      n.buffer = this.noise!
      n.loop = true
      src = n
    } else {
      const osc = ctx.createOscillator()
      osc.type = o.wave
      osc.frequency.value = o.freq ?? 220
      src = osc
    }
    const gain = ctx.createGain()
    gain.gain.value = 0
    let filter: BiquadFilterNode | undefined
    if (o.filter) {
      filter = ctx.createBiquadFilter()
      filter.type = o.filter.type
      filter.frequency.value = o.filter.freq
      filter.Q.value = o.filter.q ?? 0.7
      src.connect(filter).connect(gain)
    } else src.connect(gain)
    gain.connect(this.buses![o.bus ?? 'ambient'])
    src.start()
    return {
      setGain: (v, sec = 0.5) => gain.gain.setTargetAtTime(Math.max(0, v), ctx.currentTime, sec / 3),
      setFilter: (f, sec = 0.5) => filter?.frequency.setTargetAtTime(f, ctx.currentTime, sec / 3),
      stop: () => {
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1)
        setTimeout(() => {
          src.stop()
          gain.disconnect()
        }, 500)
      },
    }
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
      this.buses = { sfx: bus(), ui: bus(), ambient: bus(), music: bus() }
      // echo: world sounds feed a delay that feeds itself back, darker each time round
      const send = ctx.createGain()
      send.gain.value = 0
      const delay = ctx.createDelay(1)
      const feedback = ctx.createGain()
      const dark = ctx.createBiquadFilter()
      dark.type = 'lowpass'
      dark.frequency.value = 2200
      this.buses.sfx.connect(send).connect(delay).connect(dark).connect(feedback).connect(delay)
      dark.connect(this.master)
      this.echo = { send, delay, feedback }
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
