import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Hand, Handedness, Landmark } from '@jarvis/shared';
import type { Gesture } from './gestures';
import { GestureRecognizer, GestureType, landmarkToVector3 } from './gestures';
import { WindowManager, WINDOW_ASPECT, wrapToPi } from './windowManager';
import {
  InteractionEngine,
  GESTURE_WORLD_HALF_EXTENT,
  HOVER_EVICT_MS,
  OPEN_RELEASE_CONFIDENCE,
  RESIZE_INTENSITY_DELTA,
} from './interactionEngine';
import type { InteractionEvent } from './interactionEngine';

/**
 * InteractionEngine unit tests (node environment). The engine is tested
 * against a REAL headless PerspectiveCamera (fov 75, z=5 — matching
 * Scene3D) + Raycaster + WindowManager, so grab/resize/raycast behavior is
 * verified with actual projection math, not mocks.
 *
 * IMPORTANT: raycasts read mesh.matrixWorld, which the browser's render
 * loop updates each frame; headless tests must call scene.updateMatrixWorld
 * explicitly after placing meshes.
 */

const CAMERA_FOV = 75;
const CAMERA_Z = 5;

interface Rig {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  wm: WindowManager;
  engine: InteractionEngine;
}

function setup(): Rig {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, WINDOW_ASPECT, 0.1, 1000);
  camera.position.set(0, 0, CAMERA_Z);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  scene.add(camera);
  const wm = new WindowManager(scene);
  const engine = new InteractionEngine(camera, wm);
  return { scene, camera, wm, engine };
}

function makeGesture(
  type: GestureType,
  position: THREE.Vector3,
  intensity: number,
  confidence: number,
  handedness: Handedness = 'Right',
  trackingConfidence: number = 0.9,
): Gesture {
  return {
    type,
    confidence,
    trackingConfidence,
    intensity,
    position,
    handedness,
    timestamp: 0,
  };
}

/** NDC whose ray passes exactly through the window center (inverse of position/5). */
function ndcThroughCenter(
  camera: THREE.PerspectiveCamera,
  window: { position: THREE.Vector3 },
): { x: number; y: number } {
  const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const depth = camera.position.z - window.position.z;
  return {
    x: window.position.x / (depth * tanHalfFov * camera.aspect),
    y: window.position.y / (depth * tanHalfFov),
  };
}

/** PINCH gesture aimed exactly at a window's center (raycast hit guaranteed). */
function pinchOver(
  camera: THREE.PerspectiveCamera,
  window: { position: THREE.Vector3 },
  intensity = 0.8,
  handedness: Handedness = 'Right',
): Gesture {
  const ndc = ndcThroughCenter(camera, window);
  return makeGesture(
    GestureType.PINCH,
    new THREE.Vector3(ndc.x * GESTURE_WORLD_HALF_EXTENT, ndc.y * GESTURE_WORLD_HALF_EXTENT, 0),
    intensity,
    intensity,
    handedness,
  );
}

  /** OPEN with the recognizer's fixed confidence (0.9 > OPEN_RELEASE_CONFIDENCE). */
  function openHand(handedness: Handedness = 'Right'): Gesture {
    return makeGesture(GestureType.OPEN, new THREE.Vector3(0, 0, 0), 1, 0.9, handedness);
  }

  /** GRAB gesture aimed exactly at a window's center (raycast hit guaranteed). */
  function grabOver(
    camera: THREE.PerspectiveCamera,
    window: { position: THREE.Vector3 },
    intensity = 0.6,
    handedness: Handedness = 'Right',
  ): Gesture {
    const ndc = ndcThroughCenter(camera, window);
    return makeGesture(
      GestureType.GRAB,
      new THREE.Vector3(ndc.x * GESTURE_WORLD_HALF_EXTENT, ndc.y * GESTURE_WORLD_HALF_EXTENT, 0),
      intensity,
      0.9,
      handedness,
    );
  }

  /** POINT gesture (index tip, recognizer fields) aimed at a window's center. */
  function pointOver(
    camera: THREE.PerspectiveCamera,
    window: { position: THREE.Vector3 },
    handedness: Handedness = 'Right',
  ): Gesture {
    const ndc = ndcThroughCenter(camera, window);
    return makeGesture(
      GestureType.POINT,
      new THREE.Vector3(ndc.x * GESTURE_WORLD_HALF_EXTENT, ndc.y * GESTURE_WORLD_HALF_EXTENT, 0),
      0.5,
      0.85,
      handedness,
    );
  }

  /** POINT aimed at a world position guaranteed to miss every window. */
  function pointMiss(handedness: Handedness = 'Right'): Gesture {
    return makeGesture(GestureType.POINT, new THREE.Vector3(4.5, 4.5, 0), 0.5, 0.85, handedness);
  }

  // Local copy of the M5 fist pose (gestures.test.ts is frozen and not
  // importable): wrist [0.5, 0.8], middle MCP [0.5, 0.6] (palm center
  // (0.5, 0.7) → world (0, -2, 0)), tips thumb [0.487, 0.685], index
  // [0.513, 0.685], middle [0.53, 0.67], ring [0.52, 0.73], pinky
  // [0.49, 0.74]; the remaining joints interpolate like poseHand does.
  function fistHand(handedness: Handedness = 'Right'): Hand {
    const wrist: Landmark = { x: 0.5, y: 0.8, z: 0 };
    const palmMcp: Landmark = { x: 0.5, y: 0.6, z: 0 };
    const tips: Record<number, Landmark> = {
      4: { x: 0.487, y: 0.685, z: 0 },
      8: { x: 0.513, y: 0.685, z: 0 },
      12: { x: 0.53, y: 0.67, z: 0 },
      16: { x: 0.52, y: 0.73, z: 0 },
      20: { x: 0.49, y: 0.74, z: 0 },
    };
    const fingers: ReadonlyArray<{ base: number; tip: number }> = [
      { base: 1, tip: 4 },
      { base: 5, tip: 8 },
      { base: 9, tip: 12 },
      { base: 13, tip: 16 },
      { base: 17, tip: 20 },
    ];
    const landmarks: Landmark[] = [];
    landmarks[0] = wrist;
    landmarks[9] = palmMcp;
    for (const { base, tip } of fingers) {
      const from = base === 9 ? landmarks[9] : landmarks[0];
      const tipLm = tips[tip];
      for (let i = base; i <= tip; i += 1) {
        if (landmarks[i]) continue; // keep landmark 9 at the palm MCP
        const t = (i - base) / (tip - base);
        landmarks[i] = {
          x: from.x + (tipLm.x - from.x) * t,
          y: from.y + (tipLm.y - from.y) * t,
          z: 0,
        };
      }
      landmarks[tip] = tipLm;
    }
    return { handedness, landmarks, confidence: 0.95 };
  }

  /** Clones a Hand adding dx/dy to every landmark (classification-invariant
   *  translation). A normalized-units shift of 0.04 per 100 ms frame is a
   *  world velocity of 4 u/s (landmarkToVector3 spans -5..5). */
  function shiftHand(hand: Hand, dx: number, dy: number): Hand {
    return {
      ...hand,
      landmarks: hand.landmarks.map((lm) => ({ ...lm, x: lm.x + dx, y: lm.y + dy })),
    };
  }

