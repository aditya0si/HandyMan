import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { WindowState } from '@jarvis/shared';
import { InteractionEngine, GESTURE_WORLD_HALF_EXTENT } from './interactionEngine';
import { GestureType } from './gestures';
import { WINDOW_BASE_WIDTH, WindowManager as WM } from './windowManager';
import {
  applyRemoteClose,
  applyRemoteWindow,
  reconcileSnapshot,
} from './remoteApply';
import type { Gesture } from './gestures';

/**
 * remoteApply unit tests (M12 D4) against the REAL WindowManager. The
 * M12 brief's hover-eviction edge is pinned here too: a remote window
 * closed by its owner while locally hovered -> the next POINT frame emits
 * hover-null (the M6 eviction machinery — raycast now misses).
 */

function wire(over: Partial<WindowState> = {}): WindowState {
  return {
    id: 'holo-1',
    title: 'Holo',
    owner: 'user-b',
    position: [0.5, 0.25, -1],
    rotationY: 0.3,
    scale: 2,
    zIndex: 7,
    lastModified: 1,
    ...over,
  };
}

function setup(): { scene: THREE.Scene; wm: WM; remoteIds: Set<string> } {
  const scene = new THREE.Scene();
  const wm = new WM(scene);
  return { scene, wm, remoteIds: new Set() };
}

describe('applyRemoteWindow (M12 D4)', () => {
  it('creates an unknown window: registry add + position/rotation/scale/zIndex applied', () => {
    const { wm, remoteIds } = setup();
    expect(applyRemoteWindow(wire(), wm, remoteIds)).toBe('created');
    expect(remoteIds.has('holo-1')).toBe(true);
    const win = wm.getWindow('holo-1')!;
    expect(win.title).toBe('Holo');
    expect(win.position).toEqual(new THREE.Vector3(0.5, 0.25, -1));
    expect(win.rotation.y).toBeCloseTo(0.3, 10);
    // resize is compound: base 1.5 -> factor 2/1.5 -> scale.x = 2.
    expect(win.scale.x).toBeCloseTo(2, 10);
    expect(win.zIndex).toBe(7);
  });

  it('updates an already-materialized remote window (move)', () => {
    const { wm, remoteIds } = setup();
    applyRemoteWindow(wire(), wm, remoteIds);
    const outcome = applyRemoteWindow(
      wire({ position: [-0.7, 0.1, 0.5] }),
      wm,
      remoteIds,
    );
    expect(outcome).toBe('updated');
    expect(wm.getWindow('holo-1')!.position).toEqual(
      new THREE.Vector3(-0.7, 0.1, 0.5),
    );
  });

  it('recreates a materialized window whose local copy was closed', () => {
    const { wm, remoteIds } = setup();
    applyRemoteWindow(wire(), wm, remoteIds);
    wm.closeWindow('holo-1');
    expect(applyRemoteWindow(wire(), wm, remoteIds)).toBe('updated');
    expect(wm.getWindow('holo-1')).toBeDefined();
    expect(remoteIds.has('holo-1')).toBe(true);
  });

  it('skips a locally-owned window seen in a snapshot (boot-id collision)', () => {
    const { wm, remoteIds } = setup();
    wm.createWindow('notes-1', 'Notes', new THREE.Vector3(9, 9, 9));
    expect(applyRemoteWindow(wire({ id: 'notes-1' }), wm, remoteIds)).toBe(
      'skipped-local',
    );
    expect(remoteIds.has('notes-1')).toBe(false);
    // The local fresh view wins — untouched.
    expect(wm.getWindow('notes-1')!.position).toEqual(new THREE.Vector3(9, 9, 9));
  });

  it('resize factor math is exact across two target scales', () => {
    const { wm, remoteIds } = setup();
    applyRemoteWindow(wire({ scale: 2 }), wm, remoteIds);
    expect(wm.getWindow('holo-1')!.scale.x).toBeCloseTo(2, 10);
    applyRemoteWindow(wire({ scale: 1 }), wm, remoteIds);
    expect(wm.getWindow('holo-1')!.scale.x).toBeCloseTo(1, 10);
    applyRemoteWindow(
      wire({ scale: WINDOW_BASE_WIDTH }),
      wm,
      remoteIds,
    );
    expect(wm.getWindow('holo-1')!.scale.x).toBeCloseTo(WINDOW_BASE_WIDTH, 10);
  });

  it('remote zIndex keeps local bringToFront allocation monotonic', () => {
    const { wm, remoteIds } = setup();
    wm.createWindow('local-1', 'L1');
    applyRemoteWindow(wire({ zIndex: 7 }), wm, remoteIds);
    wm.createWindow('local-2', 'L2');
    // local-2 was created AFTER the remote zIndex 7 -> it must outrank it.
    expect(wm.getWindow('local-2')!.zIndex).toBe(8);
    wm.bringToFront('local-1');
    expect(wm.getWindow('local-1')!.zIndex).toBe(9);
  });
});

