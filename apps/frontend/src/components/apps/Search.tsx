import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { AppProps } from '../../utils/appRegistry';
import { friendlyErrorText } from '../../utils/errorMessages';
import type { SearchResult } from '../../utils/search';
import { DEMO_SEARCH_RESULTS, isSearchDemoMode, runSearch, truncateSnippet } from '../../utils/search';
import { SearchError } from '../../utils/search';
import type { ApiMode } from '../../utils/apiProxy';
import {
  DEFAULT_PROXY_URL,
  resolveApiMode,
  runSearchViaProxy,
} from '../../utils/apiProxy';

/** Demo-path simulated latency (ms) (D5): the searching state is visible
 *  in the browser yet deterministic and fast for the verifier. */
const DEMO_SEARCH_DELAY_MS = 400;

/**
 * SECURITY (D14): VITE_GOOGLE_SEARCH_API_KEY and VITE_GOOGLE_SEARCH_CX are
 * FRONTEND credentials — they are visible in devtools. Acceptable for
 * local Phase 3; Phase 4 adds the backend APIRouter proxy with rate
 * limiting. Read ONCE here at the React boundary (D2) — utils/search.ts
 * stays node-pure.
 */
const SEARCH_API_KEY: string = import.meta.env.VITE_GOOGLE_SEARCH_API_KEY ?? '';
const SEARCH_CX: string = import.meta.env.VITE_GOOGLE_SEARCH_CX ?? '';
/** M13 (D12): the backend proxy base — env is read HERE only. */
const PROXY_BASE: string = import.meta.env.VITE_API_PROXY_URL ?? DEFAULT_PROXY_URL;

type SearchStatus = 'idle' | 'searching' | 'error';

const inputStyle = {
  flex: 1,
  minWidth: 0,
  background: 'rgba(0, 0, 0, 0.35)',
  border: '1px solid rgba(255, 255, 255, 0.16)',
  borderRadius: 6,
  color: '#e8eaed',
  fontFamily: 'inherit',
  fontSize: 9,
  padding: '2px 5px',
} as const;
// LONGHAND borders (D8): the retry variant below overrides borderColor —
// a border-shorthand + borderColor-override mix logs a React 19 dev-mode
// console error, which would break the verifiers' zero-console-error gate.
const buttonStyle = {
  background: 'rgba(255, 255, 255, 0.05)',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'rgba(255, 255, 255, 0.18)',
  borderRadius: 6,
  color: '#d3d6db',
  fontFamily: 'inherit',
  fontSize: 9,
  padding: '2px 6px',
  cursor: 'pointer',
} as const;
const disabledButtonStyle = {
  ...buttonStyle,
  color: '#8b8f98',
  borderColor: 'rgba(139, 143, 152, 0.3)',
  cursor: 'default',
} as const;
const cardStyle = {
  background: 'rgba(0, 0, 0, 0.35)',
  border: '1px solid rgba(255, 255, 255, 0.16)',
  borderRadius: 6,
  padding: '2px 4px',
  marginBottom: 2,
  cursor: 'pointer',
} as const;
const linkStyle = {
  color: '#00e5ff',
  textDecoration: 'underline',
  fontSize: 10,
  wordBreak: 'break-word',
} as const;
const domainStyle = { color: '#8b8f98', fontSize: 9 } as const;
const snippetStyle = {
  color: '#e8eaed',
  fontSize: 9,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
} as const;
const detailStyle = {
  color: '#8b8f98',
  fontSize: 9,
  borderTop: '1px dashed rgba(255, 255, 255, 0.12)',
  marginTop: 2,
  paddingTop: 2,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
} as const;

