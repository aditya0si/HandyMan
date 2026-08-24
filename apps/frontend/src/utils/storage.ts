/**
 * M8: tiny typed JSON storage on localStorage (Notes persistence; the
 * future sync channel will reuse the key scheme). The module OWNS the
 * 'jarvis:' key prefix — callers pass logical keys ('note:notes-1' →
 * physical key 'jarvis:note:notes-1').
 *
 * Backend injection (D9): tests call setStorageBackend(fake); null restores
 * the default (window.localStorage when available). With no backend
 * available, get → null / set → false / remove → no-op, silently — storage
 * is a convenience, never a crash.
 *
 * Edge cases log exactly ONE console.warn('[Storage] …') each (corrupt
 * JSON, quota/throw on setItem, unserializable value) and NEVER fire in
 * normal operation. Verifiers assert zero [error] lines; [warning] is
 * safe but must stay edge-only.
 */

export const STORAGE_KEY_PREFIX = 'jarvis:';

export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let injectedBackend: StorageBackend | null = null;

function activeBackend(): StorageBackend | null {
  if (injectedBackend) return injectedBackend;
  return typeof window !== 'undefined' && window.localStorage
    ? window.localStorage
    : null;
}

/** Injects a backend for tests; null restores the default. */
export function setStorageBackend(backend: StorageBackend | null): void {
  injectedBackend = backend;
}

function fullKey(key: string): string {
  return STORAGE_KEY_PREFIX + key;
}

/** Parsed value, or null when the key is missing, storage is unavailable,
 *  or the stored JSON is corrupt (warn once, never throws). */
export function get<T>(key: string): T | null {
  const backend = activeBackend();
  if (!backend) return null;
  const raw = backend.getItem(fullKey(key));
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.warn(`[Storage] corrupt JSON at "${fullKey(key)}" — returning null`);
    return null;
  }
}

/** true on success; false when storage is unavailable, the value cannot be
 *  serialized, or the write is refused (quota) — warns once, never throws. */
export function set(key: string, value: unknown): boolean {
  const backend = activeBackend();
  if (!backend) return false;
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    console.warn(`[Storage] serialization failed for "${fullKey(key)}":`, error);
    return false;
  }
  try {
    backend.setItem(fullKey(key), serialized);
    return true;
  } catch (error) {
    console.warn(`[Storage] save failed (quota?) for "${fullKey(key)}":`, error);
    return false;
  }
}

/** Removes a key; missing keys / no backend are silent no-ops. */
export function remove(key: string): void {
  activeBackend()?.removeItem(fullKey(key));
}
