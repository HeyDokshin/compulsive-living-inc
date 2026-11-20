/** Today's goods (pure, tested in tests/crafting.test.ts). */

/** Integer hash → [0, 1). */
function hash01(seed: number, day: number, salt: string, i: number): number {
  let h = (seed ^ Math.imul(day, 0x9e3779b1)) >>> 0
  for (let k = 0; k < salt.length; k++) h = Math.imul(h ^ salt.charCodeAt(k), 16777619) >>> 0
  h = Math.imul(h ^ i, 0x5bd1e995) >>> 0
  h ^= h >>> 15
  return h / 4294967296
}

/** `n` distinct entries of `pool` for a day, the same all day long (and for the same island). */
export function pickDaily<T>(pool: readonly T[], n: number, seed: number, day: number, salt: string): T[] {
  const order = pool.map((item, i) => ({ item, r: hash01(seed, day, salt, i) }))
  order.sort((a, b) => a.r - b.r)
  return order.slice(0, Math.min(n, pool.length)).map((o) => o.item)
}
