import { describe, expect, it } from 'vitest';
import type { Hand, WindowState } from '@jarvis/shared';
import { SYNC_QUANTIZE_DECIMALS } from '@jarvis/shared';
import { StateManager } from './manager';

const hand = (x = 0.1234567): Hand => ({
  handedness: 'Right',
  landmarks: [
    { x, y: 0.9876543, z: -0.0456789 },
    { x: 0.5, y: 0.5, z: 0 },
  ],
  confidence: 0.8765432,
});

const wireWindow = (id = 'notes-1', owner = ''): WindowState => ({
  id,
  title: 'Notes',
  owner,
  position: [1.6, -0.65, 0.2],
  rotationY: 0.25,
  scale: 1.5,
  zIndex: 3,
  lastModified: 0,
});

describe('StateManager (M11)', () => {
  it('upsertUserHands creates a user and returns quantized hands', () => {
    const state = new StateManager();
    const returned = state.upsertUserHands('user-1', [hand()]);
    expect(returned[0].landmarks[0]).toEqual({ x: 0.123, y: 0.988, z: -0.046 });
    expect(returned[0].confidence).toBe(0.877);
    expect(state.userCount()).toBe(1);
  });

  it('upsertUserHands quantizes on EVERY store (server authority)', () => {
    const state = new StateManager();
    const returned = state.upsertUserHands('user-1', [hand(0.9999999)]);
    expect(returned[0].landmarks[0].x).toBe(1);
    const again = state.upsertUserHands('user-1', [hand(0.9999999)]);
    expect(again[0].landmarks[0].x).toBe(1);
    expect(SYNC_QUANTIZE_DECIMALS).toBe(3);
  });

  it('upsertUserHands updates hands and bumps lastUpdate monotonically', () => {
    let clock = 100;
    const state = new StateManager({ now: () => clock });
    state.upsertUserHands('user-1', []);
    clock = 200;
    state.upsertUserHands('user-1', [hand()]);
    const users = state.getFullState().users;
    expect(users).toHaveLength(1);
    expect(users[0].lastUpdate).toBe(200);
  });

  it('upsertUserHands does not mutate the caller\'s array', () => {
    const state = new StateManager();
    const input = [hand()];
    const copy = structuredClone(input);
    state.upsertUserHands('user-1', input);
    expect(input).toEqual(copy);
  });

  it('getFullState users carry id + lastUpdate only (no hands on the wire)', () => {
    const state = new StateManager({ now: () => 42 });
    state.upsertUserHands('user-1', [hand()]);
    const users = state.getFullState().users;
    expect(users[0]).toEqual({ id: 'user-1', lastUpdate: 42 });
    expect('hands' in users[0]).toBe(false);
  });

  it('upsertWindow create stamps owner = sender and ignores the client owner', () => {
    const state = new StateManager();
    const stored = state.upsertWindow('user-A', wireWindow('notes-1', 'spoofed'));
    expect(stored.owner).toBe('user-A');
    expect(state.getFullState().windows[0].owner).toBe('user-A');
  });

  it('upsertWindow create stamps lastModified from the clock', () => {
    const state = new StateManager({ now: () => 1234 });
    const stored = state.upsertWindow('user-A', wireWindow());
    expect(stored.lastModified).toBe(1234);
  });

  it('upsertWindow update NEVER changes the owner', () => {
    const state = new StateManager({ now: () => 1 });
    state.upsertWindow('user-A', wireWindow('notes-1'));
    const updated = state.upsertWindow('user-B', {
      ...wireWindow('notes-1'),
      position: [-1, 0, 0.5],
      scale: 2,
      zIndex: 7,
      rotationY: -0.5,
      title: 'Moved',
    });
    expect(updated.owner).toBe('user-A');
    expect(updated.position).toEqual([-1, 0, 0.5]);
    expect(updated.scale).toBe(2);
    expect(updated.zIndex).toBe(7);
    expect(updated.rotationY).toBe(-0.5);
    expect(updated.title).toBe('Moved');
  });

  it('closeWindow removes and returns true; unknown id returns false', () => {
    const state = new StateManager();
    state.upsertWindow('user-A', wireWindow('notes-1'));
    expect(state.closeWindow('notes-1')).toBe(true);
    expect(state.closeWindow('notes-1')).toBe(false);
    expect(state.getFullState().windows).toHaveLength(0);
  });

  it('re-create after close re-stamps the new creator', () => {
    const state = new StateManager();
    state.upsertWindow('user-A', wireWindow('notes-1'));
    state.closeWindow('notes-1');
    const recreated = state.upsertWindow('user-B', wireWindow('notes-1'));
    expect(recreated.owner).toBe('user-B');
  });

  it('removeUser drops the user but KEEPS their windows', () => {
    const state = new StateManager();
    state.upsertUserHands('user-A', []);
    state.upsertWindow('user-A', wireWindow('notes-1'));
    state.removeUser('user-A');
    expect(state.userCount()).toBe(0);
    expect(state.getFullState().windows.map((w) => w.id)).toEqual(['notes-1']);
  });

  it('getFullState windows round-trip the wire shape', () => {
    const state = new StateManager({ now: () => 9 });
    const stored = state.upsertWindow('user-A', wireWindow('chat-1'));
    const [wire] = state.getFullState().windows;
    expect(wire.id).toBe('chat-1');
    expect(Array.isArray(wire.position)).toBe(true);
    expect(wire.position).toHaveLength(3);
    expect(typeof wire.scale).toBe('number');
    expect(typeof wire.rotationY).toBe('number');
    expect(typeof wire.zIndex).toBe('number');
    expect(wire.lastModified).toBe(stored.lastModified);
  });
});
