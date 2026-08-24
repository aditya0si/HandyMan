/**
 * JARVIS backend composer (M11 real-time core + M13 persistence/proxy).
 *
 * - Boot: load the persisted workspace file -> PRE-LOAD StateManager
 *   (late joiners receive it in their snapshot, brief D5) -> WS server
 *   -> HTTP app (health + workspace REST + API proxy).
 * - ORDERING (D5, unchanged): the WS server binds BEFORE the HTTP server
 *   listens, so "health responds" implies "WS is listening" — the
 *   frontend's probe gate can never race a half-started backend.
 * - Persistence (D1/D2): every StateManager window mutation fires onChange
 *   -> debounced store save; SIGINT/SIGTERM flushes before exit.
 * - The data file lives at <backend>/data/workspace.json (gitignored;
 *   resolved from __dirname so it works from BOTH src (tsx) and dist).
 */
import http from 'http';
import path from 'node:path';
import { WS_PORT } from '@jarvis/shared';
import { startJARVISWebSocketServer } from './websocket/server';
import { StateManager } from './state/manager';
import { WorkspaceStore } from './state/store';
import { InMemoryUserRepository, InMemoryWorkspaceRepository, InMemoryUsageRepository } from './state/repository';
import { PostgresUserRepository, PostgresWorkspaceRepository, PostgresUsageRepository } from './state/postgresRepository';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import * as schema from './state/schema';
import { createHttpApp } from './api/http';

const DEFAULT_HTTP_PORT = 4000;

const httpPort = Number(process.env.PORT ?? DEFAULT_HTTP_PORT);
const wsPort = Number(process.env.WS_PORT ?? WS_PORT);

const DATA_FILE = path.resolve(__dirname, '..', 'data', 'workspace.json');
const store = new WorkspaceStore(DATA_FILE);
const bootWorkspace = store.load();

const state = new StateManager({
  onChange: () => store.scheduleSave(state.getFullState().windows),
});
state.replaceAllWindows(bootWorkspace.windows); // preload (D5)

// WebSocket first (D5 ordering), then HTTP.
const ws = startJARVISWebSocketServer({ port: wsPort, stateManager: state });

const isTest = process.env.NODE_ENV === 'test';
let userRepo: any;
let workspaceRepo: any;
let usageRepo: any;

// Use Postgres in production/development, fallback to InMemory in test or if no DB URL
if (!isTest && process.env.DATABASE_URL) {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  client.connect().catch((err: unknown) => {
    console.error('[backend] Failed to connect to Postgres:', err);
  });
  const db = drizzle(client, { schema });
  userRepo = new PostgresUserRepository(db);
  workspaceRepo = new PostgresWorkspaceRepository(db);
  usageRepo = new PostgresUsageRepository(db);
} else {
  console.log('[backend] Using InMemory repositories (test mode or no DATABASE_URL)');
  userRepo = new InMemoryUserRepository();
  workspaceRepo = new InMemoryWorkspaceRepository();
  usageRepo = new InMemoryUsageRepository();
}

const app = createHttpApp({
  stateManager: state,
  store,
  wsPort,
  userRepo,
  workspaceRepo,
  usageRepo,
});

const httpServer = http.createServer(app);
httpServer.listen(httpPort, () => {
  console.log(`[backend] HTTP server listening on http://localhost:${httpPort}`);
});

function shutdown(): void {
  console.log('[backend] shutting down...');
  void ws.close().then(() => {
    store.flush(); // persist any debounced-but-unwritten mutation (D1)
    httpServer.close(() => process.exit(0));
  });
  // Force-exit if close callbacks stall (e.g. lingering connections).
  setTimeout(() => {
    store.flush();
    process.exit(0);
  }, 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
