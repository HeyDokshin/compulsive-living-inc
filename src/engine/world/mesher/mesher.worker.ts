import { meshChunk, type MeshInput, type MeshOutput } from './mesher'

export interface MeshRequest {
  id: number
  input: MeshInput
}
export interface MeshResponse {
  id: number
  output?: MeshOutput
  error?: string
}

self.onmessage = (e: MessageEvent<MeshRequest>) => {
  const { id, input } = e.data
  try {
    const output = meshChunk(input)
    const transfer: ArrayBuffer[] = []
    for (const part of [output.opaque, output.transparent]) {
      for (const arr of Object.values(part)) transfer.push((arr as Float32Array).buffer as ArrayBuffer)
    }
    ;(self as unknown as Worker).postMessage({ id, output } satisfies MeshResponse, transfer)
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: String(err) } satisfies MeshResponse)
  }
}
