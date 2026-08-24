import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Handedness } from '@jarvis/shared';
import type { Gesture } from './gestures';
import { GestureType } from './gestures';
import { WindowManager, WINDOW_ASPECT } from './windowManager';
import {
  InteractionEngine,
  GESTURE_WORLD_HALF_EXTENT,
} from './interactionEngine';
import type { InteractionEvent } from './interactionEngine';
import {
  AnimationController,
  PositionSmoother,
  VelocityTracker,
  buildMomentumSpec,
  easeOutCubic,
  MOMENTUM_DURATION,
  MOMENTUM_MIN_SPEED,
  SMOOTH_FOLLOW_FACTOR,
  WORKSPACE_XY_LIMIT,
  WORKSPACE_Z_MIN,
  WORKSPACE_Z_MAX,
} from './animation';

/**
 * Animation & smoothing unit tests (node environment, pure three.js math).
 * All clocks are injected — zero real-timing dependencies except the
 * no-throw smoke and the perf smoke (both explicitly allowed by the M4 brief,
 * section 8).
 *
 * The integration suites replicate the App wiring with the same helpers the
 * M4 brief specifies (applyEvents), so momentum is verified against a REAL
 * WindowManager + InteractionEngine: state == mesh == applied value after
 * every tick, monotonic approach to the clamped end, exact completion, and
 * grab-cancellation freezing the window mid-flight.
 */

const CAMERA_FOV = 75;
const CAMERA_Z = 5;

interface Rig {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  wm: WindowManager;
  engine: InteractionEngine;
}

function setupRig(): Rig {
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
  timestamp = 0,
): Gesture {
  return { type, confidence, intensity, position, handedness, timestamp };
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
  timestamp = 0,
): Gesture {
  const ndc = ndcThroughCenter(camera, window);
  return makeGesture(
    GestureType.PINCH,
    new THREE.Vector3(
      ndc.x * GESTURE_WORLD_HALF_EXTENT,
      ndc.y * GESTURE_WORLD_HALF_EXTENT,
      0,
    ),
    intensity,
    intensity,
    handedness,
    timestamp,
  );
}

/** OPEN with the recognizer's fixed confidence (0.9 > OPEN_RELEASE_CONFIDENCE). */
function openHand(handedness: Handedness = 'Right', timestamp = 0): Gesture {
  return makeGesture(GestureType.OPEN, new THREE.Vector3(0, 0, 0), 1, 0.9, handedness, timestamp);
}

/** The App wiring replicated for tests (see App.handleInteractionEvent). */
interface Wiring {
  wm: WindowManager;
  controller: AnimationController;
  trackers: Map<string, VelocityTracker>;
}

function applyEvents(
  events: InteractionEvent[],
  wiring: Wiring,
  nowMs?: number,
): void {
  const { wm, controller, trackers } = wiring;
  for (const event of events) {
    if (event.type === 'grab') {
      // A new grab kills any in-flight momentum; the tracker starts fresh.
      controller.cancelAnimation(event.targetId);
      trackers.set(event.targetId, new VelocityTracker());
    } else if (event.type === 'move') {
      let tracker = trackers.get(event.targetId);
      if (!tracker) {
        tracker = new VelocityTracker();
        trackers.set(event.targetId, tracker);
      }
      tracker.push(event.newPosition!, event.gesture.timestamp);
    } else if (event.type === 'release') {
      const tracker = trackers.get(event.targetId);
      trackers.delete(event.targetId);
      const win = wm.getWindow(event.targetId);
      if (!win) continue;
      const velocity = tracker?.getVelocity() ?? new THREE.Vector3();
      const spec = buildMomentumSpec(win.position, velocity);
      if (!spec) continue;
      controller.addAnimation(
        event.targetId,
        {
          from: win.position,
          to: spec.to,
          duration: spec.duration,
          apply: (p) => wm.moveWindow(event.targetId, p),
        },
        nowMs,
      );
    }
    // resize: nothing to do (scale is not animated).
  }
}

