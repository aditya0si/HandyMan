import { describe, expect, it, vi } from 'vitest';
import type { WindowState } from '@jarvis/shared';
import { WorkspaceError, loadWorkspace, saveWorkspace } from './workspace';

const BASE = 'http://localhost:4000';

function win(id: string): WindowState {
  return {
    id,
    title: `T-${id}`,
    owner: '',
    position: [0, 0, 0],
    rotationY: 0,
    scale: 1.5,
    zIndex: 1,
    lastModified: 1,
  };
}

describe('saveWorkspace (M13 D13)', () => {
  it('PUTs {windows} to /api/workspace and resolves the confirmed count', async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request) =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true, count: 2 }), { status: 200 }),
        ),
    );
    const count = await saveWorkspace(BASE, [win('a'), win('b')], fetchImpl);
    expect(count).toBe(2);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/workspace`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({
      windows: [win('a'), win('b')],
    });
  });

  it('400 -> typed WorkspaceError(invalid)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('{"error":"invalid_workspace"}', { status: 400 })),
    );
    await expect(saveWorkspace(BASE, [], fetchImpl)).rejects.toMatchObject({
      name: 'WorkspaceError',
      kind: 'invalid',
    });
  });

  it('network rejection -> typed WorkspaceError(network)', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('down')));
    await expect(saveWorkspace(BASE, [], fetchImpl)).rejects.toMatchObject({
      name: 'WorkspaceError',
      kind: 'network',
    });
  });
});

describe('loadWorkspace (M13 D13)', () => {
  it('GETs and returns the windows array', async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request) =>
        Promise.resolve(
          new Response(JSON.stringify({ windows: [win('x')] }), { status: 200 }),
        ),
    );
    const windows = await loadWorkspace(BASE, fetchImpl);
    expect(windows).toEqual([win('x')]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/workspace`);
    expect(init.method).toBe('GET');
  });

  it('non-array body -> typed WorkspaceError(invalid)', async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request) =>
      jsonResponse({ nope: true }),
    );
    function jsonResponse(body: unknown): Promise<Response> {
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }
    await expect(loadWorkspace(BASE, fetchImpl)).rejects.toMatchObject({
      name: 'WorkspaceError',
      kind: 'invalid',
    });
    // instanceof shape check for the docs-guard.
    try {
      await loadWorkspace(BASE, fetchImpl);
    } catch (error) {
      expect(error instanceof WorkspaceError).toBe(true);
    }
  });
});
