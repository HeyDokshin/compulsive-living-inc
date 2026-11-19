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
  camera: z
    .object({
      pitch: z.number().min(10).max(89).default(35.264).meta({ label: 'pitch°', step: 0.5 }),
      viewSize: z.number().min(4).max(200).default(24).meta({ label: 'view size (blocks)', step: 1 }),
      zoom: z.number().min(0.25).max(6).default(1).meta({ step: 0.05 }),
      minZoom: z.number().min(0.1).max(10).default(0.4).meta({ step: 0.05 }),
      maxZoom: z.number().min(0.1).max(10).default(4).meta({ step: 0.05 }),
      zoomSpeed: z.number().min(0).max(0.01).default(0.0015).meta({ step: 0.0001 }),
      rotateSmoothing: z.number().min(1).max(40).default(12).meta({ step: 0.5 }),
      panSpeed: z.number().min(0).max(80).default(12).meta({ step: 0.5 }),
    })
    .prefault({}),
  render: z
    .object({
      background: z.string().default('#9fd3e6').meta({ color: true }),
      shadows: z.boolean().default(true),
      maxPixelRatio: z.number().min(0.5).max(3).default(2).meta({ step: 0.25 }),
      shadowRange: z.number().min(10).max(200).default(60).meta({ label: 'shadow range', step: 1 }),
      ao: z.number().min(0).max(1).default(0.55).meta({ label: 'ambient occlusion', step: 0.05 }),
      waterOpacity: z.number().min(0).max(1).default(0.78).meta({ step: 0.01 }),
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
  debug: z
    .object({
      showPanel: z.boolean().default(true),
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
})
export type WorldConfig = z.infer<typeof WorldConfigSchema>
