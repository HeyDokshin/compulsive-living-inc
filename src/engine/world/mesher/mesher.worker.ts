import type { MeshOutput } from './mesher'
import { runMeshJob, type MeshJob } from './meshJob'

export interface MeshRequest {
  id: number
  input: MeshJob
}
export interface MeshResponse {
  id: number
  output?: MeshOutput
  error?: string
}

self.onmessage = (e: MessageEvent<MeshRequest>) => {
  const { id, input } = e.data
  try {
    const output = runMeshJob(input)
    const transfer = new Set<ArrayBuffer>()
    for (const part of [output.opaque, output.transparent]) {
      for (const arr of Object.values(part)) if (arr) transfer.add((arr as Float32Array).buffer as ArrayBuffer)
    }
    ;(self as unknown as Worker).postMessage({ id, output } satisfies MeshResponse, [...transfer])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: String(err) } satisfies MeshResponse)
  }
}
