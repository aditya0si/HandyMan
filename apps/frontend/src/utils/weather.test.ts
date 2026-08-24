import { describe, expect, it, vi } from 'vitest';
import {
  WEATHER_CITIES,
  buildWeatherUrl,
  dayInitial,
  describeWeatherCode,
  fetchWeather,
  getDemoWeather,
  nextCityIndex,
} from './weather';
import type { WeatherCity } from './weather';

const LONDON: WeatherCity = WEATHER_CITIES[0];

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('weather', () => {
  it('has a non-empty fixed city table', () => {
    expect(WEATHER_CITIES.length).toBeGreaterThanOrEqual(3);
    for (const city of WEATHER_CITIES) {
      expect(city.name.length).toBeGreaterThan(0);
    }
  });

  it('buildWeatherUrl encodes coordinates and both query groups', () => {
    const url = buildWeatherUrl(LONDON, 'https://example.com/forecast');
    expect(url.startsWith('https://example.com/forecast?')).toBe(true);
    expect(url).toContain('latitude=51.5072');
    expect(url).toContain('longitude=-0.1276');
    expect(url).toContain('current=');
    expect(url).toContain('daily=');
  });

  it('describeWeatherCode maps the WMO groups', () => {
    expect(describeWeatherCode(0).label).toBe('Clear');
    expect(describeWeatherCode(2).label).toBe('Partly cloudy');
    expect(describeWeatherCode(3).label).toBe('Overcast');
    expect(describeWeatherCode(61).label).toBe('Rain');
    expect(describeWeatherCode(73).label).toBe('Snow');
    expect(describeWeatherCode(95).label).toBe('Thunderstorm');
    // 78 is outside every WMO group → the unknown fallback.
    expect(describeWeatherCode(78).label).toBe('—');
  });

  it('dayInitial returns a single letter for valid ISO dates', () => {
    // 2026-08-22 is a Saturday.
    expect(dayInitial('2026-08-22')).toBe('S');
    expect(dayInitial('not-a-date')).toBe('·');
  });

  it('demo weather is deterministic and flagged isDemo', () => {
    const first = getDemoWeather(LONDON);
    const second = getDemoWeather(LONDON);
    expect(first).toEqual(second);
    expect(first.isDemo).toBe(true);
    expect(first.city).toBe('London');
    expect(first.days).toHaveLength(5);
  });

  it('fetchWeather maps a valid Open-Meteo payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      okResponse({
        current: {
          temperature_2m: 21.4,
          relative_humidity_2m: 60,
          weather_code: 2,
          wind_speed_10m: 14.2,
        },
        daily: {
          time: ['2026-08-22', '2026-08-23'],
          weather_code: [2, 61],
          temperature_2m_max: [24, 20],
          temperature_2m_min: [13, 12],
        },
      }),
    );
    const result = await fetchWeather(LONDON, fetchImpl as unknown as typeof fetch);
    expect(result.isDemo).toBe(false);
    expect(result.temperature).toBeCloseTo(21.4, 5);
    expect(result.code).toBe(2);
    expect(result.days).toHaveLength(2);
    expect(result.days[1].tMax).toBe(20);
    expect(result.days[1].tMin).toBe(12);
  });

  it('fetchWeather falls back to demo on network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('offline'));
    const result = await fetchWeather(LONDON, fetchImpl as unknown as typeof fetch);
    expect(result.isDemo).toBe(true);
    expect(result.city).toBe('London');
  });

  it('fetchWeather falls back to demo on malformed payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ current: null }));
    const result = await fetchWeather(LONDON, fetchImpl as unknown as typeof fetch);
    expect(result.isDemo).toBe(true);
  });

  it('nextCityIndex wraps cyclically', () => {
    expect(nextCityIndex(0, 4)).toBe(1);
    expect(nextCityIndex(3, 4)).toBe(0);
    expect(nextCityIndex(0, 0)).toBe(0);
  });
});
