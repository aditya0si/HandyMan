/**
 * M13 API-proxy selection + clients (brief D11/D12). ONE shared module:
 * resolveApiMode picks proxy | direct | demo per app; the two thin clients
 * ride the backend's PASSTHROUGH proxies and REUSE the existing frontend
 * parsers (extractSseData/extractTextDelta for LLM, mapSearchItems for
 * search) so there is exactly one mapping code path (D6/D7).
 *
 * Resolution order (the milestone prompt): proxy IF reachable AND it
 * reports the app's key configured (GET /api/proxy/status); ELSE direct if
 * the VITE_ key exists (M9/M10 paths unchanged); ELSE demo mode.
 *
 * Purity contract: NO import.meta (env is read at the React boundary),
 * NO DOM-only APIs — fetch + clock injectable, node vitest covers all.
 * The probe is SILENT by design: a failed fetch logs only the already
 * documented ERR_CONNECTION_REFUSED native line (M11 D4b), never an app
 * console error.
 */
import type { GeminiMessage } from '@jarvis/shared';
import { extractSseData, extractTextDelta } from './gemini';
import { CHAT_ERROR_KINDS, ChatError } from './gemini';
import type { SearchResult } from './search';
import { SEARCH_ERROR_KINDS, SearchError, mapSearchItems } from './search';

export type ApiMode = 'proxy' | 'direct' | 'demo';
export type ApiKind = 'llm' | 'search';

/** Default dev proxy base (README M13); override via VITE_API_PROXY_URL. */
export const DEFAULT_PROXY_URL = 'http://localhost:4000';

export const PROXY_PROBE_TIMEOUT_MS = 1200;

export interface ProxyStatus {
  llm: boolean;
  search: boolean;
}

/** Fetches /api/proxy/status; null when unreachable/invalid (silent). */
export async function fetchProxyStatus(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
  timeoutMs: number = PROXY_PROBE_TIMEOUT_MS,
): Promise<ProxyStatus | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/api/proxy/status`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<ProxyStatus>;
    return { llm: body.llm === true, search: body.search === true };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ResolveApiModeOptions {
  kind: ApiKind;
  /** Proxy base (default DEFAULT_PROXY_URL). */
  proxyUrl?: string;
  /** Whether the direct VITE_ credentials exist (isDemoMode() === false). */
  directConfigured: boolean;
  fetchImpl?: typeof fetch;
  probeTimeoutMs?: number;
}

/** The resolution order (see module docblock). */
export async function resolveApiMode({
  kind,
  proxyUrl = DEFAULT_PROXY_URL,
  directConfigured,
  fetchImpl,
  probeTimeoutMs,
}: ResolveApiModeOptions): Promise<ApiMode> {
  const status = await fetchProxyStatus(proxyUrl, fetchImpl, probeTimeoutMs);
  if (status !== null && status[kind]) return 'proxy';
  return directConfigured ? 'direct' : 'demo';
}

// ---------------------------------------------------------------------------
// LLM proxy client (SSE passthrough — same event shape as direct Gemini)
// ---------------------------------------------------------------------------

export interface StreamChatViaProxyOptions {
  baseUrl: string;
  messages: readonly GeminiMessage[];
  /** Called once per non-empty text delta (live append). */
  onDelta: (delta: string) => void;
  /** Abort = clean stop: resolves with the partial text (M9 D5 parity). */
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

function proxyChatError(status: number): ChatError {
  if (status === 429) {
    return new ChatError(
      CHAT_ERROR_KINDS.rateLimit,
      'Proxy rate limit reached (10 req/min) — try again shortly.',
    );
  }
  return new ChatError(
    CHAT_ERROR_KINDS.other,
    `Proxy request failed (HTTP ${status}).`,
  );
}

/**
 * Streams one chat completion through POST /api/proxy/llm. The backend
 * pipes Gemini's SSE bytes through unchanged, so the parsing is EXACTLY
 * streamChat's (shared extractors). Throws ChatError for genuine failures
 * (D13): a mid-session 503 means the backend key vanished — a typed,
 * retryable inline error, never a silent fallback loop.
 */
export async function streamChatViaProxy({
  baseUrl,
  messages,
  onDelta,
  signal,
  fetchImpl = fetch.bind(globalThis),
}: StreamChatViaProxyOptions): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/proxy/llm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) return '';
    throw new ChatError(
      CHAT_ERROR_KINDS.network,
      `Network error reaching the proxy: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!response.ok) throw proxyChatError(response.status);
  const body = response.body;
  if (!body) {
    throw new ChatError(CHAT_ERROR_KINDS.other, 'Proxy response had no body.');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  const consume = (chunkText: string): void => {
    buffer += chunkText;
    const { data, rest } = extractSseData(buffer);
    buffer = rest;
    for (const line of data) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const delta = extractTextDelta(parsed);
      if (delta) {
        full += delta;
        onDelta(delta);
      }
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      consume(decoder.decode(value, { stream: true }));
    }
    consume(decoder.decode() + '\n');
  } catch (error) {
    if (signal?.aborted) return full;
    throw new ChatError(
      CHAT_ERROR_KINDS.network,
      `Proxy stream failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return full;
}

// ---------------------------------------------------------------------------
// Search proxy client (JSON passthrough — same Google shape as direct)
// ---------------------------------------------------------------------------

export interface RunSearchViaProxyOptions {
  baseUrl: string;
  query: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/**
 * Runs one search through GET /api/proxy/search (upstream Google JSON
 * passes through; mapping is the shared mapSearchItems). Throws
 * SearchError for genuine failures (D13).
 */
export async function runSearchViaProxy({
  baseUrl,
  query,
  signal,
  fetchImpl = fetch.bind(globalThis),
}: RunSearchViaProxyOptions): Promise<SearchResult[]> {
  const url = `${baseUrl}/api/proxy/search?q=${encodeURIComponent(query)}`;
  let response: Response;
  try {
    response = await fetchImpl(url, { method: 'GET', signal });
  } catch (error) {
    if (signal?.aborted) return [];
    throw new SearchError(
      SEARCH_ERROR_KINDS.network,
      `Network error reaching the proxy: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!response.ok) {
    if (response.status === 429) {
      throw new SearchError(
        SEARCH_ERROR_KINDS.rateLimit,
        'Proxy rate limit reached (30 req/min) — try again shortly.',
      );
    }
    throw new SearchError(
      SEARCH_ERROR_KINDS.other,
      `Proxy request failed (HTTP ${response.status}).`,
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new SearchError(
      SEARCH_ERROR_KINDS.other,
      'Proxy search response was not valid JSON.',
    );
  }
  return mapSearchItems(payload);
}
