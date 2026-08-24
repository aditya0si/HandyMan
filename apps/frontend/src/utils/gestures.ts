import * as THREE from 'three';
import type { Hand, Handedness, Landmark } from '@jarvis/shared';
import { VelocityTracker } from './animation';

/**
 * Gesture recognition (guide step 2.1, TECHNICAL_SPEC 2.2).
 *
 * The guide/spec write `enum GestureType`, but this workspace compiles with
 * `erasableSyntaxOnly` (Vite's current TS template default), which rejects
 * enums. The const-object + union-type pattern below is the erasable
 * equivalent: same values, same `GestureType.PINCH` usage.
 *
 * Landmark geometry: MediaPipe landmarks are normalized 0..1 image units
 * (x/y as a fraction of frame width/height, z relative to the wrist).
 * The guide's comments call the thresholds "3cm/8cm in meters" — that is
 * an errata; the numeric values are kept as the baseline and re-documented
 * here in the units they are actually compared in.
 *
 * M5 (Phase 2 part 1) — advanced gestures: GRAB, SWIPE, bimanual
 * PINCH_ZOOM. Two unit families coexist: per-hand thresholds
 * (PINCH_THRESHOLD, OPEN_FINGER_THRESHOLD, GRAB_FINGER_CURL_THRESHOLD, ...)
 * are compared against raw normalized image distances (0..1), while the
 * velocity/rate constants (SWIPE_*, PINCH_ZOOM_*) operate in WORLD units/s
 * — positions span -5..5 via landmarkToVector3. Two timebases, never mixed
 * (M4 lesson): ALL velocity/rate math uses the injected frame clock `nowMs`
 * (default performance.now(), matching HandTracker's onResults); only the
 * emitted Gesture.timestamp stays on the Date.now() base (App's momentum
 * tracker pushes with gesture.timestamp).
 */

export const GestureType = {
  PINCH: 'pinch',
  GRAB: 'grab',
  POINT: 'point',
  TWO_FINGER: 'two_finger',
  OPEN: 'open',
  SWIPE: 'swipe',
  PINCH_ZOOM: 'pinch_zoom',
  NONE: 'none',
} as const;

export type GestureType = (typeof GestureType)[keyof typeof GestureType];

/** SWIPE direction in scene axes (+x image-right, +y image-up). */
export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

/** PINCH_ZOOM direction: 'in' = hands closing, 'out' = hands spreading. */
export type ZoomDirection = 'in' | 'out';

export interface Gesture {
  type: GestureType;
  /** 0..1 — how certain the classifier is of the type. */
  confidence: number;
  /** 0..1 — MediaPipe tracking confidence for this hand. */
  trackingConfidence?: number;
  /** 0..1 — how "strong" the gesture is (e.g. pinch tightness). */
  intensity: number;
  /** Position of the pinch/point in the 3D scene. */
  position: THREE.Vector3;
  handedness: Handedness;
  timestamp: number;
  /** SWIPE only: dominant planar direction (see SwipeDirection). */
  swipeDirection?: SwipeDirection;
  /** PINCH_ZOOM only: sign of the distance change. */
  zoomDirection?: ZoomDirection;
}

// --- Tunable thresholds (normalized image units, 0..1) ----------------------

/** Thumb-index distance below which a hand counts as pinching (~3% of frame). */
export const PINCH_THRESHOLD = 0.03;

/** Minimum fingertip-to-palm-center distance for every finger in an open hand. */
export const OPEN_FINGER_THRESHOLD = 0.08;

/** Index-tip-to-palm-center distance above which the index is "extended". */
export const POINT_INDEX_EXTENDED_THRESHOLD = 0.12;

/** Middle-tip-to-palm-center distance below which non-pointing fingers are "closed". */
export const POINT_OTHER_FINGER_THRESHOLD = 0.08;

/** Middle-tip-to-palm-center distance above which the middle finger joins
 *  the index in the TWO_FINGER (scroll) pose. */
export const TWO_FINGER_SECOND_EXTENDED_THRESHOLD = 0.12;