describe('InteractionEngine grab lifecycle', () => {
  it('pinch over a window emits a grab with the target id', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(-1.5, 1.5, -2));
    scene.updateMatrixWorld(true);

    const events = engine.processGesture(pinchOver(camera, w));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('grab');
    expect(events[0].targetId).toBe('w1');
    // The grab frame must not also move or resize the window.
    expect(events[0].newPosition).toBeUndefined();
    expect(events[0].scaleChange).toBeUndefined();
  });

  it('pinch that misses every window emits no events', () => {
    const { scene, wm, engine } = setup();
    wm.createWindow('w1', 'Test', new THREE.Vector3(1.5, 1.5, -2));
    scene.updateMatrixWorld(true);

    // Aim far away from the window (NDC (0.9, 0.9) -> world (4.5, 4.5)).
    const miss = makeGesture(
      GestureType.PINCH,
      new THREE.Vector3(4.5, 4.5, 0),
      0.8,
      0.8,
    );
    expect(engine.processGesture(miss)).toEqual([]);
  });

  it('fix B: after grabbing, a pinch far off the window still moves it', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(-1.5, 1.5, -2));
    scene.updateMatrixWorld(true);
    const grab = pinchOver(camera, w);
    engine.processGesture(grab);
    const grabOffset = grab.position.clone().sub(w.position);

    // Hand swipes to a position that would MISS the window on a fresh
    // raycast (world x,y = (4, 2) is > 5 units away from the window).
    const far = makeGesture(
      GestureType.PINCH,
      new THREE.Vector3(4, 2, 0),
      0.8,
      0.8,
    );
    const events = engine.processGesture(far);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('move');
    expect(events[0].targetId).toBe('w1');
    const expected = far.position.clone().sub(grabOffset);
    expect(events[0].newPosition).toEqual(expected);
    expect(wm.getWindow('w1')!.position).toEqual(expected);
    expect(wm.getWindowMesh('w1')!.position).toEqual(expected);
  });

  it('open hand with nothing grabbed emits no events', () => {
    const { scene, wm, engine } = setup();
    wm.createWindow('w1', 'Test');
    scene.updateMatrixWorld(true);
    expect(engine.processGesture(openHand())).toEqual([]);
  });

  it('open hand releases all grabs; grabs are cleared and re-grabbable', () => {
    const { scene, camera, wm, engine } = setup();
    const w1 = wm.createWindow('w1', 'A', new THREE.Vector3(-1.5, 1.5, 0));
    const w2 = wm.createWindow('w2', 'B', new THREE.Vector3(1.5, 1.5, 0));
    scene.updateMatrixWorld(true);

    engine.processGesture(pinchOver(camera, w1, 0.8, 'Right'));
    engine.processGesture(pinchOver(camera, w2, 0.8, 'Left'));

    const events = engine.processGesture(openHand('Right'));
    expect(events.map((e) => [e.type, e.targetId])).toEqual([
      ['release', 'w1'],
      ['release', 'w2'],
    ]);

    // Grab state cleared: a new pinch starts a fresh grab.
    const again = engine.processGesture(pinchOver(camera, w1));
    expect(again.map((e) => e.type)).toEqual(['grab']);
  });

  it('open hand below the release confidence does not release', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(0, 1.5, 0));
    scene.updateMatrixWorld(true);
    engine.processGesture(pinchOver(camera, w));

    const weakOpen = makeGesture(GestureType.OPEN, new THREE.Vector3(), 1, 0.5);
    expect(engine.processGesture(weakOpen)).toEqual([]);

    // The grab is still alive: the next pinch continues it.
    const events = engine.processGesture(pinchOver(camera, w, 0.8));
    expect(events[0].type).toBe('move');
  });

  // E0-a (M7, sanctioned amendment): the M3 same-window-two-hands refusal is
  // lifted for the JOIN case — a second hand pinching the window the other
  // hand already holds JOINS it in rotation mode (silent: no events that
  // frame; both hands now hold it — the M7 rotation suite proves the twist).
  // The DIFFERENT-window grab still works normally.
  it('two hands can each grab a window; a second hand on the SAME window joins silently (M7)', () => {
    const { scene, camera, wm, engine } = setup();
    const w1 = wm.createWindow('w1', 'A', new THREE.Vector3(-1.5, 1.5, 0));
    const w2 = wm.createWindow('w2', 'B', new THREE.Vector3(1.5, 1.5, 0));
    scene.updateMatrixWorld(true);

    engine.processGesture(pinchOver(camera, w1, 0.8, 'Right'));
    // M7 join: Left pinching the SAME window emits nothing but takes hold.
    expect(engine.processGesture(pinchOver(camera, w1, 0.8, 'Left'))).toEqual([]);
    // Left exits (secondary release, D8): silent — Right still holds w1 —
    // and Left is free to grab a DIFFERENT window normally.
    expect(
      engine.processGesture(pointMiss('Left')),
    ).toEqual([]);
    const leftGrab = engine.processGesture(pinchOver(camera, w2, 0.8, 'Left'));
    expect(leftGrab.map((e) => e.type)).toEqual(['grab']);
  });

  it('closing a grabbed window clears the grab silently', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(0, 1.5, 0));
    scene.updateMatrixWorld(true);
    engine.processGesture(pinchOver(camera, w));

    wm.closeWindow('w1');
    const events = engine.processGesture(pinchOver(camera, w));
    expect(events).toEqual([]);

    // Hand is free again: grabbing another window works.
    const w2 = wm.createWindow('w2', 'B', new THREE.Vector3(1.5, 1.5, 0));
    scene.updateMatrixWorld(true);
    expect(engine.processGesture(pinchOver(camera, w2)).map((e) => e.type)).toEqual([
      'grab',
    ]);
  });

  // E0 (M6, sanctioned amendment): the pre-M6 assertions of GRAB/POINT/NONE
  // inertness contradicted M6 by design — GRAB now grabs, POINT now hovers.
  // Repurposed as the requirement-2d passthrough pin: SWIPE and PINCH_ZOOM
  // return [] unconditionally (App routes them to the CameraRig — the
  // engine must never grab/resize from them), and NONE is inert when
  // nothing is grabbed and no hover state exists.
  it('SWIPE and PINCH_ZOOM pass through untouched; NONE is inert with nothing grabbed', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(0, 1.5, 0));
    scene.updateMatrixWorld(true);
    const over = pinchOver(camera, w);
    // Aimed AT the window: passthrough must still return [] (no grab, no
    // hover, no resize — SWIPE/PINCH_ZOOM never touch grabs or hover).
    expect(
      engine.processGesture({ ...over, type: GestureType.SWIPE, swipeDirection: 'left' as const }),
    ).toEqual([]);
    expect(
      engine.processGesture({
        ...over,
        type: GestureType.PINCH_ZOOM,
        zoomDirection: 'in' as const,
      }),
    ).toEqual([]);
    // Nothing grabbed, no hover state: NONE emits nothing.
    expect(engine.processGesture({ ...over, type: GestureType.NONE })).toEqual([]);
  });
});

describe('InteractionEngine move/resize semantics', () => {
  it('move events carry newPosition = gesture.position - grabOffset (offset preserved)', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(-1.5, 1.5, -2));
    scene.updateMatrixWorld(true);
    const grab = pinchOver(camera, w, 0.7);
    engine.processGesture(grab);
    const grabOffset = grab.position.clone().sub(w.position);

    // Continuation pinch at a new spot, intensity delta <= threshold.
    const ndc = ndcThroughCenter(camera, w);
    const next = makeGesture(
      GestureType.PINCH,
      new THREE.Vector3(ndc.x * GESTURE_WORLD_HALF_EXTENT + 0.8, ndc.y * GESTURE_WORLD_HALF_EXTENT + 0.4, 0),
      0.7,
      0.7,
    );
    const events = engine.processGesture(next);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('move');
    expect(events[0].newPosition).toEqual(next.position.clone().sub(grabOffset));
    expect(events[0].scaleChange).toBeUndefined();
    expect(wm.getWindow('w1')!.position).toEqual(events[0].newPosition);
  });

  it('resize fires when |intensity delta| > 0.05, and it is else-if vs move', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(0, 1.5, 0));
    scene.updateMatrixWorld(true);
    const initialScale = wm.getWindow('w1')!.scale.clone();

    engine.processGesture(pinchOver(camera, w, 0.7));

    // Small delta (0.04 <= 0.05): MOVE, scale untouched.
    const smallDelta = makeGesture(
      GestureType.PINCH,
      new THREE.Vector3(0, 0, 0),
      0.74,
      0.74,
    );
    const moveEvents = engine.processGesture(smallDelta);
    expect(moveEvents.map((e) => e.type)).toEqual(['move']);
    expect(wm.getWindow('w1')!.scale).toEqual(initialScale);
    const positionAfterMove = wm.getWindow('w1')!.position.clone();

    // Big delta (0.06 > 0.05): RESIZE with scaleChange = 1 + delta, and the
    // same frame does NOT move (else-if per guide).
    const bigDelta = makeGesture(
      GestureType.PINCH,
      new THREE.Vector3(2, 2, 0),
      0.8,
      0.8,
    );
    const resizeEvents = engine.processGesture(bigDelta);
    expect(resizeEvents).toHaveLength(1);
    expect(resizeEvents[0].type).toBe('resize');
    expect(resizeEvents[0].scaleChange).toBeCloseTo(1.06, 10);
    expect(resizeEvents[0].newPosition).toBeUndefined();
    // Window scale actually changed (real WindowManager in the loop).
    expect(wm.getWindow('w1')!.scale.x).toBeCloseTo(initialScale.x * 1.06, 10);
    expect(wm.getWindowMesh('w1')!.scale).toEqual(wm.getWindow('w1')!.scale);
    // Position unchanged by the resize frame (it moved only during the
    // earlier move frame).
    expect(wm.getWindow('w1')!.position).toEqual(positionAfterMove);
  });

  it('per-frame intensity deltas: steady slow drift never resizes', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(0, 1.5, 0));
    scene.updateMatrixWorld(true);
    const initialScale = wm.getWindow('w1')!.scale.clone();

    engine.processGesture(pinchOver(camera, w, 0.7));
    // Five frames of +0.01: cumulative drift is 0.05 but each per-frame
    // delta is below the threshold — no resize ever fires.
    for (let i = 1; i <= 5; i += 1) {
      const g = makeGesture(GestureType.PINCH, new THREE.Vector3(0, 0, 0), 0.7 + i * 0.01, 0.7 + i * 0.01);
      const events = engine.processGesture(g);
      expect(events.map((e) => e.type)).toEqual(['move']);
    }
    expect(wm.getWindow('w1')!.scale).toEqual(initialScale);
  });
});

