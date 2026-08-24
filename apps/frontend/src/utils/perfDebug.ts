/**
 * M14 opt-in frame-time instrumentation (brief D4/D5). Enabled ONLY by the
 * `?perf=1` URL param — default OFF, so every verifier's console
 * expectations stay byte-identical to M13 and the [Performance] line
 * keeps its exact M4 format. When disabled, record/dump are no-ops gated
 * by a module-cached boolean (zero measurement cost, zero output).
 *
 * Purity: NO import.meta, NO DOM-only APIs at module scope — the
 * `typeof location` guard keeps node vitest usable (param absent in node
 * => permanently disabled there).
 *
 * Line format (ONE per second, from Scene3D's existing 1 s gate):
 *   [PerfDebug] render_avg=0.8ms n=60 inference_avg=203.1ms n=4 \
 *   projection_avg=1.2ms n=88 interaction_avg=0.4ms n=30 sync_avg=0.1ms n=20
 * Buckets with no samples in the window are omitted.
 */

/** The URL search param that opts in (documented: no rebuild needed). */
export const PERF_DEBUG_PARAM = 'perf';

export type PerfBucket = 'render' | 'inference' | 'projection' | 'interaction' | 'sync';

const BUCKET_ORDER: readonly PerfBucket[] = [
  'render',
  'inference',
  'projection',
  'interaction',
  'sync',
];

/** Window length for the aggregated line (must ride the 1 s rAF gate). */
export const PERF_DEBUG_WINDOW_MS = 1000;

function readEnabled(): boolean {
  if (typeof location === 'undefined') return false; // node/tests: never
  try {
    return new URLSearchParams(location.search).get(PERF_DEBUG_PARAM) === '1';
  } catch {
    return false;
  }
}

let enabled = readEnabled();

export function isPerfDebugEnabled(): boolean {
  return enabled;
}

/** TEST-ONLY lever (node has no location, so the param can never be on).
 *  Also resets the window state so tests are order-independent. Never
 *  referenced by app code — grep-verified in review. */
export function __setPerfDebugEnabledForTests(value: boolean): void {
  enabled = value;
  samples.clear();
  lastDumpMs = 0;
}

interface Sample {
  totalMs: number;
  count: number;
}

const samples = new Map<PerfBucket, Sample>();
let lastDumpMs = 0;

/** Adds one duration sample (no-op when disabled). */
export function recordPerf(bucket: PerfBucket, durationMs: number): void {
  if (!enabled) return;
  const sample = samples.get(bucket);
  if (sample) {
    sample.totalMs += durationMs;
    sample.count += 1;
  } else {
    samples.set(bucket, { totalMs: durationMs, count: 1 });
  }
}

/** Builds the one-line summary for the current window (test hook). */
export function formatPerfLine(): string {
  const parts: string[] = [];
  for (const bucket of BUCKET_ORDER) {
    const sample = samples.get(bucket);
    if (!sample || sample.count === 0) continue;
    parts.push(
      `${bucket}_avg=${(sample.totalMs / sample.count).toFixed(1)}ms n=${sample.count}`,
    );
  }
  return parts.join(' ');
}

/**
 * Dumps the window's line if one full window has elapsed (called from
 * Scene3D's existing per-second FPS gate — the same rAF clock). Resets
 * the buckets. No-op when disabled.
 */
export function dumpPerf(nowMs: number): void {
  if (!enabled) return;
  if (lastDumpMs !== 0 && nowMs - lastDumpMs < PERF_DEBUG_WINDOW_MS) return;
  if (lastDumpMs === 0) {
    // First gate tick: start the window instead of dumping a partial one.
    lastDumpMs = nowMs;
    return;
  }
  lastDumpMs = nowMs;
  const line = formatPerfLine();
  samples.clear();
  if (line !== '') console.log(`[PerfDebug] ${line}`);
}
