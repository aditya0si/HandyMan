/**
 * M11 StateManager (TECHNICAL_SPEC §3.2 reimagined per the M11 prompt).
 *
 * DEVIATIONS from the spec sketch (documented, D17): no Database/Redis
 * (in-memory only — the M13 JSON-store decision), no applyInteraction
 * (windows mutate via explicit upsert/close), getFullState returns
 * SERIALIZABLE arrays (Maps do not JSON), and upsertUserHands QUANTIZES
 * via the shared quantizeHands (single authority, D9).
 *
 * Pure + injectable clock => unit-testable with no network, no timers.
 * Ownership (D7): create stamps owner = sender; update NEVER changes it;
 * a close followed by a re-create re-stamps the (possibly new) creator.
 * removeUser keeps the user's windows (spec §3.2; GC is M12).
 */
import type { Hand, UserInfo, WindowState } from '@jarvis/shared';
import { quantizeHands } from '@jarvis/shared';

export interface StateManagerOptions {
  /** Injectable for deterministic tests (default Date.now). */
  now?: () => number;
  /**
   * M13 (D2): fired after every WINDOW mutation (upsertWindow that stores,
   * closeWindow that removes, replaceAllWindows). The composer (server.ts)
   * subscribes to feed the debounced WorkspaceStore — the WS server itself
   * stays untouched. NOT fired for user/hands mutations (users are
   * ephemeral presence, never persisted).
   */
  onChange?: () => void;
}

interface StoredUser {
  id: string;
  hands: Hand[];
  lastUpdate: number;
}

export class StateManager {
  private readonly users = new Map<string, StoredUser>();
  private readonly windows = new Map<string, WindowState>();
  private readonly now: () => number;
  private readonly onChange?: () => void;

  constructor(options: StateManagerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.onChange = options.onChange;
  }

  /** Stores QUANTIZED hands (D9 authority) and returns them (the caller
   *  broadcasts exactly what was stored). Creates the user on first call. */
  upsertUserHands(userId: string, hands: readonly Hand[]): Hand[] {
    const quantized = quantizeHands(hands);
    const existing = this.users.get(userId);
    if (existing) {
      existing.hands = quantized;
      existing.lastUpdate = this.now();
    } else {
      this.users.set(userId, { id: userId, hands: quantized, lastUpdate: this.now() });
    }
    return quantized;
  }

  /** Create-or-update. CREATE stamps owner = senderId (D7); UPDATE keeps
   *  the existing owner and ignores the incoming owner field entirely.
   *  Returns the authoritative stored state (for broadcast). */
  upsertWindow(senderId: string, incoming: WindowState): WindowState {
    const existing = this.windows.get(incoming.id);
    if (!existing) {
      const created: WindowState = { ...incoming, owner: senderId, lastModified: this.now() };
      this.windows.set(created.id, created);
      this.onChange?.();
      return created;
    }
    const updated: WindowState = {
      ...incoming,
      owner: existing.owner,
      lastModified: this.now(),
    };
    this.windows.set(updated.id, updated);
    this.onChange?.();
    return updated;
  }

  /** Removes the window; false for unknown ids (silent no-op, D7). */
  closeWindow(id: string): boolean {
    const removed = this.windows.delete(id);
    if (removed) this.onChange?.();
    return removed;
  }

  /**
   * M13 (D2): replaces the whole window set AS-GIVEN (owners preserved
   * from the payload — PUT /api/workspace semantics; contrast
   * upsertWindow, which stamps/keeps owners). Used by the boot preload
   * and the REST replace. Fires onChange (the composer persists).
   */
  replaceAllWindows(windows: readonly WindowState[]): void {
    this.windows.clear();
    for (const window of windows) this.windows.set(window.id, { ...window });
    this.onChange?.();
  }

  /** Serializable full state (D17.6): users are PRESENCE records only. */
  getFullState(): { users: UserInfo[]; windows: WindowState[] } {
    return {
      users: [...this.users.values()].map(({ id, lastUpdate }) => ({ id, lastUpdate })),
      windows: [...this.windows.values()],
    };
  }

  /** Drops the user; their WINDOWS stay (D7 — GC is M12). */
  removeUser(userId: string): void {
    this.users.delete(userId);
  }

  userCount(): number {
    return this.users.size;
  }
}
