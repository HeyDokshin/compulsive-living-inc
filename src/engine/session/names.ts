/** Names and seeds typed by the player. */
export const MAX_NAME = 20

/** Trim, collapse spaces, cut to `MAX_NAME`. */
export function cleanName(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME).trim()
}

/** A whole number is the seed itself, any other text is hashed (FNV-1a); empty = no seed chosen. */
export function parseSeed(text: string): number | undefined {
  const t = text.trim()
  if (!t) return undefined
  if (/^\d{1,9}$/.test(t)) return Number(t)
  let h = 0x811c9dc5
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193)
  return (h >>> 0) % 2 ** 31
}
