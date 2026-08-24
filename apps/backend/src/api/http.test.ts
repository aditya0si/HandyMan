import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { WindowState } from '@jarvis/shared';
import { StateManager } from '../state/manager';
import { WorkspaceStore } from '../state/store';
import { InMemoryUserRepository, InMemoryWorkspaceRepository, InMemoryUsageRepository } from '../state/repository';
import { createHttpApp } from './http';

function win(id: string): WindowState {
  return {
    id,
    title: `T-${id}`,
    owner: 'user-a',
    position: [0, 0, 0],
    rotationY: 0,
    scale: 1.5,
    zIndex: 1,
    lastModified: 1,
  };
}

let server: Server;
let base: string;

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-http-'));
  const store = new WorkspaceStore(path.join(dir, 'workspace.json'));
  store.load();
  const state = new StateManager();
  const userRepo = new InMemoryUserRepository();
  const workspaceRepo = new InMemoryWorkspaceRepository();
  const usageRepo = new InMemoryUsageRepository();

  const app = createHttpApp({
    stateManager: state,
    store,
    wsPort: 4321,
    userRepo,
    workspaceRepo,
    usageRepo,
  });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('HTTP workspace + health + CORS (M13 D3/D4/D10)', () => {
  it('health returns the exact M11 shape with the composed wsPort', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', wsPort: 4321 });
  });

  it('PUT valid workspace -> {ok,count}; GET returns the same windows', async () => {
    const put = await fetch(`${base}/api/workspace`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ windows: [win('a'), win('b')] }),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ ok: true, count: 2 });
    const get = await fetch(`${base}/api/workspace`);
    const body = (await get.json()) as { windows: WindowState[] };
    expect(body.windows.map((w) => w.id)).toEqual(['a', 'b']);
  });

  it('PUT invalid window shape -> 400 invalid_workspace; bad JSON -> 400 invalid_json', async () => {
    const badShape = await fetch(`${base}/api/workspace`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ windows: [{ id: 'x' }] }),
    });
    expect(badShape.status).toBe(400);
    expect(await badShape.json()).toEqual({ error: 'invalid_workspace' });

    const badJson = await fetch(`${base}/api/workspace`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{oops',
    });
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toEqual({ error: 'invalid_json' });
  });

  it('unknown /api route -> JSON 404', async () => {
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('CORS: preflight from the Vite origin -> 204 + ACAO; foreign origin gets none', async () => {
    const pre = await fetch(`${base}/api/workspace`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe(
      'http://localhost:5173',
    );
    // The preview origin (M14 production-build verifier) is allowed too.
    const prePreview = await fetch(`${base}/api/workspace`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:4173' },
    });
    expect(prePreview.status).toBe(204);
    expect(prePreview.headers.get('access-control-allow-origin')).toBe(
      'http://localhost:4173',
    );

    const foreign = await fetch(`${base}/api/health`, {
      headers: { Origin: 'http://evil.example' },
    });
    expect(foreign.status).toBe(200);
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('GET /api/news returns live tech news items with real structure and images', async () => {
    const res = await fetch(`${base}/api/news`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; articles: Array<Record<string, unknown>> };
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.articles)).toBe(true);
    expect(data.articles.length).toBeGreaterThanOrEqual(1);

    const first = data.articles[0];
    expect(first.title).toBeDefined();
    expect(first.source).toBeDefined();
    expect(first.url).toMatch(/^https?:\/\//);
    expect(first.imageUrl).toMatch(/^https?:\/\//);
    expect(first.badgeColor).toBeDefined();
  });
});
