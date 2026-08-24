import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ServerMessage, WindowState } from '@jarvis/shared';
import { startJARVISWebSocketServer } from './server';
import type { JARVISWSServer } from './server';

const TEST_TIMEOUT_MS = 10_000;
const BROADCAST_INTERVAL_MS = 40;

let server: JARVISWSServer | null = null;
const clients: WebSocket[] = [];

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    clients.push(ws);
    // The pump MUST be installed BEFORE 'open': the server sends the
    // stateSnapshot in the same tick as the handshake completes, so a
    // listener attached after `await open` would drop it.
    installMessagePump(ws);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** Per-socket message queues: resolves the next message of `type`,
 *  buffering everything else for later waits. 5 s internal timeout.
 *  The generic narrows the resolved union arm via the type literal. */
const queues = new Map<WebSocket, ServerMessage[]>();
const waiters = new Map<WebSocket, Map<ServerMessage['type'], Array<(m: ServerMessage) => void>>>();

function nextMessage<T extends ServerMessage['type']>(
  ws: WebSocket,
  type: T,
): Promise<Extract<ServerMessage, { type: T }>> {
  type Narrowed = Extract<ServerMessage, { type: T }>;
  const queue = queues.get(ws) ?? [];
  queues.set(ws, queue);
  const index = queue.findIndex((m) => m.type === type);
  if (index >= 0) {
    const [message] = queue.splice(index, 1);
    return Promise.resolve(message as Narrowed);
  }
  return new Promise<Narrowed>((resolve, reject) => {
    const byType = waiters.get(ws) ?? new Map();
    waiters.set(ws, byType);
    const list = byType.get(type) ?? [];
    byType.set(type, list);
    list.push((message: ServerMessage) => resolve(message as Narrowed));
    const timeout = setTimeout(() => reject(new Error(`nextMessage(${type}) timed out`)), 5000);
    ws.once('close', () => {
      clearTimeout(timeout);
      reject(new Error(`socket closed while waiting for ${type}`));
    });
  });
}

function installMessagePump(ws: WebSocket): void {
  queues.set(ws, []);
  ws.on('message', (data) => {
    let message: ServerMessage;
    try {
      message = JSON.parse(data.toString()) as ServerMessage;
    } catch {
      return;
    }
    const byType = waiters.get(ws);
    const list = byType?.get(message.type);
    const resolve = list?.shift();
    if (resolve) resolve(message);
    else queues.get(ws)?.push(message);
  });
}

function send(ws: WebSocket, payload: unknown): void {
  ws.send(JSON.stringify(payload));
}

function closeWs(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.once('close', resolve);
    ws.close();
  });
}

