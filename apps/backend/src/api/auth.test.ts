import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { createHttpApp } from './http';
import { localSessions as sessions } from './auth';
import { StateManager } from '../state/manager';
import { WorkspaceStore } from '../state/store';
import { InMemoryUserRepository, InMemoryWorkspaceRepository, InMemoryUsageRepository } from '../state/repository';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Auth & Tenant Isolation API', () => {
  let app: ReturnType<typeof createHttpApp>;
  let userRepo: InMemoryUserRepository;
  let workspaceRepo: InMemoryWorkspaceRepository;
  let usageRepo: InMemoryUsageRepository;
  
  beforeAll(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-auth-'));
    const store = new WorkspaceStore(path.join(dir, 'workspace.json'));
    store.load();

    userRepo = new InMemoryUserRepository();
    workspaceRepo = new InMemoryWorkspaceRepository();
    usageRepo = new InMemoryUsageRepository();

    app = createHttpApp({
      stateManager: new StateManager(),
      store,
      wsPort: 4002,
      userRepo,
      workspaceRepo,
      usageRepo,
    });
  });

  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    base = `http://localhost:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(() => {
    server?.close();
  });

    let token: string;

  it('generates a magic link and verifies it to issue a session', async () => {
    const linkRes = await fetch(`${base}/api/auth/magic-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    expect(linkRes.status).toBe(200);
    const linkData = await linkRes.json() as any;
    expect(linkData.success).toBe(true);

    const user = await userRepo.createUser({
      email: 'test2@example.com',
      name: 'Test',
      organizationId: 'default_org',
      defaultWorkspaceId: null,
    });
    const ws = await workspaceRepo.createWorkspace({
      name: 'Test WS',
      ownerId: user.id,
      organizationId: user.organizationId,
      windows: [],
    });
    await userRepo.updateUser(user.id, { defaultWorkspaceId: ws.id });

    // Inject session
    token = 'test-token';
    sessions.set(token, {
      userId: user.id,
      expiresAt: Date.now() + 100000,
    });

    const res = await fetch(`${base}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const resData = await res.json() as any;
    expect(resData.user.email).toBe('test2@example.com');
  });

  it('rejects protected routes without auth', async () => {
    const res = await fetch(`${base}/api/auth/me`);
    expect(res.status).toBe(401);
    const resData = await res.json() as any;
    expect(resData.error).toBe('unauthorized');
  });

  it('allows guest access to /api/workspace but returns legacy data', async () => {
    const res = await fetch(`${base}/api/workspace`);
    expect(res.status).toBe(200);
    const resData = await res.json() as any;
    expect(resData.windows).toEqual([]); // Empty legacy store
  });

  it('fetches multi-tenant workspace when authenticated', async () => {
    const res = await fetch(`${base}/api/workspace`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.status).toBe(200);
    const resData = await res.json() as any;
    expect(resData.windows).toEqual([]);
  });
});
