import { z } from 'zod'

/**
 * Procedural materials: a stack of layers, each a tileable pattern mapped through a color ramp and
 * blended over the layers below. Rendered at any resolution — finer octaves appear only when there
 * are pixels for them, so a close camera gets real detail and a far one a clean, quiet surface.
 */

export const LAYER_KINDS = ['fill', 'noise', 'ridged', 'cells', 'cracks', 'strata', 'wood', 'boards', 'grain', 'fibers', 'knit', 'pebbles', 'twill', 'weave',
  // decor motifs (rare patterns): soft-edged shapes in a grid
  'stripes', 'dots', 'stars', 'hearts', 'flowers', 'checker', 'waves', 'marble', 'terrazzo', 'scales', 'herringbone', 'zigzag'] as const
export type LayerKind = (typeof LAYER_KINDS)[number]

export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'soft', 'add', 'darken', 'lighten'] as const
export type BlendMode = (typeof BLEND_MODES)[number]

const MaskSchema = z.object({
  /** Pattern the mask comes from (its value 0…1, before the ramp). */
  kind: z.enum(LAYER_KINDS).default('noise'),
  scale: z.number().min(0.5).max(256).default(3),
  octaves: z.number().int().min(1).max(8).default(3),
  roughness: z.number().min(0).max(1).default(0.5),
  seed: z.number().int().default(7),
  /** Where the mask switches on, and how softly (in pattern values). */
  threshold: z.number().min(0).max(1).default(0.5),
  softness: z.number().min(0).max(1).default(0.1),
  invert: z.boolean().default(false),
  params: z.record(z.string(), z.number()).default({}),
})
export type MaskDef = z.infer<typeof MaskSchema>

export const LayerSchema = z.object({
  kind: z.enum(LAYER_KINDS).default('noise'),
  /** Color ramp from low to high pattern values (evenly spaced stops). One color = flat. */
  colors: z.array(z.string()).min(1).default(['#808080']),
  /** Features across one tile (whole numbers tile seamlessly; rounded). */
  scale: z.number().min(0.5).max(256).default(4),
  /** Octaves of detail; finer ones are dropped when the texture is too small to show them. */
  octaves: z.number().int().min(1).max(8).default(4),
  /** How much each finer octave counts (0.5 = classic fractal noise). */
  roughness: z.number().min(0).max(1).default(0.5),
  /** Distort the pattern with noise (fraction of a tile). */
  warp: z.number().min(0).max(1).default(0),
  /** Shapes the value before the ramp: >1 favours low values, <1 high ones. */
  contrast: z.number().min(0.05).max(8).default(1),
  seed: z.number().int().default(1),
  blend: z.enum(BLEND_MODES).default('normal'),
  opacity: z.number().min(0).max(1).default(1),
  /** Adds the pattern to the surface height (baked into light and shade; negative = grooves). */
  relief: z.number().min(-4).max(4).default(0),
  mask: MaskSchema.optional(),
  /** Pattern-specific numbers (rows, gap, rings…). */
  params: z.record(z.string(), z.number()).default({}),
})
export type LayerDef = z.infer<typeof LayerSchema>

export const MaterialSchema = z.looseObject({
  id: z.string(),
  tags: z.array(z.string()).optional(),
  layers: z.array(LayerSchema).min(1),
  /** How strongly the summed relief is lit (light from the top left), 0 = flat. */
  shading: z.number().min(0).max(4).default(1),
  /** Soft darkening in the grooves of the relief. */
  occlusion: z.number().min(0).max(2).default(0.5),
})
export type MaterialDef = z.infer<typeof MaterialSchema>
