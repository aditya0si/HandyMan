import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { StateManager } from '../state/manager';
import { WorkspaceStore } from '../state/store';
import { InMemoryUserRepository, InMemoryWorkspaceRepository, InMemoryUsageRepository } from '../state/repository';
import { createHttpApp } from './http';
import { LLM_RATE_LIMIT_PER_MINUTE, SEARCH_RATE_LIMIT_PER_MINUTE } from './rate-limiter';

const SSE_BODY =
  'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n' +
  'data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}]}\n\n';

let server: Server;
let base: string;

/** Upstream mock: captures the request, returns a canned Response. */
let upstreamCalls: Array<{ url: string; body?: string }> = [];

function startApp(env: Record<string, string>, upstream: (url: string, body?: string) => Response): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-proxy-'));
  const store = new WorkspaceStore(path.join(dir, 'workspace.json'));
  store.load();
  const userRepo = new InMemoryUserRepository();
  const workspaceRepo = new InMemoryWorkspaceRepository();
  const usageRepo = new InMemoryUsageRepository();

  const app = createHttpApp({
    stateManager: new StateManager(),
    store,
    wsPort: 4321,
    env,
    now: () => FAKE_NOW,
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      const urlText = String(url);
      const bodyText = typeof init?.body === 'string' ? init.body : undefined;
      upstreamCalls.push({ url: urlText, body: bodyText });
      return upstream(urlText, bodyText);
    }) as typeof fetch,
    userRepo,
    workspaceRepo,
    usageRepo,
  });
  server = app.listen(0);
  return new Promise<void>((resolve) =>
    server.once('listening', () => {
      const address = server.address();
      base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
      resolve();
    }),
  );
}

const FAKE_NOW = 1_000_000;

async function stopApp(): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

afterAll(async () => {
  await stopApp();
});

describe('API proxy without keys (M13 D6/D8)', () => {
  beforeAll(async () => {
    upstreamCalls = [];
    await startApp({}, () => new Response('unused', { status: 200 }));
  });

  it('status reports both services not configured', async () => {
    const res = await fetch(`${base}/api/proxy/status`);
    expect(await res.json()).toEqual({ llm: false, search: false });
  });

  it('POST /api/proxy/llm without a key -> 503 not_configured (typed, no upstream call)', async () => {
    const res = await fetch(`${base}/api/proxy/llm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'not_configured' });
    expect(upstreamCalls).toHaveLength(0);
  });

  it('GET /api/proxy/search without keys -> 503 not_configured', async () => {
    const res = await fetch(`${base}/api/proxy/search?q=x`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'not_configured' });
  });

  it('status with keys reports both configured', async () => {
    await stopApp();
    upstreamCalls = [];
    await startApp(
      { geminiApiKey: 'k1', googleSearchApiKey: 's1', googleSearchCx: 'c1' },
      () => new Response('unused', { status: 200 }),
    );
    const res = await fetch(`${base}/api/proxy/status`);
    expect(await res.json()).toEqual({ llm: true, search: true });
  });
});

describe('API proxy with mocked upstreams (M13 D6)', () => {
  beforeAll(async () => {
    await stopApp();
    upstreamCalls = [];
    await startApp(
      { geminiApiKey: 'k1', googleSearchApiKey: 's1', googleSearchCx: 'c1' },
      (url) => {
        if (url.includes('streamGenerateContent')) {
          return new Response(SSE_BODY, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          });
        }
        if (url.includes('customsearch')) {
          return new Response('{"items":[{"title":"t"}]}', {
            status: 200,
            headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          });
        }
        return new Response('unexpected', { status: 500 });
      },
    );
  });

  it('llm: SSE bytes pass through UNCHANGED; the key stays server-side', async () => {
    const res = await fetch(`${base}/api/proxy/llm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(await res.text()).toBe(SSE_BODY);
    // The upstream URL carries the SERVER key; the browser never sees it.
    expect(upstreamCalls[0].url).toContain('key=k1');
    expect(upstreamCalls[0].body).toContain('"role":"user"');
  });

  it('llm: upstream non-OK -> 502 upstream_error with the upstream status', async () => {
    await stopApp();
    upstreamCalls = [];
    await startApp(
      { geminiApiKey: 'k1' },
      () => new Response('quota', { status: 429 }),
    );
    const res = await fetch(`${base}/api/proxy/llm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream_error', status: 429 });
  });

  it('llm: invalid body -> 400 invalid_body', async () => {
    const res = await fetch(`${base}/api/proxy/llm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: 'nope' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_body' });
  });

  it('search: upstream JSON body + status pass through; q is encoded', async () => {
    await stopApp();
    upstreamCalls = [];
    await startApp(
      { googleSearchApiKey: 's1', googleSearchCx: 'c1' },
      () =>
        new Response('{"items":[]}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const res = await fetch(`${base}/api/proxy/search?q=vision pro`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"items":[]}');
    expect(upstreamCalls[0].url).toContain('q=vision%20pro');
    expect(upstreamCalls[0].url).toContain('cx=c1');
  });

  it('rate limits: LLM bursts to 10 then 429 + Retry-After; SEARCH to 30', async () => {
    await stopApp();
    upstreamCalls = [];
    await startApp(
      { geminiApiKey: 'k1', googleSearchApiKey: 's1', googleSearchCx: 'c1' },
      () => new Response('{}', { status: 200 }),
    );
    const post = () =>
      fetch(`${base}/api/proxy/llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }),
      });
    let last = 0;
    for (let i = 0; i < LLM_RATE_LIMIT_PER_MINUTE; i += 1) {
      last = (await post()).status;
    }
    expect(last).toBe(200);
    const limited = await post();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(await limited.json()).toEqual({ error: 'rate_limited' });

    const get = () => fetch(`${base}/api/proxy/search?q=x`);
    let lastSearch = 0;
    for (let i = 0; i < SEARCH_RATE_LIMIT_PER_MINUTE; i += 1) {
      lastSearch = (await get()).status;
    }
    expect(lastSearch).toBe(200);
    expect((await get()).status).toBe(429);
  });
});
