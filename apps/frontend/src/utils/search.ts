/**
 * M10 Google Custom Search JSON API client for the Web Search app.
 *
 * DEVIATIONS from TECHNICAL_SPEC §2.3 (documented, D16): the spec sketch
 * (`export class WebSearchApp extends App { // Similar structure }`) is an
 * EMPTY placeholder — the M8 React-FC registry continues, and this module
 * is the node-pure client behind the Search app component. API form: GET
 * https://www.googleapis.com/customsearch/v1?key=<KEY>&cx=<CX>&num=<N>&q=<QUERY>
 * — query-param auth per the M10 milestone prompt supersedes the spec
 * family's x-goog-api-key header form (both are valid Google REST auth).
 *
 * Purity contract (D2, mirrors gemini.ts): NO import.meta, NO React, NO
 * DOM-only APIs — apiKey and cx are PARAMETERS (Search.tsx reads
 * import.meta.env at the React boundary), fetch is injectable so node
 * vitest exercises everything with Response-likes (no network in tests).
 *
 * Semantics (D4/D5): a 200 with `items` ABSENT is a VALID zero-result
 * response -> [] (never an error); missing item fields map to '';
 * SearchError is reserved for genuine failures (no credentials, 401/403,
 * 429, other non-OK, network, unparseable body). Abort = clean stop:
 * resolves [] (request/response has no partial result to keep — unlike
 * M9's streaming partial text).
 */
import { buildSearchUrl } from '@jarvis/shared';

// M13: the result-count constant + URL builder moved to @jarvis/shared
// (single source of truth shared with the backend proxy); re-exported so
// every existing import keeps working.
export { SEARCH_RESULT_COUNT, buildSearchUrl } from '@jarvis/shared';

/** Error kinds as a const object (NO enum — erasableSyntaxOnly). */
export const SEARCH_ERROR_KINDS = {
  noKey: 'no_key',
  invalidKey: 'invalid_key',
  rateLimit: 'rate_limit',
  network: 'network',
  other: 'other',
} as const;

export type SearchErrorKind = (typeof SEARCH_ERROR_KINDS)[keyof typeof SEARCH_ERROR_KINDS];

/**
 * Typed failure with a distinguishable kind + user-readable message (D3).
 * PARALLEL to M9's ChatError (same shape, same HTTP mapping) — kept
 * separate for clean per-app coupling: 'no_key' here means the key OR the
 * cx is missing (search has TWO credentials; chat has one).
 */
export class SearchError extends Error {
  readonly kind: SearchErrorKind;

  constructor(kind: SearchErrorKind, message: string) {
    super(message);
    this.name = 'SearchError';
    this.kind = kind;
  }
}

/** One result card. Missing wire fields map to '' (D4). */
export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
}

/**
 * items[] -> SearchResult[] (D4). `items` absent (the API omits it on
 * zero matches) or non-array -> []. Every field type-guarded: missing or
 * non-string -> ''. Never throws.
 */
export function mapSearchItems(payload: unknown): SearchResult[] {
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const record = (item ?? {}) as Record<string, unknown>;
    return {
      title: typeof record.title === 'string' ? record.title : '',
      link: typeof record.link === 'string' ? record.link : '',
      snippet: typeof record.snippet === 'string' ? record.snippet : '',
      displayLink:
        typeof record.displayLink === 'string' ? record.displayLink : '',
    };
  });
}

/** Demo mode = EITHER credential missing/whitespace (D5). */
export function isSearchDemoMode(
  apiKey: string | undefined | null,
  cx: string | undefined | null,
): boolean {
  return !apiKey || apiKey.trim() === '' || !cx || cx.trim() === '';
}

/** Collapsed-card snippet budget (D8); pure so tests pin the truncation. */
const SNIPPET_COLLAPSE_MAX = 80;

/** Collapsed cards show at most `max` chars + ellipsis; expanded shows all. */
export function truncateSnippet(
  snippet: string,
  max: number = SNIPPET_COLLAPSE_MAX,
): string {
  return snippet.length > max ? `${snippet.slice(0, max)}…` : snippet;
}

