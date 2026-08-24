import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_PIXEL_RATIO } from '../components/Scene3D';
import {
  PERF_DEBUG_WINDOW_MS,
  __setPerfDebugEnabledForTests,
  dumpPerf,
  formatPerfLine,
  isPerfDebugEnabled,
  recordPerf,
} from './perfDebug';

afterEach(() => {
  __setPerfDebugEnabledForTests(false);
  vi.restoreAllMocks();
});

describe('perfDebug (M14 D4/D5)', () => {
  it('is DISABLED by default in node (no location) and record/dump are no-ops', () => {
    expect(isPerfDebugEnabled()).toBe(false);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    recordPerf('render', 5);
    dumpPerf(10_000);
    dumpPerf(20_000);
    expect(log).not.toHaveBeenCalled();
    expect(formatPerfLine()).toBe('');
  });

  it('MAX_PIXEL_RATIO is capped at 2 (D3)', () => {
    expect(MAX_PIXEL_RATIO).toBe(2);
  });

  it('aggregates buckets in fixed order with avg + count, omitting empty buckets', () => {
    __setPerfDebugEnabledForTests(true);
    recordPerf('render', 1);
    recordPerf('render', 3); // avg 2.0, n=2
    recordPerf('projection', 0.5);
    recordPerf('inference', 200);
    const line = formatPerfLine();
    expect(line).toBe(
      'render_avg=2.0ms n=2 inference_avg=200.0ms n=1 projection_avg=0.5ms n=1',
    );
  });

  it('dumpPerf prints one [PerfDebug] line per window and resets the buckets', () => {
    __setPerfDebugEnabledForTests(true); // also resets prior tests' samples
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    recordPerf('render', 4);
    dumpPerf(1_000); // first gate tick primes the window (no partial dump)
    expect(log).not.toHaveBeenCalled();
    recordPerf('render', 6);
    dumpPerf(1_000 + PERF_DEBUG_WINDOW_MS);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toBe('[PerfDebug] render_avg=5.0ms n=2');
    // Buckets reset: the next window dumps nothing when no new samples.
    dumpPerf(1_000 + 2 * PERF_DEBUG_WINDOW_MS);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
