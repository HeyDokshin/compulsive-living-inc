/**
 * How many jars a hive has after a night. Pure, so it is easy to test.
 * @param {number} jars jars already in it
 * @param {number} flowers flowers around
 * @param {{ flowersPerJar: number, maxJars: number }} cfg
 */
export function afterNight(jars, flowers, cfg) {
  return Math.min(cfg.maxJars, jars + Math.floor(flowers / cfg.flowersPerJar))
}
