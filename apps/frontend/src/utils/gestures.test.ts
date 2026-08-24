import { describe, expect, it } from 'vitest';
import type { Hand, Handedness, Landmark } from '@jarvis/shared';
import type { Gesture } from './gestures';
import {
  GestureRecognizer,
  GestureType,
  GESTURE_STABLE_FRAMES,
  GRAB_FINGER_CURL_THRESHOLD,
  OPEN_FINGER_THRESHOLD,
  PINCH_THRESHOLD,
  PINCH_ZOOM_MAX_RATE,
  POINT_INDEX_EXTENDED_THRESHOLD,
  SWIPE_VELOCITY_THRESHOLD,
  distance,
  landmarkToVector3,
  midpoint,
} from './gestures';

/**
 * Synthetic-landmark unit tests for the gesture recognizer (M2 deviation
 * from the guide: Chromium's fake webcam shows no hands, so hand-crafted
 * poses are the only automatable classification evidence).
 *
 * Poses are SIMPLIFIED GEOMETRIC poses, not anatomically exact hands: the
 * classifier only reads landmark 0 (wrist), 9 (middle MCP), and the five
 * fingertips (4/8/12/16/20), so each pose sets those exactly (satisfying
 * the distance relations under the tuned thresholds) and interpolates the
 * remaining joints. Thresholds are imported so the poses and expected
 * values stay correct if the constants are retuned.
 */

// Shared pose geometry: wrist + middle-MCP define palmCenter (0.5, 0.7, 0).
const WRIST: [number, number] = [0.5, 0.8];
const PALM_MCP: [number, number] = [0.5, 0.6];
const PALM_CENTER: Landmark = midpoint(toLandmark(WRIST), toLandmark(PALM_MCP));

function toLandmark([x, y]: [number, number], z = 0): Landmark {
  return { x, y, z };
}

interface PoseSpec {
  thumbTip: [number, number];
  indexTip: [number, number];
  middleTip: [number, number];
  ringTip: [number, number];
  pinkyTip: [number, number];
}

const FINGERS: ReadonlyArray<{ base: number; tip: number; key: keyof PoseSpec }> = [
  { base: 1, tip: 4, key: 'thumbTip' },
  { base: 5, tip: 8, key: 'indexTip' },
  { base: 9, tip: 12, key: 'middleTip' },
  { base: 13, tip: 16, key: 'ringTip' },
  { base: 17, tip: 20, key: 'pinkyTip' },
];

