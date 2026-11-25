import type { Game } from '../Game'
import { uiPrefs } from '../ui/prefs'
import { createLogger } from '../util/log'

const log = createLogger('settings')
const KEY = 'cl-settings'

export type Quality = 'low' | 'medium' | 'high'

/** Per-device player preferences: kept in the browser, not in save slots. */
export interface UserSettings {
  quality: Quality
  master: number
  sfx: number
  ui: number
  ambient: number
  music: number
  muted: boolean
  showFps: boolean
  /** Small camera shakes (a fish biting…). */
  cameraShake: boolean
  /** Size of the whole interface (1 = normal). */
  uiScale: number
  /** Dialogue text at once instead of letter by letter. */
  instantText: boolean
  /** Keys the player changed: action id → codes. */
  bindings: Record<string, string[]>
}

export const UI_SCALES = [0.85, 1, 1.15, 1.3, 1.5]

export const DEFAULT_SETTINGS: UserSettings = { quality: 'high', master: 0.8, sfx: 0.9, ui: 0.7, ambient: 0.6, music: 0.5, muted: false, showFps: false, cameraShake: true, uiScale: 1, instantText: false, bindings: {} }

/** Engine config values per quality level (paths in config · engine). */
export const QUALITY_PRESETS: Record<Quality, Record<string, number | boolean>> = {
  high: {
    'render.maxPixelRatio': 2,
    'render.shadows': true,
    'render.shadowMapSize': 2048,
    'render.msaa': 4,
    'style.postfx': true,
    'style.tiltShift': 3,
    'style.curvature': 0.0025,
  },
  medium: {
    'render.maxPixelRatio': 1.5,
    'render.shadows': true,
    'render.shadowMapSize': 1024,
    'render.msaa': 2,
    'style.postfx': true,
    'style.tiltShift': 3,
    'style.curvature': 0.0025,
  },
  // No shadows or post effects, flat world (lets the mesher merge faces: ~3× fewer triangles).
  low: {
    'render.maxPixelRatio': 1,
    'render.shadows': false,
    'render.shadowMapSize': 512,
    'render.msaa': 0,
    'style.postfx': false,
    'style.tiltShift': 0,
    'style.curvature': 0,
  },
}

export function loadUserSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<UserSettings>) } : { ...DEFAULT_SETTINGS }
  } catch {
    return { ...DEFAULT_SETTINGS } // private mode, blocked storage…
  }
}

function store(s: UserSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // not persisted — still applied for this session
  }
}

/** Push settings into the engine config (live). */
export function applyUserSettings(game: Game, s = loadUserSettings()): void {
  try {
    for (const [path, value] of Object.entries(QUALITY_PRESETS[s.quality] ?? QUALITY_PRESETS.high)) game.config.set('engine', path, value)
    game.config.set('engine', 'audio.master', s.master)
    game.config.set('engine', 'audio.sfx', s.sfx)
    game.config.set('engine', 'audio.ui', s.ui)
    game.config.set('engine', 'audio.ambient', s.ambient)
    game.config.set('engine', 'audio.music', s.music)
    game.config.set('engine', 'audio.muted', s.muted)
    game.config.set('engine', 'debug.showFps', s.showFps)
    game.config.set('engine', 'camera.shake', s.cameraShake ? 1 : 0)
    uiPrefs.instantText.value = s.instantText
    document.documentElement.style.setProperty('--ui-zoom', String(s.uiScale))
    game.input.setBindings(s.bindings)
  } catch (e) {
    log.warn('could not apply settings:', e)
  }
}

export function updateUserSettings(game: Game, patch: Partial<UserSettings>): UserSettings {
  const next = { ...loadUserSettings(), ...patch }
  store(next)
  applyUserSettings(game, next)
  return next
}
