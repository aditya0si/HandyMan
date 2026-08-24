import { describe, expect, it, vi } from 'vitest';
import {
  DEMO_MARKETS,
  buildMarketsUrl,
  fetchMarkets,
  formatChange,
  formatPrice,
  sampleSparkline,
  sparklinePoints,
} from './markets';

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function coinPayload(): unknown {
  return [
    {
      id: 'bitcoin',
      symbol: 'btc',
      name: 'Bitcoin',
      current_price: 67000.5,
      price_change_percentage_24h: 2.5,
      sparkline_in_7d: { price: Array.from({ length: 40 }, (_, i) => 60000 + i * 250) },
    },
  ];
}

describe('markets', () => {
  it('buildMarketsUrl carries the CoinGecko query params', () => {
    const url = buildMarketsUrl('https://example.com/markets');
    expect(url.startsWith('https://example.com/markets?')).toBe(true);
    expect(url).toContain('vs_currency=usd');
    expect(url).toContain('per_page=5');
    expect(url).toContain('sparkline=true');
  });

  it('formatPrice adapts precision to magnitude', () => {
    expect(formatPrice(67412.5)).toBe('$67,412.50');
    expect(formatPrice(142.371)).toBe('$142.37');
    expect(formatPrice(0.13244)).toBe('$0.1324');
  });

  it('formatChange signs the percentage', () => {
    expect(formatChange(2.41)).toBe('+2.41%');
    expect(formatChange(-1.12)).toBe('-1.12%');
    expect(formatChange(0)).toBe('0.00%');
  });

  it('sampleSparkline samples evenly and guards degenerate input', () => {
    // 10 points -> 5: indices round(0, 2.25, 4.5, 6.75, 9) = 0, 2, 5, 7, 9.
    expect(sampleSparkline([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)).toEqual([1, 3, 6, 8, 10]);
    expect(sampleSparkline([], 5)).toEqual([]);
    expect(sampleSparkline([4, 7], 5)).toEqual([4, 7]);
  });

  it('sparklinePoints normalizes into the box and inverts y', () => {
    const points = sparklinePoints([0, 5, 10], 40, 20);
    expect(points).toBe('0.0,20.0 20.0,10.0 40.0,0.0');
    // Flat series centers instead of hugging an edge.
    expect(sparklinePoints([3, 3, 3], 10, 10)).toBe('0.0,5.0 5.0,5.0 10.0,5.0');
    expect(sparklinePoints([], 10, 10)).toBe('');
  });

  it('fetchMarkets maps a valid CoinGecko payload and samples the sparkline', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(coinPayload()));
    const result = await fetchMarkets(fetchImpl as unknown as typeof fetch, 'https://example.com');
    expect(result.isDemo).toBe(false);
    expect(result.coins[0].symbol).toBe('BTC');
    expect(result.coins[0].priceUsd).toBeCloseTo(67000.5, 5);
    expect(result.coins[0].sparkline.length).toBeLessThanOrEqual(12);
  });

  it('fetchMarkets falls back to demo data on network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('offline'));
    const result = await fetchMarkets(fetchImpl as unknown as typeof fetch, 'https://example.com');
    expect(result.isDemo).toBe(true);
    expect(result.coins).toHaveLength(DEMO_MARKETS.length);
    expect(result.coins[0].symbol).toBe('BTC');
  });

  it('fetchMarkets falls back to demo on malformed payloads', async () => {
    const missingPrice = vi.fn().mockResolvedValue(okResponse([{ id: 'x', symbol: 'x' }]));
    const notArray = vi.fn().mockResolvedValue(okResponse({ odd: true }));
    const empty = vi.fn().mockResolvedValue(okResponse([]));
    for (const impl of [missingPrice, notArray, empty]) {
      const result = await fetchMarkets(impl as unknown as typeof fetch, 'https://example.com');
      expect(result.isDemo).toBe(true);
    }
  });

  it('demo sparklines are hand-authored trend shapes (up/down/flat)', () => {
    expect(DEMO_MARKETS.length).toBe(5);
    for (const coin of DEMO_MARKETS) {
      expect(coin.sparkline.length).toBeGreaterThanOrEqual(10);
    }
  });
});
