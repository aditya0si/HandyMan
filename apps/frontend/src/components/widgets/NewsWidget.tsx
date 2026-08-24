import { useCallback, useEffect, useState } from 'react';
import { WidgetCard } from './WidgetCard';
import type { WidgetStatus } from '../../utils/widgets/widgetData';
import { buildNewsWidgetUrl, parseRss2JsonResponse } from '../../utils/widgets/widgetData';
import { loadWidgetCache, saveWidgetCache } from '../../utils/widgets/widgetLayout';

interface NewsHeadline {
  title: string;
  url: string;
}

const CACHE_KEY = 'news-widget';
const RSS_URL = 'https://feeds.bbci.co.uk/news/rss.xml';

async function fetchNewsHeadlines(fetchImpl: typeof fetch = fetch, rssUrl = RSS_URL): Promise<NewsHeadline[]> {
  const url = buildNewsWidgetUrl(rssUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  const res = await fetchImpl(url, { signal: controller.signal });
  clearTimeout(timeout);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as unknown;
  const parsed = parseRss2JsonResponse(json);
  if (!parsed) throw new Error('malformed rss2json payload');
  return parsed;
}

export function NewsWidget() {
  const [headlines, setHeadlines] = useState<NewsHeadline[] | null>(() => {
    const cached = loadWidgetCache<NewsHeadline[]>(CACHE_KEY);
    return cached?.data ?? null;
  });
  const [status, setStatus] = useState<WidgetStatus>(() => (loadWidgetCache<NewsHeadline[]>(CACHE_KEY) ? 'stale' : 'loading'));
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorMsg(null);
    try {
      const items = await fetchNewsHeadlines();
      setHeadlines(items);
      saveWidgetCache(CACHE_KEY, items);
      setStatus('live');
    } catch (e) {
      const cached = loadWidgetCache<NewsHeadline[]>(CACHE_KEY);
      if (cached?.data) {
        setHeadlines(cached.data);
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
    const id = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [load]);

  return (
    <WidgetCard title="News" status={status} onRefresh={() => void load()} subtitle="BBC">
      <div data-testid="news-widget" style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {status === 'error' && !headlines ? (
          <div data-testid="news-widget-error" style={{ color: '#f87171', fontSize: 11 }}>{errorMsg ?? 'Failed to load headlines'}</div>
        ) : headlines ? (
          <>
            {headlines.slice(0, 5).map((h, i) => (
              <a
                key={`${h.url}-${i}`}
                href={h.url || '#'}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`news-widget-item-${i}`}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'flex-start',
                  padding: '6px 8px',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  color: '#e8eaed',
                  textDecoration: 'none',
                  fontSize: 11,
                  lineHeight: 1.4,
                  cursor: 'pointer',
                }}
              >
                <span style={{ color: '#00e5ff', fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                <span style={{ flex: 1 }}>{h.title}</span>
              </a>
            ))}
            {status === 'stale' && <div style={{ fontSize: 9, color: '#fbbf24' }}>cached — {errorMsg ?? 'offline'}</div>}
          </>
        ) : (
          <div style={{ color: '#8b8f98', fontSize: 11 }}>Loading…</div>
        )}
      </div>
    </WidgetCard>
  );
}

// Export for tests
export { fetchNewsHeadlines };
