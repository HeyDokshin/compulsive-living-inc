import { z } from 'zod'

const Range = z.tuple([z.number(), z.number()])

/** A particle burst preset: little voxel cubes that fly, fall and shrink. */
export const ParticleDefSchema = z.looseObject({
  id: z.string(),
  tags: z.array(z.string()).optional(),
  count: z.number().int().min(1).max(200).default(8),
  /** Random pick per particle (a burst can override with one color, e.g. the dug block's). */
  colors: z.array(z.string()).default(['#ffffff']),
  /** Cube edge in blocks. */
  size: Range.default([0.06, 0.12]),
  /** Initial speed (blocks/s) along a random direction in a cone around +y. */
  speed: Range.default([0.8, 1.8]),
  /** Half-angle of that cone (radians): 0 = straight up, π/2 = flat ring. */
  spread: z.number().min(0).max(Math.PI).default(1.1),
  gravity: z.number().default(6),
  /** Velocity damping per second. */
  drag: z.number().min(0).default(1.2),
  life: Range.default([0.35, 0.7]),
  /** Start positions jittered within this radius. */
  radius: z.number().min(0).default(0.15),
  /** Unlit and bright (sparkles) instead of shaded (dust, clods). */
  glow: z.boolean().default(false),
  /** Shrink to nothing over the lifetime. */
  shrink: z.boolean().default(true),
  /** Spin speed (rad/s). */
  spin: z.number().default(4),
})
export type ParticleDef = z.infer<typeof ParticleDefSchema>
