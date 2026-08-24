/**
 * SaaS Identity, Billing, and Core Data Models
 */

// --- Plan & Entitlements ---
export type PlanTier = 'free' | 'pro' | 'team';

export interface Entitlements {
  maxWorkspaces: number;
  maxMonthlyAiProxy: number;
  maxMonthlySearchProxy: number;
  features: string[]; // e.g. 'cloud_sync', 'custom_models'
}

export const PLAN_ENTITLEMENTS: Record<PlanTier, Entitlements> = {
  free: {
    maxWorkspaces: 1,
    maxMonthlyAiProxy: 100, // 100 calls per month
    maxMonthlySearchProxy: 100,
    features: [], // local demo mode mostly
  },
  pro: {
    maxWorkspaces: 10,
    maxMonthlyAiProxy: 5000,
    maxMonthlySearchProxy: 5000,
    features: ['cloud_sync'],
  },
  team: {
    maxWorkspaces: 100,
    maxMonthlyAiProxy: 50000,
    maxMonthlySearchProxy: 50000,
    features: ['cloud_sync', 'collaboration', 'admin_controls'],
  },
};

// --- Identity & Organizations ---
export interface Organization {
  id: string;
  name: string;
  createdAt: number;
  tier: PlanTier;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  createdAt: number;
  updatedAt: number;
  organizationId: string; // References the personal/team org that holds the billing plan
  defaultWorkspaceId: string | null;
}

// --- Auth DTOs ---
export interface MagicLinkRequest {
  email: string;
}

export interface MagicLinkResponse {
  success: boolean;
  message: string;
}

export interface AuthSession {
  token: string;
  userId: string;
  expiresAt: number;
}

// --- Usage Accounting ---
export interface UsageRecord {
  id: string;
  organizationId: string;
  userId: string;
  type: 'ai_proxy' | 'search_proxy';
  tokens?: number; // Optional token count for AI
  timestamp: number;
}

// --- Persistent Models (Database Equivalents) ---
// Note: We use WindowState for the actual layout which is defined in types.ts.
import type { WindowState } from './types';

export interface Workspace {
  id: string;
  ownerId: string; // Refers to User.id (for now, before team collaboration)
  organizationId: string; // The org this workspace belongs to
  name: string;
  createdAt: number;
  updatedAt: number;
  windows: WindowState[];
}

export type Role = 'OWNER' | 'EDITOR' | 'VIEWER';

export interface WorkspaceMember {
  userId: string;
  workspaceId: string;
  role: Role;
  joinedAt: number;
}

export interface IntegrationConnection {
  id: string;
  userId: string;
  provider: 'calendar' | 'tasks' | 'music' | 'links';
  accessToken: string; // Encrypted at rest
  refreshToken: string; // Encrypted at rest
  expiresAt: number;
  createdAt: number;
}

export interface Preference {
  id: string;
  userId: string;
  key: string;
  value: string; // JSON encoded value
}
