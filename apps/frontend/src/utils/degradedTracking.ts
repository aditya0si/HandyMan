/**
 * M15 degraded-tracking detector (brief D4). A node-pure helper that turns a
 * sustained low-confidence hands-present stretch into a ONE-shot warning:
 * when a full window of hands-present frames has a mean confidence below the
 * threshold, it emits (returns true) and resets, so the caller can console.warn
 * once per sustained-low-confidence window — no new UI surface. A frame with
 * zero detected hands clears the window (degradation only counts while hands
 * are present).
 */

/** Window length (ms) of continuously-present hands to judge confidence. */
export const DEGRADED_TRACKING_WINDOW_MS = 5000;
/** Mean confidence below this (over the window) is "degraded". */
export const DEGRADED_TRACKING_CONFIDENCE_THRESHOLD = 0.5;

export class DegradedTrackingDetector {
  private windowStart = -1;
  private samples: number[] = [];

  /**
   * Feed one inference frame. `confidences` are the detected hands'
   * confidence scores (empty when no hands are present). Resets the window
   * on gaps; returns true exactly once per completed degraded window.
   */
  feed(now: number, confidences: readonly number[]): boolean {
    if (confidences.length === 0) {
      this.reset();
      return false;
    }
    if (this.windowStart < 0) this.windowStart = now;
    this.samples.push(...confidences);
    if (now - this.windowStart < DEGRADED_TRACKING_WINDOW_MS) return false;
    const mean =
      this.samples.reduce((sum, next) => sum + next, 0) / this.samples.length;
    const degraded = mean < DEGRADED_TRACKING_CONFIDENCE_THRESHOLD;
    this.reset();
    return degraded;
  }

  private reset(): void {
    this.windowStart = -1;
    this.samples = [];
  }
}
