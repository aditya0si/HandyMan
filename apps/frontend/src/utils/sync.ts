/**
 * M11 SyncManager + window-sync bridge (frontend side of the §3.1 protocol).
 *
 * THE PROBE GATE (D4, mandatory): a failed new WebSocket(...) logs a NATIVE
 * browser console error that no handler can suppress, and every verifier
 * runs a zero-console-error gate with the backend down. So this manager
 * NEVER constructs a WebSocket until a silent health probe
 * (fetch healthUrl {mode:'no-cors'} + AbortController timeout, .catch =
 * false) has SUCCEEDED — backend down means probe-fails-quietly forever,
 * zero WS attempts, status 'disconnected' (HUD 'offline'), one
 * '[Sync] offline' line total.
 *
 * Purity contract (mirrors gemini.ts/search.ts): NO import.meta, NO React,
 * NO DOM-only APIs — env is read ONLY in App.tsx; socket factory, fetch,
 * and clock are injectable so node vitest covers the retry/backoff/throttle
 * machinery with fakes and zero network.
 *
 * Console contract (D6): '[Sync] connected' / '[Sync] offline' on lifecycle
 * transitions ONLY (never per retry). Inbound-message logs live in App.
 */
import type { Hand, ServerMessage, WindowState } from '@jarvis/shared';
import { HTTP_PORT, SYNC_HANDS_INTERVAL_MS, SYNC_QUANTIZE_DECIMALS, quantizeHands } from '@jarvis/shared';
import { isPerfDebugEnabled, recordPerf } from './perfDebug';

export type SyncStatus = 'disconnected' | 'connecting' | 'connected' | 'offline';

/** Default dev endpoint (README M11; override via VITE_SYNC_URL in App.tsx). */
export const DEFAULT_SYNC_URL = 'ws://localhost:4001';

/** Probe/backoff schedule (D4): immediate first probe, then 500ms * 2^n, capped. */
export const SYNC_INITIAL_BACKOFF_MS = 500;
export const SYNC_MAX_BACKOFF_MS = 5000;
export const SYNC_PROBE_TIMEOUT_MS = 2500;

/** M15 (D7): the reconnect budget for the ONCE-CONNECTED drop path. After
 *  this many consecutive failed restoration cycles the manager enters the
 *  TERMINAL 'offline' state (zero retained timers, no further socket
 *  attempts) instead of flapping forever. The never-connected boot path is
 *  NOT budgeted — it keeps probing so a backend that starts later
 *  auto-connects on the same session (the M11 promise). */
export const SYNC_MAX_RECONNECT_ATTEMPTS = 8;

/** Derive the health-probe URL from the sync URL (D4): ws->http, wss->https,
 *  port -> HTTP_PORT, path /api/health; an explicit override wins. */
export function deriveHealthUrl(syncUrl: string, override?: string): string {
  if (override) return override;
  const url = new URL(syncUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.port = String(HTTP_PORT);
  url.pathname = '/api/health';
  url.search = '';
  return url.toString();
}

/** Structural socket interface (on* PROPERTY pattern, D12 — never
 *  addEventListener, so v4's soak listener counters never see the socket).
 *  The browser WebSocket satisfies this structurally; tests pass a fake. */
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}
export type WebSocketFactory = (url: string) => WebSocketLike;

export interface SyncManagerOptions {
  socketUrl?: string;
  healthUrl?: string;
  socketFactory?: WebSocketFactory;
  fetchImpl?: typeof fetch;
  now?: () => number;
  handsIntervalMs?: number;
  probeTimeoutMs?: number;
  token?: string;
  onStatus?: (status: SyncStatus) => void;
}

interface WaitHandle {
  settle: () => void;
}

export class SyncManager {
  private readonly socketUrl: string;
  private readonly healthUrl: string;
  private readonly socketFactory: WebSocketFactory;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly handsIntervalMs: number;
  private readonly probeTimeoutMs: number;
  private readonly token?: string;
  private readonly onStatus?: (status: SyncStatus) => void;

