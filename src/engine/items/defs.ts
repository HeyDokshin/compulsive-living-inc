import { z } from 'zod'

/**
 * An item that can sit in pockets or on the ground. Data-only: what it *does* comes from
 * interactions (`interactions` registry) that refer to it by id or tag.
 */
export const ItemDefSchema = z.looseObject({
  id: z.string(),
  tags: z.array(z.string()).optional(),
  name: z.string(),
  description: z.string().optional(),
  /** Max per pocket slot (tools: 1). */
  stack: z.number().int().min(1).max(999).default(10),
  /** Voxel model shown on the ground, in hands and as the icon. */
  model: z.string().optional(),
  /** Icon fallback when there is no model: a block cube or a colored dot. */
  icon: z
    .object({
      block: z.string().optional(),
      color: z.string().optional(),
      /** How a model becomes an icon: isometric voxels, or a flat tilted sprite (default: sprite for tall thin models). */
      style: z.enum(['iso', 'sprite']).optional(),
    })
    .optional(),
  /** Sell price (economy stage). */
  price: z.number().int().min(0).optional(),
})
export type ItemDef = z.infer<typeof ItemDefSchema>
