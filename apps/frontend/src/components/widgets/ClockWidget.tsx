import { useEffect, useState } from 'react';
import { WidgetCard } from './WidgetCard';
import { buildCalendarGrid, formatTimeInZone } from '../../utils/widgets/widgetData';

function getHomeTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  } catch {
    return 'UTC';
  }
}

function getExtraTimeZone(home: string): string {
  // Pick a distinct zone
  if (home === 'America/New_York') return 'Europe/London';
  if (home.startsWith('Europe/')) return 'America/New_York';
  if (home.startsWith('America/')) return 'Europe/London';
  return 'America/New_York';
}

export function ClockWidget() {
  const [now, setNow] = useState(() => new Date());
  const homeTz = getHomeTimeZone();
  const extraTz = getExtraTimeZone(homeTz);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const year = now.getFullYear();
  const month = now.getMonth();
  const todayIso = `${year}-${String(month + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const weeks = buildCalendarGrid(year, month, todayIso);
  const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const homeTime = formatTimeInZone(now, homeTz);
  const extraTime = formatTimeInZone(now, extraTz);
  const homeDate = now.toLocaleDateString('en-GB', { timeZone: homeTz, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <WidgetCard title="Clock" status="live" subtitle={homeTz}>
      <div data-testid="clock-widget" style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 9, color: '#8b8f98', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{homeTz}</div>
            <div data-testid="clock-home-time" style={{ fontSize: 20, fontWeight: 300, fontVariantNumeric: 'tabular-nums', color: '#e8eaed' }}>{homeTime}</div>
            <div style={{ fontSize: 10, color: '#a9aeb8' }}>{homeDate}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: '#8b8f98', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{extraTz}</div>
            <div data-testid="clock-extra-time" style={{ fontSize: 14, fontVariantNumeric: 'tabular-nums', color: '#b7bcc4' }}>{extraTime}</div>
          </div>
        </div>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#e8eaed', marginBottom: 6, textAlign: 'center' }}>{monthLabel}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, fontSize: 9, color: '#8b8f98', textAlign: 'center', marginBottom: 4 }}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => (
              <div key={d + Math.random()}>{d}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {weeks.flat().map((day) => (
              <div
                key={day.iso}
                data-testid={day.isToday ? 'clock-today' : `clock-day-${day.iso}`}
                style={{
                  fontSize: 10,
                  textAlign: 'center',
                  padding: '4px 0',
                  borderRadius: 6,
                  background: day.isToday ? 'rgba(0,229,255,0.15)' : 'transparent',
                  border: day.isToday ? '1px solid rgba(0,229,255,0.35)' : '1px solid transparent',
                  color: day.isToday ? '#00e5ff' : day.isCurrentMonth ? '#e8eaed' : '#5d616b',
                  fontWeight: day.isToday ? 700 : 400,
                }}
              >
                {day.date}
              </div>
            ))}
          </div>
        </div>
      </div>
    </WidgetCard>
  );
}