  private statusValue: SyncStatus = 'disconnected';
  private socket: WebSocketLike | null = null;
  private closed = false;          // close() is terminal (fresh per scene, D12)
  private started = false;
  private backoffMs = SYNC_INITIAL_BACKOFF_MS;
  private loggedOffline = false;   // ONE '[Sync] offline' per offline stretch (D6)
  // M15 (D7): reconnect budget, applied ONLY after a successful connection.
  private wasConnectedOnce = false;
  private reconnectFailures = 0;
  private readonly waits = new Set<WaitHandle>();
  private readonly handlers = new Set<(message: ServerMessage) => void>();
  private lastHandsSend = -Infinity;
  private lastHandsWereNonEmpty = false;

  constructor(options: SyncManagerOptions = {}) {
    this.socketUrl = options.socketUrl ?? DEFAULT_SYNC_URL;
    this.healthUrl = options.healthUrl ?? deriveHealthUrl(this.socketUrl);
    // TS 6.0.2 does not narrow the DOM WebSocket's structural type to
    // WebSocketLike in this position — the explicit cast is mechanical.
    this.socketFactory =
      options.socketFactory ??
      ((url: string): WebSocketLike => new WebSocket(url) as unknown as WebSocketLike);
    // fetch must be BOUND: ESM modules are strict-mode, and this Chromium
    // treats an unbound fetch call (this === undefined) as "Illegal
    // invocation" — the same latent bug existed in gemini.ts/search.ts.
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
    this.handsIntervalMs = options.handsIntervalMs ?? SYNC_HANDS_INTERVAL_MS;
    this.probeTimeoutMs = options.probeTimeoutMs ?? SYNC_PROBE_TIMEOUT_MS;
    this.token = options.token;
    this.onStatus = options.onStatus;
  }

  get status(): SyncStatus {
    return this.statusValue;
  }

  /** Starts the probe loop (idempotent). */
  connect(): void {
    if (this.started || this.closed) return;
    this.started = true;
    void this.runProbeLoop();
  }

  /** Terminal teardown: clears every timer/wait, closes the socket,
   *  emits nothing afterwards. Idempotent (D12). The status resets to
   *  'disconnected' SILENTLY — per-scene replacement must not log. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const wait of this.waits) wait.settle();
    this.waits.clear();
    this.detachSocket();
    this.statusValue = 'disconnected';
  }

  /**
   * M14 (D5): opt-in timing around the whole send path (quantize +
   * throttle + write). The disabled path is the original body VERBATIM —
   * zero extra calls, zero behavior change.
   */
  sendHands(hands: readonly Hand[]): void {
    if (!isPerfDebugEnabled()) {
      this.sendHandsChecked(hands);
      return;
    }
    const started = performance.now();
    this.sendHandsChecked(hands);
    recordPerf('sync', performance.now() - started);
  }

  private sendHandsChecked(hands: readonly Hand[]): void {
    if (this.statusValue !== 'connected' || !this.socket) return;
    if (hands.length === 0) {
      // Empty-hand suppression (D6): silent unless announcing hands-gone.
      // The one-shot hands-gone edge BYPASSES the throttle — a 50 ms sample
      // window must never swallow the final "hands left" state.
      if (!this.lastHandsWereNonEmpty) return;
      this.lastHandsWereNonEmpty = false;
      this.rawSend({ type: 'handUpdate', data: { hands: [] } });
      return;
    }
    this.lastHandsWereNonEmpty = true;
    const now = this.now();
    if (now - this.lastHandsSend < this.handsIntervalMs) return;
    this.lastHandsSend = now;
    this.rawSend({ type: 'handUpdate', data: { hands: quantizeHands(hands) } });
  }

  sendWindowUpsert(window: WindowState): void {
    if (this.statusValue !== 'connected') return;
    this.rawSend({ type: 'windowUpsert', data: window });
  }