describe('applyRemoteClose (M12 D4)', () => {
  it('closes a registry window and removes it from the registry', () => {
    const { wm, remoteIds } = setup();
    applyRemoteWindow(wire(), wm, remoteIds);
    expect(applyRemoteClose('holo-1', wm, remoteIds)).toBe('closed');
    expect(wm.getWindow('holo-1')).toBeUndefined();
    expect(remoteIds.has('holo-1')).toBe(false);
  });

  it('never closes a locally-owned window; unknown ids are no-ops', () => {
    const { wm, remoteIds } = setup();
    wm.createWindow('notes-1', 'Notes');
    expect(applyRemoteClose('notes-1', wm, remoteIds)).toBe('skipped-local');
    expect(wm.getWindow('notes-1')).toBeDefined();
    expect(applyRemoteClose('ghost', wm, remoteIds)).toBe('unknown');
  });
});

describe('reconcileSnapshot (M12 D4)', () => {
  it('applies all wire windows and closes registry ids absent from the snapshot', () => {
    const { wm, remoteIds } = setup();
    wm.createWindow('notes-1', 'Notes'); // local — must never be touched
    const first = reconcileSnapshot(
      [wire(), wire({ id: 'holo-2', title: 'H2' })],
      wm,
      remoteIds,
    );
    expect(first.created.sort()).toEqual(['holo-1', 'holo-2']);
    // Owner closed holo-1: the next snapshot simply lacks it (M11 D8).
    const second = reconcileSnapshot(
      [wire({ id: 'holo-2', title: 'H2', position: [0, 0, 0] })],
      wm,
      remoteIds,
    );
    expect(second.closed).toEqual(['holo-1']);
    expect(wm.getWindow('holo-1')).toBeUndefined();
    expect(wm.getWindow('holo-2')!.position).toEqual(new THREE.Vector3(0, 0, 0));
    expect(wm.getWindow('notes-1')).toBeDefined();
  });
});

describe('M12 edge: remote window closed while hovered (brief 2c)', () => {
  it('the next POINT frame emits hover-null (M6 eviction path)', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    scene.add(camera);
    const wm = new WM(scene);
    const engine = new InteractionEngine(camera, wm);
    const remoteIds = new Set<string>();

    // Remote window centered at the origin; hovered via a POINT ray that
    // passes exactly through its center.
    applyRemoteWindow(wire({ position: [0, 0, 0], scale: 1.5 }), wm, remoteIds);
    scene.updateMatrixWorld(true);
    const pointAtCenter: Gesture = {
      type: GestureType.POINT,
      confidence: 0.85,
      intensity: 0.5,
      handedness: 'Right',
      timestamp: 0,
      position: new THREE.Vector3(0, 0, 0),
    };
    const hoverEvents = engine.processGesture(pointAtCenter, 0);
    expect(hoverEvents.some((e) => e.type === 'hover' && e.targetId === 'holo-1')).toBe(true);

    // The owner closes it (close propagates as a snapshot -> reconcile).
    reconcileSnapshot([], wm, remoteIds);
    scene.updateMatrixWorld(true);
    const after = engine.processGesture(pointAtCenter, 100);
    expect(after.some((e) => e.type === 'hover' && e.targetId === null)).toBe(true);
    expect(GESTURE_WORLD_HALF_EXTENT).toBe(5); // import-guard (NDC convention)
  });
});
