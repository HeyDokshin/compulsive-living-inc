import { describe, expect, it } from 'vitest'
import * as sdk from '../src/sdk'

/**
 * What mods may import from '@sdk'. Adding is fine (add it here); taking something away or renaming
 * it breaks mods: then SDK_VERSION goes up and docs/06-modding.md says what changed.
 */
const PUBLIC = [
  'Fragment', 'JSON5', 'SDK_VERSION', 'batch', 'computed', 'deepMerge', 'definePlugin', 'downloadFile', 'effect', 'findPath', 'h', 'signal', 'ui',
  'useCallback', 'useComputed', 'useEffect', 'useMemo', 'useRef', 'useSignal', 'useState', 'voiceBlip', 'z',
]

describe('public SDK', () => {
  it('exports exactly the documented names', () => {
    expect(Object.keys(sdk).sort()).toEqual([...PUBLIC].sort())
  })
  it('offers the UI components mods use', () => {
    expect(Object.keys(sdk.ui)).toEqual(expect.arrayContaining(['AsyncIcon', 'Button', 'Choices', 'Dialogue', 'Grid', 'ItemSlot', 'Key', 'Pill']))
  })
})