describe('InteractionEngine raycast target selection (fix A)', () => {
  it('non-grabbable objects between camera and window never intercept grabs', () => {
    const { scene, camera, wm, engine } = setup();
    // Obstacle between the camera (z=5) and the window (z=0): a full-screen
    // non-grabbable plane and the GridHelper, mirroring the M1 scene.
    const obstacle = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshPhongMaterial({ color: 0xffffff }),
    );
    obstacle.position.z = 2;
    scene.add(obstacle);
    scene.add(new THREE.GridHelper(10, 10));

    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(0, 0.5, 0));
    scene.updateMatrixWorld(true);

    // Sanity: on a full scene.children raycast the obstacle IS hit first —
    // this is exactly the interception the fix removes.
    const fullRaycast = new THREE.Raycaster();
    fullRaycast.setFromCamera(new THREE.Vector2(0, 0.1), camera);
    const allHits = fullRaycast.intersectObjects(scene.children, true);
    expect(allHits.length).toBeGreaterThan(0);
    expect(allHits[0].object.userData.isGrabbable).toBeFalsy();

    // The engine still grabs the window behind the obstacle.
    const events = engine.processGesture(pinchOver(camera, w));
    expect(events.map((e) => e.type)).toEqual(['grab']);
    expect(events[0].targetId).toBe('w1');
  });
});

describe('InteractionEngine NDC mapping (fix C, verified empirically)', () => {
  it('landmark-derived world position raycasts to the window, ray goes UP (no Y re-mirror)', () => {
    const { scene, camera, wm, engine } = setup();
    // Top-of-image landmark: lm.y < 0.5 -> world y > 0 (Y mirrored by
    // landmarkToVector3, image-up = world-up).
    const landmark = { x: 0.55, y: 0.45, z: 0 };
    const worldPos = landmarkToVector3(landmark);
    expect(worldPos.y).toBeGreaterThan(0);

    wm.createWindow('ndc', 'NDC', worldPos);
    scene.updateMatrixWorld(true);
    const mesh = wm.getWindowMesh('ndc')!;

    // NDC = (x / 5, y / 5) — the engine's mapping, applied to a real camera.
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(
      new THREE.Vector2(
        worldPos.x / GESTURE_WORLD_HALF_EXTENT,
        worldPos.y / GESTURE_WORLD_HALF_EXTENT,
      ),
      camera,
    );
    const hits = raycaster.intersectObject(mesh);
    expect(hits).toHaveLength(1);
    // The ray for a top-of-image landmark goes UP (positive world Y), which
    // pins the mirror direction of the NDC mapping.
    expect(hits[0].point.y).toBeGreaterThan(0);
    expect(hits[0].point.z).toBeCloseTo(0, 10); // on the window plane

    // Negative control: re-mirroring Y (a buggy mapping) aims the ray DOWN
    // and misses the window entirely.
    raycaster.setFromCamera(
      new THREE.Vector2(
        worldPos.x / GESTURE_WORLD_HALF_EXTENT,
        -worldPos.y / GESTURE_WORLD_HALF_EXTENT,
      ),
      camera,
    );
    expect(raycaster.intersectObject(mesh)).toHaveLength(0);

    // Engine-level: the same gesture position grabs the window.
    const gesture = makeGesture(
      GestureType.PINCH,
      worldPos.clone(),
      0.8,
      0.8,
    );
    expect(engine.processGesture(gesture).map((e) => e.type)).toEqual(['grab']);
  });

  it('off-center x landmark still raycasts to its window', () => {
    const { scene, camera, wm, engine } = setup();
    // lm.x > 0.5 -> world x > 0: off-center horizontally.
    const landmark = { x: 0.65, y: 0.45, z: 0 };
    const worldPos = landmarkToVector3(landmark);
    expect(worldPos.x).toBeGreaterThan(0);

    wm.createWindow('ndc', 'NDC', worldPos);
    scene.updateMatrixWorld(true);
    const mesh = wm.getWindowMesh('ndc')!;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(
      new THREE.Vector2(
        worldPos.x / GESTURE_WORLD_HALF_EXTENT,
        worldPos.y / GESTURE_WORLD_HALF_EXTENT,
      ),
      camera,
    );
    expect(raycaster.intersectObject(mesh)).toHaveLength(1);

    const gesture = makeGesture(GestureType.PINCH, worldPos.clone(), 0.8, 0.8);
    expect(engine.processGesture(gesture).map((e) => e.type)).toEqual(['grab']);
  });

  it('constants stay consistent with the mapping and the guide thresholds', () => {
    // The engine's NDC divisor must match the ±5 world span of
    // landmarkToVector3, or hand positions would aim rays off-target.
    expect(GESTURE_WORLD_HALF_EXTENT).toBe(5);
    expect(RESIZE_INTENSITY_DELTA).toBe(0.05);
    expect(OPEN_RELEASE_CONFIDENCE).toBe(0.8);
  });
});

