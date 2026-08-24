import { useCallback, useEffect, useState } from 'react';
import type { AppProps } from '../../utils/appRegistry';
import { WidgetCard } from './WidgetCard';
import { WEATHER_CITIES, describeWeatherCode, fetchWeather, dayInitial, nextCityIndex } from '../../utils/weather';
import type { WeatherNow, WeatherCity } from '../../utils/weather';
import type { WidgetStatus } from '../../utils/widgets/widgetData';
import { loadWidgetCache, saveWidgetCache } from '../../utils/widgets/widgetLayout';

const CACHE_KEY = 'weather-widget';

function getPreferredCity(): WeatherCity {
  try {
    const raw = localStorage.getItem('jarvis-briefing-prefs');
    if (raw) {
      const prefs = JSON.parse(raw) as { city?: string };
      if (prefs.city) {
        const match = WEATHER_CITIES.find((c) => c.name.toLowerCase() === prefs.city!.toLowerCase());
        if (match) return match;
      }
    }
    const legacy = localStorage.getItem('jarvis-weather-city');
    if (legacy) {
      const match = WEATHER_CITIES.find((c) => c.name.toLowerCase() === legacy.toLowerCase());
      if (match) return match;
    }
  } catch {
    // ignore
  }
  return WEATHER_CITIES[0];
}

export function WeatherWidget({ windowId }: AppProps) {
  const [cityIndex, setCityIndex] = useState(() => {
    const pref = getPreferredCity();
    const idx = WEATHER_CITIES.findIndex((c) => c.name === pref.name);
    return idx >= 0 ? idx : 0;
  });
  const [weather, setWeather] = useState<WeatherNow | null>(() => {
    const cached = loadWidgetCache<WeatherNow>(CACHE_KEY);
    return cached?.data ?? null;
  });
  const [status, setStatus] = useState<WidgetStatus>(() => (loadWidgetCache<WeatherNow>(CACHE_KEY) ? 'stale' : 'loading'));
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const city = WEATHER_CITIES[cityIndex] ?? WEATHER_CITIES[0];

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorMsg(null);
    try {
      const data = await fetchWeather(city);
      setWeather(data);
      saveWidgetCache(CACHE_KEY, data);
      setStatus(data.isDemo ? 'stale' : 'live');
    } catch (e) {
      const cached = loadWidgetCache<WeatherNow>(CACHE_KEY);
      if (cached?.data) {
        setWeather(cached.data);
        setStatus('stale');
        setErrorMsg(e instanceof Error ? e.message : String(e));
      } else {
        setStatus('error');
        setErrorMsg(e instanceof Error ? e.message : String(e));
      }
    }
  }, [city]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => void load(), 600_000);
    return () => window.clearInterval(id);
  }, [load]);

  const cycleCity = useCallback(() => {
    setCityIndex((c) => nextCityIndex(c, WEATHER_CITIES.length));
  }, []);

  useEffect(() => {
    const handler = (e: CustomEvent<{ windowId?: string; direction: 'left' | 'right' }>) => {
      if (e.detail?.windowId && e.detail.windowId !== windowId) return;
      if (e.detail?.direction === 'left' || e.detail?.direction === 'right') cycleCity();
    };
    window.addEventListener('jarvis-spatial-swipe' as never, handler as EventListener);
    return () => window.removeEventListener('jarvis-spatial-swipe' as never, handler as EventListener);
  }, [windowId, cycleCity]);

  const condition = describeWeatherCode(weather?.code ?? 0);

  return (
    <WidgetCard title="Weather" status={status} onRefresh={() => void load()} subtitle={city.name}>
      <div data-testid="weather-widget" style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* city dots — mouse fallback */}
        <div style={{ display: 'flex', gap: 4 }}>
          {WEATHER_CITIES.map((c, idx) => (
            <button
              key={c.name}
              aria-label={`Select ${c.name}`}
              data-testid={`weather-widget-dot-${idx}`}
              onClick={() => setCityIndex(idx)}
              style={{
                width: idx === cityIndex ? 14 : 5,
                height: 5,
                borderRadius: 3,
                border: 'none',
                background: idx === cityIndex ? '#00e5ff' : 'rgba(255,255,255,0.22)',
                cursor: 'pointer',
                padding: 0,
              }}
            />
          ))}
        </div>

        {status === 'error' && !weather ? (
          <div data-testid="weather-widget-error" style={{ color: '#f87171', fontSize: 11 }}>
            {errorMsg ?? 'Failed to load weather'}
          </div>
        ) : weather ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span aria-hidden="true" style={{ fontSize: 28 }}>{condition.icon}</span>
              <div>
                <div data-testid="weather-widget-temp" style={{ fontSize: 30, fontWeight: 300, lineHeight: 1 }}>
                  {Math.round(weather.temperature)}°
                </div>
                <div style={{ fontSize: 11, color: '#a9aeb8' }}>{condition.label}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 10, color: '#8b8f98' }}>
              <span>H <span style={{ color: '#e8eaed' }}>{Math.round(weather.days[0]?.tMax ?? 0)}°</span></span>
              <span>L <span style={{ color: '#e8eaed' }}>{Math.round(weather.days[0]?.tMin ?? 0)}°</span></span>
              <span>Wind <span style={{ color: '#e8eaed' }}>{Math.round(weather.windKph)} km/h</span></span>
              <span>Hum <span style={{ color: '#e8eaed' }}>{Math.round(weather.humidity)}%</span></span>
            </div>
            {/* 5-day strip reused; 3h forecast shown as next-hours caption when available */}
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              {weather.days.slice(0, 5).map((d, i) => {
                const c = describeWeatherCode(d.code);
                return (
                  <div key={d.date} data-testid={`weather-widget-day-${i}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, fontSize: 10, color: '#a9aeb8' }}>
                    <span style={{ fontSize: 9, color: '#8b8f98' }}>{dayInitial(d.date)}</span>
                    <span aria-hidden="true">{c.icon}</span>
                    <span style={{ color: '#e8eaed' }}>{Math.round(d.tMax)}°</span>
                  </div>
                );
              })}
            </div>
            {status === 'stale' && <div style={{ fontSize: 9, color: '#fbbf24' }}>cached — {errorMsg ?? 'offline demo'}</div>}
          </>
        ) : (
          <div style={{ color: '#8b8f98', fontSize: 11 }}>Loading…</div>
        )}
      </div>
    </WidgetCard>
  );
}
