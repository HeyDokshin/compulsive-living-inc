/**
 * Quiet patterns behind UI text: small motifs a shade darker (or, on colored buttons, lighter)
 * than the panel, tiled under the content. Each is a tiny SVG tile, so they stay sharp at any zoom.
 */

export const UI_PATTERNS = ['dots', 'stars', 'hearts', 'flowers', 'waves', 'checks', 'sprinkles', 'leaves'] as const
export type UiPattern = (typeof UI_PATTERNS)[number]

/** One tile's shapes (24×24 units) in `currentColor`-free form: `F` is replaced by the fill. */
const TILES: Record<UiPattern, { size: number; svg: string }> = {
  dots: { size: 22, svg: '<circle cx="5.5" cy="5.5" r="1.9" fill="F"/><circle cx="16.5" cy="16.5" r="1.9" fill="F"/>' },
  stars: {
    size: 34,
    svg:
      '<path d="M8 3.2l1.5 3.1 3.4.5-2.5 2.4.6 3.4L8 11l-3 1.6.6-3.4-2.5-2.4 3.4-.5z" fill="F"/>' +
      '<circle cx="25" cy="25" r="1.6" fill="F"/><circle cx="27" cy="9" r="1" fill="F"/>',
  },
  hearts: {
    size: 30,
    svg:
      '<path d="M7.5 12.5s-5-3-5-6.2A2.6 2.6 0 0 1 7.5 5a2.6 2.6 0 0 1 5 1.3c0 3.2-5 6.2-5 6.2z" fill="F"/>' +
      '<path d="M22.5 27.5s-4-2.4-4-5a2.1 2.1 0 0 1 4-1 2.1 2.1 0 0 1 4 1c0 2.6-4 5-4 5z" fill="F"/>',
  },
  flowers: {
    size: 36,
    svg:
      '<g fill="F"><circle cx="9" cy="5.6" r="2.6"/><circle cx="12.4" cy="9" r="2.6"/><circle cx="9" cy="12.4" r="2.6"/><circle cx="5.6" cy="9" r="2.6"/></g>' +
      '<circle cx="27" cy="27" r="1.8" fill="F"/>',
  },
  waves: {
    size: 28,
    svg: '<path d="M0 8q3.5-4 7 0t7 0 7 0 7 0M0 22q3.5-4 7 0t7 0 7 0 7 0" fill="none" stroke="F" stroke-width="1.6" stroke-linecap="round"/>',
  },
  checks: { size: 28, svg: '<rect x="0" y="0" width="14" height="14" rx="3" fill="F"/><rect x="14" y="14" width="14" height="14" rx="3" fill="F"/>' },
  sprinkles: {
    size: 32,
    svg:
      '<g stroke="F" stroke-width="2" stroke-linecap="round"><path d="M5 6l3 2"/><path d="M20 4l-1 3.5"/><path d="M26 17l3 1"/>' +
      '<path d="M11 19l-2 3"/><path d="M18 27l3-1.5"/><path d="M3 28l1.5 1"/></g>',
  },
  leaves: {
    size: 34,
    svg: '<path d="M6 13C6 7 10 4 14 4c0 5-3 9-8 9z" fill="F"/><path d="M24 30c-1-4 1-7 5-8 1 4-1 7-5 8z" fill="F"/>',
  },
}

/** The tile as a CSS `url(...)` in this color. */
export function patternUrl(p: UiPattern, color: string): string {
  const t = TILES[p]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${t.size}" height="${t.size}" viewBox="0 0 ${t.size} ${t.size}">${t.svg.replaceAll('F', color)}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/** A stable pattern for a window id (each window keeps its own). */
export function patternFor(id: string): UiPattern {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return UI_PATTERNS[(h >>> 0) % UI_PATTERNS.length]!
}

/** CSS variables for every pattern: `--ui-pat-<name>` (darker) and `--ui-pat-<name>-light` (lighter). */
export function patternCss(dark: string, light: string): string {
  let vars = ':root {\n'
  for (const p of UI_PATTERNS) vars += `  --ui-pat-${p}: ${patternUrl(p, dark)};\n  --ui-pat-${p}-light: ${patternUrl(p, light)};\n`
  vars += '  --ui-pat: var(--ui-pat-dots);\n}\n'
  for (const p of UI_PATTERNS) vars += `[data-pattern='${p}'] { --ui-pat: var(--ui-pat-${p}); }\n`
  return vars
}

/**
 * Wavy panel edges without SVG filters (those leave noise behind in some browsers): a 120×120
 * rounded square with one soft wave per 40-unit edge piece, used as a 9-slice mask — corners stay
 * round, edges repeat whole waves whatever the panel's size.
 */
export function waveMask(): string {
  const a = 6 // inset of the edge line
  const w = 3 // wave height
  const path =
    `M${a},40 C${a},20 20,${a} 40,${a} Q50,${a - w * 2} 60,${a} T80,${a} ` +
    `C100,${a} ${120 - a},20 ${120 - a},40 Q${120 - a + w * 2},50 ${120 - a},60 T${120 - a},80 ` +
    `C${120 - a},100 100,${120 - a} 80,${120 - a} Q70,${120 - a + w * 2} 60,${120 - a} T40,${120 - a} ` +
    `C20,${120 - a} ${a},100 ${a},80 Q${a - w * 2},70 ${a},60 T${a},40 Z`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><path d="${path}" fill="#000"/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}