describe('InteractionEngine GRAB lifecycle (M6, D3/D4)', () => {
  it('GRAB over a window emits a grab with the target id (same shape as pinch)', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(-1.5, 1.5, -2));
    scene.updateMatrixWorld(true);

    const events = engine.processGesture(grabOver(camera, w));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('grab');
    expect(events[0].targetId).toBe('w1');
    // The grab frame must not also move or resize the window.
    expect(events[0].newPosition).toBeUndefined();
    expect(events[0].scaleChange).toBeUndefined();
  });

  it('GRAB that misses every window emits no events', () => {
    const { scene, wm, engine } = setup();
    wm.createWindow('w1', 'Test', new THREE.Vector3(1.5, 1.5, -2));
    scene.updateMatrixWorld(true);

    const miss = makeGesture(GestureType.GRAB, new THREE.Vector3(4.5, 4.5, 0), 0.6, 0.9);
    expect(engine.processGesture(miss)).toEqual([]);
  });

  it('fix B inheritance: after grabbing, a GRAB far off the window still moves it', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(-1.5, 1.5, -2));
    scene.updateMatrixWorld(true);
    const grab = grabOver(camera, w);
    engine.processGesture(grab);
    const grabOffset = grab.position.clone().sub(w.position);

    // Fist swipes to a position that would MISS the window on a fresh
    // raycast (world x,y = (4, 2) is > 5 units away from the window).
    const far = makeGesture(GestureType.GRAB, new THREE.Vector3(4, 2, 0), 0.6, 0.9);
    const events = engine.processGesture(far);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('move');
    expect(events[0].targetId).toBe('w1');
    const expected = far.position.clone().sub(grabOffset);
    expect(events[0].newPosition).toEqual(expected);
    expect(wm.getWindow('w1')!.position).toEqual(expected);
    expect(wm.getWindowMesh('w1')!.position).toEqual(expected);
  });

  it('D4: GRAB intensity drift never resizes (Δ 0.6 ≫ 0.05 → move only)', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(0, 1.5, 0));
    scene.updateMatrixWorld(true);
    const initialScale = wm.getWindow('w1')!.scale.clone();

    engine.processGesture(grabOver(camera, w, 0.3));
    // Same frame type GRAB with a huge intensity jump: curledness noise —
    // the resize branch is PINCH-gated (D4), so this is a move.
    const events = engine.processGesture(grabOver(camera, w, 0.9));

    expect(events.map((e) => e.type)).toEqual(['move']);
    expect(wm.getWindow('w1')!.scale).toEqual(initialScale);
  });

  it('strong OPEN releases a GRAB-started grab (release-all) and re-grab works', () => {
    const { scene, camera, wm, engine } = setup();
    const w1 = wm.createWindow('w1', 'A', new THREE.Vector3(-1.5, 1.5, 0));
    const w2 = wm.createWindow('w2', 'B', new THREE.Vector3(1.5, 1.5, 0));
    scene.updateMatrixWorld(true);

    engine.processGesture(grabOver(camera, w1, 0.6, 'Right'));
    engine.processGesture(grabOver(camera, w2, 0.6, 'Left'));

    const events = engine.processGesture(openHand('Right'));
    expect(events.map((e) => [e.type, e.targetId])).toEqual([
      ['release', 'w1'],
      ['release', 'w2'],
    ]);

    const again = engine.processGesture(grabOver(camera, w1));
    expect(again.map((e) => e.type)).toEqual(['grab']);
  });

  it('D3: NONE releases the grabbing hand per-hand; the grab is cleared', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(-1.5, 1.5, -2));
    scene.updateMatrixWorld(true);
    engine.processGesture(grabOver(camera, w));

    const none = makeGesture(GestureType.NONE, new THREE.Vector3(0, 0, 0), 0, 0);
    const events = engine.processGesture(none);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('release');
    expect(events[0].targetId).toBe('w1');
    // The OTHER hand's grab is untouched by the per-hand release.
    expect(wm.getWindow('w1')).toBeDefined();

    // Grab state cleared: a new GRAB starts a fresh grab.
    const again = engine.processGesture(grabOver(camera, w));
    expect(again.map((e) => e.type)).toEqual(['grab']);
  });

  it('D3: POINT releases a grabbing hand; an off-window POINT stays hover-silent', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(-1.5, 1.5, -2));
    scene.updateMatrixWorld(true);
    engine.processGesture(grabOver(camera, w));

    // Aimed OFF-window: the release fires, the hover raycast misses and its
    // fresh slot has no prior target, so exactly one release is emitted.
    const events = engine.processGesture(pointMiss());

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('release');
    expect(events[0].targetId).toBe('w1');
  });

  it('weak OPEN (conf 0.5) does not release a GRAB grab (M3 carryover)', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(0, 1.5, 0));
    scene.updateMatrixWorld(true);
    engine.processGesture(grabOver(camera, w));

    const weakOpen = makeGesture(GestureType.OPEN, new THREE.Vector3(), 1, 0.5);
    expect(engine.processGesture(weakOpen)).toEqual([]);

    // The grab is still alive: the next GRAB frame continues it (move).
    const events = engine.processGesture(grabOver(camera, w, 0.7));
    expect(events.map((e) => e.type)).toEqual(['move']);
  });

  it('closing a grabbed window mid-GRAB drops the grab silently', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(0, 1.5, 0));
    scene.updateMatrixWorld(true);
    engine.processGesture(grabOver(camera, w));

    wm.closeWindow('w1');
    const events = engine.processGesture(grabOver(camera, w));
    expect(events).toEqual([]);

    // Hand is free again: grabbing another window works.
    const w2 = wm.createWindow('w2', 'B', new THREE.Vector3(1.5, 1.5, 0));
    scene.updateMatrixWorld(true);
    expect(engine.processGesture(grabOver(camera, w2)).map((e) => e.type)).toEqual(['grab']);
  });
});

describe('InteractionEngine cross-type grabs (M6, D4 frame-type rule)', () => {
  it('PINCH starts, GRAB frames continue (moves), a later PINCH frame resizes', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(-1.5, 1.5, -2));
    scene.updateMatrixWorld(true);
    const initialScale = wm.getWindow('w1')!.scale.clone();

    engine.processGesture(pinchOver(camera, w, 0.7));

    // GRAB frame: intensity delta 0.1 > 0.05 but the frame type is GRAB —
    // move only, scale untouched (the resize branch is PINCH-gated).
    const grabFrame = makeGesture(GestureType.GRAB, new THREE.Vector3(2, 0, 0), 0.8, 0.9);
    const moves = engine.processGesture(grabFrame);
    expect(moves.map((e) => e.type)).toEqual(['move']);
    expect(wm.getWindow('w1')!.scale).toEqual(initialScale);

    // A later PINCH frame with a big intensity delta RESIZES (frame-type
    // rule — cross-type continuation is alive).
    const pinchFrame = makeGesture(GestureType.PINCH, new THREE.Vector3(2, 0, 0), 0.3, 0.3);
    const resizes = engine.processGesture(pinchFrame);
    expect(resizes.map((e) => e.type)).toEqual(['resize']);
    expect(resizes[0].scaleChange).toBeCloseTo(0.5, 10);
  });

  it('GRAB starts, PINCH continues and can resize', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(-1.5, 1.5, -2));
    scene.updateMatrixWorld(true);
    engine.processGesture(grabOver(camera, w, 0.6));

    const pinchFrame = makeGesture(GestureType.PINCH, new THREE.Vector3(2, 0, 0), 0.9, 0.9);
    const events = engine.processGesture(pinchFrame);

    expect(events.map((e) => e.type)).toEqual(['resize']);
    expect(events[0].scaleChange).toBeCloseTo(1.3, 10);
  });

  // E0-b (M7, sanctioned amendment): same observable as E0-a with GRAB
  // gestures — the join is type-agnostic (a fist joins a fist-held window).
  it('join is type-agnostic: a GRAB joins a GRAB-held window (M7)', () => {
    const { scene, camera, wm, engine } = setup();
    const w1 = wm.createWindow('w1', 'A', new THREE.Vector3(-1.5, 1.5, 0));
    const w2 = wm.createWindow('w2', 'B', new THREE.Vector3(1.5, 1.5, 0));
    scene.updateMatrixWorld(true);

    engine.processGesture(grabOver(camera, w1, 0.6, 'Right'));
    expect(engine.processGesture(grabOver(camera, w1, 0.6, 'Left'))).toEqual([]);
    expect(engine.processGesture(makeGesture(GestureType.POINT, new THREE.Vector3(4.5, 4.5, 0), 0.5, 0.85, 'Left'))).toEqual([]);
    const leftGrab = engine.processGesture(grabOver(camera, w2, 0.6, 'Left'));
    expect(leftGrab.map((e) => e.type)).toEqual(['grab']);
  });
});

