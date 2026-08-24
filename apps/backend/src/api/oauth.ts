import { Router, Request, Response } from 'express';
import { requireAuthMiddleware } from './auth';
import crypto from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import * as schema from '../state/schema';
import { eq } from 'drizzle-orm';

// Setup DB connection for integrations (ideally injected, but for brevity)
const db = process.env.DATABASE_URL ? drizzle(new Client({ connectionString: process.env.DATABASE_URL })) : null;
if (db) (db as any).session.client.connect().catch(() => {});

export const OAUTH_CONFIG = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  },
  todoist: {
    clientId: process.env.TODOIST_CLIENT_ID || '',
    clientSecret: process.env.TODOIST_CLIENT_SECRET || '',
    authUrl: 'https://todoist.com/oauth/authorize',
    tokenUrl: 'https://todoist.com/oauth/access_token',
    scopes: ['data:read'],
  }
};

const pkceChallenges = new Map<string, { codeVerifier: string; userId: string; provider: string }>();

export function createOAuthRouter(): Router {
  const router = Router();

  router.get('/connect/:provider', requireAuthMiddleware, (req: Request, res: Response) => {
    const provider = req.params.provider as keyof typeof OAUTH_CONFIG;
    const config = OAUTH_CONFIG[provider];
    const userId = (req as any).userId;

    if (!config) {
      res.status(400).json({ error: 'invalid_provider' });
      return;
    }

    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    pkceChallenges.set(state, { codeVerifier, userId, provider });

    const redirectUri = `${process.env.PUBLIC_URL || 'http://localhost:3000'}/api/oauth/callback/${provider}`;
    
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: config.scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent'
    });

    res.json({ url: `${config.authUrl}?${params.toString()}` });
  });

  router.get('/callback/:provider', async (req: Request, res: Response) => {
    const provider = req.params.provider as keyof typeof OAUTH_CONFIG;
    const config = OAUTH_CONFIG[provider];
    const { code, state } = req.query;

    if (!config || typeof code !== 'string' || typeof state !== 'string') {
      res.status(400).send('Invalid request');
      return;
    }

    const challenge = pkceChallenges.get(state);
    if (!challenge || challenge.provider !== provider) {
      res.status(400).send('Invalid or expired state');
      return;
    }

    pkceChallenges.delete(state);
    const redirectUri = `${process.env.PUBLIC_URL || 'http://localhost:3000'}/api/oauth/callback/${provider}`;

    try {
      const tokenRes = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          code_verifier: challenge.codeVerifier,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        })
      });

      const tokenData: any = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(tokenData.error || 'Failed to fetch token');

      // Save to database
      if (db) {
        await db.insert(schema.integrationConnections).values({
          id: crypto.randomUUID(),
          userId: challenge.userId,
          provider,
          providerAccountId: 'unknown', // Typically fetched from a userinfo endpoint
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token || null,
          expiresAt: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null,
          scopes: config.scopes,
        }).onConflictDoUpdate({
          target: [schema.integrationConnections.id], // In a real app we'd upsert by userId + provider
          set: {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token || null,
            updatedAt: new Date()
          }
        });
      }

      // Redirect back to app
      res.redirect(`/?integration_connected=${provider}`);
    } catch (e) {
      console.error('[oauth] Failed token exchange:', e);
      res.redirect(`/?integration_error=${provider}`);
    }
  });

  router.get('/connections', requireAuthMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    if (!db) return res.json({ connections: [] });
    
    const rows = await db.select({ provider: schema.integrationConnections.provider })
      .from(schema.integrationConnections)
      .where(eq(schema.integrationConnections.userId, userId));
      
    res.json({ connections: rows.map(r => r.provider) });
  });

  return router;
}
