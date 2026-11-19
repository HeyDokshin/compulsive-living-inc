import { describe, expect, it } from 'vitest'
import { parseArgs } from '../src/engine/debug/Console'

describe('parseArgs', () => {
  it('splits and honors quotes', () => {
    expect(parseArgs(`config hello name "big tree" 'x y'`)).toEqual(['config', 'hello', 'name', 'big tree', 'x y'])
  })
})
