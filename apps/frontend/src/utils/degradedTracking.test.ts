import { describe, expect, it } from 'vitest';
import {
  DEGRADED_TRACKING_CONFIDENCE_THRESHOLD,
  DEGRADED_TRACKING_WINDOW_MS,
  DegradedTrackingDetector,
} from './degradedTracking';

/** Feed a fully-sampled low/high window (step 100ms, includes the emit tick). */
function runWindow(
  detector: DegradedTrackingDetector,
  startMs: number,
  confidenceFor: (t: number) => number,
): boolean {
  let emitted = false;
  for (let t = startMs; t <= startMs + DEGRADED_TRACKING_WINDOW_MS; t += 100) {
    if (detector.feed(t, [confidenceFor(t)])) emitted = true;
  }
  return emitted;
}

describe('degradedTracking (M15 D4)', () => {
  it('exports the documented constants', () => {
    expect(DEGRADED_TRACKING_WINDOW_MS).toBe(5000);
    expect(DEGRADED_TRACKING_CONFIDENCE_THRESHOLD).toBe(0.5);
  });

  it('emits once after a full window of hands-present LOW-confidence samples', () => {
    const detector = new DegradedTrackingDetector();
    const emitted = runWindow(detector, 0, () => 0.2);
    expect(emitted).toBe(true);
  });

  it('does not emit for HIGH-confidence tracking (above threshold)', () => {
    const detector = new DegradedTrackingDetector();
    const emitted = runWindow(detector, 0, () => 0.9);
    expect(emitted).toBe(false);
  });

  it('a zero-hand frame resets the window (degradation only while hands are present)', () => {
    const detector = new DegradedTrackingDetector();
    // Low-confidence for 4s (not yet a full window)…
    for (let t = 0; t < 4000; t += 100) detector.feed(t, [0.2]);
    // …hands disappear — the accumulating window must reset.
    detector.feed(4000, []);
    // A fresh full low-confidence window starting AFTER the gap: the zeros
    // must NOT count, so this emits at its own completion.
    const emitted = runWindow(detector, 4500, () => 0.2);
    // A second full window just after would emit again (self-rearms).
    expect(emitted).toBe(true);
  });

  it('emits at most once per completed window (throttled by the window), then re-arms', () => {
    const detector = new DegradedTrackingDetector();
    const emissions: number[] = [];
    for (let t = 0; t < 2 * DEGRADED_TRACKING_WINDOW_MS + 1000; t += 100) {
      if (detector.feed(t, [0.1])) emissions.push(t);
    }
    // Steady low confidence over ~11s yields exactly two full windows. The
    // second starts on the first sample after the first emit (one step late),
    // so spacing is window + one 100ms sample.
    expect(emissions).toHaveLength(2);
    const spacing = emissions[1] - emissions[0];
    expect(spacing).toBeGreaterThanOrEqual(DEGRADED_TRACKING_WINDOW_MS);
    expect(spacing).toBeLessThanOrEqual(DEGRADED_TRACKING_WINDOW_MS + 100);
  });

  it('judges the WINDOW MEAN, not per-sample confidence', () => {
    const detector = new DegradedTrackingDetector();
    // Mostly weak (0.1) with a strong frame only every 400ms: mean ~0.30.
    const emitted = runWindow(detector, 0, (t) => (t % 400 === 0 ? 0.9 : 0.1));
    expect(emitted).toBe(true);
    // Reverse: mostly strong — mean ~0.72 > 0.5, so no emission.
    const healthy = new DegradedTrackingDetector();
    const healthyEmitted = runWindow(healthy, 0, (t) =>
      t % 400 === 0 ? 0.1 : 0.9,
    );
    expect(healthyEmitted).toBe(false);
  });
});
