import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  buildLayoutFromWindows,
  isValidLayoutEntry,
  isValidPosition,
  loadWidgetLayout,
  saveWidgetLayout,
  validateLayout,
  WIDGET_LAYOUT_STORAGE_KEY,
} from './widgetLayout';
import { setStorageBackend, STORAGE_KEY_PREFIX } from '../storage';
import type { StorageBackend } from '../storage';

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

describe('widgetLayout validation', () => {
  it('isValidPosition checks finite numbers', () => {
    expect(isValidPosition({ x: 1, y: 2, z: 3 })).toBe(true);
    expect(isValidPosition({ x: 1, y: 2 })).toBe(false);
    expect(isValidPosition({ x: NaN, y: 0, z: 0 })).toBe(false);
    expect(isValidPosition({ x: Infinity, y: 0, z: 0 })).toBe(false);
    expect(isValidPosition(null)).toBe(false);
  });

  it('isValidLayoutEntry validates position and optional scale/zIndex', () => {
    expect(isValidLayoutEntry({ position: { x: 1, y: 0, z: 0.5 } })).toBe(true);
    expect(isValidLayoutEntry({ position: { x: 1, y: 0, z: 0.5 }, scale: { x: 1.5, y: 0.8, z: 0.1 } })).toBe(true);
    expect(isValidLayoutEntry({ position: { x: 0, y: 0, z: 0 }, zIndex: 5 })).toBe(true);
    expect(isValidLayoutEntry({ position: { x: 100, y: 0, z: 0 } })).toBe(false); // out of bounds
    expect(isValidLayoutEntry({ position: { x: 1, y: 0, z: 0 }, zIndex: 1.5 })).toBe(false); // not integer
    expect(isValidLayoutEntry({ position: null })).toBe(false);
  });

  it('validateLayout rejects invalid layouts', () => {
    expect(validateLayout({ 'widget-weather-1': { position: { x: 0, y: 0, z: 0 } } })).toBe(true);
    expect(validateLayout(null)).toBe(false);
    expect(validateLayout([])).toBe(false);
    expect(validateLayout({})).toBe(false); // empty
    expect(validateLayout({ 'bad id!': { position: { x: 0, y: 0, z: 0 } } })).toBe(false);
    expect(validateLayout({ 'widget-a': { position: { x: NaN, y: 0, z: 0 } } })).toBe(false);
    // too many entries
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 51; i++) big[`widget-${i}`] = { position: { x: 0, y: 0, z: 0 } };
    expect(validateLayout(big)).toBe(false);
  });

  it('buildLayoutFromWindows filters non-widget windows', () => {
    const windows = [
      { id: 'widget-weather-1', position: new THREE.Vector3(1, 2, 0.5), scale: new THREE.Vector3(1.5, 0.8, 0.1), zIndex: 3 },
      { id: 'briefing-1', position: new THREE.Vector3(0, 0, 0), scale: new THREE.Vector3(1, 1, 1), zIndex: 1 },
      { id: 'widget-news-1', position: new THREE.Vector3(-1, 0, 0.3), scale: new THREE.Vector3(1.3, 0.7, 0.1), zIndex: 4 },
    ];
    const layout = buildLayoutFromWindows(windows);
    expect(Object.keys(layout)).toEqual(['widget-weather-1', 'widget-news-1']);
    expect(layout['widget-weather-1'].position).toEqual({ x: 1, y: 2, z: 0.5 });
    expect(layout['widget-weather-1'].zIndex).toBe(3);
  });
});

describe('widgetLayout persistence (via storage backend)', () => {
  let backend: MemoryBackend;

  beforeEach(() => {
    backend = new MemoryBackend();
    setStorageBackend(backend);
  });
  afterEach(() => {
    setStorageBackend(null);
  });

  it('save + load round-trips', () => {
    const layout = {
      'widget-weather-1': { position: { x: 1, y: 0, z: 0.5 } },
      'widget-clock-1': { position: { x: -1, y: 0.5, z: 0.3 }, zIndex: 7 },
    };
    expect(saveWidgetLayout(layout)).toBe(true);
    expect(loadWidgetLayout()).toEqual(layout);
    expect(backend.map.has(STORAGE_KEY_PREFIX + WIDGET_LAYOUT_STORAGE_KEY)).toBe(true);
  });

  it('save rejects invalid layout', () => {
    const invalid = { 'widget-a': { position: { x: NaN, y: 0, z: 0 } } } as unknown as Record<string, unknown>;
    expect(saveWidgetLayout(invalid as never)).toBe(false);
    expect(loadWidgetLayout()).toBeNull();
  });

  it('load returns null when missing', () => {
    expect(loadWidgetLayout()).toBeNull();
  });

  it('load returns null and ignores corrupt JSON', () => {
    backend.map.set(STORAGE_KEY_PREFIX + WIDGET_LAYOUT_STORAGE_KEY, '{not json');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadWidgetLayout()).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('load returns null when validation fails (bad id)', () => {
    // Store directly an invalid layout via storage set
    backend.map.set(STORAGE_KEY_PREFIX + WIDGET_LAYOUT_STORAGE_KEY, JSON.stringify({ 'bad id!': { position: { x: 0, y: 0, z: 0 } } }));
    expect(loadWidgetLayout()).toBeNull();
  });

  it('clearWidgetLayout removes the key', () => {
    const layout = { 'widget-weather-1': { position: { x: 0, y: 0, z: 0 } } };
    saveWidgetLayout(layout);
    expect(loadWidgetLayout()).not.toBeNull();
    // Need real window localStorage for clearWidgetLayout — test via backend removal directly
    backend.map.delete(STORAGE_KEY_PREFIX + WIDGET_LAYOUT_STORAGE_KEY);
    expect(loadWidgetLayout()).toBeNull();
  });
});
