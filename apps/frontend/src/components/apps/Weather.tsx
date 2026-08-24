import { useCallback, useEffect, useState } from 'react';
import type { AppProps } from '../../utils/appRegistry';
import {
  WEATHER_CITIES,
  dayInitial,
  describeWeatherCode,
  fetchWeather,
  nextCityIndex,
} from '../../utils/weather';
import type { WeatherNow } from '../../utils/weather';

const labelStyle = { color: '#8b8f98' } as const;

/** Weather card: big current conditions + 5-day strip. Spatial swipe
 *  (or the city dots) cycles the city; data auto-refreshes every 10 min. */
export function Weather({ windowId }: AppProps) {
  const [cityIndex, setCityIndex] = useState(0);
  const [weather, setWeather] = useState<WeatherNow | null>(null);

  const city = WEATHER_CITIES[cityIndex] ?? WEATHER_CITIES[0];

  useEffect(() => {
    let cancelled = false;
    setWeather(null); // city switch: blank slate until data arrives
    fetchWeather(city).then((data) => {
      if (!cancelled) setWeather(data);
    });
    const refreshId = window.setInterval(() => {
      fetchWeather(city).then((data) => {
        if (!cancelled) setWeather(data);
      });
    }, 600_000);
    return () => {
      cancelled = true;
      window.clearInterval(refreshId);
    };
  }, [city]);

  const cycleCity = useCallback(() => {
    setCityIndex((curr) => nextCityIndex(curr, WEATHER_CITIES.length));
  }, []);

  // Spatial swipe on this card cycles the city (News carousel pattern).
  useEffect(() => {
    const handleSpatialSwipe = (e: CustomEvent<{ windowId?: string; direction: 'left' | 'right' }>) => {
      if (!e.detail) return;
      if (e.detail.windowId && e.detail.windowId !== windowId) return;
      if (e.detail.direction === 'left' || e.detail.direction === 'right') cycleCity();
    };
    window.addEventListener('jarvis-spatial-swipe' as never, handleSpatialSwipe as EventListener);
    return () => {
      window.removeEventListener('jarvis-spatial-swipe' as never, handleSpatialSwipe as EventListener);
    };
  }, [windowId, cycleCity]);

  const current = weather?.code ?? 0;
  const condition = describeWeatherCode(current);

  return (
    <div
      data-testid="weather-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '12px 14px 10px 14px',
        color: '#f4f5f7',
        fontFamily:
          'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      {/* City selector dots */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {WEATHER_CITIES.map((entry, idx) => (
          <div
            key={entry.name}
            data-testid={`weather-dot-${idx}`}
            onClick={() => setCityIndex(idx)}
            style={{
              width: idx === cityIndex ? 14 : 5,
              height: 5,
              borderRadius: 3,
              background: idx === cityIndex ? '#00e5ff' : 'rgba(255, 255, 255, 0.22)',
              cursor: 'pointer',
              transition: 'all 0.25s ease',
            }}
          />
        ))}
      </div>

      {weather ? (
        <>
          {/* Current conditions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span aria-hidden="true" style={{ fontSize: 30, color: '#e8eaed' }}>
              {condition.icon}
            </span>
            <div>
              <div
                data-testid="weather-temp"
                style={{
                  fontSize: 34,
                  fontWeight: 250,
                  lineHeight: 1.05,
                  letterSpacing: '-0.02em',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {Math.round(weather.temperature)}°
              </div>
              <div style={{ fontSize: 10.5, color: '#a9aeb8' }}>{condition.label}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 10 }}>
            <span style={labelStyle}>
              H <span style={{ color: '#e8eaed', fontVariantNumeric: 'tabular-nums' }}>{Math.round(weather.days[0]?.tMax ?? 0)}°</span>
            </span>
            <span style={labelStyle}>
              L <span style={{ color: '#e8eaed', fontVariantNumeric: 'tabular-nums' }}>{Math.round(weather.days[0]?.tMin ?? 0)}°</span>
            </span>
            <span style={labelStyle}>
              Wind <span style={{ color: '#e8eaed', fontVariantNumeric: 'tabular-nums' }}>{Math.round(weather.windKph)} km/h</span>
            </span>
            <span style={labelStyle}>
              Hum <span style={{ color: '#e8eaed', fontVariantNumeric: 'tabular-nums' }}>{Math.round(weather.humidity)}%</span>
            </span>
          </div>

          {/* 5-day strip */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 'auto',
              paddingTop: 9,
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            {weather.days.map((day, i) => {
              const dayCondition = describeWeatherCode(day.code);
              return (
                <div
                  key={day.date}
                  data-testid={`weather-day-${i}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 3,
                    fontSize: 10,
                    color: '#a9aeb8',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  <span style={{ color: '#8b8f98', fontSize: 9 }}>{dayInitial(day.date)}</span>
                  <span aria-hidden="true">{dayCondition.icon}</span>
                  <span style={{ color: '#e8eaed' }}>{Math.round(day.tMax)}°</span>
                  <span style={{ fontSize: 9 }}>{Math.round(day.tMin)}°</span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{ margin: 'auto', color: '#8b8f98', fontSize: 11 }}>Loading…</div>
      )}
    </div>
  );
}
