import { meshChunk, type MeshInput, type MeshOutput } from './mesher'
import { meshChunkRound, type RoundInput } from './roundMesher'

/** Blocky (greedy) or rounded meshing of a chunk. */
export type MeshJob = ({ mode?: 'blocks' } & MeshInput) | ({ mode: 'round' } & RoundInput)

/** Mesh a job on whichever thread runs this. */
export function runMeshJob(input: MeshJob): MeshOutput {
  return input.mode === 'round' ? meshChunkRound(input) : meshChunk(input)
}
