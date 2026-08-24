/**
 * Generic widget data-fetching helpers with stale/error state transitions.
 * All fetches are client-side, free APIs, no keys. Each widget stores
 * its last successful payload in localStorage for stale fallback.
 */

export type WidgetStatus = 'live' | 'stale' | 'error' | 'loading';

export interface WidgetFetchState<T> {
  data: T | null;
  status: WidgetStatus;
  error: string | null;
  updatedAt: number | null;
  fromCache: boolean;
}

/** Stale threshold per widget — after this, live becomes stale. */
export const DEFAULT_STALE_MS = 5 * 60 * 1000; // 5 min

export function isStale(updatedAt: number | null, maxAgeMs: number): boolean {
  if (updatedAt === null) return true;
  return Date.now() - updatedAt > maxAgeMs;
}

export function deriveStatus(args: {
  hasData: boolean;
  error: string | null;
  updatedAt: number | null;
  maxAgeMs: number;
  isLoading: boolean;
}): WidgetStatus {
  if (args.isLoading) return 'loading';
  if (args.error && !args.hasData) return 'error';
  if (args.error && args.hasData) return 'stale';
  if (!args.hasData) return 'error';
  if (args.updatedAt !== null && isStale(args.updatedAt, args.maxAgeMs)) return 'stale';
  return 'live';
}

/** Classic fetch with timeout + stale cache fallback.
 *  Tries live fetch; on failure, returns cached data as stale if available.
 */
export async function fetchWithStaleFallback<T>(opts: {
  cacheKey: string;
  fetcher: () => Promise<T>;
  staleMs: number;
  loadCache: () => { data: T; updatedAt: number } | null;
  saveCache: (data: T) => void;
}): Promise<WidgetFetchState<T>> {
  try {
    const data = await opts.fetcher();
    opts.saveCache(data);
    return {
      data,
      status: 'live',
      error: null,
      updatedAt: Date.now(),
      fromCache: false,
    };
  } catch (e) {
    const cached = opts.loadCache();
    const msg = e instanceof Error ? e.message : String(e);
    if (cached) {
      const stale = isStale(cached.updatedAt, opts.staleMs);
      return {
        data: cached.data,
        status: stale ? 'stale' : 'live',
        error: msg,
        updatedAt: cached.updatedAt,
        fromCache: true,
      };
    }
    return {
      data: null,
      status: 'error',
      error: msg,
      updatedAt: null,
      fromCache: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Specific helpers — pure + mockable
// ---------------------------------------------------------------------------

// --- Weather widget helpers (extends existing weather.ts but adds hourly 3h forecast) ---

export interface WidgetWeatherHour {
  time: string;
  temp: number;
  code: number;
}

export function buildWeatherWidgetUrl(
  lat: number,
  lon: number,
  base = 'https://api.open-meteo.com/v1/forecast',
): string {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
    hourly: 'temperature_2m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    forecast_days: '2',
    timezone: 'auto',
  });
  return `${base}?${params.toString()}`;
}

// --- Markets widget helpers (CoinGecko simple price) ---

export const MARKET_IDS = ['bitcoin', 'ethereum', 'tether', 'solana', 'dogecoin'] as const;

export function buildMarketsWidgetUrl(
  base = 'https://api.coingecko.com/api/v3/simple/price',
): string {
  const params = new URLSearchParams({
    ids: MARKET_IDS.join(','),
    vs_currencies: 'usd',
    include_24hr_change: 'true',
  });
  return `${base}?${params.toString()}`;
}

export interface SimplePriceEntry {
  usd: number;
  usd_24h_change?: number;
}

export type SimplePriceMap = Record<string, SimplePriceEntry>;

export function parseSimplePriceMap(data: unknown): SimplePriceMap | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const out: SimplePriceMap = {};
  for (const [id, entry] of Object.entries(data as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') return null;
    const e = entry as Record<string, unknown>;
    if (typeof e.usd !== 'number') return null;
    out[id] = { usd: e.usd, usd_24h_change: typeof e.usd_24h_change === 'number' ? e.usd_24h_change : undefined };
  }
  return out;
}

// --- News widget helpers (RSS-to-JSON) ---

export const DEFAULT_RSS_URL = 'https://feeds.bbci.co.uk/news/rss.xml';

export function buildNewsWidgetUrl(
  rssUrl = DEFAULT_RSS_URL,
  base = 'https://api.rss2json.com/v1/api.json',
): string {
  return `${base}?rss_url=${encodeURIComponent(rssUrl)}`;
}

export interface Rss2JsonItem {
  title?: string;
  link?: string;
  pubDate?: string;
  description?: string;
}

export interface Rss2JsonResponse {
  status?: string;
  items?: Rss2JsonItem[];
}

export function parseRss2JsonResponse(data: unknown): { title: string; url: string }[] | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Rss2JsonResponse;
  if (o.status !== 'ok' || !Array.isArray(o.items)) return null;
  const items = o.items.slice(0, 5).map((it, idx) => ({
    title: typeof it.title === 'string' && it.title.length > 0 ? it.title : `Headline ${idx + 1}`,
    url: typeof it.link === 'string' ? it.link : '',
  }));
  if (items.length === 0) return null;
  return items;
}

// --- Clock widget helpers ---

export interface CalendarDay {
  date: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  iso: string;
}

export function buildCalendarGrid(year: number, month: number, todayIso?: string): CalendarDay[][] {
  // month 0-indexed — use Date to compute iso correctly across year boundaries
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startDay = first.getDay(); // 0 Sun
  const daysInMonth = last.getDate();
  const prevLast = new Date(year, month, 0).getDate();

  const cells: CalendarDay[] = [];

  for (let i = startDay - 1; i >= 0; i -= 1) {
    const d = prevLast - i;
    const dt = new Date(year, month - 1, d);
    const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    cells.push({ date: d, isCurrentMonth: false, isToday: iso === todayIso, iso });
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ date: d, isCurrentMonth: true, isToday: iso === todayIso, iso });
  }
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d += 1) {
    const dt = new Date(year, month + 1, d);
    const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    cells.push({ date: d, isCurrentMonth: false, isToday: iso === todayIso, iso });
  }

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

export function formatTimeInZone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return date.toLocaleTimeString();
  }
}
