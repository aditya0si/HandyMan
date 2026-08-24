import type { Hand, Handedness } from '@jarvis/shared';

/**
 * Hand Cursor tracking and smoothing utilities (Session 3).
 * Projects MediaPipe normalized hand landmarks into viewport screen coordinates
 * and applies exponential smoothing to cancel out webcam noise and tracking jitter.
 */

export interface CursorPosition {
  x: number;
  y: number;
}

export interface HandCursorData {
  x: number;
  y: number;
  visible: boolean;
  handedness: Handedness;
  isPointing: boolean;
  isPinching: boolean;
  isHovering: boolean;
  targetId: string | null;
}

/**
 * Converts a normalized landmark (0..1) into screen pixel coordinates.
 * Inverts X coordinate to match natural mirrored webcam reflection.
 */
export function landmarkToScreen(
  landmark: { x: number; y: number },
  viewportWidth: number,
  viewportHeight: number,
): CursorPosition {
  // Mirrored X for natural user reflection, Y mapped directly
  const screenX = (1 - landmark.x) * viewportWidth;
  const screenY = landmark.y * viewportHeight;
  return {
    x: Math.max(0, Math.min(viewportWidth, screenX)),
    y: Math.max(0, Math.min(viewportHeight, screenY)),
  };
}

/**
 * Applies exponential smoothing (lerp) between current and target positions.
 * A factor of 0.35 yields a snappy yet jitter-free cursor motion.
 */
export function smoothCursor(
  current: CursorPosition | null,
  target: CursorPosition,
  alpha = 0.35,
): CursorPosition {
  if (!current) return { ...target };
  return {
    x: current.x + (target.x - current.x) * alpha,
    y: current.y + (target.y - current.y) * alpha,
  };
}

/** Index fingertip landmark index in the MediaPipe 21-landmark model. */
export const INDEX_FINGER_TIP = 8;
/** Middle knuckle / palm landmark fallback. */
export const MIDDLE_MCP = 9;

/**
 * Extracts the primary cursor target landmark from detected hands.
 * Prioritizes the primary hand's index fingertip.
 */
export function getPointerLandmark(hand: Hand): { x: number; y: number } | null {
  if (!hand.landmarks || hand.landmarks.length < 21) return null;
  const tip = hand.landmarks[INDEX_FINGER_TIP];
  if (tip && typeof tip.x === 'number' && typeof tip.y === 'number') {
    return { x: tip.x, y: tip.y };
  }
  const palm = hand.landmarks[MIDDLE_MCP];
  if (palm && typeof palm.x === 'number' && typeof palm.y === 'number') {
    return { x: palm.x, y: palm.y };
  }
  return null;
}
