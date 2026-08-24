import { useCallback, useEffect, useState } from 'react';
import type { AppProps } from '../../utils/appRegistry';
import { fetchLiveNews, getNewsArticles, getNextSlideIndex, getPrevSlideIndex } from '../../utils/news';
import type { NewsItem } from '../../utils/news';

export function News({ windowId }: AppProps) {
  const [articles, setArticles] = useState<NewsItem[]>(() => [...getNewsArticles()]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);

  // Fetch real-time live news on mount
  useEffect(() => {
    let cancelled = false;
    fetchLiveNews().then((live) => {
      if (!cancelled && live.length > 0) {
        setArticles(live);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleNext = useCallback(() => {
    setSlideDirection('left');
    setCurrentIndex((curr) => getNextSlideIndex(curr, articles.length));
  }, [articles.length]);

  const handlePrev = useCallback(() => {
    setSlideDirection('right');
    setCurrentIndex((curr) => getPrevSlideIndex(curr, articles.length));
  }, [articles.length]);

  // Listen for spatial swipe events directed at this window
  useEffect(() => {
    const handleSpatialSwipe = (e: CustomEvent<{ windowId?: string; direction: 'left' | 'right' }>) => {
      if (!e.detail) return;
      if (e.detail.windowId && e.detail.windowId !== windowId) return;
      if (e.detail.direction === 'left') {
        handleNext();
      } else if (e.detail.direction === 'right') {
        handlePrev();
      }
    };

    window.addEventListener('jarvis-spatial-swipe' as never, handleSpatialSwipe as EventListener);
    return () => {
      window.removeEventListener('jarvis-spatial-swipe' as never, handleSpatialSwipe as EventListener);
    };
  }, [windowId, handleNext, handlePrev]);

  const article = articles[currentIndex] ?? articles[0];
  if (!article) return null;

  return (
    <div
      data-testid="news-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        color: '#f4f5f7',
        fontFamily:
          'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        userSelect: 'none',
        overflow: 'hidden',
        position: 'relative',
        background: 'transparent',
      }}
    >
      {/* Top Visual Image Banner (Google Top Stories format) */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: 140,
          overflow: 'hidden',
          backgroundColor: '#0a0b0d',
        }}
      >
        <img
          src={article.imageUrl}
          alt={article.title}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: 'brightness(0.85) contrast(1.05) saturate(0.9)',
            transition: 'transform 0.5s ease',
          }}
          onError={(e) => {
            // Fallback to high-res tech image on error
            (e.target as HTMLImageElement).src =
              'https://images.unsplash.com/photo-1593508512255-86ab42a8e620?auto=format&fit=crop&w=800&q=80';
          }}
        />
        {/* Gradient vignette over image — fades into the card glass */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(0, 0, 0, 0.35) 0%, rgba(10, 11, 13, 0.1) 50%, rgba(10, 11, 13, 0.95) 100%)',
          }}
        />

        {/* Publisher Source Pill */}
        <div
          style={{
            position: 'absolute',
            top: 10,
            left: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            borderRadius: 20,
            background: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.16)',
          }}
        >
          <div
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              backgroundColor: article.badgeColor,
            }}
          />
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: '#e8eaed',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {article.source}
          </span>
        </div>

        {/* Category & Time Pill */}
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 12,
            padding: '3px 8px',
            borderRadius: 12,
            background: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(8px)',
            fontSize: 10,
            color: '#b7bcc4',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {article.timeAgo}
        </div>
      </div>

      {/* Article Body Content Area */}
      <div
        key={article.id}
        style={{
          flex: 1,
          padding: '12px 16px 14px 16px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          animation:
            slideDirection === 'left'
              ? 'slideInFromRight 0.3s ease-out'
              : slideDirection === 'right'
              ? 'slideInFromLeft 0.3s ease-out'
              : 'fadeIn 0.3s ease-out',
        }}
      >
        <div>
          <h2
            data-testid="news-title"
            style={{
              fontSize: 15.5,
              fontWeight: 650,
              lineHeight: 1.35,
              margin: '0 0 8px 0',
              color: '#ffffff',
              letterSpacing: '-0.01em',
            }}
          >
            {article.title}
          </h2>

          <p
            data-testid="news-summary"
            style={{
              fontSize: 12,
              lineHeight: 1.55,
              color: '#a9aeb8',
              margin: 0,
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {article.summary}
          </p>
        </div>

        {/* Footer: Read Button + Slideshow Carousel Controls */}
        <div
          style={{
            marginTop: 12,
            paddingTop: 10,
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="news-read-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 8,
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.18)',
              color: '#f4f5f7',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textDecoration: 'none',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            Read Full Story ↗
          </a>

          {/* Carousel Navigation & Dots */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={handlePrev}
              data-testid="news-prev-btn"
              title="Previous Story"
              style={{
                background: 'transparent',
                border: '1px solid rgba(255, 255, 255, 0.14)',
                borderRadius: 6,
                color: '#b7bcc4',
                padding: '4px 8px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              ◀
            </button>

            {/* Pagination Indicators */}
            <div style={{ display: 'flex', gap: 4, padding: '0 2px' }}>
              {articles.map((item, idx) => (
                <div
                  key={item.id}
                  onClick={() => setCurrentIndex(idx)}
                  data-testid={`news-dot-${idx}`}
                  style={{
                    width: idx === currentIndex ? 14 : 5,
                    height: 5,
                    borderRadius: 3,
                    background: idx === currentIndex ? '#00e5ff' : 'rgba(255, 255, 255, 0.22)',
                    boxShadow: idx === currentIndex ? '0 0 6px rgba(0, 229, 255, 0.6)' : 'none',
                    cursor: 'pointer',
                    transition: 'all 0.25s ease',
                  }}
                />
              ))}
            </div>

            <button
              onClick={handleNext}
              data-testid="news-next-btn"
              title="Next Story"
              style={{
                background: 'transparent',
                border: '1px solid rgba(255, 255, 255, 0.14)',
                borderRadius: 6,
                color: '#b7bcc4',
                padding: '4px 8px',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              ▶
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
