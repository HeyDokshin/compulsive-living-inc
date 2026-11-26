import { z } from 'zod'
import { DEFAULT_LIGHT_KEYS } from './render/dayCycle'

/** Engine settings — tune live in the debug panel, persisted to config/engine.json5. */
export const EngineConfigSchema = z.object({
  loop: z
    .object({
      tickRate: z.number().int().min(5).max(120).default(20).meta({ label: 'ticks / s', step: 1 }),
      timeScale: z.number().min(0).max(8).default(1).meta({ step: 0.05 }),
    })
    .prefault({}),
  /** Rooms (museum, houses): how they look while the player is inside. */
  interior: z
    .object({
      background: z.string().default('#2e2630').meta({ color: true }),
      /** Ambient light inside never drops below this (rooms stay readable at night). */
      minAmbient: z.number().min(0).max(3).default(0.95).meta({ label: 'min ambient', step: 0.05 }),
      /** Sun inside, as a share of outside (walls and roof keep most of it out). */
      sun: z.number().min(0).max(2).default(0.55).meta({ step: 0.05 }),
    })
    .prefault({}),
  camera: z
    .object({
      pitch: z.number().min(10).max(89).default(44).meta({ label: 'pitch°', step: 0.5 }),
      /** Strength of camera shakes (bites, thuds); 0 turns them off. */
      shake: z.number().min(0).max(2).default(1).meta({ step: 0.05 }),
      viewSize: z.number().min(4).max(200).default(24).meta({ label: 'view size (blocks)', step: 1 }),
      zoom: z.number().min(0.1).max(8).default(4).meta({ step: 0.05 }),
      minZoom: z.number().min(0.05).max(10).default(0.2).meta({ step: 0.05 }),
      maxZoom: z.number().min(0.1).max(10).default(6).meta({ step: 0.05 }),
      zoomSpeed: z.number().min(0).max(0.01).default(0.0015).meta({ step: 0.0001 }),
      zoomSmoothing: z.number().min(1).max(40).default(10).meta({ label: 'zoom smoothing', step: 0.5 }),
      rotateSmoothing: z.number().min(1).max(40).default(12).meta({ step: 0.5 }),
      panSpeed: z.number().min(0).max(80).default(12).meta({ step: 0.5 }),
      followSmoothing: z.number().min(0.5).max(30).default(5).meta({ label: 'follow smoothing', step: 0.5 }),
      /** Seconds of movement the camera looks ahead of a followed entity. */
      lookAhead: z.number().min(0).max(2).default(0.35).meta({ label: 'look ahead (s)', step: 0.05 }),
      /** Lift the focus point (blocks) so the followed character sits slightly below screen center. */
      focusHeight: z.number().min(-3).max(5).default(0.6).meta({ label: 'focus height', step: 0.1 }),
    })
    .prefault({}),
  render: z
    .object({
      background: z.string().default('#9fd3e6').meta({ color: true }),
      shadows: z.boolean().default(true),
      maxPixelRatio: z.number().min(0.5).max(3).default(2).meta({ step: 0.25 }),
      /** Shadows reach at most this far from the camera focus; zoomed in they cover just the picture. */
      shadowRange: z.number().min(10).max(200).default(60).meta({ label: 'shadow range', step: 1 }),
      /** Blocks around the picture that still cast shadows into it. */
      shadowMargin: z.number().min(0).max(60).default(10).meta({ label: 'shadow margin', step: 1 }),
      /** Size of a shadow texel (blocks) that `style.shadowSoftness` is tuned for. */
      softnessTexel: z.number().min(0.005).max(0.2).default(0.03).meta({ label: 'softness texel', step: 0.005 }),
      /** Blocks around the picture where things are still drawn. */
      cullMargin: z.number().min(0).max(60).default(6).meta({ label: 'cull margin', step: 1 }),
      shadowMapSize: z.number().int().min(256).max(4096).default(2048).meta({ label: 'shadow map size', step: 256 }),
      /** Antialiasing samples of the post-processing target (0 = off). */
      msaa: z.number().int().min(0).max(8).default(4).meta({ label: 'MSAA samples', step: 1 }),
      /** At most this many on dense (retina) screens: their pixels are small enough already. */
      msaaDense: z.number().int().min(0).max(8).default(2).meta({ label: 'MSAA on dense screens', step: 1 }),
      ao: z.number().min(0).max(1).default(0.4).meta({ label: 'ambient occlusion', step: 0.05 }),
      waterOpacity: z.number().min(0).max(1).default(0.72).meta({ step: 0.01 }),
      /** Round, plush characters: smooth parts, fur and hair, drawn faces. */
      characters: z
        .object({
          round: z.boolean().default(true),
          fur: z.boolean().default(true),
          faces: z.boolean().default(true),
          /** Weave of clothes close up (knit, denim…): procedural materials on characters. */
          fabric: z.boolean().default(true),
          /** Fur shells close up (more = denser, softer fur; costs drawing time). */
          maxShells: z.number().int().min(2).max(32).default(14).meta({ label: 'fur shells', step: 1 }),
          /** Fur appears from this many screen pixels per voxel… */
          furFrom: z.number().min(0.5).max(20).default(1.6).meta({ label: 'fur from (px/voxel)', step: 0.1 }),
          /** …and is fully grown at this many. */
          furFull: z.number().min(0.5).max(40).default(5).meta({ label: 'fur full (px/voxel)', step: 0.1 }),
        })
        .prefault({}),
      /** Close-up block textures: finer atlases (procedural materials) as the camera comes closer. */
      detail: z
        .object({
          enabled: z.boolean().default(true),
          /** Texels per screen pixel to aim for. */
          bias: z.number().min(0.25).max(2).default(0.9).meta({ step: 0.05 }),
          /** Finest level: texels per block (rounded down to a power of two). */
          max: z.number().int().min(16).max(1024).default(256).meta({ label: 'max texels', step: 16 }),
          /** Seconds a crossfade between levels takes. */
          fade: z.number().min(0).max(3).default(0.45).meta({ step: 0.05 }),
        })
        .prefault({}),
      /** Soft color patches on blocks with `tint: true` (lawns). */
      tint: z
        .object({
          strength: z.number().min(0).max(1).default(1).meta({ step: 0.01 }),
          scale: z.number().min(0.005).max(0.5).default(0.09).meta({ label: 'patch scale', step: 0.005 }),
          sunny: z.string().default('#fff1a0').meta({ color: true }),
          shady: z.string().default('#8fd2bf').meta({ color: true }),
        })
        .prefault({}),
    })
    .prefault({}),
  light: z
    .object({
      dayCycle: z.boolean().default(true).meta({ label: 'day cycle' }),
      time: z.number().min(0).max(24).default(10).meta({ label: 'time (h)', step: 0.1 }),
      timeSpeed: z.number().min(0).max(4).default(0).meta({ label: 'hours / sec', step: 0.05 }),
      maxElevation: z.number().min(10).max(90).default(62).meta({ label: 'max sun elevation°', step: 1 }),
      keys: z
        .array(
          z.object({
            t: z.number(),
            sun: z.string(),
            sunIntensity: z.number(),
            sky: z.string(),
            ground: z.string(),
            ambient: z.number(),
            background: z.string(),
          }),
        )
        .min(1)
        .default(DEFAULT_LIGHT_KEYS),
      sunColor: z.string().default('#fff4e0').meta({ color: true }),
      sunIntensity: z.number().min(0).max(6).default(2.2).meta({ step: 0.05 }),
      sunAzimuth: z.number().min(0).max(360).default(35).meta({ label: 'sun azimuth°', step: 1 }),
      sunElevation: z.number().min(5).max(90).default(55).meta({ label: 'sun elevation°', step: 1 }),
      skyColor: z.string().default('#cfe8ff').meta({ color: true }),
      groundColor: z.string().default('#7a6a52').meta({ color: true }),
      ambientIntensity: z.number().min(0).max(4).default(1.1).meta({ step: 0.05 }),
    })
    .prefault({}),
  /** The look: soft light, pastel grading, tilt-shift, rolling-world curvature. */
  style: z
    .object({
      postfx: z.boolean().default(true).meta({ label: 'post effects' }),
      toneMapping: z.enum(['neutral', 'agx', 'aces', 'none']).default('neutral').meta({ label: 'tone mapping' }),
      exposure: z.number().min(0.2).max(3).default(1.08).meta({ step: 0.01 }),
      saturation: z.number().min(0).max(2).default(1.12).meta({ step: 0.01 }),
      contrast: z.number().min(0.5).max(1.5).default(0.94).meta({ step: 0.01 }),
      warmth: z.number().min(-1).max(1).default(0.35).meta({ step: 0.01 }),
      lift: z.number().min(0).max(0.2).default(0.035).meta({ label: 'lift (pastel)', step: 0.005 }),
      vignette: z.number().min(0).max(1).default(0.3).meta({ step: 0.01 }),
      tiltShift: z.number().min(0).max(20).default(3).meta({ label: 'tilt-shift blur', step: 0.1 }),
      /** Blur fades out as the camera zooms in past this zoom (a close-up shouldn't look smudged). */
      tiltShiftZoom: z.number().min(0.5).max(10).default(2.2).meta({ label: 'tilt-shift full until zoom', step: 0.1 }),
      tiltFocus: z.number().min(0).max(1).default(0.5).meta({ label: 'tilt-shift focus', step: 0.01 }),
      curvature: z.number().min(0).max(0.02).default(0.0025).meta({ label: 'world curvature', step: 0.0005 }),
      shadowSoftness: z.number().min(0).max(10).default(4).meta({ label: 'shadow softness', step: 0.25 }),
      shadowStrength: z.number().min(0).max(1).default(0.55).meta({ label: 'shadow strength', step: 0.01 }),
      waterSpeed: z.number().min(0).max(5).default(1).meta({ label: 'water speed', step: 0.05 }),
    })
    .prefault({}),
  /** The game clock (see TimeService). */
  time: z
    .object({
      /** real: device clock (days pass while away) · scaled: fast clock while playing · frozen: fixed hour */
      mode: z.enum(['real', 'scaled', 'frozen']).default('real'),
      /** scaled mode: game seconds per real second (60 → a day in 24 minutes). */
      scale: z.number().min(1).max(3600).default(60).meta({ step: 1 }),
      frozenHour: z.number().min(0).max(24).default(10).meta({ label: 'frozen hour', step: 0.25 }),
      hemisphere: z.enum(['north', 'south']).default('north'),
      /** At most this many missed days are simulated after being away. */
      maxCatchUpDays: z.number().int().min(0).max(365).default(30).meta({ label: 'max catch-up days', step: 1 }),
      /** The light follows the clock (off: light.time is set by hand). */
      drivesLight: z.boolean().default(true).meta({ label: 'clock drives light' }),
    })
    .prefault({}),
  audio: z
    .object({
      muted: z.boolean().default(false),
      master: z.number().min(0).max(1).default(0.8).meta({ step: 0.01 }),
      sfx: z.number().min(0).max(1).default(0.9).meta({ step: 0.01 }),
      ui: z.number().min(0).max(1).default(0.7).meta({ step: 0.01 }),
      ambient: z.number().min(0).max(1).default(0.6).meta({ step: 0.01 }),
      music: z.number().min(0).max(1).default(0.5).meta({ step: 0.01 }),
      hearingRange: z.number().min(4).max(100).default(26).meta({ label: 'hearing range (blocks)', step: 1 }),
    })
    .prefault({}),
  title: z
    .object({
      /** Title screen on start (off: straight into the latest island). */
      enabled: z.boolean().default(true),
      zoom: z.number().min(0.1).max(8).default(1.15).meta({ step: 0.05 }),
      /** The camera drifts in a circle around the island middle (blocks, degrees per second). */
      orbit: z.number().min(0).max(60).default(16).meta({ step: 1 }),
      orbitSpeed: z.number().min(0).max(30).default(2.5).meta({ label: 'orbit speed°', step: 0.1 }),
      /** Seconds of the slow zoom-in when the game starts. */
      glide: z.number().min(0).max(6).default(2).meta({ label: 'glide-in (s)', step: 0.1 }),
    })
    .prefault({}),
  mods: z
    .object({
      /** A mod may unpack to this much. */
      maxMegabytes: z.number().min(1).max(512).default(64).meta({ label: 'max size (MB)', step: 1 }),
    })
    .prefault({}),
  save: z
    .object({
      /** Minutes between autosaves into the current slot (0 = off). Also saves when the tab is hidden. */
      autosaveMinutes: z.number().min(0).max(60).default(2).meta({ label: 'autosave (min)', step: 0.5 }),
      /** Continue the most recent save on start. */
      autoLoad: z.boolean().default(true).meta({ label: 'continue last save' }),
      slots: z.number().int().min(1).max(10).default(3).meta({ step: 1 }),
    })
    .prefault({}),
  debug: z
    .object({
      /** Debug panel (toggle with F2). */
      showPanel: z.boolean().default(false),
      showFps: z.boolean().default(false).meta({ label: 'show FPS' }),
      showClock: z.boolean().default(true).meta({ label: 'show clock' }),
      showGrid: z.boolean().default(false),
      showAxes: z.boolean().default(false),
      showChunks: z.boolean().default(false),
    })
    .prefault({}),
})

