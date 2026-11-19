/** Not a registry entry: empty space. */
export const AIR = 'air'

/**
 * Maps block ids (`core:grass`) to compact numbers stored in chunks.
 * Numbers are assigned on first use and never reassigned, so adding/removing mods
 * never scrambles a world. 0 is always air. Saves will store this table.
 */
export class BlockPalette {
  private toNum = new Map<string, number>([[AIR, 0]])
  private toId: string[] = [AIR]

  num(id: string): number {
    let n = this.toNum.get(id)
    if (n === undefined) {
      n = this.toId.length
      if (n > 0xffff) throw new Error('Block palette overflow (65535 block types)')
      this.toNum.set(id, n)
      this.toId.push(id)
    }
    return n
  }

  /** Number for an id, without assigning a new one. */
  peek(id: string): number | undefined {
    return this.toNum.get(id)
  }

  id(num: number): string {
    return this.toId[num] ?? AIR
  }

  get size(): number {
    return this.toId.length
  }

  entries(): string[] {
    return [...this.toId]
  }

  /** Restore from a save (keeps numbers stable). */
  load(ids: string[]): void {
    if (ids[0] !== AIR) throw new Error('Palette must start with air')
    this.toId = [...ids]
    this.toNum = new Map(ids.map((id, i) => [id, i]))
  }
}
