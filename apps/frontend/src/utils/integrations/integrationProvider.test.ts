import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { RateLimitedCache } from './integrationProvider';

describe('RateLimitedCache', () => {
  let fetcher: any;

  beforeEach(() => {
    vi.useFakeTimers();
    fetcher = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches on first get()', async () => {
    fetcher.mockResolvedValue('data');
    const cache = new RateLimitedCache(fetcher, 1000);
    const res = await cache.get();
    expect(res).toBe('data');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns cached data if within minIntervalMs', async () => {
    fetcher.mockResolvedValue('data');
    const cache = new RateLimitedCache(fetcher, 1000);
    
    await cache.get();
    expect(fetcher).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500); // Wait 500ms (less than 1000ms)
    const res = await cache.get();
    expect(res).toBe('data');
    expect(fetcher).toHaveBeenCalledTimes(1); // Cached!
  });

  it('refetches if older than minIntervalMs', async () => {
    fetcher.mockResolvedValue('data');
    const cache = new RateLimitedCache(fetcher, 1000);
    
    await cache.get();
    expect(fetcher).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1100); // Wait 1100ms (more than 1000ms)
    await cache.get();
    expect(fetcher).toHaveBeenCalledTimes(2); // Refetched!
  });

  it('forces a refetch even if within minIntervalMs when force=true', async () => {
    fetcher.mockResolvedValue('data');
    const cache = new RateLimitedCache(fetcher, 1000);
    
    await cache.get();
    expect(fetcher).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(200); 
    await cache.get(true); // force
    expect(fetcher).toHaveBeenCalledTimes(2); 
  });

  it('deduplicates concurrent fetches', async () => {
    // A fetcher that takes some time
    fetcher.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve('delayed'), 500)));
    const cache = new RateLimitedCache(fetcher, 1000);
    
    const p1 = cache.get();
    const p2 = cache.get();
    
    vi.advanceTimersByTime(600); 
    const [r1, r2] = await Promise.all([p1, p2]);
    
    expect(r1).toBe('delayed');
    expect(r2).toBe('delayed');
    // Only one underlying fetch should happen
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves old cache on error', async () => {
    fetcher.mockResolvedValueOnce('data');
    fetcher.mockRejectedValueOnce(new Error('network error'));
    const cache = new RateLimitedCache(fetcher, 1000);
    
    await cache.get(); // success
    vi.advanceTimersByTime(1100);
    
    // The next fetch will fail, but the cache should return the old data
    const res = await cache.get();
    expect(res).toBe('data');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
