import { useCallback, useEffect, useState } from 'react';
import { WidgetCard } from './WidgetCard';
import { fetchMarkets, formatChange, formatPrice, sparklinePoints } from '../../utils/markets';
import type { MarketsData } from '../../utils/markets';
import type { WidgetStatus } from '../../utils/widgets/widgetData';
import { loadWidgetCache, saveWidgetCache } from '../../utils/widgets/widgetLayout';

const CACHE_KEY = 'markets-widget';

export function MarketsWidget() {
  const [data, setData] = useState<MarketsData | null>(() => {
    const cached = loadWidgetCache<MarketsData>(CACHE_KEY);
    return cached?.data ?? null;
  });
  const [status, setStatus] = useState<WidgetStatus>(() => (loadWidgetCache<MarketsData>(CACHE_KEY) ? 'stale' : 'loading'));
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorMsg(null);
    try {
      const result = await fetchMarkets();
      setData(result);
      saveWidgetCache(CACHE_KEY, result);
      setStatus(result.isDemo ? 'stale' : 'live');
    } catch (e) {
      const cached = loadWidgetCache<MarketsData>(CACHE_KEY);
      if (cached?.data) {
        setData(cached.data);
        setStatus('stale');
        setErrorMsg(e instanceof Error ? e.message : String(e));
      } else {
        setStatus('error');
        setErrorMsg(e instanceof Error ? e.message : String(e));
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const coins = data?.coins ?? [];

  return (
    <WidgetCard title="Markets" status={status} onRefresh={() => void load()}>
      <div data-testid="markets-widget" style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {status === 'error' && coins.length === 0 ? (
          <div data-testid="markets-widget-error" style={{ color: '#f87171', fontSize: 11 }}>{errorMsg ?? 'Failed to load markets'}</div>
        ) : coins.length === 0 ? (
          <div style={{ color: '#8b8f98', fontSize: 11, margin: 'auto' }}>Loading…</div>
        ) : (
          coins.map((coin, i) => {
            const up = coin.change24hPct >= 0;
            const trendColor = up ? '#34d399' : '#f87171';
            return (
              <div
                key={coin.id}
                data-testid={`markets-widget-row-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 0',
                  borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}>{coin.symbol}</div>
                  <div style={{ fontSize: 9, color: '#8b8f98' }}>{coin.name}</div>
                </div>
                <svg width={44} height={18} aria-hidden="true" style={{ flexShrink: 0 }}>
                  <polyline
                    points={sparklinePoints(coin.sparkline, 44, 18)}
                    fill="none"
                    stroke={trendColor}
                    strokeWidth={1.25}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    opacity={0.9}
                  />
                </svg>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div data-testid={`markets-widget-price-${i}`} style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                    {formatPrice(coin.priceUsd)}
                  </div>
                  <div style={{ fontSize: 9.5, color: trendColor, fontVariantNumeric: 'tabular-nums' }}>
                    {formatChange(coin.change24hPct)}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div style={{ marginTop: 'auto', paddingTop: 6, fontSize: 8.5, color: '#5d616b', letterSpacing: '0.06em' }}>
          {status === 'live' ? 'LIVE · COINGECKO' : status === 'stale' ? 'CACHED · DEMO' : status === 'error' ? 'ERROR' : 'LOADING'} · TOP 5
        </div>
      </div>
    </WidgetCard>
  );
}
