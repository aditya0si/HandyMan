import * as THREE from 'three';

/**
 * Animation & smoothing (guide step 4.1) with documented deviations:
 * injectable clock, apply-callback instead of Object3D, plus
 * momentum/velocity/smoothing helpers required by the M4 integration design
 * (see docs/briefs/m4-coder-brief.md).
 *
 * DEVIATIONS from guide 4.1 (design decisions D1/D2 in the M4 brief):
 * - `object: THREE.Object3D` is replaced by an `apply(position)` callback:
 *   writing `mesh.position` directly would break WindowManager's state/mesh
 *   lockstep (every mutation must update state AND mesh together). App wires
 *   the callback to `WindowManager.moveWindow`, so momentum animations move
 *   state and mesh atomically and can never desync.
 * - Every time-taking method accepts an optional `nowMs` defaulting to
 *   `performance.now()` (the guide uses `Date.now()`): performance.now() is
 *   monotonic and matches the rAF frame timestamps, and the injectable clock
 *   makes unit tests deterministic.
 * - Momentum is Layer 1 of the M4 smoothing design: it runs only when no grab
 *   is active, and any new grab cancels it (App wiring). Layer 2 (smooth
 *   follow) lives in App's projection path and is read-side only.
 */

/** Guide 4.1 easing: 1 - (1 - t)^3. Exported for tests and tuning. */
export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** Smooth-follow lerp factor for the projection path (sanctioned band 0.15-0.3). */
export const SMOOTH_FOLLOW_FACTOR = 0.3;
/** Spec §2.2: momentum carries for 0.5 s after release. */
export const MOMENTUM_DURATION = 0.5;
/** Releases slower than this (world units / s) start no momentum animation. */
export const MOMENTUM_MIN_SPEED = 0.3;
/** Momentum end clamp: the interaction volume landmarks can reach. */
export const WORKSPACE_XY_LIMIT = 5;
export const WORKSPACE_Z_MIN = -4;
export const WORKSPACE_Z_MAX = 1;

/** Guide 4.1 default animation duration (seconds). */
const DEFAULT_ANIMATION_DURATION = 0.3;

export interface AnimationSpec {
  /** Start position (copied on add). */
  from: THREE.Vector3;
  /** End position (copied on add — callers may reuse their vectors). */
  to: THREE.Vector3;
  /** Seconds; default 0.3 (guide default). duration <= 0 completes on first update. */
  duration?: number;
  /**
   * Writes the eased position each tick. App wires this to
   * WindowManager.moveWindow so state and mesh move in lockstep. The vector is
   * a reused scratch buffer — consume or copy it synchronously (moveWindow copies).
   */
  apply: (position: THREE.Vector3) => void;
  /** Fires exactly once, after the final exact-`to` write. */
  onComplete?: () => void;
}

interface AnimationState {
  from: THREE.Vector3;
  to: THREE.Vector3;
  duration: number;
  startTime: number;
  apply: (position: THREE.Vector3) => void;
  onComplete?: () => void;
}

export class AnimationController {
  private readonly animations = new Map<string, AnimationState>();
  // One reused buffer for the eased position handed to apply() each tick.
  private readonly scratch = new THREE.Vector3();

  /** Adds or REPLACES the animation for `id` (guide Map.set semantics: the
   *  replaced animation's onComplete never fires). */
  addAnimation(id: string, spec: AnimationSpec, nowMs?: number): void {
    this.animations.set(id, {
      from: spec.from.clone(),
      to: spec.to.clone(),
      duration: spec.duration ?? DEFAULT_ANIMATION_DURATION,
      startTime: nowMs ?? performance.now(),
      apply: spec.apply,
      onComplete: spec.onComplete,
    });
  }

  /** Advances all animations to nowMs (default performance.now()): writes
   *  eased positions via apply; completes/removes finished ones. */
  update(nowMs?: number): void {
    const now = nowMs ?? performance.now();
    // Map.forEach tolerates deleting the current entry mid-iteration.
    this.animations.forEach((state, id) => {
      const elapsed = (now - state.startTime) / 1000;
      // duration <= 0 completes on the first update (no division-by-zero).
      const progress =
        state.duration <= 0 ? 1 : Math.min(elapsed / state.duration, 1);
      if (progress >= 1) {
        // The final write is the exact `to` — a last lerp can leave float
        // residue (e.g. 9.999999).
        state.apply(state.to);
        state.onComplete?.();
        this.animations.delete(id);
        return;
      }
      const eased = easeOutCubic(progress);
      this.scratch.lerpVectors(state.from, state.to, eased);
      state.apply(this.scratch);
    });
  }

  /** Removes the animation for `id` immediately: no onComplete, no final write. */
  cancelAnimation(id: string): void {
    this.animations.delete(id);
  }

