// Migrations.ts
import { WORKSPACE_VERSION, WorkspaceData } from './store';
import type { IWorkspaceRepository, IUserRepository } from './repository';

/**
 * Migration helper to import legacy single-tenant workspace.json data
 * into the new multi-tenant SaaS repository layer.
 */
export async function importJsonWorkspace(
  workspaceFilePath: string,
  targetUserId: string,
  userRepo: IUserRepository,
  workspaceRepo: IWorkspaceRepository
): Promise<void> {
  // 1. Verify user exists
  const user = await userRepo.getUserById(targetUserId);
  if (!user) {
    throw new Error(`Migration failed: Target user ${targetUserId} not found.`);
  }

  // 2. Load legacy JSON
  let raw: string;
  try {
    const fs = await import('node:fs/promises');
    raw = await fs.readFile(workspaceFilePath, 'utf-8');
  } catch (error) {
    // If the file doesn't exist, there is nothing to migrate
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }

  const parsed = JSON.parse(raw) as Partial<WorkspaceData>;
  if (!parsed || parsed.version !== WORKSPACE_VERSION || !Array.isArray(parsed.windows)) {
    throw new Error('Migration failed: Invalid workspace.json shape.');
  }

  // 3. Import windows into a new workspace for the user
  const newWorkspace = await workspaceRepo.createWorkspace({
    name: 'Imported Local Workspace',
    ownerId: user.id,
    organizationId: user.organizationId,
    windows: parsed.windows,
  });

  // 4. Update the user's default workspace if they don't have one
  if (!user.defaultWorkspaceId) {
    await userRepo.updateUser(user.id, { defaultWorkspaceId: newWorkspace.id });
  }

  // 5. Rename legacy file to prevent re-importing
  try {
    const fs = await import('node:fs/promises');
    await fs.rename(workspaceFilePath, `${workspaceFilePath}.migrated.bak`);
  } catch (error) {
    console.warn(`[migration] Failed to backup legacy workspace file:`, error);
  }
}
