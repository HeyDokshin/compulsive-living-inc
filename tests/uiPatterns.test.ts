import { describe, expect, it } from 'vitest'
import { patternCss, patternFor, patternUrl, UI_PATTERNS } from '../src/engine/ui/patterns'

describe('ui patterns', () => {
  it('every pattern is a valid, encoded svg tile in its color', () => {
    for (const p of UI_PATTERNS) {
      const url = patternUrl(p, 'rgba(1, 2, 3, .1)')
      expect(url.startsWith('url("data:image/svg+xml,')).toBe(true)
      const svg = decodeURIComponent(url.slice(24, -2))
      expect(svg).toContain('rgba(1, 2, 3, .1)')
      expect(svg).not.toMatch(/"F"/)
      expect(url).not.toMatch(/[#<>]/)
    }
  })

  it('windows keep a stable pattern and the css names them all', () => {
    expect(patternFor('shop:main')).toBe(patternFor('shop:main'))
    expect(new Set(['a', 'b', 'shop', 'phone', 'craft', 'map', 'quests', 'museum'].map(patternFor)).size).toBeGreaterThan(2)
    const css = patternCss('#000', '#fff')
    for (const p of UI_PATTERNS) expect(css).toContain(`[data-pattern='${p}']`)
  })
})