describe('InteractionEngine POINT hover (M6, D5 — clocks injected)', () => {
  it('emits hover on the first hit and never re-emits the same target', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(-1.5, 1.5, -2));
    scene.updateMatrixWorld(true);

    const first = engine.processGesture(pointOver(camera, w), 0);
    expect(first).toHaveLength(1);
    expect(first[0].type).toBe('hover');
    expect(first[0].targetId).toBe('w1');

    // Eligible frames (>= 66 ms apart) over the same window: no re-emit.
    expect(engine.processGesture(pointOver(camera, w), 66)).toEqual([]);
    expect(engine.processGesture(pointOver(camera, w), 132)).toEqual([]);
  });

  it('throttles raycasts to ~15 Hz; the check timestamp only advances on eligible frames', () => {
    const { scene, camera, wm, engine } = setup();
    const w1 = wm.createWindow('w1', 'A', new THREE.Vector3(-1.5, 1.5, -2));
    const w2 = wm.createWindow('w2', 'B', new THREE.Vector3(1.5, 1.5, -2));
    scene.updateMatrixWorld(true);
    engine.processGesture(pointOver(camera, w1), 0); // eligible: hover w1

    // 30 ms later: throttled — no raycast, no event, lastCheckMs untouched.
    expect(engine.processGesture(pointOver(camera, w2), 30)).toEqual([]);

    // 36 ms later the frame is eligible again (66 ms since the LAST eligible
    // check at t=0) and sees the new target. If the throttled frame had
    // advanced lastCheckMs, this frame would be throttled too and the
    // transition would be lost — this pins the timestamp semantics.
    const events = engine.processGesture(pointOver(camera, w2), 66);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('hover');
    expect(events[0].targetId).toBe('w2');
  });

  it('ray stop emits hover null; a fresh miss with no prior hit emits nothing', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(-1.5, 1.5, -2));
    scene.updateMatrixWorld(true);

    const hit = engine.processGesture(pointOver(camera, w), 0);
    expect(hit[0].targetId).toBe('w1');

    const stop = engine.processGesture(pointMiss(), 66);
    expect(stop).toHaveLength(1);
    expect(stop[0].type).toBe('hover');
    expect(stop[0].targetId).toBeNull();

    // A different hand with no prior hover: missing POINT emits nothing.
    expect(engine.processGesture(pointMiss('Left'), 132)).toEqual([]);
  });

  it('non-POINT frame ends the hover immediately (one-shot, not throttled)', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(-1.5, 1.5, -2));
    scene.updateMatrixWorld(true);
    engine.processGesture(pointOver(camera, w), 0); // hover w1

    // Same-hand PINCH aimed off-window: no grab events of its own, but the
    // non-POINT transition clears the hover in the same frame.
    const off = makeGesture(GestureType.PINCH, new THREE.Vector3(4.5, 4.5, 0), 0.8, 0.8);
    const events = engine.processGesture(off, 66);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('hover');
    expect(events[0].targetId).toBeNull();
  });

  it('per-hand independence: each hand tracks its own target and no-re-emit', () => {
    const { scene, camera, wm, engine } = setup();
    const w1 = wm.createWindow('w1', 'A', new THREE.Vector3(-1.5, 1.5, -2));
    const w2 = wm.createWindow('w2', 'B', new THREE.Vector3(1.5, 1.5, -2));
    scene.updateMatrixWorld(true);

    const r0 = engine.processGesture(pointOver(camera, w1, 'Right'), 0);
    expect(r0[0].targetId).toBe('w1');
    const l0 = engine.processGesture(pointOver(camera, w2, 'Left'), 0);
    expect(l0[0].targetId).toBe('w2');

    // Each hand's no-re-emit is independent.
    expect(engine.processGesture(pointOver(camera, w1, 'Right'), 66)).toEqual([]);
    expect(engine.processGesture(pointOver(camera, w2, 'Left'), 66)).toEqual([]);

    // Crossing targets emits for each hand individually.
    const r2 = engine.processGesture(pointOver(camera, w2, 'Right'), 132);
    expect(r2).toHaveLength(1);
    expect(r2[0].targetId).toBe('w2');
    const l2 = engine.processGesture(pointOver(camera, w1, 'Left'), 132);
    expect(l2).toHaveLength(1);
    expect(l2[0].targetId).toBe('w1');
  });

  it('hover is read-only: no WindowManager mutation, no move/resize events', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(-1.5, 1.5, -2));
    scene.updateMatrixWorld(true);
    const versionBefore = wm.version;
    const positionBefore = wm.getWindow('w1')!.position.clone();
    const scaleBefore = wm.getWindow('w1')!.scale.clone();
    const events: string[] = [];

    for (const [g, t] of [
      [pointOver(camera, w), 0],
      [pointOver(camera, w), 66],
      [pointMiss(), 132],
    ] as const) {
      for (const e of engine.processGesture(g, t)) {
        if (e.type !== 'hover') events.push(e.type);
      }
    }

    expect(events).toEqual([]);
    expect(wm.version).toBe(versionBefore);
    expect(wm.getWindow('w1')!.position).toEqual(positionBefore);
    expect(wm.getWindow('w1')!.scale).toEqual(scaleBefore);
  });

  it('hover still fires during the OTHER hand\'s grab (App resolves priority)', () => {
    const { scene, camera, wm, engine } = setup();
    const w1 = wm.createWindow('w1', 'Test', new THREE.Vector3(-1.5, 1.5, -2));
    scene.updateMatrixWorld(true);

    // Right hand grabs w1 (PINCH).
    engine.processGesture(pinchOver(camera, w1, 0.8, 'Right'));

    // Left hand points AT the grabbed window: the engine does not suppress
    // the hover — App's highlight priority resolves grabbed-vs-hover.
    const events = engine.processGesture(pointOver(camera, w1, 'Left'), 0);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('hover');
    expect(events[0].targetId).toBe('w1');
  });

  it('eviction: a silent hand\'s slot emits hover null carrying its stored gesture', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(-1.5, 1.5, -2));
    scene.updateMatrixWorld(true);
    const hit = engine.processGesture(pointOver(camera, w, 'Right'), 0);
    expect(hit[0].targetId).toBe('w1');

    // Only the LEFT hand gestures until well past HOVER_EVICT_MS: the sweep
    // evicts the Right slot and emits hover null carrying Right's stored
    // last POINT gesture (the contract: read handedness only).
    const weakOpen = makeGesture(GestureType.OPEN, new THREE.Vector3(), 1, 0.5, 'Left');
    const evict = engine.processGesture(weakOpen, HOVER_EVICT_MS + 100);

    expect(evict).toHaveLength(1);
    expect(evict[0].type).toBe('hover');
    expect(evict[0].targetId).toBeNull();
    expect(evict[0].gesture.handedness).toBe('Right');
  });
});

describe('InteractionEngine recognizer + engine integration (M6, E7)', () => {
  it('a fast-moving fist yields GRAB every frame (never SWIPE) and one grab + moves', () => {
    const { scene, wm, engine } = setup();
    // E7: the fist's palm center maps to world (0, -2, 0), which the
    // engine's NDC mapping (position/5) sends to NDC (0, -0.4); that ray
    // hits the z=0 plane at y = -0.4 * 5 * tan(37.5°) ≈ -1.53 (NDC ≠ world
    // for off-center rays). The window sits at the TRUE hit point so the
    // first GRAB raycast lands (the brief's "(0, -2, 0)" is the palm's
    // world position, not the intersection).
    wm.createWindow('w1', 'Test', new THREE.Vector3(0, -1.53, 0));
    scene.updateMatrixWorld(true);

    const recognizer = new GestureRecognizer();
    let hand = fistHand();
    let grabs = 0;
    let moves = 0;
    const unexpected: string[] = [];

    for (let t = 0; t <= 1000; t += 100) {
      // 0.04 normalized units per 100 ms frame = 4 u/s > SWIPE threshold,
      // so the SWIPE event channel is hot — but SWIPE requires a stabilized
      // OPEN, and a fist is GRAB: pin the per-frame type explicitly.
      hand = shiftHand(hand, 0.04, 0);
      const [gesture] = recognizer.recognizeGestures([hand], t);
      expect(gesture.type).toBe(GestureType.GRAB);
      for (const event of engine.processGesture(gesture)) {
        if (event.type === 'grab') {
          grabs += 1;
          expect(event.targetId).toBe('w1');
        } else if (event.type === 'move') {
          moves += 1;
        } else {
          unexpected.push(event.type);
        }
      }
    }

    // Exactly one grab, then continuation moves — never resize/release/hover.
    expect(grabs).toBe(1);
    expect(moves).toBeGreaterThan(0);
    expect(unexpected).toEqual([]);
  });

  it('momentum fields: GRAB moves carry newPosition + timestamp, NONE release carries targetId', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(-1.5, 1.5, -2));
    scene.updateMatrixWorld(true);

    const grab = grabOver(camera, w);
    const [grabEvent] = engine.processGesture(grab);
    expect(grabEvent.type).toBe('grab');
    expect(grabEvent.targetId).toBe('w1');
    const grabOffset = grab.position.clone().sub(w.position);

    // Several GRAB moves with INCREASING timestamps (the exact fields App's
    // momentum path consumes: move.newPosition + move.gesture.timestamp).
    const moveEvents: { newPosition: THREE.Vector3; timestamp: number }[] = [];
    for (let i = 1; i <= 3; i += 1) {
      const g = makeGesture(GestureType.GRAB, new THREE.Vector3(grab.position.x + i, grab.position.y, 0), 0.6, 0.9);
      g.timestamp = i * 100;
      const events = engine.processGesture(g);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('move');
      const move = events[0];
      expect(move.targetId).toBe('w1');
      expect(move.newPosition).toEqual(g.position.clone().sub(grabOffset));
      expect(move.gesture.timestamp).toBe(i * 100);
      moveEvents.push({ newPosition: move.newPosition!, timestamp: move.gesture.timestamp });
    }
    expect(moveEvents.map((m) => m.timestamp)).toEqual([100, 200, 300]);

    // NONE release (D3) carries targetId — the momentum animation trigger.
    const release = engine.processGesture({ ...grab, type: GestureType.NONE });
    expect(release).toHaveLength(1);
    expect(release[0].type).toBe('release');
    expect(release[0].targetId).toBe('w1');
  });

  it('default clock (performance.now) does not throw', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(-1.5, 1.5, -2));
    scene.updateMatrixWorld(true);
    expect(() => engine.processGesture(pointOver(camera, w))).not.toThrow();
  });
});

