/**
 * M11 pure sync transforms shared by frontend and backend. Both sides
 * quantize with THESE helpers (client: wire bandwidth; server: storage
 * authority via StateManager — double rounding is idempotent).
 */
import type { Hand } from './types.js';
import { SYNC_QUANTIZE_DECIMALS } from './constants.js';

/** Round to `decimals` places (half-up). */
export function quantizeNumber(
  value: number,
  decimals: number = SYNC_QUANTIZE_DECIMALS,
): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Quantize one hand's landmarks + confidence (new objects; input untouched). */
export function quantizeHand(hand: Hand, decimals = SYNC_QUANTIZE_DECIMALS): Hand {
  return {
    handedness: hand.handedness,
    confidence: quantizeNumber(hand.confidence, decimals),
    landmarks: hand.landmarks.map((lm) => ({
      x: quantizeNumber(lm.x, decimals),
      y: quantizeNumber(lm.y, decimals),
      z: quantizeNumber(lm.z, decimals),
    })),
  };
}

/** Quantize a hands array (new array; input untouched). */
export function quantizeHands(hands: readonly Hand[], decimals = SYNC_QUANTIZE_DECIMALS): Hand[] {
  return hands.map((hand) => quantizeHand(hand, decimals));
}
