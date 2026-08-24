import { useEffect, useState } from 'react';
import { WidgetCard } from './WidgetCard';

interface BatteryInfo {
  level: number | null;
  charging: boolean | null;
}

function useBattery(): BatteryInfo {
  const [info, setInfo] = useState<BatteryInfo>({ level: null, charging: null });
  useEffect(() => {
    let cancelled = false;
    const nav = navigator as unknown as { getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener: (e: string, cb: () => void) => void }> };
    if (!nav.getBattery) return;
    nav.getBattery()
      .then((b) => {
        if (cancelled) return;
        const update = () => setInfo({ level: b.level, charging: b.charging });
        update();
        b.addEventListener('levelchange', update);
        b.addEventListener('chargingchange', update);
      })
      .catch(() => {
        // ignore
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return info;
}

export function SystemWidget() {
  const battery = useBattery();
  const [viewport, setViewport] = useState(() => ({ w: typeof window !== 'undefined' ? window.innerWidth : 0, h: typeof window !== 'undefined' ? window.innerHeight : 0 }));
  const [online, setOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [uptimeSec, setUptimeSec] = useState(0);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('resize', onResize);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => {
      setUptimeSec(Math.floor((Date.now() - start) / 1000));
      setNow(new Date());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const formatUptime = (sec: number): string => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  return (
    <WidgetCard title="System" status="live">
      <div data-testid="system-widget" style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#8b8f98' }}>Battery</span>
          <span data-testid="system-battery" style={{ color: '#e8eaed', fontVariantNumeric: 'tabular-nums' }}>
            {battery.level === null ? '—' : `${Math.round(battery.level * 100)}%${battery.charging ? ' ⚡' : ''}`}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#8b8f98' }}>Network</span>
          <span data-testid="system-network" style={{ color: online ? '#34d399' : '#f87171' }}>{online ? 'online' : 'offline'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#8b8f98' }}>Viewport</span>
          <span data-testid="system-viewport" style={{ color: '#e8eaed', fontVariantNumeric: 'tabular-nums' }}>{viewport.w} × {viewport.h}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#8b8f98' }}>Local time</span>
          <span data-testid="system-time" style={{ color: '#e8eaed', fontVariantNumeric: 'tabular-nums' }}>{now.toLocaleTimeString()}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#8b8f98' }}>Session uptime</span>
          <span data-testid="system-uptime" style={{ color: '#e8eaed', fontVariantNumeric: 'tabular-nums' }}>{formatUptime(uptimeSec)}</span>
        </div>
        <div style={{ marginTop: 4, fontSize: 9, color: '#5d616b' }}>
          {navigator.userAgent.slice(0, 80)}
        </div>
      </div>
    </WidgetCard>
  );
}
