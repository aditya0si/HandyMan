/**
 * M11 JARVIS WebSocket server (TECHNICAL_SPEC §3.1).
 *
 * DEVIATIONS from the spec sketch (documented, D17): JSON parse is guarded
 * (failures -> error message to the SENDER, never a crash); userJoined is
 * broadcast EXCLUDING the new client; the new client first receives a
 * stateSnapshot INCLUDING itself; userId = crypto.randomUUID(); no apiRouter
 * (M13). handSync is throttled per-user with a trailing flush (D9); window
 * upserts broadcast single-window deltas, windowClose broadcasts a snapshot
 * (D8 — the protocol has no removal delta).
 *
 * INTEROP (D2/D3, spiked): this CJS/NodeNext build imports the BUILT ESM
 * dist of @jarvis/shared via require(ESM) — supported on Node 24; TS 6.0.2
 * typechecks named value imports of ESM from CJS without TS1479.
 */
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { RawData } from 'ws';
import type { ClientMessage, Hand, ServerMessage, WindowState } from '@jarvis/shared';
import { SERVER_HANDS_BROADCAST_INTERVAL_MS, WS_PORT } from '@jarvis/shared';
import { StateManager } from '../state/manager';
import { supabase, localSessions } from '../api/auth';
import Redis from 'ioredis';
import { telemetry } from '../utils/telemetry';

export interface JARVISWSServerOptions {
  /** Default WS_PORT (4001); 0 = ephemeral port (tests). */
  port?: number;
  stateManager?: StateManager;
  /** handSync throttle per user (tests inject small values; D9). */
  broadcastIntervalMs?: number;
  /** Redis URL for horizontal scaling pub/sub (optional) */
  redisUrl?: string;
}

export interface JARVISWSServer {
  wss: WebSocketServer;
  /** Bound port (read after 'listening'; tests await it). */
  port(): number;
  userCount(): number;
  /** Terminates clients, clears timers, closes the server (tests: no leaked handles). */
  close(): Promise<void>;
}

function isWindowState(value: unknown): value is WindowState {
  if (typeof value !== 'object' || value === null) return false;
  const w = value as Partial<WindowState>;
  return (
    typeof w.id === 'string' &&
    typeof w.title === 'string' &&
    typeof w.owner === 'string' &&
    Array.isArray(w.position) &&
    w.position.length === 3 &&
    w.position.every((n) => typeof n === 'number') &&
    typeof w.rotationY === 'number' &&
    typeof w.scale === 'number' &&
    typeof w.zIndex === 'number' &&
    typeof w.lastModified === 'number'
  );
}

