import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  CameraRig,
  RIG_PAN_LIMIT,
  RIG_ZOOM_MAX,
  RIG_ZOOM_MIN,
  RIG_HOME_Z,
  SWIPE_PAN_STEP,
  ZOOM_STEP,
  swipeToPan,
  zoomToStep,
} from './cameraRig';
import { WINDOW_ASPECT } from './windowManager';

/**
 * CameraRig unit tests (node environment — pure three.js math, no DOM).
 * The rig is tested against a REAL headless PerspectiveCamera (fov 75,
 * z=5 — matching Scene3D and the InteractionEngine test rig).
 *
 * The observable pin (E1.8) asserts the D7 orbit rule by PROJECTED NDC
 * behavior: pan moves on-screen content WITH the camera (content follows
 * the hand), which is the contract App's SWIPE routing relies on.
 */

const CAMERA_FOV = 75;
const CAMERA_Z = 5;

interface Rig {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rig: CameraRig;
}

function setup(): Rig {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, WINDOW_ASPECT, 0.1, 1000);
  camera.position.set(0, 0, CAMERA_Z);
  camera.lookAt(0, 0, 0);
  scene.add(camera);
  scene.updateMatrixWorld(true);
  const rig = new CameraRig(camera);
  return { scene, camera, rig };
}

describe('CameraRig.pan', () => {
  it('moves the camera in world x/y at constant z', () => {
    const { camera, rig } = setup();
    rig.pan(1.5, -1);
    expect(camera.position.x).toBeCloseTo(1.5, 10);
    expect(camera.position.y).toBeCloseTo(-1, 10);
    expect(camera.position.z).toBe(CAMERA_Z);
  });

  it('clamps x/y to ±RIG_PAN_LIMIT and never touches z', () => {
    const { camera, rig } = setup();
    rig.pan(100, 0);
    expect(camera.position.x).toBe(RIG_PAN_LIMIT);
    expect(camera.position.y).toBe(0);
    rig.pan(-100, -100);
    expect(camera.position.x).toBe(-RIG_PAN_LIMIT);
    expect(camera.position.y).toBe(-RIG_PAN_LIMIT);
    expect(camera.position.z).toBe(CAMERA_Z);
  });
});

describe('CameraRig.zoom', () => {
  it('clamps z to [RIG_ZOOM_MIN, RIG_ZOOM_MAX] and never touches x/y', () => {
    const { camera, rig } = setup();
    rig.zoom(-100);
    expect(camera.position.z).toBe(RIG_ZOOM_MIN);
    expect(camera.position.x).toBe(0);
    expect(camera.position.y).toBe(0);
    rig.zoom(100);
    expect(camera.position.z).toBe(RIG_ZOOM_MAX);
    expect(camera.position.x).toBe(0);
    expect(camera.position.y).toBe(0);
  });

  it('negative step dollies toward the origin, positive away', () => {
    const { camera, rig } = setup();
    rig.zoom(-0.4);
    expect(camera.position.z).toBeCloseTo(4.6, 10);
  });
  it('positive step dollies away from the origin', () => {
    const { camera, rig } = setup();
    rig.zoom(0.4);
    expect(camera.position.z).toBeCloseTo(5.4, 10);
  });
});

