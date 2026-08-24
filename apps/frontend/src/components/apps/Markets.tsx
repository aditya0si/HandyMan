import { useEffect, useState } from 'react';
import { fetchMarkets, formatChange, formatPrice, sparklinePoints } from '../../utils/markets';
import type { MarketsData } from '../../utils/markets';

/** Markets card: top-5 crypto with 24 h change + trend sparklines.
 *  Green/red is semantic (up/down) — the one non-accent color rule.
 *  Auto-refreshes every 60 s; offline falls back to demo data. */
export function Markets() {
  const [data, setData] = useState<MarketsData | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      fetchMarkets().then((result) => {
        if (!cancelled) setData(result);
      });
    };
    load();
    const refreshId = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(refreshId);
    };
  }, []);

  const coins = data?.coins ?? [];

  return (
    <div
      data-testid="markets-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '10px 14px',
        color: '#f4f5f7',
        fontFamily:
          'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      {coins.length === 0 ? (
        <div style={{ margin: 'auto', color: '#8b8f98', fontSize: 11 }}>Loading…</div>
      ) : (
        coins.map((coin, i) => {
          const up = coin.change24hPct >= 0;
          const trendColor = up ? '#34d399' : '#f87171';
          return (
            <div
              key={coin.id}
              data-testid={`markets-row-${i}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 0',
                borderTop: i === 0 ? 'none' : '1px solid rgba(255, 255, 255, 0.06)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}>
                  {coin.symbol}
                </div>
                <div style={{ fontSize: 9, color: '#8b8f98', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {coin.name}
                </div>
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
                <div
                  data-testid={`markets-price-${i}`}
                  style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatPrice(coin.priceUsd)}
                </div>
                <div
                  data-testid={`markets-change-${i}`}
                  style={{ fontSize: 9.5, color: trendColor, fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatChange(coin.change24hPct)}
                </div>
              </div>
            </div>
          );
        })
      )}
      <div style={{ marginTop: 'auto', fontSize: 8.5, color: '#5d616b', letterSpacing: '0.06em' }}>
        {data?.isDemo ? 'DEMO DATA' : 'LIVE · COINGECKO'} · TOP 5 BY MARKET CAP
      </div>
    </div>
  );
}
