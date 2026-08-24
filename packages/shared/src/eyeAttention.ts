/**
 * Phase 7: Eye & Face Attention Shared Types and Constants
 * 
 * Strict privacy rule: All gaze calculations and face presence detection
 * run 100% locally in the browser. No eye coordinates or face data are
 * ever transmitted over WebSocket or HTTP.
 */

export type GazeZone = 'left' | 'center' | 'right' | 'away';

export interface EyeAttentionState {
  /** Whether the user has opted in to eye attention */
  enabled: boolean;
  /** Whether a face is detected in front of the camera */
  present: boolean;
  /** Confidence score of the face/attention estimation (0..1) */
  confidence: number;
  /** Coarse gaze orientation zone */
  gazeZone: GazeZone | null;
  /** Suggested target window based on gaze orientation */
  targetWindowId: string | null;
  /** True if user has looked away or left for longer than AWAY_THRESHOLD_MS */
  isLookingAway: boolean;
  /** Normalized attention center point (x: -1..1, y: -1..1) */
  normalizedGazePoint: { x: number; y: number } | null;
}

export const EYE_ATTENTION_CONFIDENCE_THRESHOLD = 0.5;
export const EYE_ATTENTION_AWAY_THRESHOLD_MS = 1000;
export const EYE_ATTENTION_DWELL_CONFIRM_MS = 700;