async function startServer(broadcastIntervalMs = BROADCAST_INTERVAL_MS): Promise<number> {
  server = startJARVISWebSocketServer({ port: 0, broadcastIntervalMs });
  if (server.wss.address()) return server.port();
  return new Promise((resolve) => {
    server!.wss.once('listening', () => resolve(server!.port()));
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const wireWindow = (id = 'notes-2'): WindowState => ({
  id,
  title: 'Notes',
  owner: '',
  position: [1.85, -0.85, 0.2],
  rotationY: 0,
  scale: 1.5,
  zIndex: 5,
  lastModified: 0,
});

const rawHand = (x: number) => ({
  handedness: 'Right',
  landmarks: [
    { x, y: 0.5, z: 0 },
    { x: 0.25, y: 0.25, z: 0 },
  ],
  confidence: 0.9,
});

afterEach(async () => {
  for (const ws of clients) {
    queues.delete(ws);
    waiters.delete(ws);
    try {
      await closeWs(ws);
    } catch {
      // already dead
    }
  }
  clients.length = 0;
  if (server) {
    const closing = server;
    server = null;
    await closing.close();
  }
});

describe('JARVIS WebSocket server (M11 integration)', () => {
  it(
    'join: the first client receives a stateSnapshot that includes itself',
    async () => {
      const port = await startServer();
      const a = await connect(port);
      const snapshot = await nextMessage(a, 'stateSnapshot');
      expect(snapshot.type).toBe('stateSnapshot');
      expect(snapshot.data.users).toHaveLength(1);
      expect(snapshot.data.windows).toHaveLength(0);
      expect(server?.userCount()).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'second join: first client gets userJoined; second client\'s snapshot has both users',
    async () => {
      const port = await startServer();
      const a = await connect(port);
      await nextMessage(a, 'stateSnapshot');
      const b = await connect(port);
      const joined = await nextMessage(a, 'userJoined');
      const snapshotB = await nextMessage(b, 'stateSnapshot');
      expect(joined.type).toBe('userJoined');
      expect(typeof joined.data.userId).toBe('string');
      expect(snapshotB.data.users).toHaveLength(2);
      expect(snapshotB.data.users.map((u) => u.id)).toContain(joined.data.userId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'handUpdate: others receive quantized handSync; the sender receives NOTHING',
    async () => {
      const port = await startServer();
      const a = await connect(port);
      await nextMessage(a, 'stateSnapshot');
      const b = await connect(port);
      await nextMessage(b, 'stateSnapshot');
      const joined = await nextMessage(a, 'userJoined');
      const bId = joined.data.userId;

      send(b, { type: 'handUpdate', data: { hands: [rawHand(0.1234567)] } });
      const sync = await nextMessage(a, 'handSync');
      expect(sync.data.userId).toBe(bId);
      expect(sync.data.hands[0].landmarks[0].x).toBe(0.123);

      // Quiet-window assert: the sender got nothing of its own back.
      await sleep(300);
      expect(queues.get(a)).toEqual([]);
      expect(queues.get(b) ?? []).not.toContainEqual(expect.objectContaining({ type: 'handSync' }));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'handSync throttle: bursts coalesce and the LAST state always lands',
    async () => {
      const port = await startServer();
      const a = await connect(port);
      await nextMessage(a, 'stateSnapshot');
      const b = await connect(port);
      await nextMessage(b, 'stateSnapshot');
      await nextMessage(a, 'userJoined');

      for (let i = 1; i <= 5; i++) {
        send(b, { type: 'handUpdate', data: { hands: [rawHand(i / 10)] } });
        await sleep(10);
      }
      await sleep(500);
      const received = (queues.get(a) ?? []).filter((m) => m.type === 'handSync');
      expect(received.length).toBeLessThan(5);
      expect(received.length).toBeGreaterThanOrEqual(1);
      const last = received[received.length - 1];
      expect(last.data.hands[0].landmarks[0].x).toBe(0.5);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'windowUpsert: others receive windowSync with the SERVER-stamped owner',
    async () => {
      const port = await startServer();
      const a = await connect(port);
      await nextMessage(a, 'stateSnapshot');
      const b = await connect(port);
      await nextMessage(b, 'stateSnapshot');
      const joined = await nextMessage(a, 'userJoined');
      const bId = joined.data.userId;

      send(b, { type: 'windowUpsert', data: wireWindow('notes-2') });
      const sync = await nextMessage(a, 'windowSync');
      expect(sync.type).toBe('windowSync');
      expect(sync.data.id).toBe('notes-2');
      expect(sync.data.owner).toBe(bId);
      expect(sync.data.position).toHaveLength(3);
      expect(typeof sync.data.scale).toBe('number');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'windowClose: others receive a stateSnapshot WITHOUT the window (D8)',
    async () => {
      const port = await startServer();
      const a = await connect(port);
      await nextMessage(a, 'stateSnapshot');
      const b = await connect(port);
      await nextMessage(b, 'stateSnapshot');
      await nextMessage(a, 'userJoined');

      send(b, { type: 'windowUpsert', data: wireWindow('notes-2') });
      await nextMessage(a, 'windowSync');
      send(b, { type: 'windowClose', data: { id: 'notes-2' } });
      const snapshot = await nextMessage(a, 'stateSnapshot');
      expect(snapshot.data.windows.map((w) => w.id)).not.toContain('notes-2');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'malformed JSON: sender gets error, server survives, flows still work',
    async () => {
      const port = await startServer();
      const a = await connect(port);
      await nextMessage(a, 'stateSnapshot');
      const b = await connect(port);
      await nextMessage(b, 'stateSnapshot');
      await nextMessage(a, 'userJoined');

      a.send('not-json{{');
      const error = await nextMessage(a, 'error');
      expect(error.type).toBe('error');
      expect(typeof error.data.message).toBe('string');

      send(a, { type: 'handUpdate', data: { hands: [rawHand(0.5)] } });
      const sync = await nextMessage(b, 'handSync');
      expect(sync.data.userId).not.toBe('');
      expect(server?.userCount()).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'disconnect: remaining client gets userLeft; the departed user\'s windows persist',
    async () => {
      const port = await startServer();
      const a = await connect(port);
      await nextMessage(a, 'stateSnapshot');
      const b = await connect(port);
      await nextMessage(b, 'stateSnapshot');
      const joined = await nextMessage(a, 'userJoined');
      const bId = joined.data.userId;

      send(b, { type: 'windowUpsert', data: wireWindow('notes-2') });
      await nextMessage(a, 'windowSync');
      await closeWs(b);
      const left = await nextMessage(a, 'userLeft');
      expect(left.data.userId).toBe(bId);

      const c = await connect(port);
      const snapshotC = await nextMessage(c, 'stateSnapshot');
      expect(snapshotC.data.windows.map((w) => w.id)).toContain('notes-2');
      expect(snapshotC.data.users.map((u) => u.id)).not.toContain(bId);
    },
    TEST_TIMEOUT_MS,
  );
});
