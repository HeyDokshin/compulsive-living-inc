import { z } from 'zod'

const Vec3 = z.tuple([z.number(), z.number(), z.number()])

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
  scale: z.number().positive().default(1 / 12),
  /** Origin in voxel units; default: bottom center. */
  pivot: Vec3.optional(),
})
export type ModelDef = z.infer<typeof ModelDefSchema>

/** A character or object made of several voxel models that can be animated part by part. */
export const RigDefSchema = z.looseObject({
  id: z.string(),
  tags: z.array(z.string()).optional(),
  scale: z.number().positive().default(1 / 12),
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
