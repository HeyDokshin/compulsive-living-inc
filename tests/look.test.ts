import { describe, expect, it } from 'vitest'
import { surfaceFor } from '../src/engine/models/ModelLibrary'
import { rareItemId } from '../src/plugins/decor/index'

describe('a generated surface for everything', () => {
  it('reads the surface from the paint', () => {
    expect(surfaceFor('#c99560')).toBe('core:wood')
    expect(surfaceFor('#b9bcc6')).toBe('core:stone')
    expect(surfaceFor('#fffaf0')).toBe('core:plaster')
    expect(surfaceFor('#7cc45e')).toBe('core:leaves')
    expect(surfaceFor('#f6bccb')).toBe('core:painted')
  })

  it('names rare pieces after the piece, the variant and the pattern', () => {
    expect(rareItemId('decor:bench', 'mint', 'decor:stars')).toBe('decor:bench_mint_rare_stars')
  })
})
