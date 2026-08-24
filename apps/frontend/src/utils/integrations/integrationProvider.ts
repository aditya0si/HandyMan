export type ConnectionState = 'connected' | 'disconnected' | 'error' | 'loading';

/**
 * The standard capability envelope for any integration provider.
 */
export interface IntegrationProvider<T> {
  id: string;
  name: string;
  state: ConnectionState;
  
  /** Connects to the provider (e.g. OAuth flow initiation or mock setup). */
  connect(): Promise<void>;
  
  /** Disconnects and clears local cached credentials/data. */
  disconnect(): Promise<void>;
  
  /** Refreshes data. If force is true, bypasses read-cache. */
  refresh(force?: boolean): Promise<T>;
  
  /** The most recently fetched data, or null if none. */
  getData(): T | null;
  
  /** 
   * Last error encountered, or null.
   * Actionable strings like "reconnect_required", "rate_limited", or "network_error".
   */
  getLastError(): string | null;
}

/**
 * A safe read cache wrapper to respect rate limits.
 * Guarantees calls to the underlying fetcher are throttled to minIntervalMs.
 */
export class RateLimitedCache<T> {
  private cache: T | null = null;
  private lastFetchTime = 0;
  private readonly fetcher: () => Promise<T>;
  private readonly minIntervalMs: number;
  private fetchPromise: Promise<T> | null = null;

  constructor(
    fetcher: () => Promise<T>,
    minIntervalMs: number = 30000,
  ) {
    this.fetcher = fetcher;
    this.minIntervalMs = minIntervalMs;
  }

  async get(force = false): Promise<T> {
    const now = performance.now();
    
    // If a fetch is already in flight, wait for it instead of spawning a new one.
    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    if (!force && this.cache && now - this.lastFetchTime < this.minIntervalMs) {
      return this.cache;
    }

    this.fetchPromise = this.fetcher().finally(() => {
      this.fetchPromise = null;
    });

    try {
      this.cache = await this.fetchPromise;
      this.lastFetchTime = performance.now();
      return this.cache;
    } catch (e) {
      // Keep old cache on error if we have one
      if (this.cache) return this.cache;
      throw e;
    }
  }

  getSync(): T | null {
    return this.cache;
  }
  
  clear(): void {
    this.cache = null;
    this.lastFetchTime = 0;
  }
}
