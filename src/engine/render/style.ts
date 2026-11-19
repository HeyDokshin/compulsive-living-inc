import { Vector2, Vector3, type Material } from 'three'

/**
 * Uniforms shared by every stylized material. Updating `.value` here updates all of them at once.
 * - uCurve: "rolling world" — the ground bends away from the camera focus, like a small planet
 * - uTime: drives water ripples and swaying plants
 */
export const styleUniforms = {
  uTime: { value: 0 },
  uCurve: { value: 0 },
  uCurveCenter: { value: new Vector3() },
  uCurveDir: { value: new Vector2(0, -1) },
  uWaterSpeed: { value: 1 },
}

export interface StyleOptions {
  /** Sway amplitude for plants (world units per unit of height). 0 = static. */
  sway?: number
  /** Scroll the texture over time (water). */
  flowUv?: boolean
}

const DECLS = `
uniform float uTime;
uniform float uCurve;
uniform vec3 uCurveCenter;
uniform vec2 uCurveDir;
uniform float uWaterSpeed;
`

/**
 * Make any three.js material follow the game's look (world curvature, optional sway / flowing UVs).
 * Chains with an existing `onBeforeCompile`. Shadows stay computed on the unbent world, which keeps
 * them glued to the surfaces they fall on.
 */
export function stylize<T extends Material>(material: T, opts: StyleOptions = {}): T {
  const prev = material.onBeforeCompile
  const prevKey = material.customProgramCacheKey.bind(material)
  const sway = opts.sway ?? 0
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer)
    Object.assign(shader.uniforms, styleUniforms)
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + DECLS)
    if (sway > 0) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 swayBase = vec3(0.0);
          #ifdef USE_INSTANCING
            swayBase = instanceMatrix[3].xyz;
          #endif
          float ph = uTime * 1.6 + swayBase.x * 0.37 + swayBase.z * 0.53;
          float k = max(transformed.y, 0.0) * ${sway.toFixed(4)};
          transformed.x += sin(ph) * k;
          transformed.z += cos(ph * 0.8) * k * 0.6;
        }`,
      )
    }
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      if (uCurve > 0.0) {
        vec4 cw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cw = instanceMatrix * cw;
        #endif
        cw = modelMatrix * cw;
        float dd = dot(cw.xz - uCurveCenter.xz, uCurveDir);
        cw.y -= uCurve * dd * dd;
        mvPosition = viewMatrix * cw;
        gl_Position = projectionMatrix * mvPosition;
      }`,
    )
    if (opts.flowUv) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + DECLS)
        .replace('fract(vMapUv)', 'fract(vMapUv + vec2(uTime * 0.045, uTime * 0.03) * uWaterSpeed)')
    }
  }
  material.customProgramCacheKey = () => `${prevKey()}|style:${sway}:${opts.flowUv ? 1 : 0}`
  material.needsUpdate = true
  return material
}
