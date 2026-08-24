import type { Handedness } from '@jarvis/shared';

/**
 * Quick-pinch click detection (user-approved gesture upgrade): a PINCH
 * shorter than PINCH_CLICK_MAX_MS on a hovered card acts as SELECT —
 * bring-to-front + activation event — exactly like a mouse click vs drag.
 * A longer pinch remains a drag (the engine's grab path already handles
 * the grab/release; near-zero release velocity means no momentum).
 *
 * The 400ms budget deliberately exceeds a raw quick pinch (~250ms) to
 * absorb the recognizer's 3-frame stabilization skew (~100ms at 30 fps)
 * on both edges of the gesture.
 *
 * Timebase: Gesture.timestamp (Date.now base) — feed the same timestamp
 * the gesture carries; never mix with performance.now (M4 lesson).
 */
export const PINCH_CLICK_MAX_MS = 400;

/**
 * Per-handedness pinch session tracker. Feed EVERY gesture frame for a
 * hand (any type): PINCH starts/continues the session, anything else
 * ends it. Returns the clicked window id exactly once, on the frame the
 * quick pinch ends — null otherwise.
 */
export class PinchClickTracker {
  private readonly active = new Map<Handedness, { startMs: number; targetId: string }>();

  update(
    handedness: Handedness,
    isPinching: boolean,
    hoveredId: string | null,
    nowMs: number,
  ): string | null {
    if (isPinching) {
      if (!this.active.has(handedness)) {
        this.active.set(handedness, { startMs: nowMs, targetId: hoveredId ?? '' });
      }
      return null;
    }
    const session = this.active.get(handedness);
    if (!session) return null;
    this.active.delete(handedness);
    // No card under the hand when the pinch began -> not a click.
    if (!session.targetId) return null;
    return nowMs - session.startMs <= PINCH_CLICK_MAX_MS ? session.targetId : null;
  }

  /** Forgets all in-flight sessions (scene reset / hand vanished). */
  reset(): void {
    this.active.clear();
  }
}