  sendWindowClose(id: string): void {
    if (this.statusValue !== 'connected') return;
    this.rawSend({ type: 'windowClose', data: { id } });
  }

  sendPresenterSync(data: { position: [number, number, number], rotation: [number, number, number], fov: number } | null): void {
    if (this.statusValue !== 'connected') return;
    this.rawSend({ type: 'presenterSync', data });
  }

  subscribe(handler: (message: ServerMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  // --- internals -----------------------------------------------------------

  private setStatus(status: SyncStatus): void {
    if (this.closed || this.statusValue === status) return;
    this.statusValue = status;
    if (status === 'connected') console.log('[Sync] connected');
    this.onStatus?.(status);
  }

  /** Announces one '[Sync] offline' per offline stretch (D6). The initial
   *  boot-against-a-dead-backend case never passes through setStatus (the
   *  status is ALREADY 'disconnected'), so the log lives HERE, not there. */
  private announceOffline(): void {
    if (this.loggedOffline) return;
    this.loggedOffline = true;
    console.log('[Sync] offline');
    if (this.statusValue !== 'disconnected') this.setStatus('disconnected');
  }

  /** M15 (D7): the terminal 'offline' transition — budget exhausted. Keeps
   *  the one-per-stretch log (no second line when already announced) but
   *  publishes the DISTINCT status so the HUD/onStatus can distinguish
   *  "still retrying" from "gave up this session". */
  private enterOfflineTerminal(): void {
    if (!this.loggedOffline) {
      this.loggedOffline = true;
      console.log('[Sync] offline');
    }
    this.setStatus('offline');
  }

  private rawSend(message: unknown): void {
    try {
      this.socket?.send(JSON.stringify(message));
    } catch {
      // A just-died socket throws; the close path owns reconnection.
    }
  }

  /** setTimeout whose promise ALSO settles on close() — the loop exits.
   *  close() settles the wait without clearing the native timer (the stale
   *  timer's later resolve is a harmless no-op) — deliberate, D12. */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const handle: WaitHandle = {
        settle: () => resolve(),
      };
      const timer = setTimeout(() => {
        this.waits.delete(handle);
        resolve();
      }, ms);
      void timer;
      this.waits.add(handle);
    });
  }

  private async probeOnce(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.probeTimeoutMs);
    try {
      // no-cors: an opaque response RESOLVES (server up); only network
      // failure rejects — and a rejected fetch logs NOTHING natively (D4).
      await this.fetchImpl(this.healthUrl, { mode: 'no-cors', signal: controller.signal });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private async runProbeLoop(): Promise<void> {
    while (!this.closed) {
      const healthy = await this.probeOnce();
      if (this.closed) return;
      if (healthy) {
        this.openSocket();
        return; // socket events own the lifecycle from here
      }
      if (this.wasConnectedOnce) {
        // M15 (D7): the ONCE-CONNECTED drop path is budgeted — a sustained
        // outage settles into the terminal 'offline' state instead of
        // probing/flapping forever. The never-connected boot path below is
        // NOT budgeted (M11 promise: a backend that starts later connects).
        this.reconnectFailures += 1;
        if (this.reconnectFailures >= SYNC_MAX_RECONNECT_ATTEMPTS) {
          this.enterOfflineTerminal();
          return; // terminal: zero retained timers, no further attempts
        }
      } else if (!this.loggedOffline) {
        this.announceOffline();
      }
      await this.wait(this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, SYNC_MAX_BACKOFF_MS);
    }
  }

  private openSocket(): void {
    this.setStatus('connecting');
    const url = this.token ? `${this.socketUrl}?token=${encodeURIComponent(this.token)}` : this.socketUrl;
    const socket = this.socketFactory(url);
    this.socket = socket;
    socket.onopen = () => {
      if (this.closed) return;
      this.backoffMs = SYNC_INITIAL_BACKOFF_MS;
      this.loggedOffline = false;
      this.lastHandsSend = -Infinity;
      // M15 (D7): a live connection resets both the budget and the
      // was-once-connected flag (re-ready for the next outage round).
      this.reconnectFailures = 0;
      this.wasConnectedOnce = true;
      this.setStatus('connected');
    };
    socket.onmessage = (event) => {
      if (this.closed) return;
      try {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (typeof message !== 'object' || message === null || typeof message.type !== 'string') return;
        for (const handler of this.handlers) handler(message);
      } catch {
        // Malformed server frames are ignored silently (D6).
      }
    };
    socket.onclose = () => {
      if (this.closed) return;
      this.detachSocket();
      this.announceOffline(); // unexpected drop: one '[Sync] offline' (D6)
      this.backoffMs = SYNC_INITIAL_BACKOFF_MS;
      void this.runProbeLoop(); // re-probe (server may be restarting)
    };
    socket.onerror = () => {
      // Native console behavior is out of our hands; onclose follows.
    };
  }

  private detachSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onclose = null;
    socket.onmessage = null;
    socket.onerror = null;
    try {
      socket.close(1000);
    } catch {
      // already dead — fine
    }
  }
}

