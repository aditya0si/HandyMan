/**
 * M13 shared Custom Search request builder (single source of truth for
 * BOTH the frontend client (utils/search.ts) and the backend proxy —
 * moved from search.ts, which re-exports it so every existing import
 * keeps working). Pure string builder only — no fetch, no env, no DOM.
 */

/** Fixed result count (no pagination in M10/M13 — M10 D16). v10 pins 5. */
export const SEARCH_RESULT_COUNT = 5;

const SEARCH_API_BASE = 'https://www.googleapis.com/customsearch/v1';

/** URL builder: every param percent-encoded (M10 D1). */
export function buildSearchUrl(
  apiKey: string,
  cx: string,
  query: string,
  num: number = SEARCH_RESULT_COUNT,
): string {
  return (
    `${SEARCH_API_BASE}?key=${encodeURIComponent(apiKey)}` +
    `&cx=${encodeURIComponent(cx)}` +
    `&num=${num}` +
    `&q=${encodeURIComponent(query)}`
  );
}
