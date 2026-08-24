import { describe, expect, it, beforeEach } from 'vitest';
import {
  appIdFromWindowId,
  createAppBus,
  getApp,
  getTitle,
  listApps,
  register,
  setFallbackApp,
} from './appRegistry';
import type { AppComponent, AppDefinition } from './appRegistry';

/**
 * appRegistry (M8) unit tests (node environment — the module imports NO
 * runtime React: components are plain functions stored by reference).
 *
 * The registry is module-global and append-only (no reset API, D7), so
 * every `it` uses UNIQUE app ids; `beforeEach` re-injects a fresh dummy
 * fallback so unknown-id assertions never depend on a prior test's state.
 */

const dummyA = (() => null) as AppComponent;
const dummyB = (() => null) as AppComponent;
const dummyC = (() => null) as AppComponent;
const dummyFallback = (() => null) as AppComponent;

describe('appRegistry (M8)', () => {
  beforeEach(() => {
    setFallbackApp({
      id: 'unknown',
      title: 'Unknown App',
      Component: dummyFallback,
    });
  });

  it('register + getApp return the exact definition (Component by reference)', () => {
    const def: AppDefinition = { id: 'a-1', title: 'A', Component: dummyA };
    register(def);
    expect(getApp('a-1')).toBe(def);
    expect(getApp('a-1').Component).toBe(dummyA);
  });

  it('listApps preserves registration order', () => {
    register({ id: 'b-1', title: 'B', Component: dummyB });
    register({ id: 'b-2', title: 'B2', Component: dummyC });
    const ids = listApps().map((a) => a.id);
    expect(ids).toContain('b-1');
    expect(ids).toContain('b-2');
    expect(ids.indexOf('b-1')).toBeLessThan(ids.indexOf('b-2'));
    // Length grows accordingly (a-1 from the first test + the two above).
    expect(ids.length).toBeGreaterThanOrEqual(3);
  });

  it('getTitle returns the title for registered ids', () => {
    register({ id: 'c-1', title: 'Clock', Component: dummyA });
    expect(getTitle('c-1')).toBe('Clock');
  });

  it('getApp on an unknown id returns the injected fallback', () => {
    const fallback: AppDefinition = {
      id: 'unknown',
      title: 'Unknown App',
      Component: dummyFallback,
    };
    setFallbackApp(fallback);
    expect(getApp('nope')).toBe(fallback);
    expect(getApp('nope').Component).toBe(dummyFallback);
    expect(getTitle('nope')).toBe('Unknown App');
  });

  it('register throws on duplicate id and does not overwrite', () => {
    const first: AppDefinition = { id: 'dup-1', title: 'First', Component: dummyA };
    register(first);
    const second: AppDefinition = {
      id: 'dup-1',
      title: 'Second',
      Component: dummyB,
    };
    expect(() => register(second)).toThrow(/already registered/);
    expect(() => register(second)).toThrow(/dup-1/);
    expect(getApp('dup-1')).toBe(first);
    expect(getApp('dup-1').title).toBe('First');
  });

  it('appIdFromWindowId truth table', () => {
    expect(appIdFromWindowId('dashboard-1')).toBe('dashboard');
    expect(appIdFromWindowId('notes-12')).toBe('notes');
    expect(appIdFromWindowId('web-search-2')).toBe('web-search');
    expect(appIdFromWindowId('notes-1-2')).toBe('notes-1');
    expect(appIdFromWindowId('dashboard')).toBe('dashboard');
    expect(appIdFromWindowId('-1')).toBe('-1');
  });

  it('bus: subscribe + emit delivers the exact message', () => {
    const bus = createAppBus();
    let received: unknown = null;
    bus.subscribe((msg) => {
      received = msg;
    });
    const message = { from: 'notes-1', type: 'hello', payload: 7 };
    bus.emit(message);
    expect(received).toBe(message);
    expect(received).toEqual({ from: 'notes-1', type: 'hello', payload: 7 });
  });

  it('bus: unsubscribe stops delivery for that handler only', () => {
    const bus = createAppBus();
    const received: string[] = [];
    const unsub = bus.subscribe(() => received.push('first'));
    bus.subscribe(() => received.push('second'));
    unsub();
    bus.emit({ from: 'x', type: 't' });
    expect(received).toEqual(['second']);
  });

  it('bus: emit with zero subscribers is a no-op', () => {
    const bus = createAppBus();
    expect(() => bus.emit({ from: 'x', type: 't' })).not.toThrow();
  });

  it('bus: two subscribers both receive one emit', () => {
    const bus = createAppBus();
    let first = 0;
    let second = 0;
    bus.subscribe(() => {
      first += 1;
    });
    bus.subscribe(() => {
      second += 1;
    });
    bus.emit({ from: 'x', type: 't' });
    expect(first).toBe(1);
    expect(second).toBe(1);
  });
});
