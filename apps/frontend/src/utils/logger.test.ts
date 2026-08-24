import { describe, expect, it, vi } from 'vitest';
import {
  PerformanceLogger,
  METRIC_SAMPLE_WINDOW,
  SUMMARY_INTERVAL_MS,
} from './logger';
import type { PerformanceMetrics } from './logger';

/**
 * PerformanceLogger unit tests (node environment, no DOM). All clocks are
 * injected; the only real-timing dependency is the no-throw smoke. The
 * logToConsole line format is asserted against the exact regex the M4
 * verifier uses.
 */

const LOG_LINE_PATTERN =
  /^\[Performance\] handDetectionLatency=\d+ms renderFPS=\d+ gestureRecognitionLatency=\d+(\.\d+)?ms interactionLatency=\d+(\.\d+)?ms$/;

describe('PerformanceLogger initial state', () => {
  it('all metrics start at 0 and hasData() is false', () => {
    const logger = new PerformanceLogger();
    expect(logger.getMetrics()).toEqual({
      handDetectionLatency: 0,
      renderFPS: 0,
      gestureRecognitionLatency: 0,
      interactionLatency: 0,
    });
    expect(logger.hasData()).toBe(false);
  });

  it('getMetrics() returns a defensive copy (mutating it does not affect the logger)', () => {
    const logger = new PerformanceLogger();
    logger.logMetric('renderFPS', 42);
    const copy = logger.getMetrics();
    copy.renderFPS = 999;
    copy.handDetectionLatency = 999;
    expect(logger.getMetrics().renderFPS).toBe(42);
    expect(logger.getMetrics().handDetectionLatency).toBe(0);
  });
});

describe('PerformanceLogger.logMetric', () => {
  it('sets each of the four keys', () => {
    const logger = new PerformanceLogger();
    const values: PerformanceMetrics = {
      handDetectionLatency: 212,
      renderFPS: 4,
      gestureRecognitionLatency: 12,
      interactionLatency: 0.7,
    };
    (Object.keys(values) as (keyof PerformanceMetrics)[]).forEach((key) => {
      logger.logMetric(key, values[key]);
    });
    expect(logger.getMetrics()).toEqual(values);
  });
});

describe('PerformanceLogger.recordSample', () => {
  it('rolling mean: 30 samples of 10 -> 10.0', () => {
    const logger = new PerformanceLogger();
    for (let i = 0; i < METRIC_SAMPLE_WINDOW; i += 1) {
      logger.recordSample('gestureRecognitionLatency', 10);
    }
    expect(logger.getMetrics().gestureRecognitionLatency).toBe(10);
  });

  it('then 5 samples of 20 -> (25*10 + 5*20) / 30', () => {
    const logger = new PerformanceLogger();
    for (let i = 0; i < 30; i += 1) {
      logger.recordSample('gestureRecognitionLatency', 10);
    }
    for (let i = 0; i < 5; i += 1) {
      logger.recordSample('gestureRecognitionLatency', 20);
    }
    expect(logger.getMetrics().gestureRecognitionLatency).toBeCloseTo(
      (25 * 10 + 5 * 20) / 30,
      10,
    );
  });

  it('the window is exactly the last METRIC_SAMPLE_WINDOW samples (40 pushed)', () => {
    const logger = new PerformanceLogger();
    for (let i = 0; i < 30; i += 1) {
      logger.recordSample('interactionLatency', 10);
    }
    for (let i = 0; i < 10; i += 1) {
      logger.recordSample('interactionLatency', 20);
    }
    // 40 pushed total: the oldest 10 must be gone -> (20*10 + 10*20) / 30.
    expect(logger.getMetrics().interactionLatency).toBeCloseTo(
      (20 * 10 + 10 * 20) / 30,
      10,
    );
  });

  it('sample keys and setter keys never affect each other', () => {
    const logger = new PerformanceLogger();
    logger.logMetric('handDetectionLatency', 5);
    logger.recordSample('gestureRecognitionLatency', 1);
    logger.recordSample('gestureRecognitionLatency', 3);
    // Setter key untouched by samples; sample mean untouched by setters.
    expect(logger.getMetrics().handDetectionLatency).toBe(5);
    expect(logger.getMetrics().gestureRecognitionLatency).toBeCloseTo(2, 10);

    logger.logMetric('renderFPS', 60);
    expect(logger.getMetrics().gestureRecognitionLatency).toBeCloseTo(2, 10);
    expect(logger.getMetrics().renderFPS).toBe(60);
  });
});

describe('PerformanceLogger.updateFPS', () => {
  it('counts frames in a 1 s window: t=0..999 do not publish, t>=1000 publishes and resets', () => {
    const logger = new PerformanceLogger();
    logger.updateFPS(0); // frame 1
    logger.updateFPS(500); // frame 2
    logger.updateFPS(999); // frame 3
    expect(logger.getMetrics().renderFPS).toBe(0); // window not elapsed

    logger.updateFPS(1000); // frame 4 -> publishes
    expect(logger.getMetrics().renderFPS).toBe(4);

    // The next second re-accumulates independently.
    logger.updateFPS(1999); // frame 1 of the new window
    expect(logger.getMetrics().renderFPS).toBe(4); // not elapsed yet
    logger.updateFPS(2000); // frame 2 -> publishes
    expect(logger.getMetrics().renderFPS).toBe(2);
  });

  it('updateFPS() with the default clock does not throw (no-throw smoke)', () => {
    const logger = new PerformanceLogger();
    expect(() => logger.updateFPS()).not.toThrow();
  });
});

describe('PerformanceLogger.logToConsole', () => {
  it('prints exactly one line matching the verifier format with current values', () => {
    const logger = new PerformanceLogger();
    logger.logMetric('handDetectionLatency', 212);
    logger.logMetric('renderFPS', 4);
    logger.recordSample('gestureRecognitionLatency', 0.3);
    // interactionLatency stays unmeasured -> prints as 0.0.
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    logger.logToConsole();

    expect(spy).toHaveBeenCalledTimes(1);
    const message = spy.mock.calls[0][0] as string;
    expect(message).toMatch(LOG_LINE_PATTERN);
    expect(message).toBe(
      '[Performance] handDetectionLatency=212ms renderFPS=4 gestureRecognitionLatency=0.3ms interactionLatency=0.0ms',
    );
    spy.mockRestore();
  });

  it('unmeasured values print as 0 / 0.0', () => {
    const logger = new PerformanceLogger();
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    logger.logToConsole();
    expect(spy.mock.calls[0][0]).toBe(
      '[Performance] handDetectionLatency=0ms renderFPS=0 gestureRecognitionLatency=0.0ms interactionLatency=0.0ms',
    );
    spy.mockRestore();
  });
});

describe('PerformanceLogger.hasData', () => {
  it('is false initially, true after logMetric, true after recordSample', () => {
    const logger = new PerformanceLogger();
    expect(logger.hasData()).toBe(false);
    logger.logMetric('renderFPS', 30);
    expect(logger.hasData()).toBe(true);

    const other = new PerformanceLogger();
    other.recordSample('interactionLatency', 1);
    expect(other.hasData()).toBe(true);
  });

  it('SUMMARY_INTERVAL_MS is exported as the 5 s cadence constant', () => {
    expect(SUMMARY_INTERVAL_MS).toBe(5000);
  });
});
