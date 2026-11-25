import { HalfFloatType, Vector2, WebGLRenderTarget, type Camera, type Scene, type WebGLRenderer } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { HorizontalTiltShiftShader } from 'three/examples/jsm/shaders/HorizontalTiltShiftShader.js'
import { VerticalTiltShiftShader } from 'three/examples/jsm/shaders/VerticalTiltShiftShader.js'
import type { EngineConfig } from '../engineConfig'

/** Soft color grade in linear space: saturation, contrast, warmth, lifted blacks, vignette. */
const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1 },
    contrast: { value: 1 },
    warmth: { value: 0 },
    lift: { value: 0 },
    vignette: { value: 0 },
    aspect: { value: new Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation, contrast, warmth, lift, vignette;
    uniform vec2 aspect;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      col = (col - 0.18) * contrast + 0.18;
      col *= vec3(1.0 + warmth * 0.08, 1.0 + warmth * 0.025, 1.0 - warmth * 0.07);
      col = lift * vec3(0.95, 0.93, 1.0) + col * (1.0 - lift);
      vec2 d = (vUv - 0.5) * aspect;
      float v = smoothstep(0.95, 0.2, length(d));
      col *= mix(1.0, v, vignette);
      gl_FragColor = vec4(max(col, 0.0), c.a);
    }`,
}

/** Draws the scene into a target of its own: the only antialiased one, and the only one with depth and stencil. */
class ScenePass extends Pass {
  override needsSwap = false
  readonly target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4, stencilBuffer: true })

  constructor(
    private scene: Scene,
    private camera: Camera,
  ) {
    super()
  }

  override setSize(width: number, height: number): void {
    this.target.setSize(width, height)
  }

  override render(renderer: WebGLRenderer): void {
    renderer.setRenderTarget(this.target)
    renderer.render(this.scene, this.camera)
  }

  override dispose(): void {
    this.target.dispose()
  }
}

/** A full-screen effect; the first one of the chain reads the scene itself. */
class EffectPass extends ShaderPass {
  source: WebGLRenderTarget | null = null

  override render(renderer: WebGLRenderer, write: WebGLRenderTarget, read: WebGLRenderTarget, dt: number, mask: boolean): void {
    super.render(renderer, write, this.source ?? read, dt, mask)
  }
}

/**
 * Post-processing chain: scene (MSAA) → tilt-shift H/V → grade → tone mapping + sRGB output. Effects
 * go through plain targets: antialiasing flat full-screen pictures cost more than the scene did.
 */
export class PostFX {
  readonly composer: EffectComposer
  private scenePass: ScenePass
  private tiltH: EffectPass
  private tiltV: EffectPass
  private grade: EffectPass
  private size = new Vector2()

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    this.composer = new EffectComposer(renderer, new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false }))
    this.scenePass = new ScenePass(scene, camera)
    this.composer.addPass(this.scenePass)
    this.tiltH = new EffectPass(HorizontalTiltShiftShader)
    this.tiltV = new EffectPass(VerticalTiltShiftShader)
    this.grade = new EffectPass(GradeShader)
    this.composer.addPass(this.tiltH)
    this.composer.addPass(this.tiltV)
    this.composer.addPass(this.grade)
    this.composer.addPass(new OutputPass())
    this.tiltH.source = this.scenePass.target
  }

  /** Where the scene is drawn (materials are compiled for it). */
  get sceneTarget(): WebGLRenderTarget {
    return this.scenePass.target
  }

  /** MSAA samples of the scene (changing them reallocates its target). */
  setSamples(samples: number): void {
    const rt = this.scenePass.target
    if (rt.samples === samples) return
    rt.samples = samples
    rt.dispose()
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio)
    this.composer.setSize(width, height)
    this.size.set(width, height)
    this.grade.uniforms.aspect!.value.set(width / Math.max(1, Math.max(width, height)), height / Math.max(1, Math.max(width, height)))
  }

  private tilt = 0
  private tiltScale = 1

  /** 0..1 multiplier for the tilt-shift strength (the renderer lowers it in close-ups). Cheap: uniforms only. */
  setTiltScale(k: number): void {
    if (Math.abs(k - this.tiltScale) < 0.005) return
    this.tiltScale = k
    this.updateTilt()
  }

  private updateTilt(): void {
    const t = this.tilt * this.tiltScale
    this.tiltH.enabled = this.tiltV.enabled = t > 0.05
    this.grade.source = this.tiltH.enabled ? null : this.scenePass.target
    this.tiltH.uniforms.h!.value = t / Math.max(1, this.size.x)
    this.tiltV.uniforms.v!.value = t / Math.max(1, this.size.y)
  }

  apply(style: EngineConfig['style']): void {
    this.tilt = style.tiltShift
    this.updateTilt()
    this.tiltH.uniforms.r!.value = this.tiltV.uniforms.r!.value = style.tiltFocus
    const g = this.grade.uniforms
    g.saturation!.value = style.saturation
    g.contrast!.value = style.contrast
    g.warmth!.value = style.warmth
    g.lift!.value = style.lift
    g.vignette!.value = style.vignette
  }

  render(dt: number): void {
    this.composer.render(dt)
  }

  dispose(): void {
    this.scenePass.dispose()
    this.composer.dispose()
  }
}
