/** City selector entry — fixed table (no geolocation prompt at boot). */
export interface WeatherCity {
  name: string;
  latitude: number;
  longitude: number;
}

/** Cities the weather card cycles through (spatial swipe / dots). */
export const WEATHER_CITIES: readonly WeatherCity[] = [
  { name: 'London', latitude: 51.5072, longitude: -0.1276 },
  { name: 'New York', latitude: 40.7128, longitude: -74.006 },
  { name: 'Tokyo', latitude: 35.6762, longitude: 139.6503 },
  { name: 'Lagos', latitude: 6.5244, longitude: 3.3792 },
];

/** One forecast day (ISO date + WMO code + min/max °C). */
export interface WeatherDay {
  date: string;
  code: number;
  tMax: number;
  tMin: number;
}

/** The card's full view model. `isDemo` is true on the offline fallback. */
export interface WeatherNow {
  city: string;
  temperature: number;
  code: number;
  windKph: number;
  humidity: number;
  days: WeatherDay[];
  isDemo: boolean;
}

/** WMO weather-code → { label, icon } (monochrome-friendly glyphs). */
export function describeWeatherCode(code: number): { label: string; icon: string } {
  if (code === 0) return { label: 'Clear', icon: '☀' };
  if (code === 1 || code === 2) return { label: 'Partly cloudy', icon: '≘' };
  if (code === 3) return { label: 'Overcast', icon: '☁' };
  if (code === 45 || code === 48) return { label: 'Fog', icon: '≈' };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', icon: '◌' };
  if (code >= 61 && code <= 67) return { label: 'Rain', icon: '☂' };
  if (code >= 71 && code <= 77) return { label: 'Snow', icon: '❄' };
  if (code >= 80 && code <= 82) return { label: 'Showers', icon: '☔' };
  if (code >= 95) return { label: 'Thunderstorm', icon: '⛈' };
  return { label: '—', icon: '·' };
}

/** Day-of-week initial ('M', 'T', 'W'…) from an ISO date string. */
export function dayInitial(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return '·';
  return ['S', 'M', 'T', 'W', 'T', 'F', 'S'][date.getUTCDay()] ?? '·';
}

/** Open-Meteo query for one city (current + 5-day daily, metric). */
export function buildWeatherUrl(
  city: WeatherCity,
  base = 'https://api.open-meteo.com/v1/forecast',
): string {
  const params = new URLSearchParams({
    latitude: String(city.latitude),
    longitude: String(city.longitude),
    current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    forecast_days: '5',
    timezone: 'auto',
  });
  return `${base}?${params.toString()}`;
}

interface OpenMeteoResponse {
  current?: {
    temperature_2m?: number;
    relative_humidity_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
  };
}

/** Deterministic per-city demo weather (offline fallback — no Math.random,
 *  so tests and repeated renders are stable). */
export function getDemoWeather(city: WeatherCity): WeatherNow {
  const seed = city.name.length;
  const demoCodes = [0, 2, 61, 3, 80];
  const days: WeatherDay[] = demoCodes.map((code, i) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + i);
    return {
      date: date.toISOString().slice(0, 10),
      code,
      tMax: 16 + ((seed + i * 3) % 9),
      tMin: 8 + ((seed + i * 2) % 5),
    };
  });
  return {
    city: city.name,
    temperature: days[0].tMax - 2,
    code: days[0].code,
    windKph: 9 + (seed % 7),
    humidity: 55 + (seed % 20),
    days,
    isDemo: true,
  };
}

function mapResponse(city: WeatherCity, data: OpenMeteoResponse): WeatherNow | null {
  const current = data.current;
  const daily = data.daily;
  if (
    !current ||
    typeof current.temperature_2m !== 'number' ||
    !Array.isArray(daily?.time) ||
    !Array.isArray(daily?.weather_code)
  ) {
    return null;
  }
  const days: WeatherDay[] = daily.time.slice(0, 5).map((date, i) => ({
    date,
    code: daily.weather_code?.[i] ?? 0,
    tMax: daily.temperature_2m_max?.[i] ?? 0,
    tMin: daily.temperature_2m_min?.[i] ?? 0,
  }));
  return {
    city: city.name,
    temperature: current.temperature_2m,
    code: current.weather_code ?? 0,
    windKph: current.wind_speed_10m ?? 0,
    humidity: current.relative_humidity_2m ?? 0,
    days,
    isDemo: false,
  };
}

/**
 * Fetches live weather from Open-Meteo (keyless, CORS-open). Any failure —
 * offline, timeout (4 s), malformed body — falls back to the deterministic
 * demo payload for the city. Injectable fetch keeps it node-testable.
 */
export async function fetchWeather(
  city: WeatherCity,
  fetchImpl: typeof fetch = fetch,
  urlBuilder: (c: WeatherCity) => string = buildWeatherUrl,
): Promise<WeatherNow> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const res = await fetchImpl(urlBuilder(city), { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = (await res.json()) as OpenMeteoResponse;
    return mapResponse(city, data) ?? getDemoWeather(city);
  } catch {
    return getDemoWeather(city);
  }
}

/** Next city index with cyclic wrapping (mirrors the news slide helpers). */
export function nextCityIndex(current: number, total: number): number {
  if (total <= 0) return 0;
  return (current + 1) % total;
}