describe('CameraRig lookAt maintenance', () => {
  it('after every op the camera looks at the origin (orbit invariant)', () => {
    const { camera, rig } = setup();
    const lookDir = new THREE.Vector3();
    const expectAimedAtOrigin = () => {
      camera.getWorldDirection(lookDir);
      const towardOrigin = camera.position.clone().multiplyScalar(-1).normalize();
      expect(lookDir.x).toBeCloseTo(towardOrigin.x, 10);
      expect(lookDir.y).toBeCloseTo(towardOrigin.y, 10);
      expect(lookDir.z).toBeCloseTo(towardOrigin.z, 10);
    };

    rig.pan(1.5, -1);
    expectAimedAtOrigin();
    rig.zoom(-0.4);
    expectAimedAtOrigin();
    rig.pan(-2, 3);
    expectAimedAtOrigin();
    rig.zoom(1);
    expectAimedAtOrigin();
  });

  it('no drift: 1000 alternating pan/zoom ops stay in clamps and aim at origin', () => {
    const { camera, rig } = setup();
    // Deterministic LCG so the sequence is reproducible.
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let i = 0; i < 1000; i += 1) {
      rig.pan((rand() - 0.5) * 30, (rand() - 0.5) * 30);
      rig.zoom((rand() - 0.5) * 8);
      // z monotone-clamped invariant, spot-checked every frame.
      expect(camera.position.z).toBeGreaterThanOrEqual(RIG_ZOOM_MIN);
      expect(camera.position.z).toBeLessThanOrEqual(RIG_ZOOM_MAX);
    }

    expect(Math.abs(camera.position.x)).toBeLessThanOrEqual(RIG_PAN_LIMIT);
    expect(Math.abs(camera.position.y)).toBeLessThanOrEqual(RIG_PAN_LIMIT);
    expect(camera.position.z).toBeGreaterThanOrEqual(RIG_ZOOM_MIN);
    expect(camera.position.z).toBeLessThanOrEqual(RIG_ZOOM_MAX);

    const lookDir = new THREE.Vector3();
    camera.getWorldDirection(lookDir);
    const towardOrigin = camera.position.clone().multiplyScalar(-1).normalize();
    expect(lookDir.x).toBeCloseTo(towardOrigin.x, 10);
    expect(lookDir.y).toBeCloseTo(towardOrigin.y, 10);
    expect(lookDir.z).toBeCloseTo(towardOrigin.z, 10);
  });
});

describe('swipeToPan / zoomToStep (D7 sign table)', () => {
  it('swipeToPan maps all four directions with intensity scaling', () => {
    expect(swipeToPan('left', 1)).toEqual({ dx: -SWIPE_PAN_STEP, dy: 0 });
    expect(swipeToPan('right', 1)).toEqual({ dx: SWIPE_PAN_STEP, dy: 0 });
    expect(swipeToPan('up', 1)).toEqual({ dx: 0, dy: SWIPE_PAN_STEP });
    expect(swipeToPan('down', 1)).toEqual({ dx: 0, dy: -SWIPE_PAN_STEP });

    const half = SWIPE_PAN_STEP * 0.5;
    expect(swipeToPan('left', 0.5)).toEqual({ dx: -half, dy: 0 });
    expect(swipeToPan('right', 0.5)).toEqual({ dx: half, dy: 0 });
    expect(swipeToPan('up', 0.5)).toEqual({ dx: 0, dy: half });
    expect(swipeToPan('down', 0.5)).toEqual({ dx: 0, dy: -half });

    // Intensity is clamped to [0, 1]: 2 ≡ 1, -1 ≡ 0.
    expect(swipeToPan('right', 2)).toEqual(swipeToPan('right', 1));
    expect(swipeToPan('right', -1)).toEqual({ dx: 0, dy: 0 });
  });

  it('zoomToStep maps in/out with intensity scaling and clamping', () => {
    expect(zoomToStep('in', 1)).toBe(-ZOOM_STEP);
    expect(zoomToStep('out', 1)).toBe(ZOOM_STEP);
    expect(zoomToStep('in', 0.5)).toBe(-ZOOM_STEP * 0.5);
    expect(zoomToStep('out', 0.5)).toBe(ZOOM_STEP * 0.5);
    expect(zoomToStep('in', 2)).toBe(-ZOOM_STEP); // clamped to intensity 1
    expect(zoomToStep('out', -1)).toBe(0); // clamped to intensity 0
  });
});

