import { describe, expect, it } from 'vitest';
import {
  InMemoryUserRepository,
  InMemoryWorkspaceRepository,
  InMemoryUsageRepository,
} from './repository';
import { importJsonWorkspace } from './migrations';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

describe('Repository Layer', () => {
  describe('UserRepository', () => {
    it('creates and updates users', async () => {
      const repo = new InMemoryUserRepository();
      const user = await repo.createUser({
        email: 'test@example.com',
        name: 'Test User',
        organizationId: 'org_1',
        defaultWorkspaceId: null,
      });

      expect(user.id).toBeDefined();
      expect(user.email).toBe('test@example.com');

      const updated = await repo.updateUser(user.id, { name: 'Updated Name' });
      expect(updated.name).toBe('Updated Name');

      const fetched = await repo.getUserByEmail('test@example.com');
      expect(fetched?.name).toBe('Updated Name');
    });
  });

  describe('WorkspaceRepository', () => {
    it('creates, lists, and isolates workspaces by owner', async () => {
      const repo = new InMemoryWorkspaceRepository();
      
      const ws1 = await repo.createWorkspace({
        name: 'WS 1',
        ownerId: 'user_A',
        organizationId: 'org_1',
        windows: [],
      });
      await repo.createWorkspace({
        name: 'WS 2',
        ownerId: 'user_B',
        organizationId: 'org_1',
        windows: [],
      });

      const userAWorkspaces = await repo.listWorkspacesForUser('user_A');
      expect(userAWorkspaces.length).toBe(1);
      expect(userAWorkspaces[0].id).toBe(ws1.id);
    });
  });

  describe('UsageRepository', () => {
    it('tracks and aggregates monthly usage', async () => {
      const repo = new InMemoryUsageRepository();
      await repo.recordUsage({
        userId: 'user_1',
        organizationId: 'org_1',
        type: 'ai_proxy',
        tokens: 5,
      });
      await repo.recordUsage({
        userId: 'user_1',
        organizationId: 'org_1',
        type: 'ai_proxy',
        tokens: 15,
      });

      const total = await repo.getMonthlyUsage('user_1', 'ai_proxy');
      expect(total).toBe(20);
    });
  });

  describe('Migrations', () => {
    it('imports legacy workspace.json', async () => {
      const userRepo = new InMemoryUserRepository();
      const wsRepo = new InMemoryWorkspaceRepository();

      const user = await userRepo.createUser({
        email: 'migrate@example.com',
        name: 'Migrate User',
        organizationId: 'org_1',
        defaultWorkspaceId: null,
      });

      const tempDir = await fs.mkdtemp('test-migration-');
      const tempFile = path.join(tempDir, 'workspace.json');
      await fs.writeFile(tempFile, JSON.stringify({
        version: 1,
        windows: [{ id: 'win_1', app: 'chat', state: 'active', x: 0, y: 0, z: 0 }],
      }));

      await importJsonWorkspace(tempFile, user.id, userRepo, wsRepo);

      const workspaces = await wsRepo.listWorkspacesForUser(user.id);
      expect(workspaces.length).toBe(1);
      expect(workspaces[0].name).toBe('Imported Local Workspace');
      expect(workspaces[0].windows.length).toBe(1);
      expect(workspaces[0].windows[0].id).toBe('win_1');

      // Check user default updated
      const updatedUser = await userRepo.getUserById(user.id);
      expect(updatedUser?.defaultWorkspaceId).toBe(workspaces[0].id);

      // Check file was renamed
      const stat = await fs.stat(`${tempFile}.migrated.bak`).catch(() => null);
      expect(stat).not.toBeNull();
    });
  });
});