export function startJARVISWebSocketServer(options: JARVISWSServerOptions = {}): JARVISWSServer {
  const intervalMs = options.broadcastIntervalMs ?? SERVER_HANDS_BROADCAST_INTERVAL_MS;
  const wss = new WebSocketServer({ port: options.port ?? WS_PORT });
  
  interface Room {
    state: StateManager;
    clients: Map<string, WebSocket>;
    latestHands: Map<string, Hand[]>;
    flushTimers: Map<string, ReturnType<typeof setTimeout>>;
    lastBroadcast: Map<string, number>;
  }
  const rooms = new Map<string, Room>();

  const getOrCreateRoom = (workspaceId: string) => {
    if (!rooms.has(workspaceId)) {
      rooms.set(workspaceId, {
        state: new StateManager(),
        clients: new Map(),
        latestHands: new Map(),
        flushTimers: new Map(),
        lastBroadcast: new Map(),
      });
    }
    return rooms.get(workspaceId)!;
  };

  // Redis scaling
  const redisUrl = options.redisUrl || process.env.REDIS_URL;
  let pubClient: Redis | null = null;
  let subClient: Redis | null = null;
  const SERVER_ID = crypto.randomUUID();

  if (redisUrl) {
    pubClient = new Redis(redisUrl);
    subClient = new Redis(redisUrl);
    
    subClient.subscribe('jarvis:broadcast', (err) => {
      if (err) console.error('[backend] Redis subscribe error:', err);
    });

    subClient.on('message', (channel, messageStr) => {
      if (channel === 'jarvis:broadcast') {
        try {
          const { serverId, workspaceId, message, excludeUserId } = JSON.parse(messageStr);
          if (serverId === SERVER_ID) return; // Ignore our own broadcasts
          
          const room = rooms.get(workspaceId);
          if (!room) return;

          // Send to all local clients in the room except the excluded one
          const payload = JSON.stringify(message);
          for (const [uid, ws] of room.clients) {
            if (uid === excludeUserId) continue;
            if (ws.readyState === WebSocket.OPEN) ws.send(payload);
          }
        } catch (e) {
          console.error('[backend] Redis message parse error:', e);
        }
      }
    });
  }

  const send = (ws: WebSocket, message: ServerMessage): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };
  const broadcast = (workspaceId: string, message: ServerMessage, excludeUserId?: string): void => {
    const payload = JSON.stringify(message);
    const room = rooms.get(workspaceId);
    if (room) {
      for (const [uid, ws] of room.clients) {
        if (uid === excludeUserId) continue;
        if (ws.readyState === WebSocket.OPEN) ws.send(payload);
      }
    }
    
    // Distribute via Redis to other nodes
    if (pubClient) {
      pubClient.publish('jarvis:broadcast', JSON.stringify({
        serverId: SERVER_ID,
        workspaceId,
        message,
        excludeUserId,
      })).catch(err => console.error('[backend] Redis publish error:', err));
    }
  };

  const flushHands = (workspaceId: string, userId: string): void => {
    const room = rooms.get(workspaceId);
    if (!room) return;
    const timer = room.flushTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      room.flushTimers.delete(userId);
    }
    const hands = room.latestHands.get(userId);
    if (!hands) return;
    room.latestHands.delete(userId);
    room.lastBroadcast.set(userId, Date.now());
    broadcast(workspaceId, { type: 'handSync', data: { userId, hands } }, userId);
  };
  const broadcastHands = (workspaceId: string, userId: string, hands: Hand[]): void => {
    const room = rooms.get(workspaceId);
    if (!room) return;
    room.latestHands.set(userId, hands);
    const wait = intervalMs - (Date.now() - (room.lastBroadcast.get(userId) ?? 0));
    if (wait <= 0) {
      flushHands(workspaceId, userId);
    } else if (!room.flushTimers.has(userId)) {
      room.flushTimers.set(userId, setTimeout(() => flushHands(workspaceId, userId), wait));
    }
  };

  wss.on('connection', async (ws: WebSocket, req: any) => {
    // Phase 6: Require token verification
    const url = new URL(req.url || '/', 'http://localhost');
    const token = url.searchParams.get('token');
    const workspaceId = url.searchParams.get('workspaceId') || 'default_workspace';
    
    let userId: string = crypto.randomUUID(); // default guest ID
    
    if (token) {
      if (token.startsWith('local_')) {
        const session = localSessions.get(token);
        if (session && session.expiresAt > Date.now()) {
          userId = session.userId;
        } else {
          ws.close(1008, 'Invalid or expired local token');
          return;
        }
      } else if (supabase) {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (!error && user) {
          userId = user.id;
        } else {
          ws.close(1008, 'Invalid or expired Supabase token');
          return;
        }
      }
    } else {
      // In production, require tokens for all connections
      if (process.env.NODE_ENV === 'production') {
        ws.close(1008, 'Token required');
        return;
      }
    }

    const room = getOrCreateRoom(workspaceId);
    room.clients.set(userId, ws);
    room.state.upsertUserHands(userId, []); // presence record (empty hands)
    send(ws, { type: 'stateSnapshot', data: room.state.getFullState() }); // incl. SELF (D17.4)
    broadcast(workspaceId, { type: 'userJoined', data: { userId } }, userId); // EXCLUDING sender (D17.2)

    telemetry.track('ws_connection_established', { userId, workspaceId });

    ws.on('message', (data: RawData) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        send(ws, { type: 'error', data: { message: 'Malformed JSON.' } });
        return;
      }
      if (typeof message !== 'object' || message === null || typeof message.type !== 'string') {
        send(ws, { type: 'error', data: { message: 'Invalid message envelope.' } });
        return;
      }
      switch (message.type) {
        case 'handUpdate': {
          if (!message.data || !Array.isArray(message.data.hands)) {
            send(ws, { type: 'error', data: { message: 'handUpdate requires data.hands[]' } });
            return;
          }
          const quantized = room.state.upsertUserHands(userId, message.data.hands);
          broadcastHands(workspaceId, userId, quantized);
          return;
        }
        case 'windowUpsert': {
          if (!isWindowState(message.data)) {
            send(ws, { type: 'error', data: { message: 'windowUpsert requires a WindowState' } });
            return;
          }
          const stored = room.state.upsertWindow(userId, message.data);
          broadcast(workspaceId, { type: 'windowSync', data: stored }, userId);
          return;
        }
        case 'windowClose': {
          const id = (message.data as { id?: unknown } | undefined)?.id;
          if (typeof id !== 'string') {
            send(ws, { type: 'error', data: { message: 'windowClose requires data.id' } });
            return;
          }
          if (room.state.closeWindow(id)) {
            broadcast(workspaceId, { type: 'stateSnapshot', data: room.state.getFullState() }, userId); // D8
          }
          return;
        }
        case 'presenterSync': {
          if (message.data === null) {
            broadcast(workspaceId, { type: 'presenterSync', data: null }, userId);
          } else {
            const { position, rotation, fov } = message.data as any;
            if (Array.isArray(position) && Array.isArray(rotation) && typeof fov === 'number') {
              broadcast(workspaceId, { type: 'presenterSync', data: { presenterId: userId, position: position as [number, number, number], rotation: rotation as [number, number, number], fov } }, userId);
            }
          }
          return;
        }
        default:
          send(ws, { type: 'error', data: { message: 'Unknown message type.' } });
      }
    });

    ws.on('close', () => {
      room.clients.delete(userId);
      room.latestHands.delete(userId);
      const timer = room.flushTimers.get(userId);
      if (timer) {
        clearTimeout(timer);
        room.flushTimers.delete(userId);
      }
      room.state.removeUser(userId); // windows persist (D7)
      broadcast(workspaceId, { type: 'userLeft', data: { userId } });
      
      // Cleanup empty rooms
      if (room.clients.size === 0) {
        rooms.delete(workspaceId);
      }
      
      telemetry.track('ws_connection_dropped', { userId, workspaceId });
    });

    ws.on('error', () => {
      // The close handler owns cleanup; never crash on socket errors.
    });
  });

  wss.once('listening', () => {
    console.log(`[backend] WebSocket server listening on ws://localhost:${wss.address() !== null ? (wss.address() as { port: number }).port : WS_PORT}`);
  });

  return {
    wss,
    port: () => {
      const address = wss.address();
      return typeof address === 'object' && address !== null ? address.port : WS_PORT;
    },
    userCount: () => {
      let count = 0;
      for (const room of rooms.values()) count += room.clients.size;
      return count;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const room of rooms.values()) {
          for (const timer of room.flushTimers.values()) clearTimeout(timer);
          room.flushTimers.clear();
          for (const ws of room.clients.values()) ws.terminate();
          room.clients.clear();
        }
        rooms.clear();
        
        if (pubClient) pubClient.disconnect();
        if (subClient) subClient.disconnect();
        
        wss.close(() => resolve());
      }),
  };
}
