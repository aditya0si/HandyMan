import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  get,
  remove,
  set,
  setStorageBackend,
  STORAGE_KEY_PREFIX,
} from './storage';
import type { StorageBackend } from './storage';

/**
 * storage (M8) unit tests (node environment — backend injection makes the
 * module testable without jsdom; the no-backend default is exactly what
 * node gives us). Warn assertions spy on console.warn and restore after
 * each test.
 */

class MemoryBackend implements StorageBackend {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

class QuotaBackend extends MemoryBackend {
  setItem(): void {
    throw new Error('QuotaExceededError');
  }
}

describe('storage (M8)', () => {
  let backend: MemoryBackend;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    backend = new MemoryBackend();
    setStorageBackend(backend);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    setStorageBackend(null);
    warnSpy.mockRestore();
  });

  it('round-trip: set then get returns the value; physical key carries the prefix', () => {
    expect(set('note:notes-1', { text: 'hello' })).toBe(true);
    expect(get<{ text: string }>('note:notes-1')).toEqual({ text: 'hello' });
    expect(set('plain', 'string value')).toBe(true);
    expect(get<string>('plain')).toBe('string value');
    // Physical key ownership: the prefix lives INSIDE the module.
    expect([...backend.map.keys()]).toEqual([
      `${STORAGE_KEY_PREFIX}note:notes-1`,
      `${STORAGE_KEY_PREFIX}plain`,
    ]);
    expect(backend.map.has('note:notes-1')).toBe(false);
  });

  it('missing key → null, no warn', () => {
    expect(get('never-set')).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('corrupt JSON → null + exactly one warn', () => {
    backend.map.set(`${STORAGE_KEY_PREFIX}note:bad`, '{not json');
    expect(get('note:bad')).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('[Storage]');
  });

  it('quota error on setItem → false + exactly one warn; nothing written', () => {
    setStorageBackend(new QuotaBackend());
    expect(set('note:q', 'x')).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('[Storage]');
  });

  it('prefix isolation + two-window key independence', () => {
    expect(set('note:notes-1', 'A')).toBe(true);
    expect(set('note:notes-2', 'B')).toBe(true);
    expect(get('note:notes-1')).toBe('A');
    expect(get('note:notes-2')).toBe('B');
    // A foreign key planted directly is invisible to get (prefix owned).
    const foreign = new MemoryBackend();
    foreign.map.set('other:x', '"raw"');
    setStorageBackend(foreign);
    expect(get('x')).toBeNull();
  });

  it('remove: clears the value; missing key is a silent no-op', () => {
    expect(set('note:del', 'v')).toBe(true);
    remove('note:del');
    expect(get('note:del')).toBeNull();
    expect(() => remove('never-set')).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('no backend available (node default): get → null, set → false, silently', () => {
    setStorageBackend(null); // restores the default: node has no localStorage
    expect(get('k')).toBeNull();
    expect(set('k', 'v')).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