/**
 * Web Search app (M10): Google Custom Search with a demo-mode state
 * machine (D5), result cards whose titles are REAL <a target="_blank"
 * rel="noopener noreferrer"> links (D8 — the link stopPropagation's so
 * following it never toggles the card; the card BODY toggles inline
 * expansion: full snippet + raw link, D8), inline retryable errors, and
 * NO persistence (D7 — a search is a query, not a document: state only,
 * so StrictMode's double mount is trivially safe and the ONLY effect is
 * the unmount cleanup, which clears the demo timer and aborts any
 * in-flight fetch). Zero console output in every state (errors render
 * inline, never logged). The canned DEMO_SEARCH_RESULTS reference is
 * shared (React state holds the same readonly reference and only ever
 * replaces it wholesale — never mutated). windowId is destructured with
 * the underscore prefix (unused — search has no persistence/bus, D7) to
 * keep the AppProps contract explicit under noUnusedParameters.
 */
export function Search({ windowId: _windowId }: AppProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly SearchResult[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [demoMode, setDemoMode] = useState(() =>
    isSearchDemoMode(SEARCH_API_KEY, SEARCH_CX),
  );
  const [errorText, setErrorText] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  // M13 (D12): 'resolving' until the silent proxy probe answers; the ref
  // mirrors the resolution so the async submit path reads the LATEST mode.
  const [apiMode, setApiMode] = useState<ApiMode | 'resolving'>('resolving');
  const apiModeRef = useRef<ApiMode | 'resolving'>('resolving');
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const demoTimerRef = useRef<number | null>(null);
  // Sticky 401/403 degrade (D5): once credentials are rejected, every
  // later submit in this window goes straight to demo — no repeats.
  const demoFallbackRef = useRef(false);
  const lastQueryRef = useRef('');
  const listRef = useRef<HTMLDivElement | null>(null);

  // M13 (D12): resolve proxy | direct | demo ONCE per mount (silent).
  useEffect(() => {
    let cancelled = false;
    void resolveApiMode({
      kind: 'search',
      proxyUrl: PROXY_BASE,
      directConfigured: !isSearchDemoMode(SEARCH_API_KEY, SEARCH_CX),
    }).then((mode) => {
      if (cancelled) return;
      apiModeRef.current = mode;
      setApiMode(mode);
      if (mode === 'demo') setDemoMode(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Unmount cleanup only (D7: no persistence -> no restore/debounce/flush).
  useEffect(() => {
    return () => {
      if (demoTimerRef.current !== null) window.clearTimeout(demoTimerRef.current);
      demoTimerRef.current = null;
      abortRef.current?.abort(); // clean stop; runSearch resolves [] (D5)
    };
  }, []);

  // Auto scroll-to-bottom on result growth (D8).
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [results]);

  /** Demo path (D5/D6): canned results after the simulated latency. */
  const runDemoSearch = (): void => {
    setStatus('searching');
    demoTimerRef.current = window.setTimeout(() => {
      demoTimerRef.current = null;
      setResults(DEMO_SEARCH_RESULTS);
      setHasSearched(true);
      setStatus('idle');
    }, DEMO_SEARCH_DELAY_MS);
  };

  /** Live query. */
  const runLiveSearch = async (q: string): Promise<void> => {
    setStatus('searching');
    const controller = new AbortController();
    abortRef.current = controller;
    // M13 (D12): 'proxy' runs through the backend (keys stay server-side);
    // 'direct' is the unchanged M10 path; unresolved falls back like Chat.
    const effectiveMode: ApiMode =
      apiModeRef.current === 'resolving'
        ? isSearchDemoMode(SEARCH_API_KEY, SEARCH_CX)
          ? 'demo'
          : 'direct'
        : apiModeRef.current;
    try {
      const found =
        effectiveMode === 'proxy'
          ? await runSearchViaProxy({
              baseUrl: PROXY_BASE,
              query: q,
              signal: controller.signal,
            })
          : await runSearch({
              apiKey: SEARCH_API_KEY,
              cx: SEARCH_CX,
              query: q,
              signal: controller.signal,
            });
      setResults(found);
      setHasSearched(true);
      setStatus('idle');
    } catch (error) {
      if (error instanceof SearchError && error.kind === 'invalid_key') {
        // D5 sticky degrade: banner on + canned results for THIS query.
        demoFallbackRef.current = true;
        setDemoMode(true);
        runDemoSearch();
        return;
      }
      // 429/network/other: inline retryable error (D5); stale results go.
      setResults([]);
      setErrorText(friendlyErrorText(error));
      setStatus('error');
    } finally {
      abortRef.current = null;
    }
  };

  const handleSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const q = query.trim();
    if (!q || status === 'searching') return;
    lastQueryRef.current = q;
    setQuery('');
    setErrorText('');
    setExpandedIndex(null);
    if (demoMode || demoFallbackRef.current) {
      runDemoSearch();
    } else {
      void runLiveSearch(q);
    }
  };

  /** Retry = re-run LIVE for the same last query (D5): a 429 may have
   *  passed; rejected credentials degrade on the next failure. */
  const handleRetry = (): void => {
    if (status === 'searching') return;
    setErrorText('');
    if (demoFallbackRef.current) runDemoSearch();
    else void runLiveSearch(lastQueryRef.current);
  };

  const busy = status === 'searching';
  const submitDisabled = busy || query.trim() === '';
  const bannerReason = !isSearchDemoMode(SEARCH_API_KEY, SEARCH_CX)
    ? 'credentials rejected'
    : apiMode === 'demo'
      ? 'no keys (proxy & direct)'
      : 'no API key or search engine ID';

  return (
    <div style={{ fontSize: 10, lineHeight: 1.4 }} data-testid="search-app-root">
      {demoMode && (
        <div
          data-testid="search-demo-banner"
          style={{
            color: '#8b8f98',
            fontStyle: 'italic',
            fontSize: 9,
            border: '1px dashed rgba(255, 255, 255, 0.14)',
            borderRadius: 6,
            padding: '1px 4px',
            marginBottom: 3,
          }}
        >
          DEMO MODE — {bannerReason}
        </div>
      )}
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 4, marginBottom: 3 }}>
        <input
          data-testid="search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the web…"
          spellCheck={false}
          style={inputStyle}
        />
        <button
          type="submit"
          data-testid="search-submit"
          disabled={submitDisabled}
          style={submitDisabled ? disabledButtonStyle : buttonStyle}
        >
          Search
        </button>
      </form>
      {status === 'error' && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 3, alignItems: 'center' }}>
          <span
            data-testid="search-error"
            style={{ color: '#ffd7d7', fontSize: 9, flex: 1, minWidth: 0 }}
          >
            {errorText}
          </span>
          <button
            type="button"
            data-testid="search-retry"
            onClick={handleRetry}
            style={{
              ...buttonStyle,
              borderColor: '#ff5a5a',
              color: '#ffd7d7',
            }}
          >
            Retry
          </button>
        </div>
      )}
      <div
        ref={listRef}
        data-testid="search-results"
        style={{
          height: 44,
          overflowY: 'auto',
          background: 'rgba(0, 0, 0, 0.25)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 6,
          padding: '2px 4px',
        }}
      >
        {busy && (
          <div data-testid="search-status" style={{ color: '#8b8f98', fontSize: 9 }}>
            Searching…
          </div>
        )}
        {results.map((result, index) => (
          <div
            key={`${result.link}-${index}`}
            data-testid="search-card"
            onClick={() =>
              setExpandedIndex((current) => (current === index ? null : index))
            }
            style={cardStyle}
          >
            <a
              data-testid="search-card-link"
              href={result.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              style={linkStyle}
            >
              {result.title}
            </a>
            <div data-testid="search-card-domain" style={domainStyle}>
              {result.displayLink}
            </div>
            <div data-testid="search-card-snippet" style={snippetStyle}>
              {truncateSnippet(result.snippet)}
            </div>
            {expandedIndex === index && (
              <div data-testid="search-card-detail" style={detailStyle}>
                {result.snippet}
                {'\n'}
                {result.link}
              </div>
            )}
          </div>
        ))}
        {hasSearched && results.length === 0 && !busy && status !== 'error' && (
          <div data-testid="search-empty" style={{ color: '#8b8f98', fontSize: 9 }}>
            No results found.
          </div>
        )}
      </div>
    </div>
  );
}