/**
 * Shared constants for the JARVIS platform.
 *
 * Camera geometry and hand-tracking configuration are referenced by both
 * the camera capture and hand tracking pipelines, so they live in one place.
 */

/** Ideal capture width (MediaPipe Hands performs best at 1280x720). */
export const CAMERA_WIDTH = 1280;

/** Ideal capture height. */
export const CAMERA_HEIGHT = 720;

/** Target frame rate for both capture and MediaPipe inference. */
export const CAMERA_TARGET_FPS = 30;

/** MediaPipe Hands configuration (guide step 1.5). */
export const HANDS_MAX_NUM = 2;
export const HANDS_MODEL_COMPLEXITY = 1;
export const HANDS_MIN_DETECTION_CONFIDENCE = 0.5;
export const HANDS_MIN_TRACKING_CONFIDENCE = 0.5;
export const HANDS_CDN_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/';

/**
 * Full MediaPipe Hands landmark connection set (21 pairs).
 * This is the complete HAND_CONNECTIONS set from the official
 * MediaPipe hand_landmark proto (not the guide's truncated list):
 *   - thumb:    0-1-2-3-4
 *   - index:    0-5-6-7-8
 *   - middle:   5-9-10-11-12
 *   - ring:     9-13-14-15-16
 *   - pinky:    13-17-18-19-20
 *   - palm:     0-17
 */
export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  // Thumb
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  // Index finger
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  // Middle finger
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  // Ring finger
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  // Pinky
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  // Palm
  [0, 17],
];

/** Default ports for the backend services. */
export const HTTP_PORT = 4000;
export const WS_PORT = 4001;

/** --- M11 real-time sync (PROJECT_VISION §8 challenge 4: throttle + quantize) --- */

/** Client hand-send throttle: ~20 Hz out of the ~30 Hz inference rate. */
export const SYNC_HANDS_INTERVAL_MS = 50;

/** Landmark/confidence decimals kept on the wire: 3 decimals of the
 *  normalized 0..1 frame ≈ the vision's "1 cm precision" quantization. */
export const SYNC_QUANTIZE_DECIMALS = 3;

/** Server per-user handSync broadcast throttle (trailing flush, D9). */
export const SERVER_HANDS_BROADCAST_INTERVAL_MS = 50;