describe('CameraRig observable projection behavior (D7 orbit contract)', () => {
  it('E1.8: pan moves on-screen content WITH the camera (content follows the hand)', () => {
    const { camera, rig } = setup();
    const P = new THREE.Vector3(9, 0, -2);
    const centered = new THREE.Vector3(0, 0, -2);

    // At rest (fov 75, aspect 16/9, z=5): P projects near the right
    // frustum edge but INSIDE (ndc.x ~ 0.94).
    const restNdc = P.clone().project(camera);
    expect(restNdc.x).toBeGreaterThan(0.9);
    expect(restNdc.x).toBeLessThan(1);

    // Pan +RIG_PAN_LIMIT x: the fixed point now projects OUTSIDE +1 —
    // content shifted right WITH the camera (the App |ndc|>1 off-screen
    // cull would fire).
    rig.pan(RIG_PAN_LIMIT, 0);
    expect(P.clone().project(camera).x).toBeGreaterThan(1);

    // Pan -4 x: the centered point projects to NEGATIVE x (content moved
    // left with the hand). From x=+4, a -8 pan lands exactly at -4.
    rig.pan(-2 * RIG_PAN_LIMIT, 0);
    expect(centered.clone().project(camera).x).toBeLessThan(0);

    // Pan +4 y: the centered point projects to POSITIVE y (content moved
    // up with the hand).
    rig.pan(0, RIG_PAN_LIMIT);
    expect(centered.clone().project(camera).y).toBeGreaterThan(0);
  });

  it('zoom propagates to projection: closer camera, larger depth-shrunk NDC magnitude', () => {
    const { camera, rig } = setup();
    const P = new THREE.Vector3(2, 1.5, -2);
    const depthBefore = camera.position.distanceTo(P);
    const magBefore = P.clone().project(camera).length();

    rig.zoom(zoomToStep('in', 1)); // camera z 5 -> 4.6

    const depthAfter = camera.position.distanceTo(P);
    expect(depthAfter).toBeLessThan(depthBefore);
    const magAfter = P.clone().project(camera).length();
    expect(magAfter).toBeGreaterThan(magBefore);
  });
});

describe('CameraRig matrix freshness', () => {
  it('after pan + zoom, matrixWorld reflects the new pose without manual updates', () => {
    const { camera, rig } = setup();
    rig.pan(1, 2);
    rig.zoom(-0.5);

    // matrixWorld translation row must already be (1, 2, 4.5): the rig
    // self-updates (D2) so same-tick raycasts/projections are safe.
    expect(camera.matrixWorld.elements[12]).toBeCloseTo(1, 10);
    expect(camera.matrixWorld.elements[13]).toBeCloseTo(2, 10);
    expect(camera.matrixWorld.elements[14]).toBeCloseTo(4.5, 10);
  });
});

describe('CameraRig.reset (M7, D10)', () => {
  it('restores the exact home pose (0, 0, RIG_HOME_Z) and re-aims at the origin', () => {
    const { camera, rig } = setup();
    rig.pan(2, 3);
    rig.zoom(4);

    rig.reset();

    expect(camera.position.x).toBe(0);
    expect(camera.position.y).toBe(0);
    expect(camera.position.z).toBe(RIG_HOME_Z);
    // Re-aimed at the origin (the orbit invariant, same shape as the
    // lookAt-maintenance helper).
    const lookDir = new THREE.Vector3();
    camera.getWorldDirection(lookDir);
    const towardOrigin = camera.position.clone().multiplyScalar(-1).normalize();
    expect(lookDir.x).toBeCloseTo(towardOrigin.x, 10);
    expect(lookDir.y).toBeCloseTo(towardOrigin.y, 10);
    expect(lookDir.z).toBeCloseTo(towardOrigin.z, 10);
    // Matrix freshness (same pattern as the M6 matrix test): the world
    // translation row is already the restored pose.
    expect(camera.matrixWorld.elements[12]).toBeCloseTo(0, 10);
    expect(camera.matrixWorld.elements[13]).toBeCloseTo(0, 10);
    expect(camera.matrixWorld.elements[14]).toBeCloseTo(RIG_HOME_Z, 10);
  });

  it('reset is idempotent and clamps still hold afterwards', () => {
    const { camera, rig } = setup();
    rig.pan(3, -3);
    rig.reset();
    rig.reset();

    expect(camera.position.x).toBe(0);
    expect(camera.position.y).toBe(0);
    expect(camera.position.z).toBe(RIG_HOME_Z);

    // The rig is not corrupted by the resets: clamps still apply.
    rig.pan(100, 100);
    expect(camera.position.x).toBe(RIG_PAN_LIMIT);
    expect(camera.position.y).toBe(RIG_PAN_LIMIT);
    rig.zoom(-100);
    expect(camera.position.z).toBe(RIG_ZOOM_MIN);
    rig.zoom(100);
    expect(camera.position.z).toBe(RIG_ZOOM_MAX);
    // And reset still recovers the home pose from a clamped state.
    rig.reset();
    expect(camera.position.z).toBe(RIG_HOME_Z);
  });
});
