import { HalfFloatType, Vector2, WebGLRenderTarget, type Camera, type Scene, type WebGLRenderer } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
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

/** Post-processing chain: scene (MSAA) → tilt-shift H/V → grade → tone mapping + sRGB output. */
export class PostFX {
  readonly composer: EffectComposer
  private tiltH: ShaderPass
  private tiltV: ShaderPass
  private grade: ShaderPass
  private size = new Vector2()

  constructor(
    private renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
  ) {
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4, stencilBuffer: true })
    this.composer = new EffectComposer(renderer, target)
    this.composer.addPass(new RenderPass(scene, camera))
    this.tiltH = new ShaderPass(HorizontalTiltShiftShader)
    this.tiltV = new ShaderPass(VerticalTiltShiftShader)
    this.grade = new ShaderPass(GradeShader)
    this.composer.addPass(this.tiltH)
    this.composer.addPass(this.tiltV)
    this.composer.addPass(this.grade)
    this.composer.addPass(new OutputPass())
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio)
    this.composer.setSize(width, height)
    this.size.set(width, height)
    this.grade.uniforms.aspect!.value.set(width / Math.max(1, Math.max(width, height)), height / Math.max(1, Math.max(width, height)))
  }

  apply(style: EngineConfig['style']): void {
    const tilt = style.tiltShift
    this.tiltH.enabled = this.tiltV.enabled = tilt > 0
    this.tiltH.uniforms.h!.value = tilt / Math.max(1, this.size.x)
    this.tiltV.uniforms.v!.value = tilt / Math.max(1, this.size.y)
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
    this.composer.dispose()
  }
}