// M7 (D6): rotate events are read through a narrowing helper — the pre-M7
// event arms do not declare angleDelta, so raw union reads are not legal.
type RotateEvent = Extract<InteractionEvent, { type: 'rotate' }>;
const rotateEvents = (events: InteractionEvent[]): RotateEvent[] =>
  events.filter((e): e is RotateEvent => e.type === 'rotate');

describe('InteractionEngine two-hand twist rotation (M7)', () => {
  // Shared scenario numbers (window at (0, 0, -2), depth 7, camera (0,0,5),
  // fov 75, aspect 16:9): gesture-position -> plane-hit factor is
  // 5/(7·tan(37.5°)·aspect) = 0.5236 on x and 5/(7·tan(37.5°)) = 0.9308 on y,
  // so a pinch at (0.2618, 0.13962, 0) hits the window at (0.5, 0.15, -2)
  // (inside its ±0.75 × ±0.237 half-extents). Expected angles are computed
  // in-test from the same atan2/wrapToPi expressions (formula-assertion
  // style — the file's established convention).
  const JOIN_POS = new THREE.Vector3(0.2618, 0.13962, 0);
  const TWIST_POS = new THREE.Vector3(0.2, 0.5, 0);

  function grabAndJoin(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    wm: WindowManager,
    engine: InteractionEngine,
  ) {
    const w = wm.createWindow('w1', 'A', new THREE.Vector3(0, 0, -2));
    scene.updateMatrixWorld(true);
    engine.processGesture(pinchOver(camera, w, 0.8, 'Right'));
    expect(
      engine.processGesture(
        makeGesture(GestureType.PINCH, JOIN_POS.clone(), 0.8, 0.8, 'Left'),
      ),
    ).toEqual([]);
    return w;
  }

  it('G1+G7: second hand pinching the grabbed window JOINS silently; twist frames emit rotate; secondary never resizes', () => {
    const { scene, camera, wm, engine } = setup();
    grabAndJoin(scene, camera, wm, engine);
    const initialScale = wm.getWindow('w1')!.scale.clone();
    const initialPosition = wm.getWindow('w1')!.position.clone();

    // Left twist continuation: exactly one rotate, correct angle, no move.
    const twistEvents = engine.processGesture(
      makeGesture(GestureType.PINCH, TWIST_POS.clone(), 0.8, 0.8, 'Left'),
    );
    expect(twistEvents.map((e) => e.type)).toEqual(['rotate']);
    const rot = rotateEvents(twistEvents)[0];
    expect(rot.targetId).toBe('w1');
    expect(rot.gesture.handedness).toBe('Left');
    const baseLineAngle = Math.atan2(JOIN_POS.y, JOIN_POS.x);
    const lineAngle1 = Math.atan2(TWIST_POS.y, TWIST_POS.x);
    const expectedDelta1 = wrapToPi(lineAngle1 - baseLineAngle);
    expect(rot.angleDelta).toBeCloseTo(expectedDelta1, 10);
    const expectedTarget1 = wrapToPi(0 + expectedDelta1); // baseRotationY = 0
    expect(wm.getWindow('w1')!.rotation.y).toBeCloseTo(expectedTarget1, 10);
    // Mesh lockstep (manager writes both witnesses).
    expect(wm.getWindowMesh('w1')!.rotation.y).toBeCloseTo(expectedTarget1, 10);
    // Secondary frames never move (D7) — position untouched by join+twist.
    expect(wm.getWindow('w1')!.position).toEqual(initialPosition);

    // G7 fold: a SECONDARY frame with a huge intensity jump still emits no
    // resize (the twist-only branch skips continueGrab entirely) — scale is
    // untouched and the rotate still fires on the angle change.
    const jumpEvents = engine.processGesture(
      makeGesture(GestureType.PINCH, new THREE.Vector3(-0.3, 0.6, 0), 1.5, 1.5, 'Left'),
    );
    expect(jumpEvents.map((e) => e.type)).toEqual(['rotate']);
    expect(wm.getWindow('w1')!.scale).toEqual(initialScale);
  });

  it('G2: primary frames keep dragging while rotation is active ([move, rotate] order)', () => {
    const { scene, camera, wm, engine } = setup();
    grabAndJoin(scene, camera, wm, engine);
    engine.processGesture(
      makeGesture(GestureType.PINCH, TWIST_POS.clone(), 0.8, 0.8, 'Left'),
    );
    const previousTarget = wm.getWindow('w1')!.rotation.y;

    // Right continuation (same intensity — move, not resize): the window
    // follows with the ORIGINAL offset ((0,0,0) - (0,0,-2)) = (0,0,2), and
    // the rotation update runs in the SAME frame, after the move.
    const rightEvents = engine.processGesture(
      makeGesture(GestureType.PINCH, new THREE.Vector3(0.3, 0.1, 0), 0.8, 0.8, 'Right'),
    );
    expect(rightEvents.map((e) => e.type)).toEqual(['move', 'rotate']);
    const [move] = rightEvents;
    expect(move.targetId).toBe('w1');
    expect(move.newPosition).toEqual(new THREE.Vector3(0.3, 0.1, -2));
    expect(wm.getWindow('w1')!.position).toEqual(new THREE.Vector3(0.3, 0.1, -2));

    // The rotate delta is the wrapped per-frame change from the previous
    // target, computed from the recomputed line angle (Right moved).
    const baseLineAngle = Math.atan2(JOIN_POS.y, JOIN_POS.x);
    const lineAngle2 = Math.atan2(0.5 - 0.1, 0.2 - 0.3);
    const target2 = wrapToPi(wrapToPi(lineAngle2 - baseLineAngle)); // base 0
    const expectedDelta2 = wrapToPi(target2 - previousTarget);
    const rot = rotateEvents(rightEvents)[0];
    expect(rot.angleDelta).toBeCloseTo(expectedDelta2, 10);
    // The triggering frame's gesture is the one that computed the update (D6).
    expect(rot.gesture.handedness).toBe('Right');
    expect(wm.getWindow('w1')!.rotation.y).toBeCloseTo(target2, 10);
  });

  it('G3: join is type-agnostic: a GRAB joins a PINCH-held window', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'A', new THREE.Vector3(0, 0, -2));
    scene.updateMatrixWorld(true);
    engine.processGesture(pinchOver(camera, w, 0.8, 'Right'));

    // Left GRAB on the same window: silent join.
    expect(engine.processGesture(grabOver(camera, w, 0.6, 'Left'))).toEqual([]);

    // Left GRAB twist frame (continuation — no raycast needed).
    const events = engine.processGesture(
      makeGesture(GestureType.GRAB, new THREE.Vector3(0.5, 0.5, 0), 0.6, 0.9, 'Left'),
    );
    expect(events.map((e) => e.type)).toEqual(['rotate']);
    expect(rotateEvents(events)[0].targetId).toBe('w1');
    // GRAB continuation stays move-gated for the PRIMARY (G3 uses Right's
    // path below is untouched); the twist angle here is atan2(0.5, 0.5).
    expect(rotateEvents(events)[0].angleDelta).toBeCloseTo(Math.PI / 4, 10);
  });

  it('G4: exit A — primary releases -> secondary takes over as dragger, no jump, no release event', () => {
    const { scene, camera, wm, engine } = setup();
    grabAndJoin(scene, camera, wm, engine);
    engine.processGesture(
      makeGesture(GestureType.PINCH, TWIST_POS.clone(), 0.8, 0.8, 'Left'),
    );
    const preExitPosition = wm.getWindow('w1')!.position.clone();
    const preExitRotation = wm.getWindow('w1')!.rotation.y;

    // Primary (Right) releases via the NONE/POINT path: silent — Left still
    // holds w1 (and Right's off-window POINT has no hover slot to emit).
    expect(engine.processGesture(pointMiss('Right'))).toEqual([]);

    // Left STATIONARY continuation: the survivor was re-anchored (fresh
    // grabOffset at its current position), so the window does NOT jump —
    // newPosition equals the window's pre-exit position.
    const stationary = engine.processGesture(
      makeGesture(GestureType.PINCH, TWIST_POS.clone(), 0.8, 0.8, 'Left'),
    );
    expect(stationary.map((e) => e.type)).toEqual(['move']);
    const anchoredOffset = TWIST_POS.clone().sub(preExitPosition);
    expect(stationary[0].newPosition).toEqual(TWIST_POS.clone().sub(anchoredOffset));
    expect(wm.getWindow('w1')!.position).toEqual(preExitPosition);

    // Left becomes the normal dragger: the window follows its hand.
    const follow = engine.processGesture(
      makeGesture(GestureType.PINCH, new THREE.Vector3(0.5, 0.5, 0), 0.8, 0.8, 'Left'),
    );
    expect(follow.map((e) => e.type)).toEqual(['move']);
    expect(wm.getWindow('w1')!.position).toEqual(new THREE.Vector3(0.3, 0, -2));

    // No rotate events after the exit; the angle persists (no snap-back).
    expect(wm.getWindow('w1')!.rotation.y).toBeCloseTo(preExitRotation, 10);
  });

  it('G5: exit B — secondary releases -> primary continues with its ORIGINAL offset; rotation persists', () => {
    const { scene, camera, wm, engine } = setup();
    grabAndJoin(scene, camera, wm, engine);
    engine.processGesture(
      makeGesture(GestureType.PINCH, TWIST_POS.clone(), 0.8, 0.8, 'Left'),
    );
    const rotatedY = wm.getWindow('w1')!.rotation.y;

    // Secondary (Left) releases: silent — Right still holds w1.
    expect(
      engine.processGesture(makeGesture(GestureType.NONE, new THREE.Vector3(), 0, 0, 'Left')),
    ).toEqual([]);

    // Right continues with the ORIGINAL offset math: (0.4, 0.2, 0) - (0,0,2).
    const rightEvents = engine.processGesture(
      makeGesture(GestureType.PINCH, new THREE.Vector3(0.4, 0.2, 0), 0.8, 0.8, 'Right'),
    );
    expect(rightEvents.map((e) => e.type)).toEqual(['move']);
    expect(rightEvents[0].newPosition).toEqual(new THREE.Vector3(0.4, 0.2, -2));
    // The rotation angle persists exactly where the twist left it.
    expect(wm.getWindow('w1')!.rotation.y).toBeCloseTo(rotatedY, 10);
    // A further Left frame emits nothing (Left has no grab).
    expect(
      engine.processGesture(makeGesture(GestureType.NONE, new THREE.Vector3(1, 1, 0), 0, 0, 'Left')),
    ).toEqual([]);
  });

  it('G6: strong OPEN during rotation — release-all, two same-id releases, rotation off, re-grab works', () => {
    const { scene, camera, wm, engine } = setup();
    grabAndJoin(scene, camera, wm, engine);
    engine.processGesture(
      makeGesture(GestureType.PINCH, TWIST_POS.clone(), 0.8, 0.8, 'Left'),
    );
    const rotatedY = wm.getWindow('w1')!.rotation.y;

    // release-all: TWO releases with the SAME targetId (both hands held w1)
    // — App's release branch is idempotent for a repeated id (D8).
    const releases = engine.processGesture(openHand('Right'));
    expect(releases.map((e) => [e.type, e.targetId])).toEqual([
      ['release', 'w1'],
      ['release', 'w1'],
    ]);
    expect(wm.getWindow('w1')!.rotation.y).toBeCloseTo(rotatedY, 10);

    // Rotation mode re-arms from scratch: grab, join, twist all work.
    engine.processGesture(pinchOver(camera, wm.getWindow('w1')!, 0.8, 'Right'));
    expect(
      engine.processGesture(
        makeGesture(GestureType.PINCH, JOIN_POS.clone(), 0.8, 0.8, 'Left'),
      ),
    ).toEqual([]);
    const twist = engine.processGesture(
      makeGesture(GestureType.PINCH, TWIST_POS.clone(), 0.8, 0.8, 'Left'),
    );
    expect(twist.map((e) => e.type)).toEqual(['rotate']);
    expect(rotateEvents(twist)[0].targetId).toBe('w1');
  });

  it('G8: rotated window is still grabbable at its projected position (matrixWorld honored)', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'A', new THREE.Vector3(0, 0, -2));

    for (const angleDeg of [40, -30]) {
      wm.rotateWindow('w1', THREE.MathUtils.degToRad(angleDeg));
      // matrixWorld freshness — the render loop's job in the browser.
      scene.updateMatrixWorld(true);

      const events = engine.processGesture(pinchOver(camera, w, 0.8, 'Right'));
      expect(events.map((e) => e.type)).toEqual(['grab']);
      expect(events[0].targetId).toBe('w1');
      // The grab must not have disturbed the rotation.
      expect(wm.getWindow('w1')!.rotation.y).toBeCloseTo(
        THREE.MathUtils.degToRad(angleDeg),
        10,
      );
      expect(wm.getWindowMesh('w1')!.rotation.y).toBeCloseTo(
        THREE.MathUtils.degToRad(angleDeg),
        10,
      );
      // Release cleanly before the next variant (re-grab needs a free hand).
      engine.processGesture(openHand('Right'));
    }
  });

  it('G9: one-hand grab never rotates (no join without the second grab)', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'A', new THREE.Vector3(0, 0, -2));
    scene.updateMatrixWorld(true);

    const allEvents: InteractionEvent[] = [];
    allEvents.push(...engine.processGesture(pinchOver(camera, w, 0.8, 'Right')));
    for (const pos of [new THREE.Vector3(0.5, 0.5, 0), new THREE.Vector3(-0.5, 0.5, 0), new THREE.Vector3(0, -0.5, 0)]) {
      allEvents.push(...engine.processGesture(makeGesture(GestureType.PINCH, pos, 0.8, 0.8, 'Right')));
    }

    expect(allEvents.map((e) => e.type)).toEqual(['grab', 'move', 'move', 'move']);
    expect(rotateEvents(allEvents)).toEqual([]);
    expect(wm.getWindow('w1')!.rotation.y).toBe(0);
    expect(wm.getWindowMesh('w1')!.rotation.y).toBe(0);
  });

  it('G10: closed window mid-rotation — continuations drop silently, no stuck rotation slot', () => {
    const { scene, camera, wm, engine } = setup();
    grabAndJoin(scene, camera, wm, engine);

    wm.closeWindow('w1');
    // Both hands' continuations drop silently (the prelude clears the
    // rotation slot targeting the closed window).
    expect(
      engine.processGesture(makeGesture(GestureType.PINCH, new THREE.Vector3(0.5, 0.5, 0), 0.8, 0.8, 'Right')),
    ).toEqual([]);
    expect(
      engine.processGesture(makeGesture(GestureType.PINCH, new THREE.Vector3(-0.5, -0.5, 0), 0.8, 0.8, 'Left')),
    ).toEqual([]);

    // A fresh window elsewhere: normal grab, join, twist — the old slot is
    // gone, so the new rotation targets w2.
    const w2 = wm.createWindow('w2', 'B', new THREE.Vector3(1.5, 1.5, -2));
    scene.updateMatrixWorld(true);
    expect(engine.processGesture(pinchOver(camera, w2, 0.8, 'Right')).map((e) => e.type)).toEqual(['grab']);
    expect(engine.processGesture(pinchOver(camera, w2, 0.8, 'Left'))).toEqual([]);
    const w2Center = pinchOver(camera, w2, 0.8, 'Left').position;
    const twist = engine.processGesture(
      makeGesture(
        GestureType.PINCH,
        new THREE.Vector3(w2Center.x + 1, w2Center.y + 1, 0),
        0.8,
        0.8,
        'Left',
      ),
    );
    expect(twist.map((e) => e.type)).toEqual(['rotate']);
    expect(rotateEvents(twist)[0].targetId).toBe('w2');
  });

  it('G11: wrap-around — base near +PI stays normalized; per-frame angleDelta stays signed', () => {
    const { scene, camera, wm, engine } = setup();
    const w = wm.createWindow('w1', 'A', new THREE.Vector3(0, 0, -2));
    // Base rotation 3.0 rad BEFORE the grab (normalized: 3.0 < PI).
    wm.rotateWindow('w1', 3.0);
    scene.updateMatrixWorld(true);
    expect(wm.getWindow('w1')!.rotation.y).toBeCloseTo(3.0, 10);

    engine.processGesture(pinchOver(camera, w, 0.8, 'Right'));
    expect(
      engine.processGesture(
        makeGesture(GestureType.PINCH, JOIN_POS.clone(), 0.8, 0.8, 'Left'),
      ),
    ).toEqual([]);

    // Twist that adds exactly +0.3 of line angle: the ABSOLUTE target wraps
    // (3.3 -> 3.3 - 2PI ≈ -2.9832) while the PER-FRAME delta stays +0.3.
    const baseLineAngle = Math.atan2(JOIN_POS.y, JOIN_POS.x);
    const twistAngle = baseLineAngle + 0.3;
    const events = engine.processGesture(
      makeGesture(
        GestureType.PINCH,
        new THREE.Vector3(Math.cos(twistAngle), Math.sin(twistAngle), 0),
        0.8,
        0.8,
        'Left',
      ),
    );
    expect(events.map((e) => e.type)).toEqual(['rotate']);
    const rot = rotateEvents(events)[0];
    const expectedTarget = wrapToPi(3.0 + 0.3);
    expect(expectedTarget).toBeCloseTo(3.3 - 2 * Math.PI, 10);
    expect(wm.getWindow('w1')!.rotation.y).toBeCloseTo(expectedTarget, 10);
    expect(rot.angleDelta).toBeCloseTo(0.3, 10);
  });
});

