/**
 * LocalAnalytics — client-side analytics adapter (Session 3).
 *
 * Stores anonymized usage counters in localStorage. No PII, no camera data.
 * The adapter is designed to:
 *   1. Track session counts & card open/close events locally.
 *   2. Record user-submitted thumbs-up/down feedback.
 *   3. Flush accumulated metrics to the backend when a POST endpoint exists.
 *
 * Privacy: all data is keyed by an opaque session ID (crypto.randomUUID or
 * fallback) — never by email, user ID, or workspace name.
 *
 * Isomorphic: guards all browser-only APIs (localStorage, crypto, fetch)
 * behind typeof checks so the module compiles under lib: ["ES2020"] (no DOM).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AnalyticsEvent {
  name: string;
  timestamp: number;
  value?: number;
  meta?: Record<string, string | number | boolean>;
}

export interface FeedbackEntry {
  featureId: string;
  rating: 'positive' | 'negative';
  comment?: string;
  timestamp: number;
}

export interface AnalyticsSnapshot {
  sessionId: string;
  sessionStart: number;
  events: AnalyticsEvent[];
  feedback: FeedbackEntry[];
  counters: Record<string, number>;
}

const STORAGE_KEY = 'jarvis_analytics';
const FEEDBACK_KEY = 'jarvis_feedback';

// --- Isomorphic helpers ---------------------------------------------------

function generateSessionId(): string {
  const g = globalThis as any;
  if (g.crypto && typeof g.crypto.randomUUID === 'function') {
    return g.crypto.randomUUID() as string;
  }
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface SimpleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getStorage(): SimpleStorage | null {
  try {
    const g = globalThis as any;
    return typeof g.localStorage !== 'undefined' ? g.localStorage as SimpleStorage : null;
  } catch {
    return null;
  }
}

function readJson<T>(key: string): T | null {
  const s = getStorage();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  const s = getStorage();
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify(value));
  } catch { /* quota exceeded or unavailable — ignore */ }
}

function removeKey(key: string): void {
  const s = getStorage();
  if (!s) return;
  try { s.removeItem(key); } catch { /* ignore */ }
}

// -------------------------------------------------------------------------

/**
 * LocalAnalytics — browser-side analytics with localStorage persistence.
 * Works without any backend; can be flushed to a server endpoint later.
 */
export class LocalAnalytics {
  private sessionId: string;
  private sessionStart: number;
  private events: AnalyticsEvent[] = [];
  private counters: Record<string, number> = {};
  private maxEvents: number;

  constructor(maxEvents = 200) {
    this.sessionId = generateSessionId();
    this.sessionStart = Date.now();
    this.maxEvents = maxEvents;

    // Load persisted counters
    const persisted = readJson<Record<string, number>>(STORAGE_KEY);
    if (persisted && typeof persisted === 'object') {
      this.counters = persisted;
    }
  }

  /** Track a named event with optional numeric value and metadata. */
  track(name: string, value?: number, meta?: Record<string, string | number | boolean>): void {
    const event: AnalyticsEvent = { name, timestamp: Date.now() };
    if (value !== undefined) event.value = value;
    if (meta) event.meta = meta;

    this.events.push(event);

    // Increment counter
    this.counters[name] = (this.counters[name] || 0) + 1;

    // Cap in-memory events
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    writeJson(STORAGE_KEY, this.counters);
  }

  /** Record user feedback (thumbs-up/down). */
  recordFeedback(featureId: string, rating: 'positive' | 'negative', comment?: string): void {
    const entry: FeedbackEntry = { featureId, rating, timestamp: Date.now() };
    if (comment) entry.comment = comment;

    const existing = readJson<FeedbackEntry[]>(FEEDBACK_KEY) ?? [];
    existing.push(entry);
    // Cap at 50 feedback entries
    writeJson(FEEDBACK_KEY, existing.slice(-50));

    // Also track as an analytics event
    this.track('user_feedback', rating === 'positive' ? 1 : 0, { featureId });
  }

  /** Increment a named counter without creating a full event. */
  increment(name: string, by = 1): void {
    this.counters[name] = (this.counters[name] || 0) + by;
    writeJson(STORAGE_KEY, this.counters);
  }

  /** Get the current counter value. */
  getCounter(name: string): number {
    return this.counters[name] || 0;
  }

  /** Return all counters (read-only copy). */
  getCounters(): Record<string, number> {
    return { ...this.counters };
  }

  /** Return stored feedback entries. */
  getFeedback(): FeedbackEntry[] {
    return readJson<FeedbackEntry[]>(FEEDBACK_KEY) ?? [];
  }

  /** Get a full snapshot for diagnostics or flush. */
  snapshot(): AnalyticsSnapshot {
    return {
      sessionId: this.sessionId,
      sessionStart: this.sessionStart,
      events: [...this.events],
      feedback: this.getFeedback(),
      counters: { ...this.counters },
    };
  }

  /** Flush to a server endpoint (fire-and-forget). */
  async flush(endpoint: string): Promise<boolean> {
    const g = globalThis as any;
    if (typeof g.fetch !== 'function') return false;
    try {
      const fetchFn = g.fetch as (input: string, init?: any) => Promise<{ ok: boolean }>;
      const res = await fetchFn(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.snapshot()),
      });
      if (res.ok) {
        this.events = [];
        return true;
      }
    } catch {
      // Flush is best-effort
    }
    return false;
  }

  /** Reset all data. */
  reset(): void {
    this.events = [];
    this.counters = {};
    removeKey(STORAGE_KEY);
    removeKey(FEEDBACK_KEY);
  }
}
