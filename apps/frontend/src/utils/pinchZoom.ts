import type { Landmark } from '@jarvis/shared';

/** Threshold below which thumb and index are considered pinched together. */
export const PINCH_TOUCH_THRESHOLD = 0.055;

/** Threshold above which fingers are considered fully opened/released. */
export const PINCH_OPEN_THRESHOLD = 0.14;

/** Calculate Euclidean distance between thumb tip (landmark 4) and index tip (landmark 8). */
export function calculatePinchDistance(thumb: Landmark, index: Landmark): number {
  const dx = index.x - thumb.x;
  const dy = index.y - thumb.y;
  const dz = (index.z ?? 0) - (thumb.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Tracks single-hand pinch-and-spread gesture dynamics:
 * When thumb and index touch (pinch), an anchor distance is recorded.
 * As fingers spread apart, a proportional scale factor > 1.0 is emitted.
 * As fingers close tighter, a scale factor < 1.0 is emitted.
 */
export class PinchSpreadZoomTracker {
  private isPinching = false;
  private anchorDistance = 0;
  private lastDistance = 0;
  private smoothedScaleFactor = 1.0;

  /**
   * Update tracker with current thumb (landmark 4) and index (landmark 8) landmarks.
   */
  update(
    thumb: Landmark,
    index: Landmark,
  ): { isPinching: boolean; isSpreading: boolean; scaleFactor: number; distance: number } {
    const currentDistance = calculatePinchDistance(thumb, index);

    if (!this.isPinching) {
      if (currentDistance <= PINCH_TOUCH_THRESHOLD) {
        // Pinch initiated
        this.isPinching = true;
        this.anchorDistance = currentDistance;
        this.lastDistance = currentDistance;
        this.smoothedScaleFactor = 1.0;
        return {
          isPinching: true,
          isSpreading: false,
          scaleFactor: 1.0,
          distance: currentDistance,
        };
      }
      return {
        isPinching: false,
        isSpreading: false,
        scaleFactor: 1.0,
        distance: currentDistance,
      };
    }

    // Currently in pinch session
    if (currentDistance >= PINCH_OPEN_THRESHOLD) {
      // Fingers opened widely -> release pinch zoom
      this.isPinching = false;
      this.anchorDistance = 0;
      this.smoothedScaleFactor = 1.0;
      return {
        isPinching: false,
        isSpreading: false,
        scaleFactor: 1.0,
        distance: currentDistance,
      };
    }

    // Compute differential distance relative to last frame
    const delta = currentDistance - this.lastDistance;
    this.lastDistance = currentDistance;

    // Proportional zoom factor: spreading increases scale, closing decreases
    const rawFactor = 1 + delta * 2.2;
    // Exponential smoothing (alpha = 0.45)
    this.smoothedScaleFactor = this.smoothedScaleFactor * 0.55 + rawFactor * 0.45;

    const isSpreading = currentDistance > this.anchorDistance + 0.01;

    return {
      isPinching: true,
      isSpreading,
      scaleFactor: this.smoothedScaleFactor,
      distance: currentDistance,
    };
  }

  reset(): void {
    this.isPinching = false;
    this.anchorDistance = 0;
    this.lastDistance = 0;
    this.smoothedScaleFactor = 1.0;
  }
}