describe('easeOutCubic', () => {
  it('hits the endpoints and the guide midpoint (f(0.5) = 0.875)', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 10);
  });

  it('is monotonic non-decreasing over a [0, 1] grid', () => {
    let previous = easeOutCubic(0);
    for (let i = 1; i <= 100; i += 1) {
      const value = easeOutCubic(i / 100);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('eases OUT: segment deltas strictly shrink toward t = 1', () => {
    const q1 = easeOutCubic(0.25) - easeOutCubic(0);
    const q2 = easeOutCubic(0.5) - easeOutCubic(0.25);
    const q3 = easeOutCubic(0.75) - easeOutCubic(0.5);
    const q4 = 1 - easeOutCubic(0.75);
    expect(q1).toBeGreaterThan(q2);
    expect(q2).toBeGreaterThan(q3);
    expect(q3).toBeGreaterThan(q4);
  });
});

describe('AnimationController', () => {
  it('eased midpoint: 1 s from (0,0,0) to (10,0,0) applies x ~ 8.75 at t+500ms', () => {
    const controller = new AnimationController();
    const applied: number[] = [];
    controller.addAnimation(
      'w1',
      {
        from: new THREE.Vector3(0, 0, 0),
        to: new THREE.Vector3(10, 0, 0),
        duration: 1,
        apply: (p) => applied.push(p.x),
      },
      0,
    );
    controller.update(500);
    // eased = 1 - (1 - 0.5)^3 = 0.875 -> x = 10 * 0.875
    expect(applied[applied.length - 1]).toBeCloseTo(8.75, 10);
  });

  it('completion writes the exact `to` (no float residue) and removes the animation', () => {
    const controller = new AnimationController();
    const applied: number[] = [];
    controller.addAnimation(
      'w1',
      {
        from: new THREE.Vector3(0, 0, 0),
        to: new THREE.Vector3(10, 0, 0),
        duration: 1,
        apply: (p) => applied.push(p.x),
      },
      0,
    );
    controller.update(1000);
    expect(applied[applied.length - 1]).toBe(10);
    expect(controller.hasAnimation('w1')).toBe(false);
    expect(controller.activeAnimationCount).toBe(0);
  });

  it('over-deadline updates apply nothing more', () => {
    const controller = new AnimationController();
    const applied: number[] = [];
    controller.addAnimation(
      'w1',
      {
        from: new THREE.Vector3(0, 0, 0),
        to: new THREE.Vector3(10, 0, 0),
        duration: 1,
        apply: (p) => applied.push(p.x),
      },
      0,
    );
    controller.update(1000);
    const count = applied.length;
    controller.update(1500);
    controller.update(100000);
    expect(applied.length).toBe(count);
  });

  it('onComplete fires exactly once across multiple over-deadline updates', () => {
    const controller = new AnimationController();
    const onComplete = vi.fn();
    controller.addAnimation(
      'w1',
      {
        from: new THREE.Vector3(0, 0, 0),
        to: new THREE.Vector3(10, 0, 0),
        duration: 1,
        apply: () => undefined,
        onComplete,
      },
      0,
    );
    controller.update(1000);
    controller.update(2000);
    controller.update(3000);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('cancel mid-flight: no further applies, no onComplete, hasAnimation false', () => {
    const controller = new AnimationController();
    const applied: number[] = [];
    const onComplete = vi.fn();
    controller.addAnimation(
      'w1',
      {
        from: new THREE.Vector3(0, 0, 0),
        to: new THREE.Vector3(10, 0, 0),
        duration: 1,
        apply: (p) => applied.push(p.x),
        onComplete,
      },
      0,
    );
    controller.update(500);
    expect(applied).toHaveLength(1);

    controller.cancelAnimation('w1');
    expect(controller.hasAnimation('w1')).toBe(false);
    expect(controller.activeAnimationCount).toBe(0);
    controller.update(600);
    controller.update(5000);
    expect(applied).toHaveLength(1); // frozen: no further writes
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('re-adding an id replaces the animation (first onComplete never fires)', () => {
    const controller = new AnimationController();
    const applied: number[] = [];
    const firstComplete = vi.fn();
    const secondComplete = vi.fn();
    controller.addAnimation(
      'w1',
      {
        from: new THREE.Vector3(0, 0, 0),
        to: new THREE.Vector3(10, 0, 0),
        duration: 1,
        apply: (p) => applied.push(p.x),
        onComplete: firstComplete,
      },
      0,
    );
    controller.addAnimation(
      'w1',
      {
        from: new THREE.Vector3(0, 0, 0),
        to: new THREE.Vector3(100, 0, 0),
        duration: 1,
        apply: (p) => applied.push(p.x),
        onComplete: secondComplete,
      },
      0,
    );
    expect(controller.activeAnimationCount).toBe(1);
    controller.update(1000);
    expect(applied[applied.length - 1]).toBe(100); // new target wins
    expect(firstComplete).not.toHaveBeenCalled();
    expect(secondComplete).toHaveBeenCalledTimes(1);
  });

  it('from/to are copied on add: mutating caller vectors does not affect the animation', () => {
    const controller = new AnimationController();
    const applied: THREE.Vector3[] = [];
    const from = new THREE.Vector3(0, 0, 0);
    const to = new THREE.Vector3(10, 0, 0);
    controller.addAnimation(
      'w1',
      { from, to, duration: 1, apply: (p) => applied.push(p.clone()) },
      0,
    );
    from.set(999, 999, 999);
    to.set(999, 999, 999);

    controller.update(500);
    expect(applied[applied.length - 1].x).toBeCloseTo(8.75, 10);
    expect(applied[applied.length - 1].y).toBe(0);
    controller.update(1000);
    expect(applied[applied.length - 1].x).toBe(10);
    expect(applied[applied.length - 1].y).toBe(0);
  });

  it('two concurrent ids animate independently', () => {
    const controller = new AnimationController();
    const appliedA: number[] = [];
    const appliedB: number[] = [];
    controller.addAnimation(
      'a',
      {
        from: new THREE.Vector3(0, 0, 0),
        to: new THREE.Vector3(10, 0, 0),
        duration: 1,
        apply: (p) => appliedA.push(p.x),
      },
      100,
    );
    controller.addAnimation(
      'b',
      {
        from: new THREE.Vector3(0, 0, 0),
        to: new THREE.Vector3(20, 0, 0),
        duration: 2,
        apply: (p) => appliedB.push(p.x),
      },
      100,
    );
    expect(controller.activeAnimationCount).toBe(2);

    controller.update(1100);
    expect(appliedA[appliedA.length - 1]).toBe(10); // a finished exactly
    expect(appliedB[appliedB.length - 1]).toBeCloseTo(17.5, 10); // b at 0.875
    expect(controller.hasAnimation('a')).toBe(false);
    expect(controller.hasAnimation('b')).toBe(true);

    controller.update(2100);
    expect(appliedB[appliedB.length - 1]).toBe(20);
    expect(controller.activeAnimationCount).toBe(0);
  });

  it('duration <= 0 completes on the first update with the exact `to`', () => {
    const controller = new AnimationController();
    const applied: number[] = [];
    const onComplete = vi.fn();
    controller.addAnimation(
      'a',
      {
        from: new THREE.Vector3(0, 0, 0),
        to: new THREE.Vector3(10, 0, 0),
        duration: 0,
        apply: (p) => applied.push(p.x),
        onComplete,
      },
      0,
    );
    controller.addAnimation(
      'b',
      {
        from: new THREE.Vector3(0, 0, 0),
        to: new THREE.Vector3(20, 0, 0),
        duration: -1,
        apply: (p) => applied.push(p.x),
      },
      0,
    );
    controller.update(0);
    expect(applied[applied.length - 2]).toBe(10);
    expect(applied[applied.length - 1]).toBe(20);
    expect(controller.activeAnimationCount).toBe(0);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('default duration is 0.3 s (eased midpoint at t+150ms, exact end at t+300ms)', () => {
    const controller = new AnimationController();
    const applied: number[] = [];
    controller.addAnimation(
      'w1',
      {
        from: new THREE.Vector3(0, 0, 0),
        to: new THREE.Vector3(10, 0, 0),
        apply: (p) => applied.push(p.x),
      },
      0,
    );
    controller.update(150); // progress 0.5 -> 8.75 (only true for 0.3 s)
    expect(applied[applied.length - 1]).toBeCloseTo(8.75, 10);
    controller.update(300); // progress 1 -> exact end
    expect(applied[applied.length - 1]).toBe(10);
  });

  it('update() with the default clock does not throw (no-throw smoke)', () => {
    const controller = new AnimationController();
    expect(() => controller.update()).not.toThrow();
  });

  it('the first update at startTime applies exactly `from`', () => {
    const controller = new AnimationController();
    const applied: THREE.Vector3[] = [];
    controller.addAnimation(
      'w1',
      {
        from: new THREE.Vector3(2, 3, 4),
        to: new THREE.Vector3(10, 10, 10),
        duration: 1,
        apply: (p) => applied.push(p.clone()),
      },
      500,
    );
    controller.update(500);
    expect(applied[applied.length - 1]).toEqual(new THREE.Vector3(2, 3, 4));
  });
});

describe('VelocityTracker', () => {
  it('constant velocity: +1 x per 100 ms over 5 samples -> 10 u/s on x', () => {
    const tracker = new VelocityTracker();
    for (let i = 0; i < 5; i += 1) {
      tracker.push(new THREE.Vector3(i, 0, 0), i * 100);
    }
    const v = tracker.getVelocity();
    expect(v.x).toBeCloseTo(10, 10);
    expect(v.y).toBe(0);
    expect(v.z).toBe(0);
  });

  it('fewer than 2 valid samples -> zero vector', () => {
    const tracker = new VelocityTracker();
    expect(tracker.getVelocity().length()).toBe(0);
    tracker.push(new THREE.Vector3(1, 1, 1), 0);
    const v = tracker.getVelocity();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(v.z).toBe(0);
  });

  it('samples older than the newest sample by maxAgeMs are dropped', () => {
    const tracker = new VelocityTracker();
    for (let i = 0; i < 4; i += 1) {
      tracker.push(new THREE.Vector3(i, 0, 0), i * 100);
    }
    // New sample 700 ms later: everything before t=750 is stale (age > 250ms),
    // leaving a single valid sample -> zero velocity.
    tracker.push(new THREE.Vector3(50, 0, 0), 1000);
    const v = tracker.getVelocity();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(v.z).toBe(0);
  });

  it('clear() resets the window and a fresh push records again', () => {
    const tracker = new VelocityTracker();
    tracker.push(new THREE.Vector3(0, 0, 0), 0);
    tracker.push(new THREE.Vector3(1, 0, 0), 100);
    expect(tracker.getVelocity().x).toBeCloseTo(10, 10);
    tracker.clear();
    expect(tracker.getVelocity().length()).toBe(0);
    tracker.push(new THREE.Vector3(0, 0, 0), 200);
    tracker.push(new THREE.Vector3(0, 2, 0), 300);
    const v = tracker.getVelocity();
    expect(v.x).toBe(0);
    expect(v.y).toBeCloseTo(20, 10);
  });

  it('y-axis velocity is computed with x untouched', () => {
    const tracker = new VelocityTracker();
    tracker.push(new THREE.Vector3(0, 0, 0), 0);
    tracker.push(new THREE.Vector3(0, 2, 0), 100);
    tracker.push(new THREE.Vector3(0, 4, 0), 200);
    const v = tracker.getVelocity();
    expect(v.x).toBe(0);
    expect(v.y).toBeCloseTo(20, 10);
    expect(v.z).toBe(0);
  });
});

describe('PositionSmoother', () => {
  it('the first sample for an id SEEDS with the target (returned exactly)', () => {
    const smoother = new PositionSmoother();
    const target = new THREE.Vector3(3, 4, 5);
    const first = smoother.sample('w1', target);
    expect(first).toEqual(target);
    // Seeding is exact even when the stored vector would otherwise lerp.
    expect(smoother.sample('w1', target)).toEqual(target);
  });

  it('successive samples approach the target with strictly decreasing distance (factor 0.3)', () => {
    const smoother = new PositionSmoother(0.3);
    const target = new THREE.Vector3(10, 0, 0);
    smoother.sample('w1', new THREE.Vector3(0, 0, 0)); // seed
    let previous = target.length();
    for (let i = 0; i < 10; i += 1) {
      const presented = smoother.sample('w1', target);
      const distance = presented.distanceTo(target);
      expect(distance).toBeLessThan(previous);
      previous = distance;
    }
  });

  it('converges: after ~15 samples the distance is under 1% of the initial gap', () => {
    const smoother = new PositionSmoother(SMOOTH_FOLLOW_FACTOR);
    const target = new THREE.Vector3(10, 0, 0);
    smoother.sample('w1', new THREE.Vector3(0, 0, 0)); // seed
    for (let i = 0; i < 15; i += 1) {
      smoother.sample('w1', target);
    }
    const presented = smoother.sample('w1', target);
    expect(presented.distanceTo(target)).toBeLessThan(target.length() * 0.01);
  });

  it('forget() drops the state so the next target re-seeds exactly', () => {
    const smoother = new PositionSmoother();
    smoother.sample('w1', new THREE.Vector3(0, 0, 0));
    expect(smoother.sample('w1', new THREE.Vector3(10, 0, 0)).x).toBeCloseTo(3, 10);
    smoother.forget('w1');
    expect(smoother.sample('w1', new THREE.Vector3(10, 0, 0))).toEqual(
      new THREE.Vector3(10, 0, 0),
    );
  });
});

describe('buildMomentumSpec', () => {
  it('straight-line math: from (0,1,-2), v (2,0,0) -> to (1,1,-2), duration 0.5', () => {
    const spec = buildMomentumSpec(
      new THREE.Vector3(0, 1, -2),
      new THREE.Vector3(2, 0, 0),
    );
    expect(spec).not.toBeNull();
    expect(spec!.duration).toBe(MOMENTUM_DURATION);
    expect(spec!.to.x).toBeCloseTo(1, 10);
    expect(spec!.to.y).toBeCloseTo(1, 10);
    expect(spec!.to.z).toBeCloseTo(-2, 10);
  });

  it('z-velocity is zeroed (wrist-relative z is noisy)', () => {
    const spec = buildMomentumSpec(
      new THREE.Vector3(0, 1, -2),
      new THREE.Vector3(2, 0, 5),
    );
    expect(spec).not.toBeNull();
    expect(spec!.to.z).toBeCloseTo(-2, 10); // z unchanged despite v.z = 5
    expect(spec!.to.x).toBeCloseTo(1, 10);
  });

  it('clamps the end to the interaction volume (|x|,|y| <= 5, z in [-4, 1])', () => {
    const spec = buildMomentumSpec(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(100, -100, 0),
    );
    expect(spec!.to.x).toBe(WORKSPACE_XY_LIMIT);
    expect(spec!.to.y).toBe(-WORKSPACE_XY_LIMIT);
    expect(spec!.to.z).toBe(0);

    const low = buildMomentumSpec(
      new THREE.Vector3(0, 0, -10),
      new THREE.Vector3(2, 0, 0),
    );
    expect(low!.to.z).toBe(WORKSPACE_Z_MIN);

    const high = buildMomentumSpec(
      new THREE.Vector3(0, 0, 5),
      new THREE.Vector3(2, 0, 0),
    );
    expect(high!.to.z).toBe(WORKSPACE_Z_MAX);
  });

  it('releases slower than MOMENTUM_MIN_SPEED (or z-only noise) return null', () => {
    expect(
      buildMomentumSpec(new THREE.Vector3(), new THREE.Vector3(0.1, 0, 0)),
    ).toBeNull();
    expect(
      buildMomentumSpec(
        new THREE.Vector3(),
        new THREE.Vector3(0, 0, 100), // z-only: horizontal speed is 0
      ),
    ).toBeNull();
    expect(
      buildMomentumSpec(
        new THREE.Vector3(),
        new THREE.Vector3(MOMENTUM_MIN_SPEED, 0, 0),
      ),
    ).not.toBeNull();
  });
});

describe('M4 integration: momentum through a real WindowManager + InteractionEngine', () => {
  it('an animation applied through moveWindow keeps state == mesh == applied after every tick', () => {
    const { wm } = setupRig();
    wm.createWindow('w1', 'Test', new THREE.Vector3(0, 0, 0));
    const controller = new AnimationController();
    const applied: THREE.Vector3[] = [];
    controller.addAnimation(
      'w1',
      {
        from: new THREE.Vector3(0, 0, 0),
        to: new THREE.Vector3(2, 2, -1),
        duration: 1,
        apply: (p) => {
          applied.push(p.clone());
          wm.moveWindow('w1', p);
        },
      },
      1000,
    );
    for (let tick = 1000; tick <= 2000; tick += 100) {
      controller.update(tick);
      const win = wm.getWindow('w1')!;
      const mesh = wm.getWindowMesh('w1')!;
      expect(win.position).toEqual(mesh.position);
      expect(applied[applied.length - 1]).toEqual(win.position);
    }
    expect(wm.getWindow('w1')!.position).toEqual(new THREE.Vector3(2, 2, -1));
  });

  it('momentum pipeline: grab -> moves -> release animates monotonically to the clamped end, and a new grab freezes it', () => {
    const { scene, camera, wm, engine } = setupRig();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(0, 1.5, -2));
    scene.updateMatrixWorld(true);
    const controller = new AnimationController();
    const trackers = new Map<string, VelocityTracker>();
    const wiring = { wm, controller, trackers };

    // Grab at t=0: fresh tracker, no animation yet.
    const grabGesture = pinchOver(camera, w, 0.8, 'Right', 0);
    const grab = engine.processGesture(grabGesture);
    expect(grab.map((e) => e.type)).toEqual(['grab']);
    applyEvents(grab, wiring, 0);
    expect(trackers.has('w1')).toBe(true);
    expect(controller.activeAnimationCount).toBe(0);

    // The engine anchors the grab with an offset (gesture.position is the
    // z=0 NDC-mapped point, the window sits at z=-2): continuation gestures
    // must add that offset so the window lands on the intended position.
    const grabOffset = grabGesture.position
      .clone()
      .sub(wm.getWindow('w1')!.position);

    // Two continuation moves at +0.5 x per 100 ms -> tracker velocity 5 u/s.
    for (const t of [100, 200]) {
      const desired = wm
        .getWindow('w1')!
        .position.clone()
        .add(new THREE.Vector3(0.5, 0, 0));
      const move = makeGesture(
        GestureType.PINCH,
        desired.add(grabOffset),
        0.8,
        0.8,
        'Right',
        t,
      );
      const events = engine.processGesture(move);
      expect(events.map((e) => e.type)).toEqual(['move']);
      applyEvents(events, wiring, t);
    }
    expect(wm.getWindow('w1')!.position.x).toBeCloseTo(1, 10);
    expect(wm.getWindow('w1')!.position.y).toBeCloseTo(1.5, 10);
    expect(wm.getWindow('w1')!.position.z).toBeCloseTo(-2, 10);

    // Open-hand release starts the momentum animation (5 u/s * 0.5 s = +2.5 x).
    const release = engine.processGesture(openHand('Right', 300));
    expect(release.map((e) => [e.type, e.targetId])).toEqual([
      ['release', 'w1'],
    ]);
    applyEvents(release, wiring, 300);
    expect(controller.activeAnimationCount).toBe(1);
    expect(trackers.has('w1')).toBe(false);

    // Monotonic glide toward the (unclamped) end; lockstep after EVERY tick.
    // The first tick (t=300) applies exactly `from` (progress 0), so the
    // monotonicity loop starts at t=350.
    let prevX = wm.getWindow('w1')!.position.x;
    for (let tick = 350; tick < 800; tick += 50) {
      controller.update(tick);
      const win = wm.getWindow('w1')!;
      const mesh = wm.getWindowMesh('w1')!;
      expect(win.position).toEqual(mesh.position);
      expect(win.position.x).toBeGreaterThan(prevX);
      expect(win.position.x).toBeLessThanOrEqual(3.5);
      prevX = win.position.x;
    }
    controller.update(800);
    expect(wm.getWindow('w1')!.position).toEqual(
      new THREE.Vector3(3.5, 1.5, -2),
    );
    expect(wm.getWindowMesh('w1')!.position).toEqual(
      new THREE.Vector3(3.5, 1.5, -2),
    );
    expect(controller.activeAnimationCount).toBe(0);

    // Headless raycasts read mesh.matrixWorld: refresh it after the momentum
    // moved the mesh, or the next grab would aim at a stale matrix.
    scene.updateMatrixWorld(true);

    // Second run with a faster hand: the momentum end hits the x clamp (5).
    const grab2Gesture = pinchOver(camera, w, 0.8, 'Right', 800);
    applyEvents(engine.processGesture(grab2Gesture), wiring, 800);
    const grabOffset2 = grab2Gesture.position
      .clone()
      .sub(wm.getWindow('w1')!.position);
    for (const t of [900, 1000]) {
      const desired = wm
        .getWindow('w1')!
        .position.clone()
        .add(new THREE.Vector3(1, 0, 0));
      const move = makeGesture(
        GestureType.PINCH,
        desired.add(grabOffset2),
        0.8,
        0.8,
        'Right',
        t,
      );
      applyEvents(engine.processGesture(move), wiring, t);
    }
    applyEvents(engine.processGesture(openHand('Right', 1100)), wiring, 1100);
    expect(controller.activeAnimationCount).toBe(1);
    controller.update(1100); // first tick: applies `from` exactly
    expect(wm.getWindow('w1')!.position.x).toBeCloseTo(5.5, 10);
    controller.update(1250); // mid-flight
    expect(wm.getWindow('w1')!.position.x).toBeLessThan(5.5);
    expect(wm.getWindow('w1')!.position.x).toBeGreaterThan(5);

    // Refresh the mesh matrix before the freeze grab raycasts again.
    scene.updateMatrixWorld(true);

    // A new grab cancels the momentum: the window freezes mid-flight.
    const frozen = wm.getWindow('w1')!.position.clone();
    applyEvents(engine.processGesture(pinchOver(camera, w, 0.8, 'Right', 1250)), wiring, 1250);
    expect(controller.activeAnimationCount).toBe(0);
    expect(trackers.has('w1')).toBe(true);
    for (let tick = 1300; tick <= 3000; tick += 100) {
      controller.update(tick);
    }
    expect(wm.getWindow('w1')!.position).toEqual(frozen);
    expect(wm.getWindowMesh('w1')!.position).toEqual(frozen);
  });

  it('perf smoke: processGesture + momentum bookkeeping averages < 5 ms per frame', () => {
    const { scene, camera, wm, engine } = setupRig();
    const w = wm.createWindow('w1', 'Test', new THREE.Vector3(0, 1.5, -2));
    scene.updateMatrixWorld(true);
    const controller = new AnimationController();
    const trackers = new Map<string, VelocityTracker>();
    const wiring = { wm, controller, trackers };

    // A real engine/manager loop with the App wiring; grab/move/release cycle
    // every 10 frames so cancel/tracker/momentum/update paths all run. The
    // window oscillates so grabs keep landing (aim stays on-screen).
    const iterations = 200;
    let clock = 0;
    let grabOffset = new THREE.Vector3();
    const t0 = performance.now();
    for (let i = 0; i < iterations; i += 1) {
      clock += 100;
      let gesture: Gesture;
      if (i % 10 === 0) {
        gesture = pinchOver(camera, w, 0.8, 'Right', clock);
        grabOffset = gesture.position
          .clone()
          .sub(wm.getWindow('w1')!.position);
      } else if (i % 10 === 9) {
        gesture = openHand('Right', clock);
      } else {
        const deltaX = wm.getWindow('w1')!.position.x < 3 ? 0.2 : -0.2;
        const desired = wm
          .getWindow('w1')!
          .position.clone()
          .add(new THREE.Vector3(deltaX, 0, 0));
        gesture = makeGesture(
          GestureType.PINCH,
          desired.add(grabOffset),
          0.8,
          0.8,
          'Right',
          clock,
        );
      }
      applyEvents(engine.processGesture(gesture), wiring, clock);
      controller.update(clock);
    }
    const elapsedMs = performance.now() - t0;
    const averageMs = elapsedMs / iterations;
    console.info(
      `perf smoke: momentum pipeline avg ${averageMs.toFixed(3)} ms/frame over ${iterations} iterations`,
    );
    expect(averageMs).toBeLessThan(5);
  });
});
