import { describe, expect, it, vi } from 'vitest';
import { ChatError } from './gemini';
import { SearchError } from './search';
import {
  DEFAULT_PROXY_URL,
  PROXY_PROBE_TIMEOUT_MS,
  resolveApiMode,
  runSearchViaProxy,
  streamChatViaProxy,
} from './apiProxy';

type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('resolveApiMode (M13 D11/D12)', () => {
  it('reachable proxy reporting the key configured -> proxy', async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request) =>
      jsonResponse({ llm: true, search: false })) as unknown as ReturnType<typeof vi.fn> & FetchLike;
    expect(
      await resolveApiMode({ kind: 'llm', directConfigured: true, fetchImpl }),
    ).toBe('proxy');
    expect(fetchImpl).toHaveBeenCalledWith(
      `${DEFAULT_PROXY_URL}/api/proxy/status`,
      expect.anything(),
    );
  });

  it('reachable but NOT configured -> direct when a VITE key exists', async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request) =>
      jsonResponse({ llm: false, search: false })) as unknown as ReturnType<typeof vi.fn> & FetchLike;
    expect(
      await resolveApiMode({ kind: 'llm', directConfigured: true, fetchImpl }),
    ).toBe('direct');
  });

  it('reachable but NOT configured and no direct key -> demo', async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request) =>
      jsonResponse({ llm: false, search: false })) as unknown as ReturnType<typeof vi.fn> & FetchLike;
    expect(
      await resolveApiMode({ kind: 'llm', directConfigured: false, fetchImpl }),
    ).toBe('demo');
  });

  it('UNREACHABLE proxy (fetch rejects) falls back: direct / demo', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('down')));
    expect(
      await resolveApiMode({ kind: 'search', directConfigured: true, fetchImpl }),
    ).toBe('direct');
    expect(
      await resolveApiMode({ kind: 'search', directConfigured: false, fetchImpl }),
    ).toBe('demo');
  });

  it('probe timeout aborts into the fallback (never hangs)', async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    expect(
      await resolveApiMode({
        kind: 'llm',
        directConfigured: false,
        fetchImpl,
        probeTimeoutMs: 10,
      }),
    ).toBe('demo');
    expect(PROXY_PROBE_TIMEOUT_MS).toBe(1200);
  });
});

describe('streamChatViaProxy (SSE passthrough)', () => {
  it('parses the passthrough stream exactly like direct Gemini', async () => {
    const sse =
      'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}]}\n\n';
    const fetchImpl = vi.fn((_url: string | URL | Request) =>
      Promise.resolve(
        new Response(sse, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );
    const deltas: string[] = [];
    const full = await streamChatViaProxy({
      baseUrl: 'http://x',
      messages: [{ role: 'user', content: 'hi' }],
      onDelta: (d) => deltas.push(d),
      fetchImpl,
    });
    expect(deltas).toEqual(['Hello', ' world']);
    expect(full).toBe('Hello world');
  });

  it('mid-session 503 -> typed ChatError (no silent fallback loop)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('{"error":"not_configured"}', { status: 503 })),
    );
    await expect(
      streamChatViaProxy({
        baseUrl: 'http://x',
        messages: [{ role: 'user', content: 'hi' }],
        onDelta: () => {},
        fetchImpl,
      }),
    ).rejects.toMatchObject({ name: 'ChatError' });
    try {
      await streamChatViaProxy({
        baseUrl: 'http://x',
        messages: [],
        onDelta: () => {},
        fetchImpl,
      });
    } catch (error) {
      expect(error instanceof ChatError).toBe(true);
    }
  });
});

describe('runSearchViaProxy (JSON passthrough)', () => {
  it('maps the passthrough Google payload with the shared mapper', async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request) =>
      jsonResponse({
        items: [{ title: 't', link: 'https://x', snippet: 's', displayLink: 'x' }],
      }),
    );
    const results = await runSearchViaProxy({
      baseUrl: 'http://x',
      query: 'vision pro',
      fetchImpl,
    });
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('t');
    expect(fetchImpl.mock.calls[0][0]).toContain('q=vision%20pro');
  });

  it('503 -> typed SearchError', async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request) =>
      jsonResponse({ error: 'not_configured' }, 503),
    );
    await expect(
      runSearchViaProxy({ baseUrl: 'http://x', query: 'q', fetchImpl }),
    ).rejects.toMatchObject({ name: 'SearchError' });
    try {
      await runSearchViaProxy({ baseUrl: 'http://x', query: 'q', fetchImpl });
    } catch (error) {
      expect(error instanceof SearchError).toBe(true);
    }
  });
});