  hasAnimation(id: string): boolean {
    return this.animations.has(id);
  }

  get activeAnimationCount(): number {
    return this.animations.size;
  }
}

interface VelocitySample {
  position: THREE.Vector3;
  timestampMs: number;
}

export class VelocityTracker {
  private readonly maxSamples: number;
  private readonly maxAgeMs: number;
  private readonly samples: VelocitySample[] = [];

  /** maxSamples: rolling window length; maxAgeMs: samples older than the
   *  NEWEST sample by more than this are ignored (no external clock — avoids
   *  mixing Date.now() gesture timestamps with performance.now()). */
  constructor(maxSamples = 5, maxAgeMs = 250) {
    this.maxSamples = maxSamples;
    this.maxAgeMs = maxAgeMs;
  }

  /** Records a position sample (copied) at timestampMs (caller's base). */
  push(position: THREE.Vector3, timestampMs: number): void {
    this.samples.push({ position: position.clone(), timestampMs });
    if (this.samples.length > this.maxSamples) this.samples.shift();
  }

  /** Mean velocity over the valid window (world units / s); zero vector when
   *  fewer than 2 valid samples. */
  getVelocity(): THREE.Vector3 {
    const valid = this.validSamples();
    if (valid.length < 2) return new THREE.Vector3();

    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    let count = 0;
    for (let i = 1; i < valid.length; i += 1) {
      const prev = valid[i - 1];
      const curr = valid[i];
      const dt = (curr.timestampMs - prev.timestampMs) / 1000;
      if (dt <= 0) continue; // duplicate/out-of-order samples add nothing
      sumX += (curr.position.x - prev.position.x) / dt;
      sumY += (curr.position.y - prev.position.y) / dt;
      sumZ += (curr.position.z - prev.position.z) / dt;
      count += 1;
    }
    if (count === 0) return new THREE.Vector3();
    return new THREE.Vector3(sumX / count, sumY / count, sumZ / count);
  }

  clear(): void {
    this.samples.length = 0;
  }

  /** Samples within maxAgeMs of the newest sample's timestamp (relative aging
   *  keeps the tracker independent of any absolute clock base). */
  private validSamples(): VelocitySample[] {
    if (this.samples.length === 0) return [];
    let newest = this.samples[0].timestampMs;
    for (const sample of this.samples) {
      if (sample.timestampMs > newest) newest = sample.timestampMs;
    }
    return this.samples.filter(
      (sample) => newest - sample.timestampMs <= this.maxAgeMs,
    );
  }
}

export class PositionSmoother {
  private readonly followFactor: number;
  private readonly positions = new Map<string, THREE.Vector3>();

  constructor(followFactor: number = SMOOTH_FOLLOW_FACTOR) {
    this.followFactor = followFactor;
  }

  /** First sample for an id SEEDS with target (returned exactly — no fly-in);
   *  afterwards the stored vector lerps toward target by followFactor and a
   *  clone is returned. */
  sample(id: string, target: THREE.Vector3): THREE.Vector3 {
    const stored = this.positions.get(id);
    if (!stored) {
      const seeded = target.clone();
      this.positions.set(id, seeded);
      return seeded.clone();
    }
    stored.lerp(target, this.followFactor);
    return stored.clone();
  }

  /** Drops state for an id (window closed). */
  forget(id: string): void {
    this.positions.delete(id);
  }

  clear(): void {
    this.positions.clear();
  }
}

/** Momentum end-position math: end = clamp(from + velocity * MOMENTUM_DURATION)
 *  with the z-velocity zeroed. Returns null when |velocity| < MOMENTUM_MIN_SPEED. */
export function buildMomentumSpec(
  from: THREE.Vector3,
  velocity: THREE.Vector3,
): { to: THREE.Vector3; duration: number } | null {
  // gesture.position.z is wrist-relative and noisy (M3 fact), so momentum is
  // horizontal-only; the speed gate uses the same surviving components, so a
  // z-only (noise) drift can never start an animation and a still release
  // never drifts.
  const horizontal = new THREE.Vector3(velocity.x, velocity.y, 0);
  if (horizontal.length() < MOMENTUM_MIN_SPEED) return null;

  const end = from.clone().addScaledVector(horizontal, MOMENTUM_DURATION);
  end.x = clamp(end.x, -WORKSPACE_XY_LIMIT, WORKSPACE_XY_LIMIT);
  end.y = clamp(end.y, -WORKSPACE_XY_LIMIT, WORKSPACE_XY_LIMIT);
  end.z = clamp(end.z, WORKSPACE_Z_MIN, WORKSPACE_Z_MAX);
  return { to: end, duration: MOMENTUM_DURATION };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