/** Fingertip-to-palm-center distance below which a finger counts as curled.
 *  Deliberately equal to OPEN_FINGER_THRESHOLD (one symmetric boundary), as
 *  its own constant for independent tuning (POINT_OTHER_FINGER_THRESHOLD
 *  precedent). */
export const GRAB_FINGER_CURL_THRESHOLD = 0.08;

// --- M5 velocity/rate constants (WORLD units/s, see module docblock) ---------

/** SWIPE: planar (x,y) palm velocity in WORLD units/s. Spec: 20cm/200ms =
 *  1 m/s ~= 15-20 world units/s (10-unit span ~ 50-70cm at arm's length).
 *  2.5 is deliberately sensitive for first real-camera tuning; raise toward
 *  15-20 if ordinary motion triggers swipes. */
export const SWIPE_VELOCITY_THRESHOLD = 2.5;

/** SWIPE velocity window (~spec 200ms) and its sample count (~30fps). */
export const SWIPE_VELOCITY_WINDOW_MS = 200;
export const SWIPE_VELOCITY_WINDOW_SAMPLES = 7;

/** SWIPE refractory: minimum gap between fires per hand (plus re-arm). */
export const SWIPE_REFRACTORY_MS = 500;

/** PINCH_ZOOM deadband: |d(pinch midpoints)/dt| below this emits nothing
 *  (world units/s, planar). Raise if static double-pinch emits on jitter;
 *  lower if gentle zooms do not register. */
export const PINCH_ZOOM_MIN_RATE = 0.5;

/** PINCH_ZOOM rate that maps to intensity 1.0 (world units/s). */
export const PINCH_ZOOM_MAX_RATE = 5;

/**
 * Temporal stability filter: a gesture TYPE change is only emitted after this
 * many consecutive agreeing classifications (~100 ms at 30 fps). Spec-aligned
 * addition per TECHNICAL_SPEC 2.2 `gestureDuration` (spec sketch: 5 frames);
 * 3 frames trades a little latency for stability at M2's 30 fps pipeline.
 * Intensity/position are never debounced — they track every frame.
 */
export const GESTURE_STABLE_FRAMES = 3;

// --- Landmark indices (MediaPipe Hands 21-point model) -----------------------

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_TIP = 12;
const RING_TIP = 16;
const PINKY_TIP = 20;
/** Middle-finger MCP — with the wrist it defines the palm center (guide 2.1). */
const PALM_LANDMARK = 9;

const FINGER_TIPS = [THUMB_TIP, INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP] as const;

// --- Geometry helpers ---------------------------------------------------------

/** Euclidean distance between two normalized landmarks. */
export function distance(a: Landmark, b: Landmark): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