/**
 * Canned demo results (D6): fixed content with the stable 'demo result'
 * markers (v10 pins them), real https URLs so <a href> assertions are
 * meaningful, displayLinks set, and snippets > 80 chars so the collapsed
 * vs expanded difference is visible. Exactly SEARCH_RESULT_COUNT entries.
 */
export const DEMO_SEARCH_RESULTS: readonly SearchResult[] = [
  {
    title: 'Spatial computing — Wikipedia (demo result 1)',
    link: 'https://en.wikipedia.org/wiki/Spatial_computing',
    snippet:
      'demo result 1: spatial computing is the use of digital technology to '
      + 'make physical space interactive, blending 3D interfaces with the real world.',
    displayLink: 'en.wikipedia.org',
  },
  {
    title: 'MediaPipe Hands — Google Developers (demo result 2)',
    link: 'https://developers.google.com/mediapipe',
    snippet:
      'demo result 2: MediaPipe provides on-device hand-landmark detection '
      + 'that powers gesture interfaces from a plain webcam, no extra hardware.',
    displayLink: 'developers.google.com',
  },
  {
    title: 'three.js docs — JavaScript 3D library (demo result 3)',
    link: 'https://threejs.org/docs/index.html#manual/en/introduction/Creating-a-scene',
    snippet:
      'demo result 3: three.js is a lightweight 3D library for rendering '
      + 'scenes, cameras, and geometry in the browser via WebGL.',
    displayLink: 'threejs.org',
  },
  {
    title: 'Custom Search JSON API overview (demo result 4)',
    link: 'https://developers.google.com/custom-search/v1/overview',
    snippet:
      'demo result 4: the Custom Search JSON API returns web results for a '
      + 'query using a Programmable Search Engine id (cx) and an API key.',
    displayLink: 'developers.google.com',
  },
  {
    title: 'WebXR Device API — MDN (demo result 5)',
    link: 'https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API',
    snippet:
      'demo result 5: WebXR exposes augmented- and virtual-reality devices '
      + 'to the web, the browser side of spatial computing standards.',
    displayLink: 'developer.mozilla.org',
  },
];

export interface RunSearchOptions {
  apiKey: string;
  cx: string;
  query: string;
  /** Abort = clean stop (D5): resolves []. */
  signal?: AbortSignal;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Runs one Custom Search query. Resolves the mapped results ([] is a
 * VALID zero-result answer). Throws SearchError ONLY for genuine failures
 * (D3/D4): missing key or cx -> no_key (fetch never called), 401/403 ->
 * invalid_key, 429 -> rate_limit, other non-OK -> other, network
 * rejection -> network, unparseable JSON on OK -> other.
 */
export async function runSearch({
  apiKey,
  cx,
  query,
  signal,
  fetchImpl = fetch.bind(globalThis),
}: RunSearchOptions): Promise<SearchResult[]> {
  const key = apiKey.trim();
  const engineId = cx.trim();
  if (!key || !engineId) {
    throw new SearchError(
      SEARCH_ERROR_KINDS.noKey,
      'No Google Custom Search credentials configured — set '
        + 'VITE_GOOGLE_SEARCH_API_KEY and VITE_GOOGLE_SEARCH_CX in '
        + 'apps/frontend/.env.local (README, Milestone 10).',
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(buildSearchUrl(key, engineId, query), {
      method: 'GET',
      signal,
    });
  } catch (error) {
    if (signal?.aborted) return []; // clean cancel before headers (D5)
    throw new SearchError(
      SEARCH_ERROR_KINDS.network,
      `Network error reaching Google Custom Search: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!response.ok) {
    const kind =
      response.status === 401 || response.status === 403
        ? SEARCH_ERROR_KINDS.invalidKey
        : response.status === 429
          ? SEARCH_ERROR_KINDS.rateLimit
          : SEARCH_ERROR_KINDS.other;
    throw new SearchError(
      kind,
      `Google Custom Search request failed (HTTP ${response.status}).`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new SearchError(
      SEARCH_ERROR_KINDS.other,
      'Google Custom Search response was not valid JSON.',
    );
  }
  return mapSearchItems(payload);
}