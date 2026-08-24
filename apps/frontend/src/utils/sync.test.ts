import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hand } from '@jarvis/shared';
import type { ServerMessage } from '@jarvis/shared';
import {
  DEFAULT_SYNC_URL,
  SYNC_INITIAL_BACKOFF_MS,
  SYNC_MAX_BACKOFF_MS,
  SYNC_MAX_RECONNECT_ATTEMPTS,
  SYNC_PROBE_TIMEOUT_MS,
  SyncManager,
  createWindowSyncBridge,
  deriveHealthUrl,
  toWindowState,
} from './sync';
import type { SyncWindowLike, WebSocketFactory, WebSocketLike } from './sync';

/** Fake socket: records sends, exposes the on* property surface. */
class FakeSocket implements WebSocketLike {
  sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  closed = false;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  sentMessages(): unknown[] {
    return this.sent.map((raw) => JSON.parse(raw));
  }

  simulateOpen(): void {
    this.onopen?.({});
  }

  simulateMessage(message: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  simulateClose(): void {
    this.onclose?.({});
  }
}

const hand = (x = 0.123456): Hand => ({
  handedness: 'Right',
  landmarks: [
    { x, y: 0.5, z: 0 },
    { x: 0.25, y: 0.25, z: 0 },
  ],
  confidence: 0.9,
});

/** Rejects the first `failures` calls with TypeError, then resolves opaque-like. */
function failingFetch(failures: number): typeof fetch & { calls: () => number } {
  let calls = 0;
  const impl = (() => {
    calls += 1;
    return calls <= failures
      ? Promise.reject(new TypeError('backend down'))
      : Promise.resolve({} as Response);
  }) as unknown as typeof fetch & { calls: () => number };
  impl.calls = () => calls;
  return impl;
}

/** Never settles UNLESS the signal aborts (the probe timeout path). */
function hangingFetch(): typeof fetch & { calls: () => number } {
  let calls = 0;
  const impl = ((_url: unknown, init?: { signal?: AbortSignal }) =>
    new Promise<Response>((_resolve, reject) => {
      calls += 1;
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
    })) as unknown as typeof fetch & { calls: () => number };
  impl.calls = () => calls;
  return impl;
}

const managerWindow = (
  id: string,
  position: { x: number; y: number; z: number },
  overrides: Partial<SyncWindowLike> = {},
): SyncWindowLike => ({
  id,
  title: 'Notes',
  position,
  scale: { x: 1.5, y: 1.5 * (9 / 16), z: 1 },
  rotation: { y: 0 },
  zIndex: 3,
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sync (M11)', () => {
  it('deriveHealthUrl maps ws->http and wss->https with HTTP_PORT and /api/health', () => {
    expect(deriveHealthUrl('ws://localhost:4001')).toBe('http://localhost:4000/api/health');
    expect(deriveHealthUrl('wss://example.com:8443')).toBe('https://example.com:4000/api/health');
  });

  it('deriveHealthUrl handles portless hosts and yields to an explicit override', () => {
    expect(deriveHealthUrl('ws://example.com')).toBe('http://example.com:4000/api/health');
    expect(deriveHealthUrl('ws://localhost:4001', 'http://127.0.0.1:9000/healthz')).toBe(
      'http://127.0.0.1:9000/healthz',
    );
  });

  it('DEFAULT_SYNC_URL is ws://localhost:4001', () => {
    expect(DEFAULT_SYNC_URL).toBe('ws://localhost:4001');
    expect(SYNC_INITIAL_BACKOFF_MS).toBe(500);
    expect(SYNC_MAX_BACKOFF_MS).toBe(5000);
    expect(SYNC_PROBE_TIMEOUT_MS).toBe(2500);
  });

  it('quantizeHands (shared) rounds landmarks + confidence and does not mutate input', async () => {
    const shared = await import('@jarvis/shared');
    const input = [hand(0.1234567)];
    const copy = structuredClone(input);
    const quantized = shared.quantizeHands(input);
    expect(quantized[0].landmarks[0].x).toBe(0.123);
    expect(quantized[0].confidence).toBe(0.9);
    expect(input).toEqual(copy);
  });

  it('toWindowState converts the manager shape to the wire shape', () => {
    const wire = toWindowState(managerWindow('notes-1', { x: 1.23456, y: -0.65, z: 0.2 }), 99);
    expect(wire.position).toEqual([1.235, -0.65, 0.2]);
    expect(wire.scale).toBe(1.5);
    expect(wire.rotationY).toBe(0);
    expect(wire.zIndex).toBe(3);
    expect(wire.owner).toBe('');
    expect(wire.lastModified).toBe(99);
  });

  it('bridge emits upsert on create and on quantized change, silent below the threshold', () => {
    const sent: unknown[] = [];
    let windows: SyncWindowLike[] = [];
    const bridge = createWindowSyncBridge(
      () => windows,
      {
        sendWindowUpsert: (w) => sent.push(['upsert', w]),
        sendWindowClose: (id) => sent.push(['close', id]),
      },
      () => 1,
    );

    windows = [managerWindow('notes-1', { x: 1, y: 0, z: 0 })];
    bridge.sync();
    expect(sent).toHaveLength(1);

    // Sub-quantization move (0.0004 < 3 decimals): silent.
    windows = [managerWindow('notes-1', { x: 1.0004, y: 0, z: 0 })];
    bridge.sync();
    expect(sent).toHaveLength(1);

    // Real move (0.002 > threshold): emits.
    windows = [managerWindow('notes-1', { x: 1.002, y: 0, z: 0 })];
    bridge.sync();
    expect(sent).toHaveLength(2);

    // zIndex change: emits.
    windows = [managerWindow('notes-1', { x: 1.002, y: 0, z: 0 }, { zIndex: 7 })];
    bridge.sync();
    expect(sent).toHaveLength(3);
  });

  it('bridge emits close when a window vanishes', () => {
    const sent: unknown[] = [];
    let windows: SyncWindowLike[] = [managerWindow('notes-1', { x: 1, y: 0, z: 0 })];
    const bridge = createWindowSyncBridge(
      () => windows,
      {
        sendWindowUpsert: () => sent.push('upsert'),
        sendWindowClose: (id) => sent.push(['close', id]),
      },
      () => 1,
    );
    bridge.sync();
    windows = [];
    bridge.sync();
    expect(sent[1]).toEqual(['close', 'notes-1']);
  });

  it('bridge.flushAll re-sends every current window', () => {
    const sent: unknown[] = [];
    const windows = [managerWindow('a-1', { x: 0, y: 0, z: 0 }), managerWindow('b-1', { x: 1, y: 1, z: 1 })];
    const bridge = createWindowSyncBridge(
      () => windows,
      {
        sendWindowUpsert: () => sent.push('upsert'),
        sendWindowClose: () => sent.push('close'),
      },
      () => 1,
    );
    bridge.sync();
    expect(sent).toHaveLength(2);
    bridge.flushAll();
    expect(sent).toHaveLength(4);
  });

  it('SyncManager is silent while the health probe fails: no socket attempts, status stays disconnected, ONE offline log', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const factory = vi.fn(() => {
      throw new Error('socketFactory must not be called while the probe fails');
    });
    const manager = new SyncManager({
      fetchImpl: failingFetch(Infinity),
      socketFactory: factory as unknown as WebSocketFactory,
    });
    manager.connect();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(factory).not.toHaveBeenCalled();
    expect(manager.status).toBe('disconnected');
    const offlineLines = logSpy.mock.calls.filter((c) => String(c[0]).includes('[Sync] offline'));
    expect(offlineLines).toHaveLength(1);
    manager.close();
  });

  it('SyncManager opens the socket only after a successful probe and connects', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const socket = new FakeSocket();
    const factory = vi.fn(() => socket);
    const statuses: string[] = [];
    const manager = new SyncManager({
      fetchImpl: failingFetch(2),
      socketFactory: factory as unknown as WebSocketFactory,
      onStatus: (s) => statuses.push(s),
    });
    manager.connect();
    await vi.advanceTimersByTimeAsync(0); // probe 1 fails
    await vi.advanceTimersByTimeAsync(500); // probe 2 fails
    await vi.advanceTimersByTimeAsync(1000); // probe 3 succeeds -> socket
    expect(factory).toHaveBeenCalledTimes(1);
    expect(manager.status).toBe('connecting');
    socket.simulateOpen();
    expect(manager.status).toBe('connected');
    expect(statuses).toEqual(['connecting', 'connected']);
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('[Sync] connected'))).toBe(true);
    manager.close();
  });

  it('probe retries back off 500 -> 1000 -> 2000 -> 4000 -> capped at 5000', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchImpl = failingFetch(Infinity);
    const manager = new SyncManager({ fetchImpl });
    manager.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchImpl.calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchImpl.calls()).toBe(3);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchImpl.calls()).toBe(4);
    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchImpl.calls()).toBe(5);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchImpl.calls()).toBe(6);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchImpl.calls()).toBe(7); // capped
    manager.close();
  });

  it('probe fetch gets an AbortController timeout', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fetchImpl = hangingFetch();
    const manager = new SyncManager({ fetchImpl });
    manager.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(SYNC_PROBE_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(500); // backoff after the aborted probe
    expect(fetchImpl.calls()).toBe(2); // the loop retried, not stalled
    expect(manager.status).toBe('disconnected');
    manager.close();
  });

  it('sendHands cadence: >= 50 ms between sends, empty hands suppressed, silent while disconnected', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    let clock = 0;
    let socket = new FakeSocket();
    const factory = vi.fn(() => socket);
    const manager = new SyncManager({
      fetchImpl: failingFetch(0),
      socketFactory: factory as unknown as WebSocketFactory,
      now: () => clock,
    });
    manager.connect();
    await vi.advanceTimersByTimeAsync(0);
    socket.simulateOpen();

    // Disconnected manager: nothing sends.
    const idle = new SyncManager({ fetchImpl: failingFetch(0) });
    idle.sendHands([hand()]);
    expect(idle).toBeDefined();

    // Empty before any non-empty: silent.
    manager.sendHands([]);
    expect(socket.sent).toHaveLength(0);

    // t = 0, 10, 50, 60, 100 -> sends at 0, 50, 100.
    for (const t of [0, 10, 50, 60, 100]) {
      clock = t;
      manager.sendHands([hand(t / 100)]);
    }
    expect(socket.sent).toHaveLength(3);

    // Non-empty -> empty: exactly ONE empty update; then silence.
    clock = 200;
    manager.sendHands([hand()]);
    clock = 210;
    manager.sendHands([]);
    clock = 220;
    manager.sendHands([]);
    const messages = socket.sentMessages() as Array<{ type: string; data: { hands: Hand[] } }>;
    expect(messages.at(-1)?.data.hands).toHaveLength(0);
    expect(socket.sent).toHaveLength(5);

    // Reconnect resets the throttle window (fresh socket).
    socket.simulateClose();
    await vi.advanceTimersByTimeAsync(0);
    socket = new FakeSocket();
    manager.close();
  });

  it('sendHands quantizes the wire payload', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const socket = new FakeSocket();
    const manager = new SyncManager({
      fetchImpl: failingFetch(0),
      socketFactory: (() => socket) as unknown as WebSocketFactory,
      now: () => 0,
    });
    manager.connect();
    await vi.advanceTimersByTimeAsync(0);
    socket.simulateOpen();
    manager.sendHands([hand(0.1234567)]);
    const [message] = socket.sentMessages() as Array<{
      type: string;
      data: { hands: Hand[] };
    }>;
    expect(message.type).toBe('handUpdate');
    expect(message.data.hands[0].landmarks[0].x).toBe(0.123);
    manager.close();
  });

  it('subscribe delivers parsed ServerMessages, unsubscribes, and malformed frames are ignored silently', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const socket = new FakeSocket();
    const manager = new SyncManager({
      fetchImpl: failingFetch(0),
      socketFactory: (() => socket) as unknown as WebSocketFactory,
    });
    const received: ServerMessage[] = [];
    const unsubscribe = manager.subscribe((m) => received.push(m));
    manager.connect();
    await vi.advanceTimersByTimeAsync(0);
    socket.simulateOpen();

    socket.simulateMessage({ type: 'stateSnapshot', data: { users: [], windows: [] } });
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('stateSnapshot');

    unsubscribe();
    socket.simulateMessage({ type: 'userJoined', data: { userId: 'x' } });
    expect(received).toHaveLength(1);

    expect(() => socket.onmessage?.({ data: '{{not json' })).not.toThrow();
    expect(logSpy.mock.calls.filter((c) => String(c[0]).includes('[Sync]')).length).toBeLessThanOrEqual(1);
    manager.close();
  });

  it('unexpected close re-probes; explicit close() is terminal, clears timers, and is idempotent', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const first = new FakeSocket();
    const second = new FakeSocket();
    const factory = vi.fn(() => (factory.mock.calls.length === 1 ? first : second));
    const fetchImpl = failingFetch(0);
    const manager = new SyncManager({
      fetchImpl,
      socketFactory: factory as unknown as WebSocketFactory,
    });
    manager.connect();
    await vi.advanceTimersByTimeAsync(0);
    first.simulateOpen();
    expect(manager.status).toBe('connected');

    first.simulateClose();
    expect(manager.status).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(0); // re-probe succeeds immediately
    second.simulateOpen();
    expect(manager.status).toBe('connected');
    expect(factory).toHaveBeenCalledTimes(2);

    manager.close();
    const fetchCalls = fetchImpl.calls();
    const factoryCalls = factory.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl.calls()).toBe(fetchCalls);
    expect(factory).toHaveBeenCalledTimes(factoryCalls);
    expect(manager.status).toBe('disconnected');
    expect(() => manager.close()).not.toThrow(); // idempotent
  });
});

