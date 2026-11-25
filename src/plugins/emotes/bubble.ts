/** Drawing bubbles over heads: an emoji, or a short line of speech. */
const W = 512
const FONT = '700 44px ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif'

/** Break a line into rows no wider than `max` (measured by `width`). */
export function wrapText(text: string, max: number, width: (s: string) => number): string[] {
  const rows: string[] = []
  let row = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = row ? `${row} ${word}` : word
    if (row && width(next) > max) {
      rows.push(row)
      row = word
    } else row = next
  }
  if (row) rows.push(row)
  return rows
}

function bubble(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.fillStyle = 'rgba(255,250,240,0.96)'
  g.strokeStyle = '#eadcc2'
  g.lineWidth = 4
  g.beginPath()
  g.roundRect(6, 6, w - 12, h - 34, 34)
  g.fill()
  g.stroke()
  // the tail
  g.beginPath()
  g.moveTo(w / 2 - 16, h - 30)
  g.lineTo(w / 2, h - 6)
  g.lineTo(w / 2 + 16, h - 30)
  g.fill()
  return g
}

export function glyphBubble(glyph: string): HTMLCanvasElement {
  const g = bubble(160, 176)
  g.font = '92px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#6b5a4e'
  g.fillText(glyph, 80, 78)
  return g.canvas
}

export function textBubble(text: string): HTMLCanvasElement {
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = FONT
  const rows = wrapText(text, W - 72, (s) => measure.measureText(s).width)
  const widest = Math.max(...rows.map((r) => measure.measureText(r).width))
  const g = bubble(Math.ceil(widest) + 72, rows.length * 54 + 74)
  g.font = FONT
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#6b5a4e'
  rows.forEach((r, i) => g.fillText(r, g.canvas.width / 2, 50 + i * 54))
  return g.canvas
}
