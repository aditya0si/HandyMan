import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_INPUT_SETTINGS,
  getStoredInputSettings,
  setStoredInputSettings,
} from './settings';
import type { InputSettings } from './settings';

class MockLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  clear(): void {
    this.store.clear();
  }
}

describe('Input settings persistence and defaults', () => {
  let originalLocalStorage: any;
  let mockStorage: MockLocalStorage;

  beforeEach(() => {
    mockStorage = new MockLocalStorage();
    originalLocalStorage = (globalThis as any).localStorage;
    (globalThis as any).localStorage = mockStorage;
  });

  afterEach(() => {
    (globalThis as any).localStorage = originalLocalStorage;
  });

  it('returns DEFAULT_INPUT_SETTINGS when localStorage is empty', () => {
    const settings = getStoredInputSettings();
    expect(settings).toEqual(DEFAULT_INPUT_SETTINGS);
    expect(settings.dominantHand).toBe('auto');
    expect(settings.sensitivity).toBe('Balanced');
    expect(settings.dwellDurationMs).toBe(700);
    expect(settings.gesturesEnabled).toBe(true);
    expect(settings.eyeAttentionEnabled).toBe(false);
    expect(settings.eyeAssistedTargeting).toBe(true);
  });

  it('stores and recovers custom settings through localStorage', () => {
    const custom: InputSettings = {
      dominantHand: 'Left',
      sensitivity: 'Responsive',
      dwellDurationMs: 500,
      reducedMotion: true,
      highContrast: true,
      gesturesEnabled: false,
      eyeAttentionEnabled: true,
      eyeAssistedTargeting: false,
    };
    setStoredInputSettings(custom);
    const recovered = getStoredInputSettings();
    expect(recovered).toEqual(custom);
  });

  it('dispatches jarvis-settings-changed event on update', () => {
    let fired = false;
    const listeners = new Set<() => void>();
    const originalWindow = (globalThis as any).window;
    (globalThis as any).window = {
      addEventListener: (_event: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_event: string, cb: () => void) => listeners.delete(cb),
      dispatchEvent: (_event: any) => {
        fired = true;
        listeners.forEach((cb) => cb());
        return true;
      },
    };

    setStoredInputSettings({
      ...DEFAULT_INPUT_SETTINGS,
      gesturesEnabled: false,
    });
    expect(fired).toBe(true);
    (globalThis as any).window = originalWindow;
  });
});
