/** Shovel terraforming rules (pure, tested in tests/house.test.ts). */

export interface TerraformLimits {
  /** How far above / below its original height a column may go. */
  maxUp: number
  maxDown: number
  /** Never stand higher than this (the world's top level). */
  maxHeight: number
  /** Never this low or lower (keeps the ground level). */
  minHeight: number
}

/**
 * What the shovel's second action does to a column: a column standing higher than you is dug down
 * ("lower"); one level with you or lower gets a block on top ("raise"). `stand` = where one would
 * stand on the column (top solid + 1), `original` = that height on the freshly generated island.
 */
export function terraformOp(stand: number, actorY: number, original: number, lim: TerraformLimits): 'raise' | 'lower' | null {
  if (stand > Math.round(actorY)) {
    const after = stand - 1
    return after >= original - lim.maxDown && after > lim.minHeight ? 'lower' : null
  }
  const after = stand + 1
  return after <= original + lim.maxUp && after <= lim.maxHeight ? 'raise' : null
}