// ---------------------------------------------------------------------------
// Window-sync bridge (D10)
// ---------------------------------------------------------------------------

/** Structural slice of WindowManager's FloatingWindow (Vector3/Euler satisfy
 *  this structurally — windowManager.ts stays untouched and un-imported). */
export interface SyncWindowLike {
  id: string;
  title: string;
  position: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  rotation: { y: number };
  zIndex: number;
}

/** Manager window -> wire state (D1 tuple/scalar conversion; owner is ''
 *  — the server stamps the real owner, D7). */
export function toWindowState(win: SyncWindowLike, lastModified: number): WindowState {
  const q = (n: number): number => Math.round(n * 10 ** SYNC_QUANTIZE_DECIMALS) / 10 ** SYNC_QUANTIZE_DECIMALS;
  return {
    id: win.id,
    title: win.title,
    owner: '',
    position: [q(win.position.x), q(win.position.y), q(win.position.z)],
    rotationY: q(win.rotation.y),
    scale: q(win.scale.x),
    zIndex: win.zIndex,
    lastModified,
  };
}

export interface WindowSyncSender {
  sendWindowUpsert(window: WindowState): void;
  sendWindowClose(id: string): void;
}

export interface WindowSyncBridge {
  /** Diff the current window list against the snapshot and emit (call from
   *  the WindowManager onChange callback — create/move/resize/rotate/
   *  bring-to-front/close all notify; highlight churn emits nothing). */
  sync(): void;
  /** Force-send every current window (call on the 'connected' transition —
   *  D10 flush-on-connect; stale server windows closed during an outage are
   *  a documented M12 edge). */
  flushAll(): void;
}

export function createWindowSyncBridge(
  getWindows: () => readonly SyncWindowLike[],
  sender: WindowSyncSender,
  now: () => number = Date.now,
): WindowSyncBridge {
  let snapshot = new Map<string, string>(); // id -> quantized wire key
  const keyOf = (w: WindowState): string =>
    JSON.stringify([w.title, w.position, w.rotationY, w.scale, w.zIndex]);
  const sync = (): void => {
    const current = new Map<string, WindowState>();
    for (const win of getWindows()) current.set(win.id, toWindowState(win, now()));
    for (const [id, wire] of current) {
      const key = keyOf(wire);
      if (snapshot.get(id) !== key) {
        snapshot.set(id, key);
        sender.sendWindowUpsert(wire);
      }
    }
    for (const id of [...snapshot.keys()]) {
      if (!current.has(id)) {
        snapshot.delete(id);
        sender.sendWindowClose(id);
      }
    }
  };
  return {
    sync,
    flushAll: () => {
      snapshot = new Map();
      sync();
    },
  };
}
