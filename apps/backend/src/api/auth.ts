import { Router, Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import type { IUserRepository, IWorkspaceRepository, IUsageRepository } from '../state/repository';

export interface AuthDependencies {
  userRepo: IUserRepository;
  workspaceRepo: IWorkspaceRepository;
  usageRepo: IUsageRepository;
}

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';

export const supabase = (supabaseUrl && supabaseKey) 
  ? createClient(supabaseUrl, supabaseKey) 
  : null;

// In-memory sessions fallback for local testing without Supabase
export const localSessions = new Map<string, { userId: string; expiresAt: number }>();

export function createAuthRouter(deps: AuthDependencies): Router {
  const router = Router();

  // Local dev magic link (used ONLY when Supabase is not configured)
  router.post('/local/magic-link', async (req: Request, res: Response) => {
    if (supabase) {
      res.status(400).json({ error: 'Use Supabase for auth' });
      return;
    }
    const { email } = req.body;
    // ... basic mock implementation for local fallback ...
    let user = await deps.userRepo.getUserByEmail(email);
    if (!user) {
      user = await deps.userRepo.createUser({
        email,
        name: email.split('@')[0],
        organizationId: 'org_default',
        defaultWorkspaceId: null,
      });
      await deps.workspaceRepo.createWorkspace({
        name: 'My Workspace',
        ownerId: user.id,
        organizationId: 'org_default',
        windows: [],
      });
    }
    const token = 'local_' + Buffer.from(email).toString('base64');
    localSessions.set(token, { userId: user.id, expiresAt: Date.now() + 86400000 });
    res.json({ token, userId: user.id });
  });

  // Alias for tests expecting /api/auth/magic-link (original Phase 5 contract)
  router.post('/magic-link', async (req: Request, res: Response) => {
    if (supabase) {
      res.status(400).json({ error: 'Use Supabase for auth' });
      return;
    }
    const { email } = req.body;
    let user = await deps.userRepo.getUserByEmail(email);
    if (!user) {
      user = await deps.userRepo.createUser({
        email,
        name: email.split('@')[0],
        organizationId: 'org_default',
        defaultWorkspaceId: null,
      });
      await deps.workspaceRepo.createWorkspace({
        name: 'My Workspace',
        ownerId: user.id,
        organizationId: 'org_default',
        windows: [],
      });
    }
    const token = 'local_' + Buffer.from(email).toString('base64');
    localSessions.set(token, { userId: user.id, expiresAt: Date.now() + 86400000 });
    res.json({ success: true, token, userId: user.id });
  });

  router.get('/me', requireAuthMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const user = await deps.userRepo.getUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'user_not_found' });
      return;
    }
    res.json({ user });
  });

  return router;
}

export function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7);
  }
  return null;
}

/**
 * Middleware to protect routes using Supabase Auth (or local fallback).
 */
export async function requireAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  // Local sessions (including test injection) take precedence
  const localSession = localSessions.get(token);
  if (localSession) {
    if (localSession.expiresAt < Date.now()) {
      res.status(401).json({ error: 'session_expired' });
      return;
    }
    (req as any).userId = localSession.userId;
    return next();
  }

  // Handle local test tokens with prefix check (fallback)
  if (token.startsWith('local_')) {
    const session = localSessions.get(token);
    if (!session || session.expiresAt < Date.now()) {
      res.status(401).json({ error: 'session_expired' });
      return;
    }
    (req as any).userId = session.userId;
    return next();
  }

  // Handle Supabase Auth
  if (supabase) {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      res.status(401).json({ error: 'invalid_token', details: error?.message });
      return;
    }
    (req as any).userId = user.id;
    return next();
  }

  res.status(401).json({ error: 'auth_not_configured' });
}

export async function optionalAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    return next();
  }

  const localSession = localSessions.get(token);
  if (localSession) {
    if (localSession.expiresAt >= Date.now()) {
      (req as any).userId = localSession.userId;
    }
    return next();
  }

  if (token.startsWith('local_')) {
    const session = localSessions.get(token);
    if (session && session.expiresAt >= Date.now()) {
      (req as any).userId = session.userId;
    }
    return next();
  }

  if (supabase) {
    const { data: { user } } = await supabase.auth.getUser(token);
    if (user) {
      (req as any).userId = user.id;
    }
  }
  next();
}
