import type { User, Workspace, UsageRecord, WorkspaceMember } from '@jarvis/shared';

// --- Repository Interfaces ---

export interface IUserRepository {
  getUserByEmail(email: string): Promise<User | null>;
  getUserById(id: string): Promise<User | null>;
  createUser(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User>;
  updateUser(id: string, updates: Partial<User>): Promise<User>;
}

export interface IWorkspaceRepository {
  getWorkspace(id: string): Promise<Workspace | null>;
  listWorkspacesForUser(userId: string): Promise<Workspace[]>;
  createWorkspace(workspace: Omit<Workspace, 'id' | 'createdAt' | 'updatedAt'>): Promise<Workspace>;
  updateWorkspace(id: string, updates: Partial<Workspace>): Promise<Workspace>;
  deleteWorkspace(id: string): Promise<void>;
}

export interface IWorkspaceMemberRepository {
  addMember(member: WorkspaceMember): Promise<void>;
  removeMember(workspaceId: string, userId: string): Promise<void>;
  getMembers(workspaceId: string): Promise<WorkspaceMember[]>;
  getMember(workspaceId: string, userId: string): Promise<WorkspaceMember | null>;
  getUserWorkspaces(userId: string): Promise<WorkspaceMember[]>;
}

export interface IUsageRepository {
  recordUsage(usage: Omit<UsageRecord, 'id' | 'timestamp'>): Promise<UsageRecord>;
  getMonthlyUsage(userId: string, type: 'ai_proxy' | 'search_proxy'): Promise<number>;
}

// --- In-Memory Implementations (For Local / Demo / Phase 5 Stand-in) ---

export class InMemoryUserRepository implements IUserRepository {
  private users: Map<string, User> = new Map();

  async getUserByEmail(email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.email === email) return user;
    }
    return null;
  }

  async getUserById(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  async createUser(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    const id = `usr_${Math.random().toString(36).slice(2)}`;
    const now = Date.now();
    const newUser: User = { ...user, id, createdAt: now, updatedAt: now };
    this.users.set(id, newUser);
    return newUser;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User> {
    const user = await this.getUserById(id);
    if (!user) throw new Error(`User ${id} not found`);
    const updated = { ...user, ...updates, updatedAt: Date.now() };
    this.users.set(id, updated);
    return updated;
  }
}

export class InMemoryWorkspaceRepository implements IWorkspaceRepository {
  private workspaces: Map<string, Workspace> = new Map();

  async getWorkspace(id: string): Promise<Workspace | null> {
    return this.workspaces.get(id) || null;
  }

  async listWorkspacesForUser(userId: string): Promise<Workspace[]> {
    const results: Workspace[] = [];
    for (const ws of this.workspaces.values()) {
      if (ws.ownerId === userId) results.push(ws);
    }
    return results;
  }

  async createWorkspace(workspace: Omit<Workspace, 'id' | 'createdAt' | 'updatedAt'>): Promise<Workspace> {
    const id = `ws_${Math.random().toString(36).slice(2)}`;
    const now = Date.now();
    const newWs: Workspace = { ...workspace, id, createdAt: now, updatedAt: now };
    this.workspaces.set(id, newWs);
    return newWs;
  }

  async updateWorkspace(id: string, updates: Partial<Workspace>): Promise<Workspace> {
    const ws = await this.getWorkspace(id);
    if (!ws) throw new Error(`Workspace ${id} not found`);
    const updated = { ...ws, ...updates, updatedAt: Date.now() };
    this.workspaces.set(id, updated);
    return updated;
  }

  async deleteWorkspace(id: string): Promise<void> {
    this.workspaces.delete(id);
  }
}

export class InMemoryUsageRepository implements IUsageRepository {
  private records: UsageRecord[] = [];

  async recordUsage(usage: Omit<UsageRecord, 'id' | 'timestamp'>): Promise<UsageRecord> {
    const record: UsageRecord = {
      ...usage,
      id: `usg_${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
    };
    this.records.push(record);
    return record;
  }

  async getMonthlyUsage(userId: string, type: 'ai_proxy' | 'search_proxy'): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const startTs = startOfMonth.getTime();

    let total = 0;
    for (const r of this.records) {
      if (r.userId === userId && r.type === type && r.timestamp >= startTs) {
        total += r.tokens || 1; // Count calls if tokens aren't specified
      }
    }
    return total;
  }
}

export class InMemoryWorkspaceMemberRepository implements IWorkspaceMemberRepository {
  private members: WorkspaceMember[] = [];

  async addMember(member: WorkspaceMember): Promise<void> {
    // Remove if exists to prevent duplicates
    this.members = this.members.filter(m => !(m.workspaceId === member.workspaceId && m.userId === member.userId));
    this.members.push(member);
  }

  async removeMember(workspaceId: string, userId: string): Promise<void> {
    this.members = this.members.filter(m => !(m.workspaceId === workspaceId && m.userId === userId));
  }

  async getMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    return this.members.filter(m => m.workspaceId === workspaceId);
  }

  async getMember(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
    return this.members.find(m => m.workspaceId === workspaceId && m.userId === userId) || null;
  }

  async getUserWorkspaces(userId: string): Promise<WorkspaceMember[]> {
    return this.members.filter(m => m.userId === userId);
  }
}