/** Builds a 21-landmark hand whose key points match `spec` exactly. */
function poseHand(spec: PoseSpec, handedness: Handedness = 'Right'): Hand {
  const landmarks: Landmark[] = [];
  landmarks[0] = toLandmark(WRIST);
  landmarks[9] = toLandmark(PALM_MCP);
  for (const { base, tip, key } of FINGERS) {
    const from = base === 9 ? landmarks[9] : landmarks[0];
    const tipLm = toLandmark(spec[key]);
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

// --- Poses (all thresholds verified below via expect-side sanity checks) -----

/** Pinch, thumb-index distance 0.01 (intensity 1 - 0.01/PINCH_THRESHOLD).
 *  E1 (M5): middle/ring/pinky raised so the other fingers are clearly open
 *  (palm dist 0.122 / 0.112 / 0.113 > GRAB_FINGER_CURL_THRESHOLD 0.08) —
 *  the spec says PINCH = "other fingers open". Thumb/index UNCHANGED. */
const pinchPose = poseHand({
  thumbTip: [0.48, 0.68],
  indexTip: [0.49, 0.68],
  middleTip: [0.52, 0.58],
  ringTip: [0.55, 0.6],
  pinkyTip: [0.58, 0.62],
});

/** Tighter pinch, thumb-index distance 0.005. */
const tightPinchPose = poseHand({
  thumbTip: [0.478, 0.68],
  indexTip: [0.483, 0.68],
  middleTip: [0.52, 0.58],
  ringTip: [0.55, 0.6],
  pinkyTip: [0.58, 0.62],
});

/** Looser pinch (still below threshold), thumb-index distance 0.02. */
const loosePinchPose = poseHand({
  thumbTip: [0.47, 0.68],
  indexTip: [0.49, 0.68],
  middleTip: [0.52, 0.58],
  ringTip: [0.55, 0.6],
  pinkyTip: [0.58, 0.62],
});

/** Open hand: every fingertip clearly beyond OPEN_FINGER_THRESHOLD from palm. */
const openPose = poseHand({
  thumbTip: [0.38, 0.72],
  indexTip: [0.42, 0.55],
  middleTip: [0.5, 0.52],
  ringTip: [0.57, 0.55],
  pinkyTip: [0.63, 0.6],
});

/** Point: index extended past POINT_INDEX_EXTENDED_THRESHOLD, middle closed. */
const pointPose = poseHand({
  thumbTip: [0.44, 0.7],
  indexTip: [0.52, 0.5],
  middleTip: [0.5, 0.655],
  ringTip: [0.53, 0.65],
  pinkyTip: [0.56, 0.66],
});

/** Relaxed/ambiguous: no branch fires (thumb-index apart, nothing extended). */
const nonePose = poseHand({
  thumbTip: [0.44, 0.68],
  indexTip: [0.46, 0.62],
  middleTip: [0.5, 0.64],
  ringTip: [0.54, 0.65],
  pinkyTip: [0.57, 0.66],
});

/** Fist: ALL five tips curled below GRAB_FINGER_CURL_THRESHOLD, and
 *  thumb-index = 0.026 < PINCH_THRESHOLD — the GRAB-over-PINCH precedence
 *  proof (this would classify PINCH under the pre-M5 branch order). */
const fistPose = poseHand({
  thumbTip: [0.487, 0.685],
  indexTip: [0.513, 0.685],
  middleTip: [0.53, 0.67],
  ringTip: [0.52, 0.73],
  pinkyTip: [0.49, 0.74],
});

/** Looser fist: all five still curled (palm dists 0.041-0.064) but visibly
 *  looser — curledness ≈ 0.32 vs the fist's ≈ 0.60 (intensity monotonicity
 *  check). */
const looseFistPose = poseHand({
  thumbTip: [0.46, 0.71],
  indexTip: [0.54, 0.71],
  middleTip: [0.55, 0.66],
  ringTip: [0.54, 0.75],
  pinkyTip: [0.47, 0.755],
});

/** Lazy pinch: pinchPose's thumb/index (distance 0.01 < PINCH_THRESHOLD)
 *  PLUS fistPose's curled middle/ring/pinky — all five curled, so it must
 *  classify GRAB (deliberate M5 semantic: spec PINCH requires open other
 *  fingers). */
const lazyPinchPose = poseHand({
  thumbTip: [0.48, 0.68],
  indexTip: [0.49, 0.68],
  middleTip: [0.53, 0.67],
  ringTip: [0.52, 0.73],
  pinkyTip: [0.49, 0.74],
});

/** Clones a Hand adding dx/dy to every landmark's x/y (classification-
 *  invariant translation). A normalized-units shift s per frame over dt ms
 *  gives a world velocity of s*10/(dt/1000) u/s (landmarkToVector3 spans
 *  -5..5, so 0.04 per 100 ms = 4 u/s). */
function shiftHand(hand: Hand, dx: number, dy: number): Hand {
  return {
    ...hand,
    landmarks: hand.landmarks.map((lm) => ({ ...lm, x: lm.x + dx, y: lm.y + dy })),
  };
}

// --- Geometry helpers ---------------------------------------------------------

describe('gesture geometry helpers', () => {
  it('distance is Euclidean in 3D', () => {
    expect(distance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBe(5);
    expect(distance({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 2 })).toBe(2);
  });

  it('midpoint averages each axis', () => {
    expect(midpoint({ x: 0, y: 0, z: 0 }, { x: 2, y: 4, z: 6 })).toEqual({
      x: 1,
      y: 2,
      z: 3,
    });
  });

  it('landmarkToVector3 maps normalized coords into the scene', () => {
    const center = landmarkToVector3({ x: 0.5, y: 0.5, z: 0.1 });
    // toBeCloseTo (not toBe): the mirrored Y axis can produce -0 here.
    expect(center.x).toBeCloseTo(0, 10);
    expect(center.y).toBeCloseTo(0, 10);
    expect(center.z).toBeCloseTo(1, 10);

    const mapped = landmarkToVector3({ x: 0.6, y: 0.7, z: -0.2 });
    expect(mapped.x).toBeCloseTo(1, 10); // (0.6 - 0.5) * 10
    expect(mapped.y).toBeCloseTo(-2, 10); // -(0.7 - 0.5) * 10
    expect(mapped.z).toBeCloseTo(-2, 10); // -0.2 * 10
  });
});

// --- Single-frame classification ----------------------------------------------

describe('GestureRecognizer classification', () => {
  it('pose sanity: synthetic poses satisfy the intended distance relations', () => {
    // Pinch poses: thumb-index below threshold.
    for (const pose of [pinchPose, tightPinchPose, loosePinchPose]) {
      const d = distance(pose.landmarks[4], pose.landmarks[8]);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThan(PINCH_THRESHOLD);
    }
    // Open pose: every fingertip beyond the open threshold.
    for (const tip of [4, 8, 12, 16, 20]) {
      expect(distance(PALM_CENTER, openPose.landmarks[tip])).toBeGreaterThan(
        OPEN_FINGER_THRESHOLD,
      );
    }
    // Point pose: index extended, middle closed.
    expect(distance(PALM_CENTER, pointPose.landmarks[8])).toBeGreaterThan(
      POINT_INDEX_EXTENDED_THRESHOLD,
    );
    expect(distance(PALM_CENTER, pointPose.landmarks[12])).toBeLessThan(
      OPEN_FINGER_THRESHOLD,
    );
    // Fist pose: every fingertip curled (all five below the GRAB threshold).
    for (const tip of [4, 8, 12, 16, 20]) {
      expect(distance(PALM_CENTER, fistPose.landmarks[tip])).toBeLessThan(
        GRAB_FINGER_CURL_THRESHOLD,
      );
    }
    // Lazy pinch: thumb-index close AND middle/ring/pinky curled (GRAB wins).
    expect(distance(lazyPinchPose.landmarks[4], lazyPinchPose.landmarks[8])).toBeLessThan(
      PINCH_THRESHOLD,
    );
    for (const tip of [12, 16, 20]) {
      expect(distance(PALM_CENTER, lazyPinchPose.landmarks[tip])).toBeLessThan(
        GRAB_FINGER_CURL_THRESHOLD,
      );
    }
    // Adjusted pinch poses (E1): the non-pinching fingers are clearly open,
    // so a spec-conformant pinch does NOT satisfy the all-five-curled rule.
    for (const pose of [pinchPose, tightPinchPose, loosePinchPose]) {
      for (const tip of [12, 16, 20]) {
        expect(distance(PALM_CENTER, pose.landmarks[tip])).toBeGreaterThan(
          GRAB_FINGER_CURL_THRESHOLD,
        );
      }
    }
  });

  it('pinch pose classifies as PINCH at the thumb-index midpoint', () => {
    const [gesture] = new GestureRecognizer().recognizeGestures([pinchPose]);
    expect(gesture.type).toBe(GestureType.PINCH);
    expect(gesture.handedness).toBe('Right');

    const expectedIntensity = 1 - 0.01 / PINCH_THRESHOLD;
    expect(gesture.intensity).toBeCloseTo(expectedIntensity, 10);
    expect(gesture.intensity).toBeGreaterThan(0);
    expect(gesture.intensity).toBeLessThanOrEqual(1);
    expect(gesture.confidence).toBeCloseTo(expectedIntensity, 10);

    const expectedPosition = landmarkToVector3(
      midpoint(pinchPose.landmarks[4], pinchPose.landmarks[8]),
    );
    expect(gesture.position.x).toBeCloseTo(expectedPosition.x, 10);
    expect(gesture.position.y).toBeCloseTo(expectedPosition.y, 10);
    expect(gesture.position.z).toBeCloseTo(expectedPosition.z, 10);
  });

  it('open pose classifies as OPEN at the palm center', () => {
    const [gesture] = new GestureRecognizer().recognizeGestures([openPose]);
    expect(gesture.type).toBe(GestureType.OPEN);
    expect(gesture.confidence).toBeCloseTo(0.9, 10);
    expect(gesture.intensity).toBe(1);
    expect(gesture.position.y).toBeCloseTo(landmarkToVector3(PALM_CENTER).y, 10);
  });

  it('point pose classifies as POINT at the index tip', () => {
    const [gesture] = new GestureRecognizer().recognizeGestures([pointPose]);
    expect(gesture.type).toBe(GestureType.POINT);
    expect(gesture.confidence).toBeCloseTo(0.85, 10);
    expect(gesture.intensity).toBeCloseTo(0.5, 10);
    const expected = landmarkToVector3(pointPose.landmarks[8]);
    expect(gesture.position.x).toBeCloseTo(expected.x, 10);
    expect(gesture.position.y).toBeCloseTo(expected.y, 10);
  });

  it('relaxed ambiguous pose classifies as NONE', () => {
    const [gesture] = new GestureRecognizer().recognizeGestures([nonePose]);
    expect(gesture.type).toBe(GestureType.NONE);
    expect(gesture.confidence).toBe(0);
    expect(gesture.intensity).toBe(0);
  });

  it('confidence is monotonic in pinch tightness and stays in (0, 1]', () => {
    const recognizer = new GestureRecognizer();
    const tight = recognizer.recognizeGestures([tightPinchPose])[0];
    const medium = new GestureRecognizer().recognizeGestures([pinchPose])[0];
    const loose = new GestureRecognizer().recognizeGestures([loosePinchPose])[0];

    expect(tight.confidence).toBeGreaterThan(medium.confidence);
    expect(medium.confidence).toBeGreaterThan(loose.confidence);
    for (const g of [tight, medium, loose]) {
      expect(g.confidence).toBeGreaterThan(0);
      expect(g.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('classifies two hands independently in one call', () => {
    const gestures = new GestureRecognizer().recognizeGestures([
      poseHand(
        {
          thumbTip: [0.48, 0.68],
          indexTip: [0.49, 0.68],
          middleTip: [0.52, 0.58],
          ringTip: [0.55, 0.6],
          pinkyTip: [0.58, 0.62],
        },
        'Right',
      ),
      poseHand(
        {
          thumbTip: [0.38, 0.72],
          indexTip: [0.42, 0.55],
          middleTip: [0.5, 0.52],
          ringTip: [0.57, 0.55],
          pinkyTip: [0.63, 0.6],
        },
        'Left',
      ),
    ]);
    expect(gestures).toHaveLength(2);
    expect(gestures[0].type).toBe(GestureType.PINCH);
    expect(gestures[1].type).toBe(GestureType.OPEN);
  });
});

// --- Temporal stability filter --------------------------------------------------

describe('GestureRecognizer temporal stability filter', () => {
  it('GestureType keeps all eight values (GRAB/SWIPE/TWO_FINGER classified; PINCH_ZOOM is bimanual-only)', () => {
    expect(new Set(Object.values(GestureType))).toEqual(
      new Set(['pinch', 'grab', 'point', 'two_finger', 'open', 'swipe', 'pinch_zoom', 'none']),
    );
    expect(GESTURE_STABLE_FRAMES).toBe(3);
  });

  it('first observation is emitted immediately (no debounce on detection)', () => {
    const recognizer = new GestureRecognizer();
    expect(recognizer.recognizeGestures([pinchPose])[0].type).toBe(GestureType.PINCH);
    expect(recognizer.recognizeGestures([openPose])[0].type).toBe(GestureType.PINCH);
    expect(recognizer.recognizeGestures([])).toEqual([]);
    // Hand reappears: state was cleared, so detection is immediate again.
    expect(recognizer.recognizeGestures([openPose])[0].type).toBe(GestureType.OPEN);
  });

  it('type only flips after GESTURE_STABLE_FRAMES consecutive agreeing frames', () => {
    const recognizer = new GestureRecognizer();
    expect(recognizer.recognizeGestures([pinchPose])[0].type).toBe(GestureType.PINCH);
    expect(recognizer.recognizeGestures([openPose])[0].type).toBe(GestureType.PINCH);
    expect(recognizer.recognizeGestures([openPose])[0].type).toBe(GestureType.PINCH);
    expect(recognizer.recognizeGestures([openPose])[0].type).toBe(GestureType.OPEN);
    expect(recognizer.recognizeGestures([openPose])[0].type).toBe(GestureType.OPEN);
  });

  it('a disagreeing frame resets the candidate streak', () => {
    const recognizer = new GestureRecognizer();
    recognizer.recognizeGestures([pinchPose]);
    recognizer.recognizeGestures([openPose]); // candidate streak: 1
    recognizer.recognizeGestures([pinchPose]); // streak reset
    expect(recognizer.recognizeGestures([openPose])[0].type).toBe(GestureType.PINCH);
    expect(recognizer.recognizeGestures([openPose])[0].type).toBe(GestureType.PINCH);
    expect(recognizer.recognizeGestures([openPose])[0].type).toBe(GestureType.OPEN);
  });

  it('intensity updates every frame while the type stays stable', () => {
    const recognizer = new GestureRecognizer();
    const tight = recognizer.recognizeGestures([tightPinchPose])[0];
    expect(tight.type).toBe(GestureType.PINCH);
    expect(tight.intensity).toBeCloseTo(1 - 0.005 / PINCH_THRESHOLD, 10);

    const loose = recognizer.recognizeGestures([loosePinchPose])[0];
    expect(loose.type).toBe(GestureType.PINCH); // same type: no debounce
    expect(loose.intensity).toBeCloseTo(1 - 0.02 / PINCH_THRESHOLD, 10);
  });

  it('during the debounce window the stable type keeps current-frame values', () => {
    const recognizer = new GestureRecognizer();
    recognizer.recognizeGestures([pinchPose]);

    // Open pose: raw type is OPEN, but PINCH must stay for now — with its
    // intensity re-measured from THIS frame's geometry (thumb-index now far
    // apart, so pinch intensity decays to the 0 clamp immediately).
    const [held] = recognizer.recognizeGestures([openPose]);
    expect(held.type).toBe(GestureType.PINCH);
    expect(held.intensity).toBe(0);
    const expectedPos = landmarkToVector3(
      midpoint(openPose.landmarks[4], openPose.landmarks[8]),
    );
    expect(held.position.x).toBeCloseTo(expectedPos.x, 10);
    expect(held.position.y).toBeCloseTo(expectedPos.y, 10);
  });

  it('two hands are filtered independently', () => {
    const recognizer = new GestureRecognizer();
    const rightPinch = poseHand(
      {
        thumbTip: [0.48, 0.68],
        indexTip: [0.49, 0.68],
        middleTip: [0.52, 0.58],
        ringTip: [0.55, 0.6],
        pinkyTip: [0.58, 0.62],
      },
      'Right',
    );
    const leftOpen = poseHand(
      {
        thumbTip: [0.38, 0.72],
        indexTip: [0.42, 0.55],
        middleTip: [0.5, 0.52],
        ringTip: [0.57, 0.55],
        pinkyTip: [0.63, 0.6],
      },
      'Left',
    );
    // First frame: both immediately stable.
    let [right, left] = recognizer.recognizeGestures([rightPinch, leftOpen]);
    expect(right.type).toBe(GestureType.PINCH);
    expect(left.type).toBe(GestureType.OPEN);

    // Second frame: right switches raw type to NONE, left stays OPEN.
    const rightNone = poseHand(
      {
        thumbTip: [0.44, 0.68],
        indexTip: [0.46, 0.62],
        middleTip: [0.5, 0.64],
        ringTip: [0.54, 0.65],
        pinkyTip: [0.57, 0.66],
      },
      'Right',
    );
    [right, left] = recognizer.recognizeGestures([rightNone, leftOpen]);
    expect(right.type).toBe(GestureType.PINCH); // debounced
    expect(left.type).toBe(GestureType.OPEN); // unaffected
  });
});

// --- M5: GRAB classification ------------------------------------------------------

describe('GestureRecognizer GRAB classification', () => {
  it('a fist classifies GRAB, not PINCH, despite thumb-index < PINCH_THRESHOLD', () => {
    const [gesture] = new GestureRecognizer().recognizeGestures([fistPose]);
    expect(gesture.type).toBe(GestureType.GRAB);
  });

  it('a lazy pinch (thumb-index close, other fingers curled) classifies GRAB', () => {
    const [gesture] = new GestureRecognizer().recognizeGestures([lazyPinchPose]);
    expect(gesture.type).toBe(GestureType.GRAB);
    expect(distance(lazyPinchPose.landmarks[4], lazyPinchPose.landmarks[8])).toBeLessThan(
      PINCH_THRESHOLD,
    );
  });

  it('GRAB carries confidence 0.90 and the palm-center world position', () => {
    const [gesture] = new GestureRecognizer().recognizeGestures([fistPose]);
    expect(gesture.confidence).toBeCloseTo(0.9, 10);
    const expected = landmarkToVector3(PALM_CENTER);
    expect(gesture.position.x).toBeCloseTo(expected.x, 10);
    expect(gesture.position.y).toBeCloseTo(expected.y, 10);
  });

  it('intensity (curledness) is monotonic: fist > loose fist, both in (0, 1]', () => {
    const fist = new GestureRecognizer().recognizeGestures([fistPose])[0];
    const loose = new GestureRecognizer().recognizeGestures([looseFistPose])[0];
    expect(fist.intensity).toBeGreaterThan(loose.intensity);
    for (const g of [fist, loose]) {
      expect(g.intensity).toBeGreaterThan(0);
      expect(g.intensity).toBeLessThanOrEqual(1);
    }
  });

  it('GRAB is a stable STATE: fist frames hold PINCH for GESTURE_STABLE_FRAMES-1 frames, then flip', () => {
    const recognizer = new GestureRecognizer();
    expect(recognizer.recognizeGestures([pinchPose])[0].type).toBe(GestureType.PINCH);
    expect(recognizer.recognizeGestures([fistPose])[0].type).toBe(GestureType.PINCH);
    expect(recognizer.recognizeGestures([fistPose])[0].type).toBe(GestureType.PINCH);
    expect(recognizer.recognizeGestures([fistPose])[0].type).toBe(GestureType.GRAB);
    expect(recognizer.recognizeGestures([fistPose])[0].type).toBe(GestureType.GRAB);
  });
});

// --- TWO_FINGER (content-scroll pose) ----------------------------------------------

describe('GestureRecognizer TWO_FINGER classification', () => {
  /** Index + middle extended (palm dists 0.201 / 0.183 > 0.12), ring +
   *  pinky curled (0.058 / 0.072 < 0.08), thumb well off the index
   *  (0.215 > PINCH_THRESHOLD). Palm center is (0.5, 0.7). */
  const twoFingerPose = poseHand({
    thumbTip: [0.44, 0.7],
    indexTip: [0.52, 0.5],
    middleTip: [0.47, 0.52],
    ringTip: [0.53, 0.65],
    pinkyTip: [0.56, 0.66],
  });

  it('classifies the index+middle pose as TWO_FINGER (first observation stable)', () => {
    const recognizer = new GestureRecognizer();
    const [gesture] = recognizer.recognizeGestures([twoFingerPose], 0);
    expect(gesture.type).toBe(GestureType.TWO_FINGER);
    expect(gesture.confidence).toBeCloseTo(0.85, 5);
  });

  it('a curled middle finger falls through to POINT (pose disjointness)', () => {
    const pointVariant = poseHand({
      thumbTip: [0.44, 0.7],
      indexTip: [0.52, 0.5],
      middleTip: [0.5, 0.655], // palm dist ~0.046 < 0.12 -> not extended
      ringTip: [0.53, 0.65],
      pinkyTip: [0.56, 0.66],
    });
    const recognizer = new GestureRecognizer();
    expect(recognizer.recognizeGestures([pointVariant], 0)[0].type).toBe(GestureType.POINT);
  });

  it('an open ring finger breaks the pose (not TWO_FINGER)', () => {
    const openRingVariant = poseHand({
      thumbTip: [0.44, 0.7],
      indexTip: [0.52, 0.5],
      middleTip: [0.47, 0.52],
      ringTip: [0.54, 0.6], // palm dist ~0.108 > 0.08 -> not curled
      pinkyTip: [0.56, 0.66],
    });
    const recognizer = new GestureRecognizer();
    const type = recognizer.recognizeGestures([openRingVariant], 0)[0].type;
    expect(type).not.toBe(GestureType.TWO_FINGER);
  });

  it('TWO_FINGER passes through the temporal stability filter like other states', () => {
    const recognizer = new GestureRecognizer();
    recognizer.recognizeGestures([pointPose], 0); // establish POINT
    const stillPoint = recognizer.recognizeGestures([twoFingerPose], 100)[0];
    expect(stillPoint.type).toBe(GestureType.POINT); // 1 disagreeing frame
    const stillPoint2 = recognizer.recognizeGestures([twoFingerPose], 200)[0];
    expect(stillPoint2.type).toBe(GestureType.POINT); // 2 disagreeing frames
    const switched = recognizer.recognizeGestures([twoFingerPose], 300)[0];
    expect(switched.type).toBe(GestureType.TWO_FINGER); // 3rd frame flips
  });
});

// --- M5: SWIPE event channel ------------------------------------------------------

describe('GestureRecognizer SWIPE event channel', () => {
  /** Runs openPose swept at dx,dy normalized units per 100 ms frame and
   *  returns the first SWIPE emitted (or throws if none fires). */
  function firstSwipe(recognizer: GestureRecognizer, dx: number, dy: number): Gesture {
    for (let t = 0; t <= 100; t += 100) {
      const hand = shiftHand(openPose, dx * (t / 100), dy * (t / 100));
      const [g] = recognizer.recognizeGestures([hand], t);
      if (g.type === GestureType.SWIPE) return g;
    }
    throw new Error('no SWIPE fired');
  }

  it('a fast right sweep fires exactly ONE SWIPE at the first eligible frame', () => {
    const recognizer = new GestureRecognizer();
    const results: Array<[number, Gesture]> = [];
    for (let t = 0; t <= 500; t += 100) {
      const hand = shiftHand(openPose, 0.04 * (t / 100), 0);
      results.push([t, recognizer.recognizeGestures([hand], t)[0]]);
    }
    const swipes = results.filter(([, g]) => g.type === GestureType.SWIPE);
    expect(swipes).toHaveLength(1);
    const [fireTime, swipe] = swipes[0];
    expect(fireTime).toBe(100); // first frame with >= 2 tracker samples

    expect(swipe.swipeDirection).toBe('right');
    expect(swipe.confidence).toBeCloseTo(0.88, 10);
    // 0.04 normalized / 100 ms = 4 world units/s; intensity = clamp01(4 / (2*threshold))
    expect(swipe.intensity).toBeCloseTo(4 / (2 * SWIPE_VELOCITY_THRESHOLD), 10);
    expect(swipe.intensity).toBeGreaterThanOrEqual(0.5);
    expect(swipe.intensity).toBeLessThanOrEqual(1);

    // Position = that frame's palm-center world position.
    const fireHand = shiftHand(openPose, 0.04 * (fireTime / 100), 0);
    const expectedPos = landmarkToVector3(
      midpoint(fireHand.landmarks[0], fireHand.landmarks[9]),
    );
    expect(swipe.position.x).toBeCloseTo(expectedPos.x, 10);
    expect(swipe.position.y).toBeCloseTo(expectedPos.y, 10);

    // Every later still-fast frame emits OPEN again (no repeat, no stick).
    for (const [t, g] of results) {
      if (t > fireTime) expect(g.type).toBe(GestureType.OPEN);
    }
  });

  it('the frame after a SWIPE emits OPEN — the event never sticks', () => {
    const recognizer = new GestureRecognizer();
    let last: Gesture | undefined;
    for (let t = 0; t <= 300; t += 100) {
      const hand = shiftHand(openPose, 0.04 * (t / 100), 0);
      last = recognizer.recognizeGestures([hand], t)[0];
      if (t === 100) expect(last.type).toBe(GestureType.SWIPE);
    }
    expect(last?.type).toBe(GestureType.OPEN);
  });

  it('slow motion (0.8 u/s) never emits SWIPE — every frame is OPEN', () => {
    const recognizer = new GestureRecognizer();
    for (let t = 0; t <= 1000; t += 100) {
      const hand = shiftHand(openPose, 0.008 * (t / 100), 0);
      const [g] = recognizer.recognizeGestures([hand], t);
      expect(g.type).toBe(GestureType.OPEN);
    }
  });

  it('refractory: a fast sweep within 500 ms of the last fire is blocked, a later one fires once more', () => {
    const recognizer = new GestureRecognizer();
    const fast = (t: number) => shiftHand(openPose, 0.04 * (t / 100), 0);
    const slow = (t: number) => shiftHand(openPose, 0.008 * (t / 100), 0);
    // t=0 seeds the tracker; t=100 is the first fire.
    expect(recognizer.recognizeGestures([fast(0)], 0)[0].type).toBe(GestureType.OPEN);
    expect(recognizer.recognizeGestures([fast(100)], 100)[0].type).toBe(GestureType.SWIPE);
    // Slow frames re-arm the channel.
    for (let t = 200; t <= 400; t += 100) {
      expect(recognizer.recognizeGestures([slow(t)], t)[0].type).toBe(GestureType.OPEN);
    }
    // Fast again at +400 ms since the fire: refractory blocks even though armed.
    expect(recognizer.recognizeGestures([fast(500)], 500)[0].type).toBe(GestureType.OPEN);
    // Slow again to keep the fast streak from firing early, then fast at
    // +700 ms (>= SWIPE_REFRACTORY_MS, armed): fires exactly once more.
    expect(recognizer.recognizeGestures([slow(600)], 600)[0].type).toBe(GestureType.OPEN);
    expect(recognizer.recognizeGestures([fast(800)], 800)[0].type).toBe(GestureType.SWIPE);
    expect(recognizer.recognizeGestures([fast(900)], 900)[0].type).toBe(GestureType.OPEN);
  });

  it('reports the dominant planar axis as the direction (scene axes: +y = image-up)', () => {
    expect(firstSwipe(new GestureRecognizer(), 0, -0.04).swipeDirection).toBe('up');
    expect(firstSwipe(new GestureRecognizer(), 0, 0.04).swipeDirection).toBe('down');
    expect(firstSwipe(new GestureRecognizer(), -0.04, 0).swipeDirection).toBe('left');
    expect(firstSwipe(new GestureRecognizer(), 0.04, 0).swipeDirection).toBe('right');
  });

  it('non-open hands never swipe: a fast fist emits GRAB every frame', () => {
    const recognizer = new GestureRecognizer();
    for (let t = 0; t <= 400; t += 100) {
      const hand = shiftHand(fistPose, 0.04 * (t / 100), 0);
      const [g] = recognizer.recognizeGestures([hand], t);
      expect(g.type).toBe(GestureType.GRAB);
    }
  });

  it('per-hand independence: only the sweeping hand ever emits SWIPE', () => {
    const recognizer = new GestureRecognizer();
    const leftOpen = { ...openPose, handedness: 'Left' as Handedness };
    let rightSwept = false;
    for (let t = 0; t <= 300; t += 100) {
      const right = shiftHand(openPose, 0.04 * (t / 100), 0);
      const gestures = recognizer.recognizeGestures([leftOpen, right], t);
      const left = gestures.find((g) => g.handedness === 'Left')!;
      const r = gestures.find((g) => g.handedness === 'Right')!;
      expect(left.type).toBe(GestureType.OPEN);
      rightSwept ||= r.type === GestureType.SWIPE;
    }
    expect(rightSwept).toBe(true);
  });

  it('state hygiene: a disappeared hand reappears with fresh swipe state and can fire again', () => {
    const recognizer = new GestureRecognizer();
    expect(recognizer.recognizeGestures([shiftHand(openPose, 0, 0)], 0)[0].type).toBe(
      GestureType.OPEN,
    );
    expect(recognizer.recognizeGestures([shiftHand(openPose, 0.04, 0)], 100)[0].type).toBe(
      GestureType.SWIPE,
    );
    // Hand disappears: stability AND swipe state are pruned (no throw).
    expect(recognizer.recognizeGestures([], 200)).toEqual([]);
    // Reappearing fast hand: first observation is OPEN immediately (fresh
    // tracker has one sample), then a fresh sweep fires again.
    expect(recognizer.recognizeGestures([shiftHand(openPose, 0.08, 0)], 300)[0].type).toBe(
      GestureType.OPEN,
    );
    expect(recognizer.recognizeGestures([shiftHand(openPose, 0.12, 0)], 400)[0].type).toBe(
      GestureType.SWIPE,
    );
  });
});

// --- M5: bimanual PINCH_ZOOM ------------------------------------------------------

describe('GestureRecognizer bimanual PINCH_ZOOM', () => {
  const rightPinch = pinchPose;
  const leftPinch = { ...pinchPose, handedness: 'Left' as Handedness };

  /** Two pinch hands 2.0 world units apart (left shifted -0.2 in x). */
  function zoomPair(): { left: Hand } {
    return { left: shiftHand(leftPinch, -0.2, 0) };
  }

  it('growing distance emits one PINCH_ZOOM per changing frame, direction out', () => {
    const recognizer = new GestureRecognizer();
    let { left } = zoomPair();
    expect(recognizer.recognizeBimanual([rightPinch, left], 0)).toEqual([]); // anchor

    left = shiftHand(left, -0.02, 0); // +0.2 world units/frame = 2 u/s
    const [zoom] = recognizer.recognizeBimanual([rightPinch, left], 100);
    expect(zoom.type).toBe(GestureType.PINCH_ZOOM);
    expect(zoom.zoomDirection).toBe('out');
    expect(zoom.confidence).toBeCloseTo(0.85, 10);
    expect(zoom.handedness).toBe('Right'); // primary hand
    expect(zoom.intensity).toBeCloseTo(2 / PINCH_ZOOM_MAX_RATE, 10); // 0.4

    // Position = world midpoint of the two pinch midpoints.
    const m1 = landmarkToVector3(midpoint(rightPinch.landmarks[4], rightPinch.landmarks[8]));
    const m2 = landmarkToVector3(midpoint(left.landmarks[4], left.landmarks[8]));
    expect(zoom.position.x).toBeCloseTo((m1.x + m2.x) / 2, 10);
    expect(zoom.position.y).toBeCloseTo((m1.y + m2.y) / 2, 10);

    // A changing-distance stream: still emitting on the next changing frame.
    left = shiftHand(left, -0.02, 0);
    const [next] = recognizer.recognizeBimanual([rightPinch, left], 200);
    expect(next.type).toBe(GestureType.PINCH_ZOOM);
    expect(next.zoomDirection).toBe('out');
  });

  it('intensity tracks the rate: 5 u/s -> 1.0, 1 u/s -> 0.2 (monotonic)', () => {
    const intensityAt = (shiftPerFrame: number): number => {
      const recognizer = new GestureRecognizer();
      let { left } = zoomPair();
      recognizer.recognizeBimanual([rightPinch, left], 0);
      left = shiftHand(left, shiftPerFrame, 0);
      return recognizer.recognizeBimanual([rightPinch, left], 100)[0].intensity;
    };
    const fast = intensityAt(-0.05); // 0.5 world / 0.1 s = 5 u/s
    const gentle = intensityAt(-0.01); // 0.1 world / 0.1 s = 1 u/s
    expect(fast).toBeCloseTo(1, 10);
    expect(gentle).toBeCloseTo(1 / PINCH_ZOOM_MAX_RATE, 10); // 0.2
    expect(fast).toBeGreaterThan(gentle);
  });

  it('shrinking distance emits direction in', () => {
    const recognizer = new GestureRecognizer();
    let { left } = zoomPair();
    recognizer.recognizeBimanual([rightPinch, left], 0);
    left = shiftHand(left, 0.02, 0); // closing: distance shrinks at 2 u/s
    const [zoom] = recognizer.recognizeBimanual([rightPinch, left], 100);
    expect(zoom.zoomDirection).toBe('in');
  });

  it('a static two-hand pinch emits nothing', () => {
    const recognizer = new GestureRecognizer();
    const { left } = zoomPair();
    recognizer.recognizeBimanual([rightPinch, left], 0);
    expect(recognizer.recognizeBimanual([rightPinch, left], 100)).toEqual([]);
    expect(recognizer.recognizeBimanual([rightPinch, left], 200)).toEqual([]);
  });

  it('below-deadband change emits nothing, but the anchor advances (no drift accumulation)', () => {
    const recognizer = new GestureRecognizer();
    let { left } = zoomPair();
    recognizer.recognizeBimanual([rightPinch, left], 0); // anchor at 2.0

    left = shiftHand(left, -0.003, 0); // 0.03 world / 0.1 s = 0.3 u/s < deadband
    expect(recognizer.recognizeBimanual([rightPinch, left], 100)).toEqual([]);
    // A later big jump rates from THIS frame (the anchor advanced), so it
    // emits immediately — no accumulated-drift false emit either.
    left = shiftHand(left, -0.2, 0); // +2.0 world / 0.1 s = 20 u/s
    const [zoom] = recognizer.recognizeBimanual([rightPinch, left], 200);
    expect(zoom.type).toBe(GestureType.PINCH_ZOOM);
    expect(zoom.zoomDirection).toBe('out');
    expect(zoom.intensity).toBeCloseTo(1, 10); // clamped at 20 / MAX_RATE
  });

  it('one hand releasing resets the anchor: a later static re-pinch emits nothing', () => {
    const recognizer = new GestureRecognizer();
    let { left } = zoomPair();
    recognizer.recognizeBimanual([rightPinch, left], 0);
    left = shiftHand(left, -0.02, 0);
    expect(recognizer.recognizeBimanual([rightPinch, left], 100)[0].type).toBe(
      GestureType.PINCH_ZOOM,
    );
    // One hand releases (replaced by an open hand): condition breaks.
    const openLeft = { ...openPose, handedness: 'Left' as Handedness };
    expect(recognizer.recognizeBimanual([rightPinch, openLeft], 200)).toEqual([]);
    // Both pinch again STATICALLY: anchor was reset, so still nothing.
    expect(recognizer.recognizeBimanual([rightPinch, left], 300)).toEqual([]);
    expect(recognizer.recognizeBimanual([rightPinch, left], 400)).toEqual([]);
  });

  it('is independent of the per-hand channel and works without prior recognizeGestures', () => {
    const recognizer = new GestureRecognizer();
    let { left } = zoomPair();
    // Order independence: recognizeBimanual first, no prior per-hand call.
    expect(recognizer.recognizeBimanual([rightPinch, left], 0)).toEqual([]);
    left = shiftHand(left, -0.02, 0);
    expect(recognizer.recognizeBimanual([rightPinch, left], 100)).toHaveLength(1);
    // The per-hand channel still reports plain PINCH for the same frames.
    const perHand = recognizer.recognizeGestures([rightPinch, left], 100);
    expect(perHand.map((g) => g.type)).toEqual([GestureType.PINCH, GestureType.PINCH]);
  });

  it('recognizeGestures and recognizeBimanual accept the default clock (no throw)', () => {
    const recognizer = new GestureRecognizer();
    expect(() => recognizer.recognizeGestures([openPose])).not.toThrow();
    expect(() => recognizer.recognizeBimanual([rightPinch, leftPinch])).not.toThrow();
  });
});

// --- Performance smoke -----------------------------------------------------------

describe('gesture recognition performance', () => {
  it('classifying 2 hands stays well under 1 ms per frame (smoke)', () => {
    const recognizer = new GestureRecognizer();
    // One warm-up pass to initialize per-hand state.
    recognizer.recognizeGestures([pinchPose, openPose]);

    const iterations = 2000;
    const start = Date.now();
    for (let i = 0; i < iterations; i += 1) {
      recognizer.recognizeGestures([pinchPose, openPose]);
    }
    const elapsed = Date.now() - start;
    // Generous bound (avg 1 ms/frame vs a real cost of microseconds), so it
    // cannot flake while still proving the math is negligible next to the
    // ~200 ms MediaPipe inference measured in onResults latency logs.
    expect(elapsed).toBeLessThan(iterations);
  });
});
