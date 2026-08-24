import { eq, and, gte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import type { User, Workspace, UsageRecord, WorkspaceMember, WindowState } from '@jarvis/shared';
import type {
  IUserRepository,
  IWorkspaceRepository,
  IWorkspaceMemberRepository,
  IUsageRepository,
} from './repository';

export class PostgresUserRepository implements IUserRepository {
  constructor(private db: NodePgDatabase<typeof schema>) {}

  async getUserByEmail(email: string): Promise<User | null> {
    const rows = await this.db.select().from(schema.users).where(eq(schema.users.email, email));
    if (rows.length === 0) return null;
    return this.mapUser(rows[0]);
  }

  async getUserById(id: string): Promise<User | null> {
    const rows = await this.db.select().from(schema.users).where(eq(schema.users.id, id));
    if (rows.length === 0) return null;
    return this.mapUser(rows[0]);
  }

  async createUser(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    const id = `usr_${Math.random().toString(36).slice(2)}`;
    const rows = await this.db.insert(schema.users).values({
      id,
      email: user.email,
      name: user.name,
      organizationId: user.organizationId,
      defaultWorkspaceId: user.defaultWorkspaceId,
    }).returning();
    return this.mapUser(rows[0]);
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User> {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.email !== undefined) updateData.email = updates.email;
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.organizationId !== undefined) updateData.organizationId = updates.organizationId;
    if (updates.defaultWorkspaceId !== undefined) updateData.defaultWorkspaceId = updates.defaultWorkspaceId;

    const rows = await this.db.update(schema.users)
      .set(updateData)
      .where(eq(schema.users.id, id))
      .returning();
    return this.mapUser(rows[0]);
  }

  private mapUser(row: typeof schema.users.$inferSelect): User {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      organizationId: row.organizationId,
      defaultWorkspaceId: row.defaultWorkspaceId,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    };
  }
}

export class PostgresWorkspaceRepository implements IWorkspaceRepository {
  constructor(private db: NodePgDatabase<typeof schema>) {}

  async getWorkspace(id: string): Promise<Workspace | null> {
    const rows = await this.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id));
    if (rows.length === 0) return null;
    return this.mapWorkspace(rows[0]);
  }

  async listWorkspacesForUser(userId: string): Promise<Workspace[]> {
    const rows = await this.db.select().from(schema.workspaces).where(eq(schema.workspaces.ownerId, userId));
    return rows.map((r) => this.mapWorkspace(r));
  }

  async createWorkspace(workspace: Omit<Workspace, 'id' | 'createdAt' | 'updatedAt'>): Promise<Workspace> {
    const id = `ws_${Math.random().toString(36).slice(2)}`;
    const rows = await this.db.insert(schema.workspaces).values({
      id,
      ownerId: workspace.ownerId,
      organizationId: workspace.organizationId,
      name: workspace.name,
      windows: JSON.stringify(workspace.windows),
    }).returning();
    return this.mapWorkspace(rows[0]);
  }

  async updateWorkspace(id: string, updates: Partial<Workspace>): Promise<Workspace> {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.windows !== undefined) updateData.windows = JSON.stringify(updates.windows);

    const rows = await this.db.update(schema.workspaces)
      .set(updateData)
      .where(eq(schema.workspaces.id, id))
      .returning();
    return this.mapWorkspace(rows[0]);
  }

  async deleteWorkspace(id: string): Promise<void> {
    await this.db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
  }

  private mapWorkspace(row: typeof schema.workspaces.$inferSelect): Workspace {
    return {
      id: row.id,
      ownerId: row.ownerId,
      organizationId: row.organizationId,
      name: row.name,
      windows: (typeof row.windows === 'string' ? JSON.parse(row.windows) : row.windows) as WindowState[],
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    };
  }
}

export class PostgresWorkspaceMemberRepository implements IWorkspaceMemberRepository {
  constructor(private db: NodePgDatabase<typeof schema>) {}

  async addMember(member: WorkspaceMember): Promise<void> {
    await this.db.insert(schema.workspaceMembers)
      .values({
        workspaceId: member.workspaceId,
        userId: member.userId,
        role: member.role,
      })
      .onConflictDoUpdate({
        target: [schema.workspaceMembers.workspaceId, schema.workspaceMembers.userId],
        set: { role: member.role }
      });
  }

  async removeMember(workspaceId: string, userId: string): Promise<void> {
    await this.db.delete(schema.workspaceMembers)
      .where(and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, userId)
      ));
  }

  async getMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const rows = await this.db.select().from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.workspaceId, workspaceId));
    return rows.map(r => ({
      workspaceId: r.workspaceId,
      userId: r.userId,
      role: r.role as WorkspaceMember['role'],
      joinedAt: r.joinedAt.getTime(),
    }));
  }

  async getMember(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
    const rows = await this.db.select().from(schema.workspaceMembers)
      .where(and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, userId)
      ));
    if (rows.length === 0) return null;
    return {
      workspaceId: rows[0].workspaceId,
      userId: rows[0].userId,
      role: rows[0].role as WorkspaceMember['role'],
      joinedAt: rows[0].joinedAt.getTime(),
    };
  }

  async getUserWorkspaces(userId: string): Promise<WorkspaceMember[]> {
    const rows = await this.db.select().from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, userId));
    return rows.map(r => ({
      workspaceId: r.workspaceId,
      userId: r.userId,
      role: r.role as WorkspaceMember['role'],
      joinedAt: r.joinedAt.getTime(),
    }));
  }
}

export class PostgresUsageRepository implements IUsageRepository {
  constructor(private db: NodePgDatabase<typeof schema>) {}

  async recordUsage(usage: Omit<UsageRecord, 'id' | 'timestamp'>): Promise<UsageRecord> {
    const id = `usg_${Math.random().toString(36).slice(2)}`;
    const rows = await this.db.insert(schema.usageRecords).values({
      id,
      organizationId: usage.organizationId,
      userId: usage.userId,
      type: usage.type,
      tokens: usage.tokens || null,
    }).returning();

    return {
      id: rows[0].id,
      organizationId: rows[0].organizationId,
      userId: rows[0].userId,
      type: rows[0].type as UsageRecord['type'],
      tokens: rows[0].tokens || undefined,
      timestamp: rows[0].timestamp.getTime(),
    };
  }

  async getMonthlyUsage(userId: string, type: 'ai_proxy' | 'search_proxy'): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const result = await this.db.select({
      totalTokens: sql<number>`cast(sum(coalesce(${schema.usageRecords.tokens}, 1)) as integer)`
    })
    .from(schema.usageRecords)
    .where(and(
      eq(schema.usageRecords.userId, userId),
      eq(schema.usageRecords.type, type),
      gte(schema.usageRecords.timestamp, startOfMonth)
    ));

    return result[0]?.totalTokens || 0;
  }
}
