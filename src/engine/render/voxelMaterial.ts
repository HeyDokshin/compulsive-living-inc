import { MeshLambertMaterial, type Texture } from 'three'
import { detailUniforms } from './AtlasDetail'
import { stylize } from './style'

const DETAIL_DECLS = `
uniform sampler2D uDetail;
uniform float uDetailW;
uniform float uDetailRes;
uniform sampler2D uDetailPrev;
uniform float uDetailPrevW;
uniform float uDetailPrevRes;
`

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
    Object.assign(shader.uniforms, detailUniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 tile;\nvarying vec4 vTile;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTile = tile;')
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vTile;\n' + DETAIL_DECLS).replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
          vec2 tileUv = fract(vMapUv);
          // keep half a texel away from tile borders so neighbours never bleed in
          vec2 texel = vTile.zw / 16.0 * 0.5;
          vec4 texColor = texture2D(map, vTile.xy + texel + tileUv * (vTile.zw - 2.0 * texel));
          // close up: finer atlases fade in over the pixel one (AtlasDetail)
          if (uDetailPrevW > 0.0) {
            vec2 tp = vTile.zw / uDetailPrevRes * 0.5;
            texColor = mix(texColor, texture2D(uDetailPrev, vTile.xy + tp + tileUv * (vTile.zw - 2.0 * tp)), uDetailPrevW);
          }
          if (uDetailW > 0.0) {
            vec2 td = vTile.zw / uDetailRes * 0.5;
            texColor = mix(texColor, texture2D(uDetail, vTile.xy + td + tileUv * (vTile.zw - 2.0 * td)), uDetailW);
          }
          diffuseColor *= texColor;
        #endif`,
    )
  }
  mat.customProgramCacheKey = () => 'voxel-atlas'
  return stylize(mat, { flowUv: !!opts.transparent })
}
