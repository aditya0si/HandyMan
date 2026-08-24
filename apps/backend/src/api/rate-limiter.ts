/**
 * M13 per-IP token-bucket rate limiter (brief D9/D10). In-memory — the
 * documented Redis scale-up path; NO auth beyond this (per the milestone
 * constraints). Capacity = N requests, refilled continuously at N/minute,
 * so a burst of N passes instantly and the budget recovers over the
 * minute. The IP is req.socket.remoteAddress — proxy headers are NOT
 * trusted (no auth milestone; the backend is direct-exposed on localhost).
 */
export const LLM_RATE_LIMIT_PER_MINUTE = 10;
export const SEARCH_RATE_LIMIT_PER_MINUTE = 30;

export interface RateLimiterOptions {
  limitPerMinute: number;
  /** Injectable clock (tests); default Date.now. */
  now?: () => number;
}

export interface RateCheck {
  allowed: boolean;
  /** Seconds until the next token (0 when allowed) — the Retry-After. */
  retryAfterSec: number;
}

interface Bucket {
  tokens: number;
  lastMs: number;
}

export function createRateLimiter({
  limitPerMinute,
  now = Date.now,
}: RateLimiterOptions): { check(ip: string): RateCheck } {
  const capacity = Math.max(1, Math.floor(limitPerMinute));
  const refillPerMs = limitPerMinute / 60_000;
  const buckets = new Map<string, Bucket>();

  const check = (ip: string): RateCheck => {
    const nowMs = now();
    const bucket = buckets.get(ip) ?? { tokens: capacity, lastMs: nowMs };
    const elapsed = Math.max(0, nowMs - bucket.lastMs);
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
    bucket.lastMs = nowMs;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      buckets.set(ip, bucket);
      return { allowed: true, retryAfterSec: 0 };
    }
    buckets.set(ip, bucket);
    const waitMs = (1 - bucket.tokens) / refillPerMs;
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(waitMs / 1000)) };
  };

  return { check };
}
