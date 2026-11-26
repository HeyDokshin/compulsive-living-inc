import { DoubleSide, MeshLambertMaterial, type Texture } from 'three'
import { stylize, styleUniforms } from './style'

/**
 * Materials of the rounded island (no pixel textures):
 * - ground: vertex colors (block colors, lawn patches, crease shade) and, close up, the light and
 *   shade of procedural materials (grass blades, rock, sand…) mapped from three sides in world
 *   space from a detail atlas; mipmaps fade it out with distance;
 * - water: a soft color with moving glints and lighter edges, all in the shader.
 */

export const terrainUniforms = {
  uDetailAtlas: { value: null as Texture | null },
  /** Columns and rows of the detail atlas. */
  uDetailGrid: { value: [4, 2] as [number, number] },
  /** How strongly material detail shows (0…1). */
  uDetailStrength: { value: 0.75 },
  /** Material tiles per block. */
  uDetailScale: { value: 0.5 },
  /** Linear colors of the water (deep and shallow parts of the swell). */
  uWaterDeep: { value: [0.09, 0.42, 0.62] as [number, number, number] },
  uWaterShallow: { value: [0.3, 0.75, 0.82] as [number, number, number] },
  /** Progress (0…1) of the dissolve being drawn; set per mesh just before it is drawn. */
  uDissolve: { value: 0 },
}

/**
 * Edited ground does not jump: the new shape dissolves in pixel by pixel while the old one dissolves
 * out over the very same pixels (one screen-space noise, complementary thresholds), so the surface
 * is never doubled or holed.
 */
export type Dissolve = 'in' | 'out'

const DECLS = `
uniform sampler2D uDetailAtlas;
uniform vec2 uDetailGrid;
uniform float uDetailStrength;
uniform float uDetailScale;
varying float vDetail;
varying vec3 vWPos;
varying vec3 vWNormal;
vec3 detailTap(vec2 p, vec2 tile) {
  // inside one atlas tile, with gradients of the continuous coordinate (no seams where it wraps)
  vec2 cell = 1.0 / uDetailGrid;
  vec2 uv = (tile + 0.02 + fract(p) * 0.96) * cell;
  return textureGrad(uDetailAtlas, uv, dFdx(p) * cell * 0.96, dFdy(p) * cell * 0.96).rgb;
}
`

export function createTerrainMaterial(dissolve?: Dissolve): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({ vertexColors: true })
  const cut = dissolve
    ? `{
        float h = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
        if (${dissolve === 'in' ? 'h >= uDissolve' : 'h < uDissolve'}) discard;
      }
`
    : ''
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, terrainUniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float detail;\nvarying float vDetail;\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvDetail = detail;\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;\nvWNormal = normal;',
      )
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uDissolve;\n' + DECLS).replace(
      '#include <color_fragment>',
      `${cut}#include <color_fragment>
      if (vDetail > -0.5 && uDetailStrength > 0.0) {
        float slot = floor(vDetail + 0.5);
        vec2 tile = vec2(mod(slot, uDetailGrid.x), floor(slot / uDetailGrid.x));
        vec3 w = pow(abs(normalize(vWNormal)), vec3(4.0));
        w /= (w.x + w.y + w.z + 1e-5);
        vec3 p = vWPos * uDetailScale;
        vec3 d = detailTap(p.zy, tile) * w.x + detailTap(p.xz, tile) * w.y + detailTap(p.xy, tile) * w.z;
        diffuseColor.rgb *= mix(vec3(1.0), d * 2.0, uDetailStrength);
      }`,
    )
  }
  mat.customProgramCacheKey = () => 'terrain-round' + (dissolve ?? '')
  return stylize(mat)
}

export function createWaterMaterial(opacity: number): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false, side: DoubleSide })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, terrainUniforms, { uTime: styleUniforms.uTime })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;\nvWNormal = normal;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uWaterDeep;
        uniform vec3 uWaterShallow;
        uniform float uTime;
        varying vec3 vWPos;
        varying vec3 vWNormal;
        float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float wNoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 q = vWPos.xz;
          float t = uTime;
          // slow soft swell, two layers drifting apart
          float swell = wNoise(q * 0.35 + vec2(t * 0.05, t * 0.03)) * 0.6 + wNoise(q * 0.9 - vec2(t * 0.07, -t * 0.04)) * 0.4;
          vec3 col = mix(uWaterDeep, uWaterShallow, smoothstep(0.25, 0.85, swell));
          // little glints that come and go
          float g = wNoise(q * 3.2 + vec2(t * 0.6, t * 0.35)) * wNoise(q * 2.3 - vec2(t * 0.4, t * 0.5));
          col += vec3(1.0) * smoothstep(0.42, 0.6, g) * 0.35 * step(0.5, vWNormal.y);
          // falls and banks: a lighter, foamy face
          col = mix(col, vec3(0.92, 0.98, 1.0), (1.0 - smoothstep(0.3, 0.8, vWNormal.y)) * 0.45);
          diffuseColor.rgb *= col;
        }`,
      )
  }
  mat.customProgramCacheKey = () => 'water-round'
  return stylize(mat)
}