describe('sync reconnect budget (M15 D7)', () => {
  it('a once-connected drop exhausts the budget into the TERMINAL offline state', async () => {
    const logLines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logLines.push(String(args[0]));
    });
    let down = false;
    let probes = 0;
    const fetchImpl = ((() => {
      probes += 1;
      return down
        ? Promise.reject(new TypeError('backend down'))
        : Promise.resolve({} as Response);
    }) as unknown) as typeof fetch & { calls: () => number };
    fetchImpl.calls = () => probes;

    const first = new FakeSocket();
    const factory = vi.fn(() => first);
    const statuses: string[] = [];
    const manager = new SyncManager({
      fetchImpl,
      socketFactory: factory as unknown as WebSocketFactory,
      onStatus: (s) => statuses.push(s),
    });

    manager.connect();
    await vi.advanceTimersByTimeAsync(0);
    first.simulateOpen(); // was connected once
    expect(manager.status).toBe('connected');

    // The backend dies for good: the reconnect loop budgets 8 failed cycles.
    down = true;
    first.simulateClose();
    await vi.advanceTimersByTimeAsync(3 * SYNC_MAX_RECONNECT_ATTEMPTS * SYNC_MAX_BACKOFF_MS);

    expect(manager.status).toBe('offline');
    expect(factory).toHaveBeenCalledTimes(1); // no new socket attempts after the cap
    const offlineLines = logLines.filter((l) => l.includes('[Sync] offline'));
    expect(offlineLines).toHaveLength(1);
    expect(statuses).toContain('offline');
    expect(SYNC_MAX_RECONNECT_ATTEMPTS).toBe(8);

    // Terminal: more time does nothing (zero retained timers / attempts).
    const callsAfter = probes;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(probes).toBe(callsAfter);
    expect(manager.status).toBe('offline');
    manager.close();
  });

  it('a budgeted drop that RECOVERS reconnects and resets the budget', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    let down = false;
    const fetchImpl = ((() =>
      down
        ? Promise.reject(new TypeError('backend down'))
        : Promise.resolve({} as Response))) as unknown as typeof fetch & {
      calls: () => number;
    };
    const first = new FakeSocket();
    const second = new FakeSocket();
    const third = new FakeSocket();
    const factory = vi.fn(() => {
      const call = factory.mock.calls.length;
      return call === 1 ? first : call === 2 ? second : third;
    });
    const manager = new SyncManager({
      fetchImpl,
      socketFactory: factory as unknown as WebSocketFactory,
    });

    // Initial connect succeeds on the first probe (loop retires).
    manager.connect();
    await vi.advanceTimersByTimeAsync(0);
    first.simulateOpen();
    expect(manager.status).toBe('connected');

    // Brief outage #1 (2 failed restoration probes), then the backend recovers.
    down = true;
    first.simulateClose();
    await vi.advanceTimersByTimeAsync(SYNC_INITIAL_BACKOFF_MS * 2);
    down = false;
    await vi.advanceTimersByTimeAsync(SYNC_INITIAL_BACKOFF_MS + 1);
    second.simulateOpen();
    expect(manager.status).toBe('connected');
    expect(factory).toHaveBeenCalledTimes(2);

    // The budget RESET on reconnect: another brief outage is NOT terminal.
    down = true;
    second.simulateClose();
    await vi.advanceTimersByTimeAsync(SYNC_INITIAL_BACKOFF_MS * 2);
    down = false;
    await vi.advanceTimersByTimeAsync(SYNC_INITIAL_BACKOFF_MS + 1);
    third.simulateOpen();
    expect(manager.status).toBe('connected');
    expect(manager.status).not.toBe('offline');
    manager.close();
  });

  it('the NEVER-connected boot path is NOT budgeted — probes keep running, no terminal offline', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const factory = vi.fn(() => {
      throw new Error('socketFactory must not be called while the probe fails');
    });
    const manager = new SyncManager({
      fetchImpl: failingFetch(Infinity),
      socketFactory: factory as unknown as WebSocketFactory,
    });
    manager.connect();
    // Far past the cap (8 cycles would be ~25s of backoff).
    await vi.advanceTimersByTimeAsync(40_000);
    expect(manager.status).toBe('disconnected'); // NOT 'offline'
    expect(factory).not.toHaveBeenCalled();
    manager.close();
  });
});
