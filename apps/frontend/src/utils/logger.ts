/**
 * Performance metrics aggregator (guide step 4.2), D3 in the M4 brief.
 *
 * The logger is an aggregator, never a replacement: the existing per-second
 * console lines in Scene3D and HandTracker stay byte-identical, and this
 * logger consumes the SAME measurements one level up (App's onFpsUpdate /
 * onLatencyUpdate handlers) plus raw per-frame samples that never touch the
 * console individually.
 *
 * DEVIATIONS from guide 4.2 (documented per the M4 brief, section 2 D3):
 * - Initial renderFPS is 0, not the guide's seeded 60 (seeding a value before
 *   any measurement exists would be dishonest).
 * - logToConsole prints ONE console.log line instead of console.table:
 *   console.table renders inconsistently in captured console streams, and the
 *   strict single-line format is what the M4 verifier asserts.
 * - updateFPS exists per the guide (self-contained 1 s frame window,
 *   injectable clock, unit-tested) but the app wires FPS via logMetric so the
 *   render loop keeps exactly ONE frame counter (Scene3D's existing one).
 * - recordSample is a new rolling-mean input for the two per-frame metrics
 *   (gestureRecognitionLatency, interactionLatency); setter keys and sample
 *   keys are independent storage and never affect each other.
 */

export interface PerformanceMetrics {
  handDetectionLatency: number; // ms — 1/s averages pushed by App (from HandTracker)
  renderFPS: number; // 1/s value pushed by App (from Scene3D)
  gestureRecognitionLatency: number; // ms — rolling mean of per-frame samples
  interactionLatency: number; // ms — rolling mean of per-frame samples
}

/** Keys that accept raw per-frame samples (rolling-mean inputs). */
export type SampleMetricKey = 'gestureRecognitionLatency' | 'interactionLatency';

/** Rolling sample window for recordSample (~1 s at 30 Hz). */
export const METRIC_SAMPLE_WINDOW = 30;
/** Console summary cadence used by App's frame gate. */
export const SUMMARY_INTERVAL_MS = 5000;

export class PerformanceLogger {
  private readonly metrics: PerformanceMetrics = {
    handDetectionLatency: 0,
    renderFPS: 0,
    gestureRecognitionLatency: 0,
    interactionLatency: 0,
  };
  private readonly samples: Record<SampleMetricKey, number[]> = {
    gestureRecognitionLatency: [],
    interactionLatency: [],
  };
  private frameCount = 0;
  // 0 = "no window open yet": the first updateFPS call starts the first
  // 1-second window (the guide's Date.now() seed is a different timebase and
  // would be wrong against an injected performance.now()-style clock).
  private lastFrameTime = 0;
  private dataPresent = false;

  /** Sets the latest value for a metric (guide 4.2 semantics). */
  logMetric(key: keyof PerformanceMetrics, value: number): void {
    this.metrics[key] = value;
    this.dataPresent = true;
  }

  /** Records a raw sample; getMetrics() reports the mean of the last
   *  METRIC_SAMPLE_WINDOW samples for sample keys. */
  recordSample(key: SampleMetricKey, value: number): void {
    const window = this.samples[key];
    window.push(value);
    if (window.length > METRIC_SAMPLE_WINDOW) window.shift();
    this.dataPresent = true;
  }

  /** Defensive copy of the current metrics (sample keys report their mean). */
  getMetrics(): PerformanceMetrics {
    return {
      handDetectionLatency: this.metrics.handDetectionLatency,
      renderFPS: this.metrics.renderFPS,
      gestureRecognitionLatency: this.meanOrLatest('gestureRecognitionLatency'),
      interactionLatency: this.meanOrLatest('interactionLatency'),
    };
  }

  /** Guide 4.2 updateFPS: self-contained 1 s frame window (injectable clock).
   *  Unit-tested; the app instead feeds Scene3D's existing FPS measurement via
   *  logMetric so the render loop keeps exactly one frame counter. */
  updateFPS(nowMs?: number): void {
    this.frameCount += 1;
    const now = nowMs ?? performance.now();
    if (now - this.lastFrameTime >= 1000) {
      this.metrics.renderFPS = this.frameCount;
      this.dataPresent = true;
      this.frameCount = 0;
      this.lastFrameTime = now;
    }
  }

  /** ONE console.log line with all four metrics (exact format, verifier-asserted):
   *  [Performance] handDetectionLatency=212ms renderFPS=4
   *  gestureRecognitionLatency=0.3ms interactionLatency=0.0ms */
  logToConsole(): void {
    const metrics = this.getMetrics();
    console.log(
      `[Performance] handDetectionLatency=${Math.round(metrics.handDetectionLatency)}ms ` +
        `renderFPS=${Math.round(metrics.renderFPS)} ` +
        `gestureRecognitionLatency=${metrics.gestureRecognitionLatency.toFixed(1)}ms ` +
        `interactionLatency=${metrics.interactionLatency.toFixed(1)}ms`,
    );
  }

  /** True once any metric has been set or sampled. */
  hasData(): boolean {
    return this.dataPresent;
  }

  /** Sample-key value: mean of the recorded window, or the logMetric value
   *  when no samples exist yet (so logMetric on any of the four keys is
   *  always observable). */
  private meanOrLatest(key: SampleMetricKey): number {
    const window = this.samples[key];
    if (window.length === 0) return this.metrics[key];
    let sum = 0;
    for (const value of window) sum += value;
    return sum / window.length;
  }
}
