import { Router, Request, Response } from 'express';
import { requireAuthMiddleware } from './auth';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import * as schema from '../state/schema';
import { eq, and } from 'drizzle-orm';

const db = process.env.DATABASE_URL ? drizzle(new Client({ connectionString: process.env.DATABASE_URL })) : null;
if (db) (db as any).session.client.connect().catch(() => {});

export function createIntegrationsRouter(): Router {
  const router = Router();

  router.get('/calendar', requireAuthMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    if (!db) {
      res.status(500).json({ error: 'Database not configured' });
      return;
    }

    const rows = await db.select().from(schema.integrationConnections)
      .where(and(eq(schema.integrationConnections.userId, userId), eq(schema.integrationConnections.provider, 'google')));
    
    if (rows.length === 0) {
      res.status(401).json({ error: 'not_connected' });
      return;
    }

    const conn = rows[0];
    
    // In a real app we'd handle token refresh here if it's expired.
    
    try {
      const gcalRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=' + new Date().toISOString() + '&maxResults=10&singleEvents=true&orderBy=startTime', {
        headers: { Authorization: `Bearer ${conn.accessToken}` }
      });
      
      if (!gcalRes.ok) throw new Error('Failed to fetch from Google Calendar');
      
      const data: any = await gcalRes.json();
      const events = (data.items || []).map((item: any) => ({
        id: item.id,
        title: item.summary,
        start: item.start.dateTime || item.start.date,
        end: item.end.dateTime || item.end.date,
        joinUrl: item.hangoutLink || undefined,
      }));
      
      res.json({ events });
    } catch (e) {
      res.status(502).json({ error: 'upstream_error' });
    }
  });

  router.get('/tasks', requireAuthMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    if (!db) {
      res.status(500).json({ error: 'Database not configured' });
      return;
    }

    const rows = await db.select().from(schema.integrationConnections)
      .where(and(eq(schema.integrationConnections.userId, userId), eq(schema.integrationConnections.provider, 'todoist')));
    
    if (rows.length === 0) {
      res.status(401).json({ error: 'not_connected' });
      return;
    }

    const conn = rows[0];
    
    try {
      const todoistRes = await fetch('https://api.todoist.com/rest/v2/tasks', {
        headers: { Authorization: `Bearer ${conn.accessToken}` }
      });
      
      if (!todoistRes.ok) throw new Error('Failed to fetch from Todoist');
      
      const data: any = await todoistRes.json();
      const tasks = (data || []).map((item: any) => ({
        id: item.id,
        title: item.content,
        isOverdue: item.due && new Date(item.due.date) < new Date(),
        isCompleted: item.is_completed,
      }));
      
      res.json({ tasks });
    } catch (e) {
      res.status(502).json({ error: 'upstream_error' });
    }
  });

  return router;
}
