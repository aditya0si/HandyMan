/** One market row: coin identity + live price + 24 h change + sparkline. */
export interface MarketCoin {
  id: string;
  symbol: string;
  name: string;
  priceUsd: number;
  change24hPct: number;
  sparkline: number[];
}

export interface MarketsData {
  coins: MarketCoin[];
  isDemo: boolean;
}

/** CoinGecko markets query (keyless, CORS-open, top 5 by market cap). */
export function buildMarketsUrl(
  base = 'https://api.coingecko.com/api/v3/coins/markets',
): string {
  const params = new URLSearchParams({
    vs_currency: 'usd',
    order: 'market_cap_desc',
    per_page: '5',
    page: '1',
    sparkline: 'true',
    price_change_percentage: '24h',
  });
  return `${base}?${params.toString()}`;
}

/** Deterministic offline fallback (hand-written 12-point trends). */
export const DEMO_MARKETS: readonly MarketCoin[] = [
  {
    id: 'bitcoin',
    symbol: 'BTC',
    name: 'Bitcoin',
    priceUsd: 67412.5,
    change24hPct: 2.41,
    sparkline: [62, 63, 62.5, 64, 65, 64.5, 65.8, 66.4, 66, 67, 67.2, 67.4],
  },
  {
    id: 'ethereum',
    symbol: 'ETH',
    name: 'Ethereum',
    priceUsd: 3128.44,
    change24hPct: -1.12,
    sparkline: [33, 32.6, 32.9, 32.4, 32.1, 32.3, 31.9, 31.6, 31.8, 31.4, 31.3, 31.2],
  },
  {
    id: 'tether',
    symbol: 'USDT',
    name: 'Tether',
    priceUsd: 1.0,
    change24hPct: 0.01,
    sparkline: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  },
  {
    id: 'solana',
    symbol: 'SOL',
    name: 'Solana',
    priceUsd: 142.37,
    change24hPct: 5.83,
    sparkline: [120, 124, 123, 127, 130, 129, 133, 136, 135, 139, 141, 142],
  },
  {
    id: 'dogecoin',
    symbol: 'DOGE',
    name: 'Dogecoin',
    priceUsd: 0.1324,
    change24hPct: -3.27,
    sparkline: [15, 14.7, 14.8, 14.4, 14.5, 14.2, 14.0, 13.9, 13.7, 13.6, 13.4, 13.2],
  },
];

interface CoinGeckoCoin {
  id?: string;
  symbol?: string;
  name?: string;
  current_price?: number;
  price_change_percentage_24h?: number;
  sparkline_in_7d?: { price?: number[] };
}

/** $67,412.50 above $1; $0.1324 below (adaptive precision). */
export function formatPrice(price: number): string {
  if (price >= 1000) return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(4)}`;
}

/** +2.41% / -1.12% (signed, 2 decimals). */
export function formatChange(pct: number): string {
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

/** Evenly samples `count` points from a series (guards short/empty input). */
export function sampleSparkline(series: number[], count = 12): number[] {
  if (series.length === 0) return [];
  if (series.length <= count) return [...series];
  const step = (series.length - 1) / (count - 1);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(series[Math.round(i * step)]);
  }
  return out;
}

/** SVG polyline `points` string: values normalized into width×height,
 *  min at the bottom, max at the top; a flat series centers vertically. */
export function sparklinePoints(values: number[], width: number, height: number): string {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  return values
    .map((value, i) => {
      const x = values.length === 1 ? 0 : (i / (values.length - 1)) * width;
      const normalized = span === 0 ? 0.5 : (value - min) / span;
      const y = height - normalized * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function mapCoins(items: CoinGeckoCoin[]): MarketCoin[] | null {
  const coins: MarketCoin[] = [];
  for (const item of items) {
    if (
      typeof item.current_price !== 'number' ||
      typeof item.price_change_percentage_24h !== 'number'
    ) {
      return null;
    }
    coins.push({
      id: item.id ?? '',
      symbol: (item.symbol ?? '').toUpperCase(),
      name: item.name ?? '',
      priceUsd: item.current_price,
      change24hPct: item.price_change_percentage_24h,
      sparkline: sampleSparkline(item.sparkline_in_7d?.price ?? []),
    });
  }
  return coins.length > 0 ? coins : null;
}

/**
 * Fetches top coins from CoinGecko (keyless). Any failure — offline,
 * timeout (4 s), rate limit, malformed body — falls back to DEMO_MARKETS.
 * Injectable fetch keeps it node-testable.
 */
export async function fetchMarkets(
  fetchImpl: typeof fetch = fetch,
  url = buildMarketsUrl(),
): Promise<MarketsData> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const res = await fetchImpl(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = (await res.json()) as CoinGeckoCoin[];
    if (!Array.isArray(data)) throw new Error('malformed payload');
    const coins = mapCoins(data);
    if (!coins) throw new Error('malformed payload');
    return { coins, isDemo: false };
  } catch {
    return { coins: DEMO_MARKETS.map((coin) => ({ ...coin, sparkline: [...coin.sparkline] })), isDemo: true };
  }
}
