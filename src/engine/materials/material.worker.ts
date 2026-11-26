import { renderMaterial } from './generate'
import type { MaterialDef } from './schema'

export interface MaterialRequest {
  id: number
  def: MaterialDef
  size: number
}
export interface MaterialResponse {
  id: number
  pixels?: Uint8ClampedArray
  error?: string
}

self.onmessage = (e: MessageEvent<MaterialRequest>) => {
  const { id, def, size } = e.data
  try {
    const pixels = renderMaterial(def, size)
    ;(self as unknown as Worker).postMessage({ id, pixels } satisfies MaterialResponse, [pixels.buffer as ArrayBuffer])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: String(err) } satisfies MaterialResponse)
  }
}
