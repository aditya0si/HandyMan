import { describe, expect, it } from 'vitest';
import {
  buildSearchUrl,
  DEMO_SEARCH_RESULTS,
  isSearchDemoMode,
  mapSearchItems,
  runSearch,
  SearchError,
  SEARCH_ERROR_KINDS,
  SEARCH_RESULT_COUNT,
  truncateSnippet,
} from './search';

/** Injected fetch returning a Response-like (ok/status/json). */
function fetchLike(response: {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
}): typeof fetch {
  return (async () => response) as unknown as typeof fetch;
}

const OK_ITEMS = {
  items: [
    {
      title: 'Result A',
      link: 'https://example.com/a',
      snippet: 'Snippet A',
      displayLink: 'example.com',
    },
    { title: 'Result B', link: 'https://example.com/b' },
  ],
};

describe('search client (M10)', () => {
  describe('buildSearchUrl', () => {
    it('buildSearchUrl is exact: base + encoded key + cx + num=SEARCH_RESULT_COUNT + encoded q', () => {
      expect(buildSearchUrl('test-key', 'test-cx', 'hello world')).toBe(
        'https://www.googleapis.com/customsearch/v1?key=test-key&cx=test-cx&num=5&q=hello%20world',
      );
      expect(SEARCH_RESULT_COUNT).toBe(5); // D1 pin
    });

    it('buildSearchUrl percent-encodes query special chars (spaces, &, =, unicode)', () => {
      expect(buildSearchUrl('k', 'c', 'a&b=c ü')).toBe(
        'https://www.googleapis.com/customsearch/v1?key=k&cx=c&num=5&q=a%26b%3Dc%20%C3%BC',
      );
    });

    it('buildSearchUrl encodes key and cx, and num overrides', () => {
      expect(buildSearchUrl('k&1', 'c=x', 'q', 10)).toBe(
        'https://www.googleapis.com/customsearch/v1?key=k%261&cx=c%3Dx&num=10&q=q',
      );
    });
  });

  describe('mapSearchItems', () => {
    it('mapSearchItems maps full items to SearchResult', () => {
      const results = mapSearchItems(OK_ITEMS);
      expect(results[0]).toEqual({
        title: 'Result A',
        link: 'https://example.com/a',
        snippet: 'Snippet A',
        displayLink: 'example.com',
      });
    });

    it('mapSearchItems missing fields become empty strings', () => {
      const results = mapSearchItems(OK_ITEMS);
      expect(results[1]).toEqual({
        title: 'Result B',
        link: 'https://example.com/b',
        snippet: '',
        displayLink: '',
      });
      // A null item also maps to all-empty strings (never throws).
      expect(mapSearchItems({ items: [null] })[0]).toEqual({
        title: '',
        link: '',
        snippet: '',
        displayLink: '',
      });
    });

    it('mapSearchItems with items absent OR non-array returns []', () => {
      expect(mapSearchItems({})).toEqual([]);
      expect(mapSearchItems({ items: 'nope' })).toEqual([]);
      expect(mapSearchItems({ items: [] })).toEqual([]);
    });
  });

  describe('isSearchDemoMode (D5 matrix)', () => {
    it('isSearchDemoMode true when the key is missing (cx present)', () => {
      expect(isSearchDemoMode('', 'cx')).toBe(true);
      expect(isSearchDemoMode(undefined, 'cx')).toBe(true);
    });

    it('isSearchDemoMode true when cx is missing (key present)', () => {
      expect(isSearchDemoMode('key', '')).toBe(true);
      expect(isSearchDemoMode('key', undefined)).toBe(true);
    });

    it('isSearchDemoMode true for undefined/null/whitespace-only credentials', () => {
      for (const missing of ['', '   ', '\t', undefined, null]) {
        expect(isSearchDemoMode(missing, 'cx')).toBe(true);
        expect(isSearchDemoMode('key', missing)).toBe(true);
      }
    });

    it('isSearchDemoMode false when both credentials are present', () => {
      expect(isSearchDemoMode('key', 'cx')).toBe(false);
      expect(isSearchDemoMode('  key  ', '  cx  ')).toBe(false); // space-padded ok
    });
  });

  describe('runSearch (injected fetch)', () => {
    it('runSearch with no key throws SearchError no_key and never fetches', async () => {
      let fetchCalls = 0;
      const spyFetch = (async () => {
        fetchCalls += 1;
        throw new Error('should never be called');
      }) as unknown as typeof fetch;
      await expect(
        runSearch({
          apiKey: '   \t ',
          cx: 'c',
          query: 'q',
          fetchImpl: spyFetch,
        }),
      ).rejects.toMatchObject({ name: SearchError.name, kind: SEARCH_ERROR_KINDS.noKey });
      expect(fetchCalls).toBe(0);
    });

    it('runSearch with no cx throws SearchError no_key and never fetches', async () => {
      let fetchCalls = 0;
      const spyFetch = (async () => {
        fetchCalls += 1;
        throw new Error('should never be called');
      }) as unknown as typeof fetch;
      await expect(
        runSearch({
          apiKey: 'k',
          cx: '',
          query: 'q',
          fetchImpl: spyFetch,
        }),
      ).rejects.toMatchObject({ name: SearchError.name, kind: SEARCH_ERROR_KINDS.noKey });
      expect(fetchCalls).toBe(0);
    });

    it("runSearch HTTP 401/403 -> kind 'invalid_key'", async () => {
      for (const status of [401, 403]) {
        await expect(
          runSearch({
            apiKey: 'k',
            cx: 'c',
            query: 'q',
            fetchImpl: fetchLike({ ok: false, status }),
          }),
        ).rejects.toMatchObject({
          name: SearchError.name,
          kind: SEARCH_ERROR_KINDS.invalidKey,
        });
      }
    });

    it("runSearch HTTP 429 -> kind 'rate_limit'", async () => {
      await expect(
        runSearch({
          apiKey: 'k',
          cx: 'c',
          query: 'q',
          fetchImpl: fetchLike({ ok: false, status: 429 }),
        }),
      ).rejects.toMatchObject({
        name: SearchError.name,
        kind: SEARCH_ERROR_KINDS.rateLimit,
      });
    });

    it("runSearch HTTP 500 -> kind 'other'", async () => {
      await expect(
        runSearch({
          apiKey: 'k',
          cx: 'c',
          query: 'q',
          fetchImpl: fetchLike({ ok: false, status: 500 }),
        }),
      ).rejects.toMatchObject({
        name: SearchError.name,
        kind: SEARCH_ERROR_KINDS.other,
      });
    });

    it("runSearch fetch rejection (TypeError) -> kind 'network'", async () => {
      const buggyFetch = ((_url: unknown) =>
        Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
      await expect(
        runSearch({
          apiKey: 'k',
          cx: 'c',
          query: 'q',
          fetchImpl: buggyFetch,
        }),
      ).rejects.toMatchObject({
        name: SearchError.name,
        kind: SEARCH_ERROR_KINDS.network,
      });
      await expect(
        runSearch({
          apiKey: 'k',
          cx: 'c',
          query: 'q',
          fetchImpl: buggyFetch,
        }),
      ).rejects.toThrow(/Network error reaching Google Custom Search/);
    });

    it('runSearch OK with items resolves the mapped results', async () => {
      const results = await runSearch({
        apiKey: 'k',
        cx: 'c',
        query: 'q',
        fetchImpl: fetchLike({
          ok: true,
          status: 200,
          json: async () => OK_ITEMS,
        }),
      });
      expect(results.length).toBe(2);
      expect(results[0]).toEqual({
        title: 'Result A',
        link: 'https://example.com/a',
        snippet: 'Snippet A',
        displayLink: 'example.com',
      });
      expect(results[1]).toEqual({
        title: 'Result B',
        link: 'https://example.com/b',
        snippet: '',
        displayLink: '',
      });
    });

    it('runSearch OK without items resolves [] (valid zero results, no throw)', async () => {
      await expect(
        runSearch({
          apiKey: 'k',
          cx: 'c',
          query: 'q',
          fetchImpl: fetchLike({
            ok: true,
            status: 200,
            json: async () => ({ searchInformation: {} }),
          }),
        }),
      ).resolves.toEqual([]);
    });

    it("runSearch OK with unparseable JSON -> kind 'other'", async () => {
      await expect(
        runSearch({
          apiKey: 'k',
          cx: 'c',
          query: 'q',
          fetchImpl: fetchLike({
            ok: true,
            status: 200,
            json: async () => {
              throw new SyntaxError('bad');
            },
          }),
        }),
      ).rejects.toMatchObject({
        name: SearchError.name,
        kind: SEARCH_ERROR_KINDS.other,
      });
    });
  });

  describe('DEMO_SEARCH_RESULTS + truncateSnippet (D6/D8)', () => {
    it('DEMO_SEARCH_RESULTS: exactly 5 well-formed canned results', () => {
      expect(DEMO_SEARCH_RESULTS.length).toBe(SEARCH_RESULT_COUNT);
      for (const result of DEMO_SEARCH_RESULTS) {
        expect(typeof result.title).toBe('string');
        expect(result.title.length).toBeGreaterThan(0);
        expect(typeof result.link).toBe('string');
        expect(result.link.startsWith('https://')).toBe(true);
        expect(typeof result.snippet).toBe('string');
        expect(result.snippet.length).toBeGreaterThan(0);
        expect(typeof result.displayLink).toBe('string');
        expect(result.displayLink.length).toBeGreaterThan(0);
        // Stable 'demo result' markers (v10 pins them).
        expect(result.title).toContain('demo result');
        expect(result.snippet).toContain('demo result');
        // Every snippet > 80 chars so the collapsed/expanded difference is
        // visible (D8).
        expect(result.snippet.length).toBeGreaterThan(80);
      }
      // Same it also pins truncateSnippet both branches (D8): short stays
      // verbatim; >80 collapses to max chars + the ellipsis.
      expect(truncateSnippet('short')).toBe('short');
      const collapsed = truncateSnippet('x'.repeat(100));
      expect(collapsed.length).toBe(81);
      expect(collapsed.endsWith('…')).toBe(true);
    });
  });

  describe('runSearch abort (D5 clean stop)', () => {
    it('runSearch abort resolves [] and never rejects', async () => {
      const fetchNever = ((_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        })) as unknown as typeof fetch;
      const ac = new AbortController();
      const promise = runSearch({
        apiKey: 'k',
        cx: 'c',
        query: 'q',
        signal: ac.signal,
        fetchImpl: fetchNever,
      });
      ac.abort();
      await expect(promise).resolves.toEqual([]);
    });
  });
});