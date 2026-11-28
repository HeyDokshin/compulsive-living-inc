import { z } from 'zod'

const Vec3 = z.tuple([z.number(), z.number(), z.number()])

/** Smooth, rounded meshing instead of blocks (see smoothMesh). */
const RoundSchema = z.object({
  /** Fine samples per voxel (1 = low-poly round, 3 = smooth). */
  subdiv: z.number().int().min(1).max(4).default(3),
  /** How round: blur passes. */
  smooth: z.number().int().min(0).max(4).default(2),
  /** Lower keeps thin parts (ears) fuller. */
  iso: z.number().min(0.2).max(0.8).default(0.42),
  /** A voxel's middle stays at least this dense (odd subdiv), so nothing thin vanishes. */
  keep: z.number().min(0).max(1).optional(),
})

/**
 * A voxel model. Either drawn in data with `layers` (bottom → top; each layer is rows from back (-z)
 * to front (+z); each row is characters left (-x) → right (+x); `.` or space = empty), with `palette`
 * mapping characters to colors — or loaded from a MagicaVoxel `.vox` file (`url`; files in
 * content/<pack>/models/ are registered automatically). Front of a model = +z.
 */
export const ModelDefSchema = z.looseObject({
  id: z.string(),
  tags: z.array(z.string()).optional(),
  url: z.string().optional(),
  layers: z.array(z.array(z.string())).optional(),
  palette: z.record(z.string(), z.string()).default({}),
  /** World units per voxel (1/12 → 12 voxels per block). */
  scale: z
    .number()
    .positive()
    .default(1 / 12),
  /** Origin in voxel units; default: bottom center. */
  pivot: Vec3.optional(),
  /** Draw smooth and rounded instead of blocky (trees, rocks, bushes). */
  round: RoundSchema.optional(),
  /**
   * How the model is built (when it isn't `round`): 'auto' — bevelled boxes for angular things
   * (furniture, crates, buildings), softly rounded for round ones with many small boxes (pots, vases,
   * lamps); 'bevel' / 'blocks' force one. `render.models` in the engine config sets the defaults.
   */
  style: z.enum(['auto', 'bevel', 'blocks']).default('auto'),
  /**
   * Parts: palette characters drawn as one piece (merged boxes, the first character's color), e.g.
   * `{ seat: 'pP' }`. Without it neighbouring shades of one material merge by themselves.
   */
  parts: z.record(z.string(), z.string()).optional(),
  /**
   * Fur or hair on round rigs: how much grows on each palette character (0…1), how long and how
   * dense. Far away it fades out; close up it is drawn strand by strand (shells).
   */
  fur: z
    .object({
      keys: z.record(z.string(), z.number().min(0).max(1)),
      /** Strand length in voxels. */
      length: z.number().min(0.05).max(6).default(0.9),
      /** Strands per voxel. */
      density: z.number().min(0.5).max(16).default(5),
      /** How much the tips hang down (hair more, short fur less). */
      droop: z.number().min(0).max(3).default(0.4),
      thickness: z.number().min(0.05).max(0.6).default(0.42),
    })
    .optional(),
  /**
   * Fabric on round rigs: palette character → procedural material (the `materials` registry) whose
   * weave shows on it close up, over the painted color (recolored clothes keep their color). At most
   * three materials per model.
   */
  fabric: z
    .object({
      keys: z.record(z.string(), z.string()),
      /** Voxels one tile of the material covers. */
      tile: z.number().min(0.25).max(64).default(4),
      /** How strongly the weave shows (0…1). */
      strength: z.number().min(0).max(1).default(0.7),
      /** Shown at every distance (leaves), not only close up (clothes). */
      always: z.boolean().default(false),
    })
    .optional(),
  /**
   * A drawn face on round rigs (expressions, blinking, talking — the `faces` plugin): where it sits on the
   * front of this model, which painted voxels it replaces, and its look.
   */
  face: z
    .looseObject({
      /** Middle of the face on the front, voxel units from the model's min corner (x, y). */
      center: z.tuple([z.number(), z.number()]),
      /** Width and height of the face area (voxels). */
      size: z.tuple([z.number(), z.number()]).default([7, 5]),
      /** Front surface z (voxels from the min corner); the face lies on surfaces in front of it. */
      front: z.number(),
      /** Painted features the drawn face takes over: palette character → character whose color it gets. */
      erase: z.record(z.string(), z.string()).default({}),
      /** Look of the face (eyes, brows, mouth…) — read by the faces plugin. */
      style: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    })
    .optional(),
})
export type ModelDef = z.infer<typeof ModelDefSchema>

/** A character or object made of several voxel models that can be animated part by part. */
export const RigDefSchema = z.looseObject({
  id: z.string(),
  tags: z.array(z.string()).optional(),
  scale: z
    .number()
    .positive()
    .default(1 / 12),
  /** Draw the parts as smooth, rounded shapes instead of blocks (characters, trees); see smoothMesh. */
  round: RoundSchema.optional(),
  parts: z.array(
    z.object({
      /** Animations find parts by name (legL, legR, armL, armR, body, head…). */
      name: z.string(),
      model: z.string(),
      /** Rotation point inside the model, voxel units from its min corner. */
      pivot: Vec3,
      /** Where the pivot sits in rig space (voxel units; y up, feet at 0, front = +z). */
      at: Vec3,
      /** Parent part name (default: rig root). */
      parent: z.string().optional(),
    }),
  ),
})
export type RigDef = z.infer<typeof RigDefSchema>
