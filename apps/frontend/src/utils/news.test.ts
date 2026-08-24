import { describe, expect, it } from 'vitest';
import {
  FALLBACK_NEWS_ARTICLES,
  fetchLiveNews,
  getNewsArticles,
  getNextSlideIndex,
  getPrevSlideIndex,
} from './news';

describe('news data model & carousel navigation (Session 3)', () => {
  it('provides 5 curated news articles with complete fields and image URLs', () => {
    const articles = getNewsArticles();
    expect(articles).toHaveLength(5);
    expect(articles).toBe(FALLBACK_NEWS_ARTICLES);

    for (const article of articles) {
      expect(article.id).toBeDefined();
      expect(article.title.length).toBeGreaterThan(10);
      expect(article.summary.length).toBeGreaterThan(20);
      expect(article.source).toBeDefined();
      expect(article.category).toBeDefined();
      expect(article.url).toMatch(/^https?:\/\//);
      expect(article.imageUrl).toMatch(/^https?:\/\//);
      expect(article.badgeColor).toBeDefined();
    }
  });

  it('fetchLiveNews successfully returns articles from backend response', async () => {
    const mockFetch = async () =>
      ({
        ok: true,
        json: async () => ({
          ok: true,
          articles: [
            {
              id: 'mock-1',
              title: 'Mock Live Headline',
              source: 'Mock Source',
              timeAgo: '10m ago',
              category: 'Technology',
              summary: 'Summary of live story',
              url: 'https://example.com/mock',
              imageUrl: 'https://example.com/mock.jpg',
              badgeColor: '#00e5ff',
            },
          ],
        }),
      }) as unknown as Response;

    const articles = await fetchLiveNews('http://mock', mockFetch as typeof fetch);
    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe('Mock Live Headline');
  });

  it('fetchLiveNews gracefully falls back on error or timeout', async () => {
    const mockFailFetch = async () => {
      throw new Error('Network error');
    };

    const articles = await fetchLiveNews('http://mock', mockFailFetch as typeof fetch);
    expect(articles).toHaveLength(5);
    expect(articles[0].title).toContain('Vision Pro');
  });

  it('cycles slide indices forward and backward with cyclic wrap', () => {
    expect(getNextSlideIndex(0, 5)).toBe(1);
    expect(getNextSlideIndex(4, 5)).toBe(0);
    expect(getPrevSlideIndex(0, 5)).toBe(4);
    expect(getPrevSlideIndex(3, 5)).toBe(2);
  });
});
