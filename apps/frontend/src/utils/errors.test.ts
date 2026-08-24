import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ERROR_COLLECTOR_MAX_STORED,
  ERROR_LOG_THROTTLE_MS,
  errorCollector,
} from './errors';
import type { ErrorEventTargetWindow } from './errors';

// The singleton's state is reset per test via the test-only lever.
function resetSingleton(): void {
  (errorCollector as unknown as { __resetForTests(): void }).__resetForTests();
}

afterEach(() => {
  vi.restoreAllMocks();
  resetSingleton();
});

/** Minimal fake window capturing the two listeners install() attaches. */
function fakeWindow(): ErrorEventTargetWindow & {
  errorListeners: Array<(event: unknown) => void>;
  rejectionListeners: Array<(event: unknown) => void>;
} {
  const listeners: ErrorEventTargetWindow & {
    errorListeners: Array<(event: unknown) => void>;
    rejectionListeners: Array<(event: unknown) => void>;
  } = {
    errorListeners: [],
    rejectionListeners: [],
    addEventListener(type, listener) {
      if (type === 'error') this.errorListeners.push(listener);
      else this.rejectionListeners.push(listener);
    },
    removeEventListener(type, listener) {
      const list = type === 'error' ? this.errorListeners : this.rejectionListeners;
      const index = list.indexOf(listener);
      if (index >= 0) list.splice(index, 1);
    },
  };
  return listeners;
}

describe('errorCollector (M15 D5)', () => {
  it('record dedupes by message: same message counts once, occurrences accumulate', () => {
    resetSingleton();
    errorCollector.record('boom');
    errorCollector.record('boom');
    errorCollector.record('other');
    expect(errorCollector.getCount()).toBe(2);
    const snapshot = errorCollector.getSnapshot();
    expect(snapshot).toHaveLength(2);
    const boom = snapshot.find((e) => e.message === 'boom');
    expect(boom?.occurrences).toBe(2);
    expect(boom?.lastAt).toBeTypeOf('number');
  });

  it('getCount is unbounded while the snapshot is capped (oldest evicted)', () => {
    resetSingleton();
    for (let i = 0; i < ERROR_COLLECTOR_MAX_STORED + 10; i += 1) {
      errorCollector.record(`error-${i}`, i);
    }
    expect(errorCollector.getCount()).toBe(ERROR_COLLECTOR_MAX_STORED + 10);
    expect(errorCollector.getSnapshot()).toHaveLength(ERROR_COLLECTOR_MAX_STORED);
    // The OLDEST distinct messages were evicted; the newest survive.
    const messages = errorCollector.getSnapshot().map((e) => e.message);
    expect(messages).not.toContain('error-0');
    expect(messages).toContain(`error-${ERROR_COLLECTOR_MAX_STORED + 9}`);
  });

  it('clear() resets count + snapshot and notifies subscribers', () => {
    resetSingleton();
    errorCollector.record('boom');
    const seen: number[] = [];
    const unsubscribe = errorCollector.subscribe(() =>
      seen.push(errorCollector.getCount()),
    );
    errorCollector.clear();
    expect(errorCollector.getCount()).toBe(0);
    expect(errorCollector.getSnapshot()).toHaveLength(0);
    unsubscribe();
  });

  it('subscribe notifies on record and unsubscribes cleanly', () => {
    resetSingleton();
    const seen: number[] = [];
    const unsubscribe = errorCollector.subscribe(() =>
      seen.push(errorCollector.getCount()),
    );
    errorCollector.record('a');
    errorCollector.record('b');
    unsubscribe();
    errorCollector.record('c');
    expect(seen).toEqual([1, 2]);
  });

  it('logs ONE throttled [Errors] warn for new distinct errors per throttle window', () => {
    resetSingleton();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorCollector.record('a', 0);
    // Second NEW distinct error within the window logs nothing.
    errorCollector.record('b', 1000);
    expect(warn).toHaveBeenCalledTimes(1);
    // A repeated message never logs.
    errorCollector.record('a', 2000);
    expect(warn).toHaveBeenCalledTimes(1);
    // Next window -> logs again.
    errorCollector.record('c', ERROR_LOG_THROTTLE_MS + 1);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0][0])).toContain('[Errors]');
  });

  it('install() attaches error + unhandledrejection listeners onto the given window', () => {
    resetSingleton();
    const win = fakeWindow();
    const detach = errorCollector.install(win);
    expect(win.errorListeners).toHaveLength(1);
    expect(win.rejectionListeners).toHaveLength(1);

    win.errorListeners[0]({ message: 'uncaught boom' });
    expect(errorCollector.getCount()).toBe(1);

    win.rejectionListeners[0]({ reason: new Error('rejected boom') });
    expect(errorCollector.getCount()).toBe(2);
    detach();
  });

  it('install() extracts nested error messages and synthesizes labels', () => {
    resetSingleton();
    const win = fakeWindow();
    errorCollector.install(win);
    // ErrorEvent with an .error property but no .message.
    win.errorListeners[0]({ error: new Error('inner') });
    // Resource-style event with no message at all.
    win.errorListeners[0]({});
    // Promise rejection with a plain string reason.
    win.rejectionListeners[0]({ reason: 'string reason' });
    // Promise rejection with an object reason (no message).
    win.rejectionListeners[0]({ reason: { code: 5 } });
    const messages = errorCollector.getSnapshot().map((e) => e.message);
    expect(messages).toEqual([
      'inner',
      'Unhandled window error (no message)',
      'string reason',
      'Unhandled promise rejection',
    ]);
  });

  it('install() is idempotent — a second call attaches nothing new', () => {
    resetSingleton();
    const win = fakeWindow();
    errorCollector.install(win);
    const detach2 = errorCollector.install(win);
    expect(win.errorListeners).toHaveLength(1);
    expect(win.rejectionListeners).toHaveLength(1);
    detach2();
  });

  it('install() with no window (node) is a safe no-op; record() still works', () => {
    resetSingleton();
    expect(errorCollector.install(undefined)).toBeInstanceOf(Function);
    errorCollector.record('direct');
    expect(errorCollector.getCount()).toBe(1);
  });
});
