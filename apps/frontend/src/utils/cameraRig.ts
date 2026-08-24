import * as THREE from 'three';
import type { SwipeDirection, ZoomDirection } from './gestures';

/** |camera.x| and |camera.y| clamp (world units) for panning. */
export const RIG_PAN_LIMIT = 4;

/** Nearest the camera may dolly toward the origin (dolly-in limit, camera z). */
export const RIG_ZOOM_MIN = 2;

/** Farthest the camera may dolly away (dolly-out limit, camera z). */
export const RIG_ZOOM_MAX = 12;

/** The camera's home z (boot pose): reset() restores (0, 0, RIG_HOME_Z). */
export const RIG_HOME_Z = 5;

/** World units of camera pan per swipe event at intensity 1. */
export const SWIPE_PAN_STEP = 0.5;

/** World units of camera z per zoom event at intensity 1. */
export const ZOOM_STEP = 0.4;

/** Shared lookAt target: the scene origin. */
const ORIGIN = new THREE.Vector3(0, 0, 0);

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * CameraRig — fixed-origin camera manipulation for M6 interaction wiring
 * (D2/D7): pan and zoom only, NO rotation (window rotation is M7).
 *
 * ORBIT, not translation: every op ends with lookAt(ORIGIN), so the camera
 * always aims at the center of the scene. Pan moves the camera in WORLD X/Y
 * at the current z (clamped to ±RIG_PAN_LIMIT); zoom dollies along z
 * (clamped to [RIG_ZOOM_MIN, RIG_ZOOM_MAX]).
 *
 * Camera-dolly over scene-root scale (D2): zoom moves the CAMERA, never a
 * scene-root scale. App's M3 projection loop derives depth from
 * camera.position.distanceTo(mesh) and size from camera.fov — dollying the
 * camera keeps every existing projection equation correct untouched, while
 * scaling the scene root would desync that math.
 *
 * Matrix freshness: both ops end with camera.updateMatrixWorld(), which
 * refreshes matrixWorld AND matrixWorldInverse (THREE.Camera's override),
 * so same-tick engine raycasts and App projections always see the new pose
 * (and headless tests never hit a stale camera matrix after rig ops).
 *
 * M7 (D10): reset() restores the home pose (0, 0, RIG_HOME_Z) and re-aims
 * at the origin — the demo "get back to the boot view" affordance.
 *
 * SIGN CONVENTION (D7 premise correction): the delegation's inline
 * recommendation ("swipe 'left' moves the camera +x so the scene appears to
 * move left") reasons with a PURE-TRANSLATION camera. This rig KEEPS
 * lookAt(origin), which makes pan an ORBIT, and under an orbit the sign
 * inverts: moving the camera +x rotates the view toward -x, so on-screen
 * content shifts +x. Numerically: camera (1,0,5) lookAt origin -> the view
 * center hits the z=-2 plane at world x = -0.4, so a fixed point at x=0
 * lands RIGHT of center; camera -x -> left; camera +y -> up. Unified rule:
 * camera pan direction = on-screen content direction = hand direction on
 * both axes (see swipeToPan's table; pinned observably by cameraRig.test.ts
 * "observable pin").
 */
export class CameraRig {
  private readonly camera: THREE.PerspectiveCamera;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  /** Pan in WORLD x/y at the current z, clamped to ±RIG_PAN_LIMIT, then
   *  re-aim at the origin. */
  pan(dx: number, dy: number): void {
    this.camera.position.x = Math.min(
      RIG_PAN_LIMIT,
      Math.max(-RIG_PAN_LIMIT, this.camera.position.x + dx),
    );
    this.camera.position.y = Math.min(
      RIG_PAN_LIMIT,
      Math.max(-RIG_PAN_LIMIT, this.camera.position.y + dy),
    );
    this.aimAndRefresh();
  }

  /** Dolly along z: positive step moves AWAY from origin, negative toward.
   *  Clamps z to [RIG_ZOOM_MIN, RIG_ZOOM_MAX], then re-aims at the origin. */
  zoom(step: number): void {
    this.camera.position.z = Math.min(
      RIG_ZOOM_MAX,
      Math.max(RIG_ZOOM_MIN, this.camera.position.z + step),
    );
    this.aimAndRefresh();
  }

  /** M7: restores the camera to the home pose (0, 0, RIG_HOME_Z) and
   *  re-aims at the origin. Resets NOTHING else (windows, highlights, grabs
   *  are untouched) — it is the demo "get back to the boot view" affordance. */
  reset(): void {
    this.camera.position.set(0, 0, RIG_HOME_Z);
    this.aimAndRefresh();
  }

  /** Re-aim at the origin and refresh world matrices (see module docblock). */
  private aimAndRefresh(): void {
    this.camera.lookAt(ORIGIN);
    this.camera.updateMatrixWorld();
  }

  /** Force the camera to a specific pose (used for Present Mode sync) */
  setPose(position: THREE.Vector3, rotation: THREE.Euler, fov: number): void {
    this.camera.position.copy(position);
    this.camera.rotation.copy(rotation);
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }
}

/**
 * SWIPE direction -> world pan deltas (D7 sign table; intensity clamped to
 * [0,1]). s = SWIPE_PAN_STEP * clamp01(intensity). Camera pan direction =
 * on-screen content direction = hand direction on both axes (orbit rule):
 *
 *   left  -> {dx: -s, dy: 0}  camera -x, content slides LEFT
 *   right -> {dx: +s, dy: 0}  camera +x, content slides RIGHT
 *   up    -> {dx: 0, dy: +s}  camera +y, content slides UP
 *   down  -> {dx: 0, dy: -s}  camera -y, content slides DOWN
 */
export function swipeToPan(
  direction: SwipeDirection,
  intensity: number,
): { dx: number; dy: number } {
  const s = SWIPE_PAN_STEP * clamp01(intensity);
  switch (direction) {
    case 'left':
      return { dx: -s, dy: 0 };
    case 'right':
      return { dx: s, dy: 0 };
    case 'up':
      return { dx: 0, dy: s };
    case 'down':
      return { dx: 0, dy: -s };
  }
}

/** PINCH_ZOOM direction -> camera z step (D7): 'in' decreases z (toward the
 *  origin), 'out' increases it; magnitude = ZOOM_STEP * clamp01(intensity). */
export function zoomToStep(direction: ZoomDirection, intensity: number): number {
  const s = ZOOM_STEP * clamp01(intensity);
  return direction === 'in' ? -s : s;
}