// ---------------------------------------------------------------------------
// M12 (D3): the isEditable ownership gate — OWNER-MUTATES. Additions only;
// every earlier describe runs against the DEFAULT predicate (() => true),
// which these tests also pin as behavior-preserving.
// ---------------------------------------------------------------------------
describe('InteractionEngine M12 isEditable gate', () => {
  it('non-editable windows reject grab start AND continuation (silent)', () => {
    const rig = setup();
    const win = rig.wm.createWindow('remote-1', 'R');
    rig.scene.updateMatrixWorld(true);
    const gated = new InteractionEngine(rig.camera, rig.wm, {
      isEditable: () => false,
    });
    // Grab start: raycast HITS the window, but the gate rejects it — no
    // events, no grab state.
    expect(gated.processGesture(pinchOver(rig.camera, win))).toEqual([]);
    // Continuation frames are equally silent (nothing to continue).
    expect(gated.processGesture(pinchOver(rig.camera, win))).toEqual([]);
    // Strong OPEN also releases nothing (no grab exists).
    expect(gated.processGesture(openHand())).toEqual([]);
    expect(win.position).toEqual(new THREE.Vector3(0, 0, 0));
  });

  it('mid-grab flip to non-editable drops the grab silently (defensive)', () => {
    const rig = setup();
    const win = rig.wm.createWindow('w1', 'W');
    rig.scene.updateMatrixWorld(true);
    let editable = true;
    const engine = new InteractionEngine(rig.camera, rig.wm, {
      isEditable: (id) => editable && id === 'w1',
    });
    const events = engine.processGesture(pinchOver(rig.camera, win));
    expect(events.map((e) => e.type)).toEqual(['grab']);
    // The target flips non-editable (unreachable via the App registry in
    // practice — pinned anyway): the continuation emits NOTHING.
    editable = false;
    const moved = pinchOver(rig.camera, win);
    moved.position.add(new THREE.Vector3(0.3, 0, 0));
    expect(engine.processGesture(moved)).toEqual([]);
    expect(win.position).toEqual(new THREE.Vector3(0, 0, 0));
    // The grab was DROPPED: a strong OPEN releases nothing afterwards.
    expect(engine.processGesture(openHand())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// M13 (D14): Load-workspace mid-grab safety — a window removed by the
// load path (wm.closeWindow under the full App hygiene) clears its grab
// via the EXISTING closed-window hygiene; nothing emits afterwards.
// ---------------------------------------------------------------------------
describe('InteractionEngine M13 load-mid-grab safety', () => {
  it('a grab whose window is closed by LOAD emits nothing and is dropped', () => {
    const rig = setup();
    const win = rig.wm.createWindow('w1', 'W');
    rig.scene.updateMatrixWorld(true);
    const events = rig.engine.processGesture(pinchOver(rig.camera, win));
    expect(events.map((e) => e.type)).toEqual(['grab']);

    // The load path: close the grabbed window (with the App-side hygiene).
    rig.wm.closeWindow('w1');
    rig.scene.updateMatrixWorld(true);

    // Continuation frame: silent (grab dropped, no move on a dead id).
    const moved = pinchOver(rig.camera, win);
    moved.position.add(new THREE.Vector3(0.3, 0, 0));
    expect(rig.engine.processGesture(moved)).toEqual([]);
    // Strong OPEN releases nothing (no grab state exists).
    expect(rig.engine.processGesture(openHand())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase 2: Confidence Gating & Hysteresis
// ---------------------------------------------------------------------------
describe('InteractionEngine Phase 2 Confidence Gating & Hysteresis', () => {
  it('drops low-confidence frames (< 0.6) before initiating a grab or hover', () => {
    const { scene, camera, wm, engine } = setup();
    const win = wm.createWindow('w1', 'Target');
    scene.updateMatrixWorld(true);

    // High confidence grab works
    const lowConfGrab = pinchOver(camera, win);
    lowConfGrab.trackingConfidence = 0.4; // Low tracking confidence

    const events = engine.processGesture(lowConfGrab);
    expect(events).toEqual([]); // Dropped by confidence gate
  });

  it('applies hysteresis: allows lower confidence (>= 0.3) for continuing an active grab', () => {
    const { scene, camera, wm, engine } = setup();
    const win = wm.createWindow('w1', 'Target');
    scene.updateMatrixWorld(true);

    // Start grab with good tracking confidence (0.9)
    const grab = pinchOver(camera, win);
    grab.trackingConfidence = 0.9;
    const startEvents = engine.processGesture(grab);
    expect(startEvents.map((e) => e.type)).toEqual(['grab']);

    // Move frame with moderate tracking confidence (0.45 >= 0.3 hysteresis threshold)
    const moved = pinchOver(camera, win);
    moved.position.add(new THREE.Vector3(0.5, 0, 0));
    moved.trackingConfidence = 0.45;
    const moveEvents = engine.processGesture(moved);
    expect(moveEvents.map((e) => e.type)).toEqual(['move']);

    // Severe tracking loss (< 0.3) drops even active grab continuation frames
    const lost = pinchOver(camera, win);
    lost.position.add(new THREE.Vector3(1.0, 0, 0));
    lost.trackingConfidence = 0.2;
    const lostEvents = engine.processGesture(lost);
    expect(lostEvents).toEqual([]);
  });
});