export type EngineConfig = z.infer<typeof EngineConfigSchema>

/** World shape. Changing any value regenerates the world. */
export const WorldConfigSchema = z.object({
  seed: z.number().int().min(0).max(2 ** 31 - 1).default(12345).meta({ step: 1 }),
  chunksX: z.number().int().min(1).max(32).default(8).meta({ label: 'chunks X', step: 1 }),
  chunksZ: z.number().int().min(1).max(32).default(8).meta({ label: 'chunks Z', step: 1 }),
  height: z.number().int().min(8).max(128).default(32).meta({ step: 1 }),
  /** Y a walker stands at on the lowest land (level 1). The sea surface is level with it. */
  ground: z.number().int().min(2).max(64).default(8).meta({ step: 1 }),
  /**
   * Levels one can stand on, from the ground up. The last one only holds things put on top of the
   * highest blocks, so blocks are built at most `levels - 1` high.
   */
  levels: z.number().int().min(2).max(16).default(5).meta({ step: 1 }),
  /**
   * Y of the sea surface, if not level with the ground. Islands made before 0.16 stood one block above
   * the sea (their saves get `ground: 9, sea: 8`).
   */
  sea: z.number().int().min(1).max(64).optional(),
})
export type WorldConfig = z.infer<typeof WorldConfigSchema>
