/**
 * M15 error collector (brief D5): a node-pure singleton that counts uncaught
 * window 'error' + 'unhandledrejection' events, deduped by message, with a
 * capped snapshot. The HUD's "Errors: N" row is its only UI surface.
 *
 * - `record(message)` is the core: coincident listeners call it. Dedupe by
 *   message; `getCount()` is the TOTAL distinct-message count (the HUD
 *   number, never capped), the snapshot is capped at ERROR_COLLECTOR_MAX_STORED
 *   (oldest evicted) so DevTools debugging of recent errors stays bounded.
 * - ONE throttled `console.warn` per ERROR_LOG_THROTTLE_MS when a NEW distinct
 *   error is captured — a WARN (not error) so the verifiers' zero-console-error
 *   gates stay honest, and never logged on the healthy path (Errors: 0).
 * - install() is idempotent and accepts an injectable window-like (node
 *   vitest exercises the event surface with fakes; unit tests may also call
 *   record() directly without installing).
 */

/** Max distinct messages retained in the snapshot (recent-first). */
export const ERROR_COLLECTOR_MAX_STORED = 50;
/** Throttle for the single [Errors] console.warn line. */
export const ERROR_LOG_THROTTLE_MS = 30000;

export interface ErrorSnapshotEntry {
  message: string;
  occurrences: number;
  lastAt: number;
}

/** Minimal EventTarget surface install() needs (satisfied by window). */
export interface ErrorEventTargetWindow {
  addEventListener(
    type: 'error' | 'unhandledrejection',
    listener: (event: unknown) => void,
  ): void;
  removeEventListener(
    type: 'error' | 'unhandledrejection',
    listener: (event: unknown) => void,
  ): void;
}

function messageFromErrorEvent(event: unknown): string {
  const value = event as { message?: unknown; error?: { message?: unknown } };
  if (typeof value.message === 'string' && value.message !== '') {
    return value.message;
  }
  if (
    typeof value.error?.message === 'string' &&
    value.error.message !== ''
  ) {
    return value.error.message;
  }
  return 'Unhandled window error (no message)';
}

function messageFromRejection(event: unknown): string {
  const reason = (event as { reason?: unknown }).reason;
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string' && reason !== '') return reason;
  return 'Unhandled promise rejection';
}

class ErrorCollector {
  private entries = new Map<string, ErrorSnapshotEntry>();
  private totalDistinct = 0;
  private readonly subscribers = new Set<() => void>();
  // -Infinity so the FIRST new distinct error logs immediately.
  private lastLogTime = -Infinity;
  private installed = false;

  getCount(): number {
    return this.totalDistinct;
  }

  getSnapshot(): readonly ErrorSnapshotEntry[] {
    return [...this.entries.values()];
  }

  /** Records one error occurrence; deduped by message. Notifies subscribers. */
  record(message: string, now: number = Date.now()): void {
    const existing = this.entries.get(message);
    if (existing) {
      existing.occurrences += 1;
      existing.lastAt = now;
    } else {
      this.totalDistinct += 1;
      this.entries.set(message, { message, occurrences: 1, lastAt: now });
      if (this.entries.size > ERROR_COLLECTOR_MAX_STORED) {
        // Evict the OLDEST distinct entry — the snapshot stays bounded.
        let oldest: ErrorSnapshotEntry | null = null;
        for (const entry of this.entries.values()) {
          if (!oldest || entry.lastAt < oldest.lastAt) oldest = entry;
        }
        if (oldest) this.entries.delete(oldest.message);
      }
      if (now - this.lastLogTime >= ERROR_LOG_THROTTLE_MS) {
        this.lastLogTime = now;
        console.warn(
          `[Errors] ${this.totalDistinct} distinct error(s) captured — see DevTools for details`,
        );
      }
    }
    for (const callback of this.subscribers) callback();
  }

  /** Resets every error (HUD back to 0) and notifies subscribers. */
  clear(): void {
    this.entries.clear();
    this.totalDistinct = 0;
    for (const callback of this.subscribers) callback();
  }

  /** Returns an unsubscribe. Fires immediately for every record/clear. */
  subscribe(callback: () => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Attaches the window listeners once (idempotent). Returns an unsubscribe.
   * No-op when no target is available (node unit tests use record() directly).
   */
  install(target?: ErrorEventTargetWindow): () => void {
    if (this.installed) return () => {};
    const win = target ?? (typeof window !== 'undefined'
      ? (window as unknown as ErrorEventTargetWindow)
      : null);
    if (!win) return () => {};
    this.installed = true;
    const onError = (event: unknown): void =>
      this.record(messageFromErrorEvent(event));
    const onRejection = (event: unknown): void =>
      this.record(messageFromRejection(event));
    win.addEventListener('error', onError);
    win.addEventListener('unhandledrejection', onRejection);
    const detach = (): void => {
      win.removeEventListener('error', onError);
      win.removeEventListener('unhandledrejection', onRejection);
      this.installed = false;
    };
    return detach;
  }

  /** TEST-ONLY: fully resets state for fresh per-test isolation. */
  __resetForTests(): void {
    this.entries.clear();
    this.totalDistinct = 0;
    this.subscribers.clear();
    this.lastLogTime = -Infinity;
    this.installed = false;
  }
}

/** Module singleton — install() in main.tsx, subscribed by App's HUD. */
export const errorCollector = new ErrorCollector();
