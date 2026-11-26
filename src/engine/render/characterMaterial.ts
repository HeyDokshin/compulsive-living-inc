import { AlwaysStencilFunc, MeshLambertMaterial, ReplaceStencilOp, Vector4, type Texture } from 'three'
import { stylize } from './style'

/**
 * Materials for round characters:
 * - the body: soft Lambert with vertex colors and a gentle rim light (plush, never plastic);
 * - fur and hair: the same surface drawn again as thin shells pushed out along the normals, each
 *   shell keeping only the cross-sections of strands (a 3D strand pattern), so a few shells read as
 *   real fluff; strands droop with gravity, sway a little and are darker at the roots;
 * - a face: a 2D picture (eyes, brows, mouth — drawn by a plugin) projected onto the front of the head,
 *   so expressions are crisp at any zoom and follow the round surface.
 */

/** Shared by every character material: updated once a frame by the model library. */
export const furUniforms = {
  /** Shells actually drawn (fewer when the camera is far). */
  uFurShells: { value: 0 },
  /** 0…1: fur grows in as the camera comes closer, so detail never pops. */
  uFurFade: { value: 0 },
}

export interface FurLook {
  /** Strand length (voxels). */
  length: number
  /** Strands per voxel along each axis. */
  density: number
  /** How much the tips hang down (0 = straight out). */
  droop: number
  /** Thickness of a strand at its root (0…1 of its cell). */
  thickness: number
}

/** A face picture on the front of a head (voxel units, relative to the part's pivot). */
export interface FaceUniforms {
  uFace: { value: Texture | null }
  /** Center x, y and size w, h of the face area on the front. */
  uFaceRect: { value: Vector4 }
  /** Surfaces in front of this z (pointing forward) get the face. */
  uFaceFront: { value: number }
  uFaceOn: { value: number }
}

export function createFaceUniforms(cx: number, cy: number, w: number, h: number, front: number): FaceUniforms {
  return {
    uFace: { value: null },
    uFaceRect: { value: new Vector4(cx, cy, w, h) },
    uFaceFront: { value: front },
    uFaceOn: { value: 0 },
  }
}

const FACE_DECLS = `
uniform sampler2D uFace;
uniform vec4 uFaceRect;
uniform float uFaceFront;
uniform float uFaceOn;
varying vec3 vObjPos;
varying vec3 vObjNormal;
`
/** Alpha of the face picture at this point of the surface (0 off the face). Sets `faceColor`. */
const FACE_SAMPLE = `
  vec4 faceColor = vec4(0.0);
  if (uFaceOn > 0.5 && vObjNormal.z > 0.15 && vObjPos.z > uFaceFront) {
    vec2 fuv = (vObjPos.xy - uFaceRect.xy) / uFaceRect.zw + 0.5;
    if (fuv.x > 0.0 && fuv.x < 1.0 && fuv.y > 0.0 && fuv.y < 1.0) {
      faceColor = texture2D(uFace, fuv);
      // fade out where the head turns away from the front
      faceColor.a *= smoothstep(0.15, 0.45, vObjNormal.z);
    }
  }
`

/** Soft rim light (plush look): brighter where the surface turns away from the camera. */
const RIM = `
  {
    vec3 rimN = normalize(vNormal);
    vec3 rimV = normalize(vViewPosition);
    float rim = pow(1.0 - clamp(dot(rimN, rimV), 0.0, 1.0), 2.5);
    outgoingLight += diffuseColor.rgb * rim * 0.28;
  }
`

/** The body of a round character; with `face`, the face picture is painted on it. */
export function createCharacterMaterial(face?: FaceUniforms): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({ vertexColors: true })
  mat.onBeforeCompile = (shader) => {
    if (face) Object.assign(shader.uniforms, face)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + (face ? 'varying vec3 vObjPos;\nvarying vec3 vObjNormal;' : ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + (face ? 'vObjPos = position; vObjNormal = normal;' : ''))
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + (face ? FACE_DECLS : ''))
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n' + (face ? FACE_SAMPLE + 'diffuseColor.rgb = mix(diffuseColor.rgb, faceColor.rgb, faceColor.a);' : ''),
      )
      .replace('#include <opaque_fragment>', RIM + '#include <opaque_fragment>')
  }
  mat.customProgramCacheKey = () => `character:${face ? 'face' : 'plain'}`
  return stylize(mat)
}

/**
 * Fur shells over a character part (drawn as instances: instance i = shell i + 1). The geometry
 * needs a `fur` attribute (0…1 per vertex: how much fur grows there).
 */
export function createFurMaterial(look: FurLook, face?: FaceUniforms): MeshLambertMaterial {
  // writes the stencil like the body does: fur covering the body must not count as "the body is
  // hidden", or see-through silhouettes would shine between the strands
  const mat = new MeshLambertMaterial({
    vertexColors: true,
    stencilWrite: true,
    stencilRef: 1,
    stencilFunc: AlwaysStencilFunc,
    stencilZPass: ReplaceStencilOp,
  })
  const own = {
    uFurLength: { value: look.length },
    uFurDensity: { value: look.density },
    uFurDroop: { value: look.droop },
    uFurThick: { value: look.thickness },
  }
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, furUniforms, own)
    if (face) Object.assign(shader.uniforms, face)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float fur;
        uniform float uFurShells;
        uniform float uFurFade;
        uniform float uFurLength;
        uniform float uFurDroop;
        varying float vShell;
        varying float vFur;
        varying vec3 vFurPos;
        varying vec3 vObjPos;
        varying vec3 vObjNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float shell = (float(gl_InstanceID) + 1.0) / max(uFurShells, 1.0);
          vShell = shell;
          vFur = fur;
          vFurPos = position;
          vObjPos = position;
          vObjNormal = normal;
          float len = uFurLength * fur * uFurFade;
          // "down" in the part's own space: tips hang under gravity whatever the pose
          vec3 down = normalize(transpose(mat3(modelMatrix)) * vec3(0.0, -1.0, 0.0));
          float ph = uTime * 1.7 + position.x * 0.9 + position.z * 0.7;
          vec3 sway = vec3(sin(ph), 0.0, cos(ph * 0.8)) * 0.12;
          transformed += normal * shell * len + (down * uFurDroop + sway) * shell * shell * len;
        }`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uFurDensity;
        uniform float uFurThick;
        varying float vShell;
        varying float vFur;
        varying vec3 vFurPos;
        ${face ? FACE_DECLS : 'varying vec3 vObjPos;\nvarying vec3 vObjNormal;'}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          if (vShell > vFur) discard;
          // one strand per cell of a 3D grid over the surface (sampled at the root, so a strand
          // is the same column through every shell)
          vec3 q = vFurPos * uFurDensity;
          vec3 cell = floor(q);
          vec3 h = fract(sin(vec3(dot(cell, vec3(127.1, 311.7, 74.7)), dot(cell, vec3(269.5, 183.3, 246.1)), dot(cell, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
          float d = length(fract(q) - (0.25 + 0.5 * h));
          float r = uFurThick * (1.0 - vShell / max(vFur, 0.001)) * (0.75 + 0.5 * h.x);
          if (d > r) discard;
          ${face ? FACE_SAMPLE + 'if (faceColor.a > 0.25) discard;' : ''}
          // darker at the roots, a little sheen at the tips
          diffuseColor.rgb *= mix(0.62, 1.12, vShell) * (0.92 + 0.16 * h.y);
        }`,
      )
      .replace('#include <opaque_fragment>', RIM + '#include <opaque_fragment>')
  }
  mat.customProgramCacheKey = () => `fur:${face ? 'face' : 'plain'}`
  return stylize(mat)
}
