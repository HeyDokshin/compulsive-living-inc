import { z } from 'zod'

/**
 * One layer of a synthesized sound: an oscillator or noise, an envelope, an optional filter.
 * Several layers play together (e.g. a soft thump + a click).
 */
export const SynthLayerSchema = z.object({
  wave: z.enum(['sine', 'triangle', 'square', 'sawtooth', 'noise']).default('sine'),
  /** Start frequency (Hz) for oscillators. */
  freq: z.number().positive().default(440),
  /** Frequency at the end (glide). */
  freqEnd: z.number().positive().optional(),
  /** Seconds. */
  attack: z.number().min(0).default(0.005),
  duration: z.number().positive().default(0.12),
  gain: z.number().min(0).max(2).default(0.5),
  /** Start after this many seconds. */
  delay: z.number().min(0).default(0),
  filter: z
    .object({
      type: z.enum(['lowpass', 'highpass', 'bandpass']).default('lowpass'),
      freq: z.number().positive().default(1200),
      freqEnd: z.number().positive().optional(),
      q: z.number().min(0.0001).default(1),
    })
    .optional(),
})
export type SynthLayer = z.infer<typeof SynthLayerSchema>

export const SoundDefSchema = z.looseObject({
  id: z.string(),
  tags: z.array(z.string()).optional(),
  /** Mixer channel: sfx (world), ui (interface), ambient (birds, surf), music. */
  bus: z.enum(['sfx', 'ui', 'ambient', 'music']).default('sfx'),
  volume: z.number().min(0).max(2).default(1),
  /** Random pitch variation (0.1 = ±10%) so repeated sounds don't feel robotic. */
  pitchJitter: z.number().min(0).max(1).default(0.06),
  /** Audio file instead of synthesis. */
  url: z.string().optional(),
  layers: z.array(SynthLayerSchema).default([]),
  /** Don't play the same sound more often than this (seconds). */
  cooldown: z.number().min(0).default(0.03),
})
export type SoundDef = z.infer<typeof SoundDefSchema>
