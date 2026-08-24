import * as THREE from 'three';
import type { WindowState } from '@jarvis/shared';
import type { WindowManager } from './windowManager';

/**
 * M12 remote-window application (brief D4). The M11 server NEVER echoes a
 * client's own window mutations (windowUpsert/windowClose broadcasts EXCLUDE
 * the sender — pinned by the backend integration suite), so everything that
 * arrives here via windowSync/stateSnapshot is definitionally ANOTHER user's
 * window: no self-identity is needed, and the backend stays untouched.
 *
 * The registry (`remoteIds`) is the ownership oracle the App shares with the
 * InteractionEngine's isEditable predicate (brief D2): an id enters it ONLY
 * by being materialized here, and a locally-created window's id can never
 * enter it (the skip-local arm below) — so a locally-grabbed window can
 * never flip to non-editable mid-grab.
 */

/** Structural slice of WindowManager (position/rotation setters via the
 *  real class; typed as a minimal interface so tests can pass the real
 *  manager and the module stays decoupled). */
export interface RemoteWindowManager
  extends Pick<
    WindowManager,
    | 'getWindow'
    | 'createWindow'
    | 'moveWindow'
    | 'rotateWindow'
    | 'resizeWindow'
    | 'setZIndex'
    | 'closeWindow'
  > {}

export type RemoteApplyResult = 'created' | 'updated' | 'skipped-local';

function applyFields(
  state: WindowState,
  wm: RemoteWindowManager,
  isNew: boolean,
): void {
  const position = new THREE.Vector3(state.position[0], state.position[1], state.position[2]);
  if (isNew) {
    // createWindow's default scale is WINDOW_BASE_WIDTH; resize is
    // COMPOUND (factor), so create first at the base then scale to the
    // wire value. Position rides createWindow's initialPosition.
    wm.createWindow(state.id, state.title, position);
  } else {
    wm.moveWindow(state.id, position);
  }
  wm.rotateWindow(state.id, state.rotationY);
  const current = wm.getWindow(state.id);
  if (current && current.scale.x !== 0) {
    wm.resizeWindow(state.id, state.scale / current.scale.x);
  }
  wm.setZIndex(state.id, state.zIndex);
}

/**
 * Applies one remote window. Registry ids are updated (or recreated if the
 * local copy vanished); unknown ids are CREATED + registered; a window that
 * exists locally but is NOT in the registry is one of OUR OWN windows seen
 * in a snapshot (e.g. a previous session created the same boot id — the
 * server's first-creator-wins keeps the OLD owner) — skip: the local fresh
 * view wins and the bridge's next diff overwrites the server copy.
 */
export function applyRemoteWindow(
  state: WindowState,
  wm: RemoteWindowManager,
  remoteIds: Set<string>,
): RemoteApplyResult {
  if (remoteIds.has(state.id)) {
    // Already-materialized remote window: apply, recreating if our local
    // copy was closed while the owner kept it.
    applyFields(state, wm, !wm.getWindow(state.id));
    return 'updated';
  }
  if (wm.getWindow(state.id)) return 'skipped-local';
  // Register BEFORE applying: applyFields notifies onChange per mutation,
  // and the App's window-sync bridge filters registry ids — registering
  // first guarantees the fresh remote window is never re-upserted by us.
  remoteIds.add(state.id);
  applyFields(state, wm, true);
  return 'created';
}

export type RemoteCloseResult = 'closed' | 'skipped-local' | 'unknown';

/**
 * Applies a remote close. Only registry ids are closable — a locally-owned
 * window's close can never arrive here (the server excludes the sender, and
 * only the owner's client sends closes for it).
 */
export function applyRemoteClose(
  id: string,
  wm: RemoteWindowManager,
  remoteIds: Set<string>,
): RemoteCloseResult {
  if (remoteIds.has(id)) {
    wm.closeWindow(id);
    remoteIds.delete(id);
    return 'closed';
  }
  if (wm.getWindow(id)) return 'skipped-local';
  return 'unknown';
}

export interface ReconcileResult {
  created: string[];
  updated: string[];
  closed: string[];
}

/**
 * Snapshot reconciliation: apply every wire window, then close registry ids
 * ABSENT from the snapshot (the owner closed it — closes propagate as a
 * full snapshot, M11 D8). Locally-owned windows are never touched.
 */
export function reconcileSnapshot(
  windows: readonly WindowState[],
  wm: RemoteWindowManager,
  remoteIds: Set<string>,
): ReconcileResult {
  const result: ReconcileResult = { created: [], updated: [], closed: [] };
  const present = new Set<string>();
  for (const state of windows) {
    present.add(state.id);
    const outcome = applyRemoteWindow(state, wm, remoteIds);
    if (outcome === 'created') result.created.push(state.id);
    else if (outcome === 'updated') result.updated.push(state.id);
  }
  for (const id of [...remoteIds]) {
    if (!present.has(id)) {
      const outcome = applyRemoteClose(id, wm, remoteIds);
      if (outcome === 'closed') result.closed.push(id);
    }
  }
  return result;
}

/**
 * M13 (D13): applies one window's wire fields to the WindowManager with
 * NO registry semantics — the Load-workspace path uses this to recreate
 * saved windows as locally-owned (create-if-absent, then position/
 * rotation/scale-factor/zIndex).
 */
export function applyWindowStateFields(
  wm: RemoteWindowManager,
  state: WindowState,
): void {
  applyFields(state, wm, !wm.getWindow(state.id));
}
