import { MeshLambertMaterial, type Texture } from 'three'

/**
 * Lambert material that samples a tile of the block atlas and repeats it across greedy-merged quads:
 * `uv` is in block units and `tile` is the atlas rect, so uv = rect.xy + fract(uv) * rect.zw.
 */
export function createVoxelMaterial(atlas: Texture, opts: { transparent?: boolean; opacity?: number } = {}): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({
    map: atlas,
    vertexColors: true,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    depthWrite: !opts.transparent,
  })
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 tile;\nvarying vec4 vTile;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTile = tile;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vTile;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          // keep half a texel away from tile borders so neighbours never bleed in
          vec2 texel = vTile.zw / 16.0 * 0.5;
          vec2 atlasUv = vTile.xy + texel + fract(vMapUv) * (vTile.zw - 2.0 * texel);
          diffuseColor *= texture2D(map, atlasUv);
        #endif`,
      )
  }
  mat.customProgramCacheKey = () => 'voxel-atlas'
  return mat
}
