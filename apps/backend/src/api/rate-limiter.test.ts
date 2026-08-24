import { describe, expect, it } from 'vitest';
import { LLM_RATE_LIMIT_PER_MINUTE, SEARCH_RATE_LIMIT_PER_MINUTE, createRateLimiter } from './rate-limiter';

describe('per-IP token bucket (M13 D9)', () => {
  it('exports the milestone limits: LLM 10/min, SEARCH 30/min', () => {
    expect(LLM_RATE_LIMIT_PER_MINUTE).toBe(10);
    expect(SEARCH_RATE_LIMIT_PER_MINUTE).toBe(30);
  });

  it('a burst of N passes; the (N+1)th is denied with a Retry-After', () => {
    let clock = 0;
    const limiter = createRateLimiter({ limitPerMinute: 3, now: () => clock });
    for (let i = 0; i < 3; i += 1) {
      expect(limiter.check('1.2.3.4').allowed).toBe(true);
    }
    const denied = limiter.check('1.2.3.4');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it('refills over time: after the window the budget recovers', () => {
    let clock = 0;
    const limiter = createRateLimiter({ limitPerMinute: 2, now: () => clock });
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
    clock = 61_000; // a full minute passes
    expect(limiter.check('a').allowed).toBe(true);
  });

  it('per-IP isolation: one IP exhausting does not touch another', () => {
    const limiter = createRateLimiter({ limitPerMinute: 1, now: () => 0 });
    expect(limiter.check('10.0.0.1').allowed).toBe(true);
    expect(limiter.check('10.0.0.1').allowed).toBe(false);
    expect(limiter.check('10.0.0.2').allowed).toBe(true);
  });
});
