import * as THREE from 'three';
import { get, set, STORAGE_KEY_PREFIX } from '../storage';

export const WIDGET_LAYOUT_STORAGE_KEY = 'widget-layout';
export const WIDGET_CACHE_PREFIX = 'widget-cache:';

/** Plain serializable position */
export interface WidgetPosition {
  x: number;
  y: number;
  z: number;
}

export interface WidgetLayoutEntry {
  position: WidgetPosition;
  scale?: WidgetPosition;
  zIndex?: number;
}

export type WidgetLayout = Record<string, WidgetLayoutEntry>;

const VALID_ID_RE = /^[a-z0-9-]+$/;

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function isValidPosition(p: unknown): p is WidgetPosition {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return isFiniteNumber(o.x) && isFiniteNumber(o.y) && isFiniteNumber(o.z);
}

export function isValidLayoutEntry(entry: unknown): entry is WidgetLayoutEntry {
  if (!entry || typeof entry !== 'object') return false;
  const o = entry as Record<string, unknown>;
  if (!isValidPosition(o.position)) return false;
  if (o.scale !== undefined && !isValidPosition(o.scale)) return false;
  if (o.zIndex !== undefined && !Number.isInteger(o.zIndex)) return false;
  // Clamp sanity: positions must be within reasonable spatial bounds (-10..10)
  const pos = o.position as WidgetPosition;
  if (Math.abs(pos.x) > 10 || Math.abs(pos.y) > 10 || Math.abs(pos.z) > 10) return false;
  return true;
}

export function validateLayout(layout: unknown): layout is WidgetLayout {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return false;
  const entries = Object.entries(layout as Record<string, unknown>);
  if (entries.length === 0) return false;
  if (entries.length > 50) return false; // guard against unbounded storage
  for (const [key, value] of entries) {
    if (!VALID_ID_RE.test(key)) return false;
    if (!isValidLayoutEntry(value)) return false;
  }
  return true;
}

export function loadWidgetLayout(): WidgetLayout | null {
  const raw = get<WidgetLayout>(WIDGET_LAYOUT_STORAGE_KEY);
  if (raw === null) return null;
  if (!validateLayout(raw)) {
    // Corrupt — do not return, caller will fall back to defaults
    return null;
  }
  return raw;
}

export function saveWidgetLayout(layout: WidgetLayout): boolean {
  if (!validateLayout(layout)) return false;
  return set(WIDGET_LAYOUT_STORAGE_KEY, layout);
}

/** Clears persisted layout (for tests / Reset layout). */
export function clearWidgetLayout(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(STORAGE_KEY_PREFIX + WIDGET_LAYOUT_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

/** Builds a layout map from a list of window-like objects. */
export function buildLayoutFromWindows(
  windows: Array<{ id: string; position: THREE.Vector3; scale: THREE.Vector3; zIndex: number }>,
): WidgetLayout {
  const layout: WidgetLayout = {};
  for (const w of windows) {
    // Persist only widget windows
    if (!w.id.startsWith('widget-')) continue;
    layout[w.id] = {
      position: { x: w.position.x, y: w.position.y, z: w.position.z },
      scale: { x: w.scale.x, y: w.scale.y, z: w.scale.z },
      zIndex: w.zIndex,
    };
  }
  return layout;
}

export function widgetCacheKey(widgetId: string): string {
  return WIDGET_CACHE_PREFIX + widgetId;
}

export function saveWidgetCache<T>(widgetId: string, data: T): boolean {
  return set(widgetCacheKey(widgetId), { data, updatedAt: Date.now() });
}

export function loadWidgetCache<T>(widgetId: string): { data: T; updatedAt: number } | null {
  const raw = get<{ data: T; updatedAt: number }>(widgetCacheKey(widgetId));
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!o.data || typeof o.updatedAt !== 'number') return null;
  return raw as { data: T; updatedAt: number };
}
