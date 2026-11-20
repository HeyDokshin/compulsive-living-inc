import { MathUtils, OrthographicCamera, Vector3 } from 'three'
import type { EngineConfig } from '../engineConfig'

/**
 * Orthographic isometric camera.
 * Yaw snaps in 90° steps (starting at 45°) and animates smoothly; zoom scales the ortho frustum.
 */
export class IsoCamera {
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, -500, 1000)
  readonly target = new Vector3(0, 0, 0)
  /** Which of the 4 views (0..3). */
  quarter = 0
  private yaw = 45
  private aspect = 1
  /** Displayed zoom, easing towards `cfg.zoom`. */
  private zoomNow = 0

  constructor(private cfg: EngineConfig['camera']) {}

  /** Zoom actually shown right now (eases towards the configured one). */
  get currentZoom(): number {
    return this.zoomNow || this.cfg.zoom
  }

  get targetYaw(): number {
    return 45 + this.quarter * 90
  }

  /** Horizontal direction the camera looks along (unit XZ). */
  forwardXZ(): { x: number; z: number } {
    const yaw = MathUtils.degToRad(this.yaw)
    return { x: -Math.sin(yaw), z: -Math.cos(yaw) }
  }

  rotate(steps: number): void {
    this.quarter += steps
  }

  zoomBy(wheelDelta: number): void {
    const c = this.cfg
    c.zoom = MathUtils.clamp(c.zoom * Math.exp(-wheelDelta * c.zoomSpeed), c.minZoom, c.maxZoom)
  }

  /** Screen-relative movement → world XZ (for panning or "up = away from camera" controls). */
  screenToWorldDir(right: number, up: number, out = new Vector3()): Vector3 {
    const yaw = MathUtils.degToRad(this.yaw)
    // forward = direction the camera looks, projected on the ground
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    out.set(fx * up + -fz * right, 0, fz * up + fx * right)
    return out
  }

  resize(width: number, height: number): void {
    this.aspect = width / Math.max(1, height)
  }

  update(dt: number): void {
    const c = this.cfg
    const k = 1 - Math.exp(-c.rotateSmoothing * dt)
    this.yaw += (this.targetYaw - this.yaw) * k

    if (!this.zoomNow) this.zoomNow = c.zoom
    this.zoomNow *= Math.pow(c.zoom / this.zoomNow, 1 - Math.exp(-c.zoomSmoothing * dt))
    const half = c.viewSize / 2 / this.zoomNow
    this.camera.left = -half * this.aspect
    this.camera.right = half * this.aspect
    this.camera.top = half
    this.camera.bottom = -half
    this.camera.updateProjectionMatrix()

    const yaw = MathUtils.degToRad(this.yaw)
    const pitch = MathUtils.degToRad(c.pitch)
    const dist = 200
    this.camera.position.set(
      this.target.x + dist * Math.cos(pitch) * Math.sin(yaw),
      this.target.y + dist * Math.sin(pitch),
      this.target.z + dist * Math.cos(pitch) * Math.cos(yaw),
    )
    this.camera.lookAt(this.target)
  }
}