/** Midpoint between two landmarks. */
export function midpoint(a: Landmark, b: Landmark): Landmark {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

/** Maps a normalized landmark into the scene's world coordinates:
 * X/Y span -5..5 (mirrored on Y so up is up), Z scales depth by 10. */
export function landmarkToVector3(landmark: Landmark): THREE.Vector3 {
  return new THREE.Vector3(
    (landmark.x - 0.5) * 10,
    -(landmark.y - 0.5) * 10,
    landmark.z * 10,
  );
}

/** All five fingertips clearly away from the palm center. */
function isHandOpen(landmarks: Landmark[], palmCenter: Landmark): boolean {
  return FINGER_TIPS.every(
    (tip) => distance(palmCenter, landmarks[tip]) > OPEN_FINGER_THRESHOLD,
  );
}

/** Index finger extended while the middle finger stays closed. */
function isPointing(landmarks: Landmark[], palmCenter: Landmark): boolean {
  const indexExtended =
    distance(palmCenter, landmarks[INDEX_TIP]) > POINT_INDEX_EXTENDED_THRESHOLD;
  const othersClose =
    distance(palmCenter, landmarks[MIDDLE_TIP]) < POINT_OTHER_FINGER_THRESHOLD;
  return indexExtended && othersClose;
}

/** TWO_FINGER (content-scroll) pose: index AND middle extended, ring and
 *  pinky curled. Disjoint from every other pose by construction — POINT
 *  needs the middle closed, OPEN needs all five extended, PINCH needs the
 *  thumb on the index, GRAB needs everything curled. */
function isTwoFinger(landmarks: Landmark[], palmCenter: Landmark): boolean {
  const indexExtended =
    distance(palmCenter, landmarks[INDEX_TIP]) > POINT_INDEX_EXTENDED_THRESHOLD;
  const middleExtended =
    distance(palmCenter, landmarks[MIDDLE_TIP]) > TWO_FINGER_SECOND_EXTENDED_THRESHOLD;
  const ringClosed =
    distance(palmCenter, landmarks[RING_TIP]) < POINT_OTHER_FINGER_THRESHOLD;
  const pinkyClosed =
    distance(palmCenter, landmarks[PINKY_TIP]) < POINT_OTHER_FINGER_THRESHOLD;
  return indexExtended && middleExtended && ringClosed && pinkyClosed;
}

/** All five fingertips curled toward the palm center (D1 rule). */
function isGrabbing(landmarks: Landmark[], palmCenter: Landmark): boolean {
  return FINGER_TIPS.every(
    (tip) => distance(palmCenter, landmarks[tip]) < GRAB_FINGER_CURL_THRESHOLD,
  );
}

/** Mean curledness 0..1: clamp01(1 - dist/GRAB_FINGER_CURL_THRESHOLD) per tip. */
function curledness(landmarks: Landmark[], palmCenter: Landmark): number {
  let sum = 0;
  for (const tip of FINGER_TIPS) {
    sum += clamp01(1 - distance(palmCenter, landmarks[tip]) / GRAB_FINGER_CURL_THRESHOLD);
  }
  return sum / FINGER_TIPS.length;
}

// --- Recognizer ----------------------------------------------------------------

interface HandStabilityState {
  /** Gesture type currently being emitted for this hand. */
  stableType: GestureType;
  /** Disagreeing type seen in the most recent run of frames. */
  candidateType: GestureType;
  /** Length of the current run of `candidateType` classifications. */
  candidateCount: number;
}

/** M5 SWIPE event-channel state (D3), one slot per handedness. */
interface SwipeState {
  /** Rolling planar-velocity tracker fed with the palm-center world
   *  position at each frame's injected clock. */
  tracker: VelocityTracker;
  /** Frame clock of the last SWIPE fire; -Infinity before the first fire. */
  lastSwipeMs: number;
  /** Re-armed on ANY frame with planar speed < SWIPE_VELOCITY_THRESHOLD. */
  armed: boolean;
}

/**
 * Classifies each detected hand into a gesture (guide step 2.1).
 *
 * M5 scope (Phase 2 part 1):
 * - GRAB is classified per D1/D2: all five fingertips curled toward the
 *   palm center, checked BEFORE PINCH so a fist (or "lazy pinch") wins over
 *   a spec-conformant pinch (which needs the other fingers open). GRAB is a
 *   STATE gesture — it passes through stabilize() like PINCH/OPEN.
 * - SWIPE is an EVENT channel riding on the state channel (D3-D5): it never
 *   enters stabilize(); the returned gesture is overridden for exactly one
 *   frame, then OPEN resumes. Fires only when armed AND
 *   nowMs - lastSwipeMs >= SWIPE_REFRACTORY_MS; any frame with planar
 *   speed < SWIPE_VELOCITY_THRESHOLD re-arms.
 * - PINCH_ZOOM is produced ONLY by recognizeBimanual (D6) — classifyHand can
 *   never emit it.
 *
 * Per-hand state is keyed by handedness ("Left"/"Right"). With maxNumHands=2
 * MediaPipe almost always reports one of each; the rare duplicate-label frame
 * simply shares one stability slot (accepted simplification). State for a hand
 * that disappears is dropped, so a reappearing hand is re-detected instantly.
 */
export class GestureRecognizer {
  private readonly stability = new Map<Handedness, HandStabilityState>();

  /** M5 SWIPE event-channel state, pruned with `stability` for absent hands. */
  private readonly swipeStates = new Map<Handedness, SwipeState>();

  /** M5 bimanual anchor slot; reset whenever the two-hand-both-pinch
   *  condition breaks (see recognizeBimanual). */
  private bimanual: { prevDistance: number; lastMs: number } | null = null;

  /**
   * Classifies + stabilizes every hand, then rides the SWIPE event channel
   * on top (D3): the palm-center world position is pushed into the hand's
   * VelocityTracker at `nowMs`, planar speed is computed every frame (also
   * on non-OPEN frames, purely to maintain `armed`), and on fire the
   * stabilized gesture is replaced for exactly this one frame.
   */
  recognizeGestures(hands: Hand[], nowMs: number = performance.now()): Gesture[] {
    const seen = new Set<Handedness>();
    const gestures = hands.map((hand) => {
      seen.add(hand.handedness);
      const stabilized = this.stabilize(this.classifyHand(hand), hand);

      let swipe = this.swipeStates.get(hand.handedness);
      if (!swipe) {
        swipe = {
          tracker: new VelocityTracker(
            SWIPE_VELOCITY_WINDOW_SAMPLES,
            SWIPE_VELOCITY_WINDOW_MS,
          ),
          lastSwipeMs: -Infinity,
          armed: true,
        };
        this.swipeStates.set(hand.handedness, swipe);
      }

      const palmCenter = midpoint(hand.landmarks[WRIST], hand.landmarks[PALM_LANDMARK]);
      swipe.tracker.push(landmarkToVector3(palmCenter), nowMs);
      const velocity = swipe.tracker.getVelocity();
      const speed = Math.hypot(velocity.x, velocity.y);

      if (speed < SWIPE_VELOCITY_THRESHOLD) {
        swipe.armed = true;
        return stabilized;
      }
      if (stabilized.type !== GestureType.OPEN) return stabilized;
      if (!swipe.armed) return stabilized;
      if (nowMs - swipe.lastSwipeMs < SWIPE_REFRACTORY_MS) return stabilized;
      swipe.lastSwipeMs = nowMs;
      swipe.armed = false;
      return this.buildSwipeEvent(hand, velocity, speed);
    });
    for (const key of this.stability.keys()) {
      if (!seen.has(key)) this.stability.delete(key);
    }
    for (const key of this.swipeStates.keys()) {
      if (!seen.has(key)) this.swipeStates.delete(key);
    }
    return gestures;
  }

  /**
   * M5 bimanual PINCH_ZOOM (D6), self-contained and order-independent: it
   * RAW-classifies both hands itself (classifyHand — no dependence on the
   * stability map or on recognizeGestures having been called). Fires only
   * when EXACTLY two hands are present and BOTH raw-classify as PINCH.
   *
   * - Primary hand: the one with handedness 'Right' if present, else
   *   hands[0] (deterministic); the emitted gesture carries its handedness.
   * - Distance: PLANAR (x,y only) world-units distance between the two
   *   hands' thumb-index pinch midpoints. z is wrist-relative PER HAND, so
   *   cross-hand z is meaningless (same reasoning as M4 buildMomentumSpec
   *   zeroing z).
   * - State: one slot {prevDistance, lastMs}. The anchor advances EVERY
   *   both-pinching frame, so a sub-deadband drift never accumulates into a
   *   later false emit. Condition break (not two hands / not both pinching)
   *   resets the anchor — a later static re-pinch emits nothing until the
   *   distance actually changes.
   * - Deadband: emit iff |d - prevDistance| / dt >= PINCH_ZOOM_MIN_RATE
   *   (0.5 u/s; raise if static double-pinch emits on jitter, lower if
   *   gentle zooms do not register). Intensity = clamp01(rate /
   *   PINCH_ZOOM_MAX_RATE), so it tracks the rate every frame while zooming.
   * - NOT passed through stabilize(): the deadband IS the filter — a
   *   changing-distance stream emits one PINCH_ZOOM per frame; a static
   *   two-hand pinch emits nothing.
   */
  recognizeBimanual(hands: Hand[], nowMs: number = performance.now()): Gesture[] {
    if (hands.length !== 2) {
      this.bimanual = null;
      return [];
    }
    const pinching = hands.filter(
      (hand) => this.classifyHand(hand).type === GestureType.PINCH,
    );
    if (pinching.length !== 2) {
      this.bimanual = null;
      return [];
    }

    const primary = pinching.find((h) => h.handedness === 'Right') ?? hands[0];
    const pinchMidpoint = (hand: Hand): THREE.Vector3 =>
      landmarkToVector3(midpoint(hand.landmarks[THUMB_TIP], hand.landmarks[INDEX_TIP]));
    const m1 = pinchMidpoint(pinching[0]);
    const m2 = pinchMidpoint(pinching[1]);
    const d = Math.hypot(m1.x - m2.x, m1.y - m2.y);

    if (!this.bimanual) {
      this.bimanual = { prevDistance: d, lastMs: nowMs };
      return [];
    }
    const prevDistance = this.bimanual.prevDistance;
    const dt = (nowMs - this.bimanual.lastMs) / 1000;
    // Anchor still advances on dt <= 0 (duplicate/out-of-order clocks).
    this.bimanual = { prevDistance: d, lastMs: nowMs };
    if (dt <= 0) return [];
    const rate = Math.abs(d - prevDistance) / dt;
    if (rate < PINCH_ZOOM_MIN_RATE) return [];

    return [
      {
        type: GestureType.PINCH_ZOOM,
        confidence: 0.85,
        intensity: clamp01(rate / PINCH_ZOOM_MAX_RATE),
        position: new THREE.Vector3((m1.x + m2.x) / 2, (m1.y + m2.y) / 2, (m1.z + m2.z) / 2),
        handedness: primary.handedness,
        trackingConfidence: Math.min(pinching[0].confidence, pinching[1].confidence),
        timestamp: Date.now(),
        zoomDirection: d > prevDistance ? 'out' : 'in',
      },
    ];
  }

  /** Raw (unfiltered) per-frame classification, guide's distance logic.
   *  Branch order (D2): GRAB first — a fist has thumb+index close and would
   *  otherwise satisfy PINCH's distance test; with GRAB first, a
   *  spec-conformant pinch (other fingers extended, >= 0.08) falls through
   *  to PINCH while a fist or "lazy pinch" (thumb-index close AND
   *  middle/ring/pinky curled) wins as GRAB. */
  private classifyHand(hand: Hand): Gesture {
    const landmarks = hand.landmarks;
    const palmCenter = midpoint(landmarks[WRIST], landmarks[PALM_LANDMARK]);
    const thumbIndexDist = distance(landmarks[THUMB_TIP], landmarks[INDEX_TIP]);

    let type: GestureType;
    if (isGrabbing(landmarks, palmCenter)) {
      type = GestureType.GRAB;
    } else if (thumbIndexDist < PINCH_THRESHOLD) {
      type = GestureType.PINCH;
    } else if (isHandOpen(landmarks, palmCenter)) {
      type = GestureType.OPEN;
    } else if (isTwoFinger(landmarks, palmCenter)) {
      type = GestureType.TWO_FINGER;
    } else if (isPointing(landmarks, palmCenter)) {
      type = GestureType.POINT;
    } else {
      type = GestureType.NONE;
    }
    return this.buildGesture(type, hand);
  }

  /**
   * Temporal stability filter: the emitted TYPE only changes after
   * GESTURE_STABLE_FRAMES consecutive agreeing classifications; a first
   * observation (or reappearance) is stable immediately. Values are never
   * debounced: during the debounce window the stable type is re-measured
   * from the current frame's landmarks, so intensity decays/grows smoothly
   * (e.g. a releasing pinch's intensity slides to 0 before the type flips).
   */
  private stabilize(raw: Gesture, hand: Hand): Gesture {
    let state = this.stability.get(raw.handedness);
    if (!state) {
      this.stability.set(raw.handedness, {
        stableType: raw.type,
        candidateType: raw.type,
        candidateCount: GESTURE_STABLE_FRAMES,
      });
      return raw;
    }

    if (raw.type === state.stableType) {
      state.candidateType = raw.type;
      state.candidateCount = GESTURE_STABLE_FRAMES;
      return raw;
    }

    if (raw.type === state.candidateType) {
      state.candidateCount += 1;
    } else {
      state.candidateType = raw.type;
      state.candidateCount = 1;
    }

    if (state.candidateCount >= GESTURE_STABLE_FRAMES) {
      state.stableType = raw.type;
      return raw;
    }
    return this.buildGesture(state.stableType, hand);
  }

  /**
   * Builds the emitted gesture for `type` from the CURRENT frame's landmarks,
   * so confidence/intensity/position always describe where the hand is now
   * (guide step 2.1 field semantics).
   */
  private buildGesture(type: GestureType, hand: Hand): Gesture {
    const landmarks = hand.landmarks;
    const palmCenter = midpoint(landmarks[WRIST], landmarks[PALM_LANDMARK]);
    const timestamp = Date.now();

    switch (type) {
      case GestureType.GRAB:
        return {
          type,
          confidence: 0.9,
          intensity: curledness(landmarks, palmCenter),
          position: landmarkToVector3(palmCenter),
          handedness: hand.handedness,
          trackingConfidence: hand.confidence,
          timestamp,
        };
      case GestureType.PINCH: {
        const tightness = clamp01(
          1 - distance(landmarks[THUMB_TIP], landmarks[INDEX_TIP]) / PINCH_THRESHOLD,
        );
        return {
          type,
          confidence: tightness,
          intensity: tightness,
          position: landmarkToVector3(
            midpoint(landmarks[THUMB_TIP], landmarks[INDEX_TIP]),
          ),
          handedness: hand.handedness,
          trackingConfidence: hand.confidence,
          timestamp,
        };
      }
      case GestureType.OPEN:
        return {
          type,
          confidence: 0.9,
          intensity: 1,
          position: landmarkToVector3(palmCenter),
          handedness: hand.handedness,
          trackingConfidence: hand.confidence,
          timestamp,
        };
      case GestureType.POINT:
        return {
          type,
          confidence: 0.85,
          intensity: 0.5,
          position: landmarkToVector3(landmarks[INDEX_TIP]),
          handedness: hand.handedness,
          trackingConfidence: hand.confidence,
          timestamp,
        };
      case GestureType.TWO_FINGER:
        return {
          type,
          confidence: 0.85,
          intensity: 0.5,
          position: landmarkToVector3(landmarks[INDEX_TIP]),
          handedness: hand.handedness,
          trackingConfidence: hand.confidence,
          timestamp,
        };
      case GestureType.NONE:
        return {
          type,
          confidence: 0,
          intensity: 0,
          position: landmarkToVector3(palmCenter),
          handedness: hand.handedness,
          trackingConfidence: hand.confidence,
          timestamp,
        };
      default:
        // classifyHand can never produce SWIPE or PINCH_ZOOM: SWIPE is built
        // by the event channel (buildSwipeEvent), PINCH_ZOOM only by
        // recognizeBimanual, so this arm is unreachable.
        throw new Error(`GestureRecognizer: gesture "${type}" is not implemented yet`);
    }
  }

  /**
   * M5 SWIPE event (D3/D4): direction = dominant planar axis of `velocity`
   * in scene coordinates (|vx| >= |vy| -> horizontal, ties prefer
   * horizontal — deterministic), intensity = clamp01(planarSpeed /
   * (2 * SWIPE_VELOCITY_THRESHOLD)) — fires only at speed >= threshold, so
   * emitted intensity is always in [0.5, 1] and monotonic in speed.
   * Position = this frame's palm-center world position.
   */
  private buildSwipeEvent(
    hand: Hand,
    velocity: THREE.Vector3,
    planarSpeed: number,
  ): Gesture {
    const palmCenter = midpoint(hand.landmarks[WRIST], hand.landmarks[PALM_LANDMARK]);
    const swipeDirection: SwipeDirection =
      Math.abs(velocity.x) >= Math.abs(velocity.y)
        ? velocity.x >= 0
          ? 'right'
          : 'left'
        : velocity.y >= 0
          ? 'up'
          : 'down';
    return {
      type: GestureType.SWIPE,
      confidence: 0.88,
      intensity: clamp01(planarSpeed / (2 * SWIPE_VELOCITY_THRESHOLD)),
      position: landmarkToVector3(palmCenter),
      handedness: hand.handedness,
      trackingConfidence: hand.confidence,
      timestamp: Date.now(),
      swipeDirection,
    };
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
