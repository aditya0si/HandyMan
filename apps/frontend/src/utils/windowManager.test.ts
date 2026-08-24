import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  WindowManager,
  WINDOW_ASPECT,
  WINDOW_BASE_WIDTH,
  WINDOW_DEPTH_SCALE,
  WINDOW_HIGHLIGHT_BASE,
  WINDOW_HIGHLIGHT_RANGE,
  HIGHLIGHT_LEVEL_GRABBED,
  HIGHLIGHT_LEVEL_HOVER,
  resolveHighlightLevel,
  wrapToPi,
} from './windowManager';

/**
 * WindowManager unit tests (node environment — three.js meshes, scenes and
 * raycasts are pure math, no DOM/WebGL needed). The core invariant asserted
 * after every operation: the state record and the mesh agree (position,
 * scale, visibility) — the manager must never let them drift apart.
 */
function setup() {
  const scene = new THREE.Scene();
  const wm = new WindowManager(scene);
  return { scene, wm };
}

function meshOf(wm: WindowManager, id: string): THREE.Mesh {
  const mesh = wm.getWindowMesh(id);
  expect(mesh).toBeDefined();
  return mesh as THREE.Mesh;
}

describe('WindowManager.createWindow', () => {
  it('adds a 16:9 grabbable plane mesh to the scene with matching state', () => {
    const { scene, wm } = setup();
    const pos = new THREE.Vector3(-1.5, 1.5, -2);
    const w = wm.createWindow('w1', 'Test', pos);

    const mesh = meshOf(wm, 'w1');
    expect(scene.children).toContain(mesh);
    expect(mesh.userData.windowId).toBe('w1');
    expect(mesh.userData.isGrabbable).toBe(true);
    expect(mesh.geometry).toBeInstanceOf(THREE.PlaneGeometry);
    expect(mesh.position).toEqual(w.position);
    expect(mesh.scale).toEqual(w.scale);

    // Default scale is a 16:9 ratio in world units.
    expect(w.scale.x).toBe(WINDOW_BASE_WIDTH);
    expect(w.scale.x / w.scale.y).toBeCloseTo(WINDOW_ASPECT, 10);
    expect(w.scale.z).toBe(WINDOW_DEPTH_SCALE);
    expect(w.aspect).toBe(WINDOW_ASPECT);
    expect(w.isMinimized).toBe(false);
    expect(w.zIndex).toBe(1);
    expect(w.position).toEqual(pos);
  });

  it('rejects duplicate window ids', () => {
    const { wm } = setup();
    wm.createWindow('w1', 'Test');
    expect(() => wm.createWindow('w1', 'Dup')).toThrow(/already exists/);
  });

  it('assigns increasing zIndex by creation order', () => {
    const { wm } = setup();
    wm.createWindow('w1', 'A');
    wm.createWindow('w2', 'B');
    wm.createWindow('w3', 'C');
    const [a, b, c] = wm.getAllWindows();
    expect([a.zIndex, b.zIndex, c.zIndex]).toEqual([1, 2, 3]);
  });
});

describe('WindowManager.mutateWindow', () => {
  it('moveWindow keeps state and mesh in lockstep and copies (no aliasing)', () => {
    const { wm } = setup();
    wm.createWindow('w1', 'Test');
    const target = new THREE.Vector3(2, 1, -3);
    wm.moveWindow('w1', target);

    expect(wm.getWindow('w1')!.position).toEqual(target);
    expect(meshOf(wm, 'w1').position).toEqual(target);

    // The caller's vector is copied, not referenced.
    target.set(99, 99, 99);
    expect(wm.getWindow('w1')!.position.x).toBe(2);
  });

  it('resizeWindow compounds multiplyScalar and syncs the mesh', () => {
    const { wm } = setup();
    wm.createWindow('w1', 'Test');
    const before = wm.getWindow('w1')!.scale.clone();

    wm.resizeWindow('w1', 1.1);
    wm.resizeWindow('w1', 1.2); // compound: 1.1 * 1.2 = 1.32

    const scale = wm.getWindow('w1')!.scale;
    expect(scale.x).toBeCloseTo(before.x * 1.32, 10);
    expect(scale.y).toBeCloseTo(before.y * 1.32, 10);
    expect(scale.z).toBeCloseTo(before.z * 1.32, 10);
    expect(meshOf(wm, 'w1').scale).toEqual(scale);
    // The 16:9 footprint ratio survives compound resizes.
    expect(scale.x / scale.y).toBeCloseTo(WINDOW_ASPECT, 10);
  });

  it('minimize hides the mesh, restore shows it (state in lockstep)', () => {
    const { wm } = setup();
    wm.createWindow('w1', 'Test');
    const mesh = meshOf(wm, 'w1');

    wm.minimizeWindow('w1');
    expect(wm.getWindow('w1')!.isMinimized).toBe(true);
    expect(mesh.visible).toBe(false);

    wm.restoreWindow('w1');
    expect(wm.getWindow('w1')!.isMinimized).toBe(false);
    expect(mesh.visible).toBe(true);
  });

  it('bringToFront assigns a strictly increasing zIndex', () => {
    const { wm } = setup();
    wm.createWindow('w1', 'A');
    wm.createWindow('w2', 'B');
    wm.createWindow('w3', 'C');

    wm.bringToFront('w1');
    expect(wm.getWindow('w1')!.zIndex).toBe(4);
    wm.bringToFront('w3');
    expect(wm.getWindow('w3')!.zIndex).toBe(5);
    // Ordering: w3 front, then w1, w2 still last.
    expect(wm.getWindow('w2')!.zIndex).toBeLessThan(wm.getWindow('w1')!.zIndex);
    expect(wm.getWindow('w1')!.zIndex).toBeLessThan(wm.getWindow('w3')!.zIndex);
  });

  it('operations on unknown ids are silent no-ops (and do not notify)', () => {
    const { wm } = setup();
    wm.createWindow('w1', 'Test');
    wm.setOnChange(() => {
      throw new Error('onChange must not fire for unknown ids');
    });
    expect(() => {
      wm.moveWindow('nope', new THREE.Vector3());
      wm.resizeWindow('nope', 2);
      wm.minimizeWindow('nope');
      wm.restoreWindow('nope');
      wm.bringToFront('nope');
      wm.closeWindow('nope');
    }).not.toThrow();
    expect(wm.getAllWindows()).toHaveLength(1);
  });
});

describe('WindowManager.closeWindow', () => {
  it('removes the mesh from the scene, disposes resources and clears state', () => {
    const { scene, wm } = setup();
    wm.createWindow('w1', 'Test');
    const mesh = meshOf(wm, 'w1');
    const geometrySpy = vi.spyOn(mesh.geometry, 'dispose');
    const materialSpy = vi.spyOn(mesh.material as THREE.Material, 'dispose');

    wm.closeWindow('w1');

    expect(scene.children).not.toContain(mesh);
    expect(wm.getWindow('w1')).toBeUndefined();
    expect(wm.getWindowMesh('w1')).toBeUndefined();
    expect(geometrySpy).toHaveBeenCalledTimes(1);
    expect(materialSpy).toHaveBeenCalledTimes(1);

    // Closing again is a silent no-op (already gone).
    expect(() => wm.closeWindow('w1')).not.toThrow();
  });

  it('closing one window leaves the others untouched', () => {
    const { scene, wm } = setup();
    wm.createWindow('w1', 'A');
    wm.createWindow('w2', 'B');
    wm.closeWindow('w1');

    expect(wm.getAllWindows().map((w) => w.id)).toEqual(['w2']);
    expect(scene.children).toContain(meshOf(wm, 'w2'));
  });
});

describe('WindowManager.getGrabbableMeshes', () => {
  it('returns only visible, non-minimized window meshes', () => {
    const { scene, wm } = setup();
    wm.createWindow('w1', 'A');
    wm.createWindow('w2', 'B');

    expect(wm.getGrabbableMeshes().map((m) => m.userData.windowId)).toEqual(['w1', 'w2']);

    wm.minimizeWindow('w1');
    expect(wm.getGrabbableMeshes().map((m) => m.userData.windowId)).toEqual(['w2']);

    wm.restoreWindow('w1');
    wm.minimizeWindow('w2');
    expect(wm.getGrabbableMeshes().map((m) => m.userData.windowId)).toEqual(['w1']);

    // Non-window scene objects (grid, cube, raw meshes) are never included.
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshPhongMaterial()));
    scene.add(new THREE.GridHelper(10, 10));
    expect(wm.getGrabbableMeshes()).toHaveLength(1);
    expect(wm.getGrabbableMeshes()[0].userData.windowId).toBe('w1');
  });
});

describe('WindowManager.change notification', () => {
  it('fires onChange and bumps the version on every successful mutation', () => {
    const { wm } = setup();
    const changes: string[] = [];
    wm.setOnChange(() => changes.push('changed'));
    const initialVersion = wm.version;

    wm.createWindow('w1', 'Test');
    wm.moveWindow('w1', new THREE.Vector3(1, 1, 0));
    wm.resizeWindow('w1', 1.1);
    wm.minimizeWindow('w1');
    wm.restoreWindow('w1');
    wm.bringToFront('w1');
    wm.closeWindow('w1');

    expect(changes).toHaveLength(7);
    expect(wm.version).toBe(initialVersion + 7);
  });

  it('unset callback means no notification and no error', () => {
    const { wm } = setup();
    wm.createWindow('w1', 'Test');
    wm.setOnChange(null);
    expect(() => wm.moveWindow('w1', new THREE.Vector3())).not.toThrow();
  });
});

describe('WindowManager mesh/state lockstep through an op sequence', () => {
  it('state and mesh agree after every step of a mixed sequence', () => {
    const { wm } = setup();
    wm.createWindow('w1', 'Test', new THREE.Vector3(0, 2, -1));
    const check = () => {
      const w = wm.getWindow('w1')!;
      const mesh = meshOf(wm, 'w1');
      expect(mesh.position).toEqual(w.position);
      expect(mesh.scale).toEqual(w.scale);
      expect(mesh.visible).toBe(!w.isMinimized);
    };

    check();
    wm.moveWindow('w1', new THREE.Vector3(-2, 1, 0));
    check();
    wm.resizeWindow('w1', 0.5);
    check();
    wm.resizeWindow('w1', 2);
    check();
    wm.minimizeWindow('w1');
    check();
    wm.restoreWindow('w1');
    check();
    wm.bringToFront('w1');
    check();
  });
});

describe('WindowManager.setWindowHighlight (M6, D6)', () => {
  function emissiveOf(wm: WindowManager, id: string): number {
    return (meshOf(wm, id).material as THREE.MeshPhongMaterial).emissiveIntensity;
  }

  it('createWindow defaults: highlight 0, material at WINDOW_HIGHLIGHT_BASE', () => {
    const { wm } = setup();
    const w = wm.createWindow('w1', 'Test');
    expect(w.highlight).toBe(0);
    expect(emissiveOf(wm, 'w1')).toBe(WINDOW_HIGHLIGHT_BASE);
  });

  it('setWindowHighlight writes state + material in lockstep and notifies', () => {
    const { wm } = setup();
    wm.createWindow('w1', 'Test');
    const changes: string[] = [];
    wm.setOnChange(() => changes.push('changed'));
    const versionBefore = wm.version;

    wm.setWindowHighlight('w1', 0.5);

    expect(wm.getWindow('w1')!.highlight).toBe(0.5);
    expect(emissiveOf(wm, 'w1')).toBeCloseTo(
      WINDOW_HIGHLIGHT_BASE + 0.5 * WINDOW_HIGHLIGHT_RANGE,
      10,
    );
    expect(changes).toEqual(['changed']);
    expect(wm.version).toBe(versionBefore + 1);
  });

  it('clamps the level to [0, 1] (state and emissive witness)', () => {
    const { wm } = setup();
    wm.createWindow('w1', 'Test');
    const mesh = meshOf(wm, 'w1');

    // Level 2 clamps to 1: emissive hits its max 0.5 by construction.
    wm.setWindowHighlight('w1', 2);
    expect(wm.getWindow('w1')!.highlight).toBe(1);
    expect((mesh.material as THREE.MeshPhongMaterial).emissiveIntensity).toBeCloseTo(
      WINDOW_HIGHLIGHT_BASE + WINDOW_HIGHLIGHT_RANGE,
      10,
    );

    // Level -1 clamps to 0: resting emissive.
    wm.setWindowHighlight('w1', -1);
    expect(wm.getWindow('w1')!.highlight).toBe(0);
    expect((mesh.material as THREE.MeshPhongMaterial).emissiveIntensity).toBeCloseTo(
      WINDOW_HIGHLIGHT_BASE,
      10,
    );
  });

  it('idempotent: setting the current level again does NOT notify', () => {
    const { wm } = setup();
    wm.createWindow('w1', 'Test');
    wm.setWindowHighlight('w1', 0.5);
    const changes: string[] = [];
    wm.setOnChange(() => changes.push('changed'));
    const versionBefore = wm.version;

    wm.setWindowHighlight('w1', 0.5);

    expect(changes).toEqual([]);
    expect(wm.version).toBe(versionBefore);
    expect(wm.getWindow('w1')!.highlight).toBe(0.5);
  });

  it('unknown id: silent no-op, no notify', () => {
    const { wm } = setup();
    wm.createWindow('w1', 'Test');
    wm.setOnChange(() => {
      throw new Error('onChange must not fire for unknown ids');
    });
    expect(() => wm.setWindowHighlight('nope', 0.5)).not.toThrow();
    expect(wm.getWindow('w1')!.highlight).toBe(0);
  });

  it('lockstep: highlight survives moveWindow/resizeWindow', () => {
    const { wm } = setup();
    wm.createWindow('w1', 'Test');
    wm.setWindowHighlight('w1', 0.5);
    wm.moveWindow('w1', new THREE.Vector3(1, 1, 0));
    wm.resizeWindow('w1', 1.2);

    expect(wm.getWindow('w1')!.highlight).toBe(0.5);
    expect(emissiveOf(wm, 'w1')).toBeCloseTo(
      WINDOW_HIGHLIGHT_BASE + 0.5 * WINDOW_HIGHLIGHT_RANGE,
      10,
    );
    expect(wm.getWindow('w1')!.position).toEqual(new THREE.Vector3(1, 1, 0));
  });

  it('resolveHighlightLevel truth table: grabbed wins over hover, none -> 0', () => {
    expect(resolveHighlightLevel(true, true)).toBe(HIGHLIGHT_LEVEL_GRABBED);
    expect(resolveHighlightLevel(true, false)).toBe(HIGHLIGHT_LEVEL_GRABBED);
    expect(resolveHighlightLevel(false, true)).toBe(HIGHLIGHT_LEVEL_HOVER);
    expect(resolveHighlightLevel(false, false)).toBe(0);
  });
});

describe('WindowManager.wrapToPi + rotateWindow (M7, D3)', () => {
  it('wrapToPi truth table: normalizes every angle to [-PI, PI) with +PI -> -PI', () => {
    expect(wrapToPi(0)).toBeCloseTo(0, 10);
    expect(wrapToPi(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 10);
    // Canonical edge: +PI maps to -PI (same rotation, one representation).
    expect(wrapToPi(Math.PI)).toBeCloseTo(-Math.PI, 10);
    expect(wrapToPi(-Math.PI)).toBeCloseTo(-Math.PI, 10);
    expect(wrapToPi((3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 10);
    expect(wrapToPi((7 * Math.PI) / 4)).toBeCloseTo(-Math.PI / 4, 10);
    expect(wrapToPi(2 * Math.PI + 0.1)).toBeCloseTo(0.1, 10);
    expect(wrapToPi(-2 * Math.PI - 0.1)).toBeCloseTo(-0.1, 10);
  });

  it('rotateWindow writes state + mesh rotation in lockstep and notifies once', () => {
    const { wm } = setup();
    wm.createWindow('w1', 'Test');
    const changes: string[] = [];
    wm.setOnChange(() => changes.push('changed'));
    const versionBefore = wm.version;

    wm.rotateWindow('w1', 1.2);

    expect(wm.getWindow('w1')!.rotation.y).toBeCloseTo(1.2, 10);
    expect(meshOf(wm, 'w1').rotation.y).toBeCloseTo(1.2, 10);
    // Y-axis only: X/Z untouched in BOTH witnesses.
    expect(wm.getWindow('w1')!.rotation.x).toBe(0);
    expect(wm.getWindow('w1')!.rotation.z).toBe(0);
    expect(meshOf(wm, 'w1').rotation.x).toBe(0);
    expect(meshOf(wm, 'w1').rotation.z).toBe(0);
    expect(changes).toEqual(['changed']);
    expect(wm.version).toBe(versionBefore + 1);
  });

  it('normalizes in BOTH witnesses (state and mesh) and chains correctly', () => {
    const { wm } = setup();
    wm.createWindow('w1', 'Test');

    wm.rotateWindow('w1', (7 * Math.PI) / 4);
    expect(wm.getWindow('w1')!.rotation.y).toBeCloseTo(-Math.PI / 4, 10);
    expect(meshOf(wm, 'w1').rotation.y).toBeCloseTo(-Math.PI / 4, 10);

    wm.rotateWindow('w1', 3 * Math.PI);
    expect(wm.getWindow('w1')!.rotation.y).toBeCloseTo(-Math.PI, 10);
    expect(meshOf(wm, 'w1').rotation.y).toBeCloseTo(-Math.PI, 10);

    wm.rotateWindow('w1', Math.PI / 2);
    wm.rotateWindow('w1', (3 * Math.PI) / 2);
    expect(wm.getWindow('w1')!.rotation.y).toBeCloseTo(-Math.PI / 2, 10);
    expect(meshOf(wm, 'w1').rotation.y).toBeCloseTo(-Math.PI / 2, 10);
  });

  it('unknown id: silent no-op, no notify', () => {
    const { wm } = setup();
    wm.createWindow('w1', 'Test');
    wm.setOnChange(() => {
      throw new Error('onChange must not fire for unknown ids');
    });
    expect(() => wm.rotateWindow('nope', 1)).not.toThrow();
    expect(wm.getWindow('w1')!.rotation.y).toBe(0);
  });

  it('rotation survives move/resize and vice versa', () => {
    const { wm } = setup();
    wm.createWindow('w1', 'Test');

    wm.rotateWindow('w1', 1.0);
    wm.moveWindow('w1', new THREE.Vector3(2, 1, -3));
    wm.resizeWindow('w1', 1.2);
    expect(wm.getWindow('w1')!.rotation.y).toBeCloseTo(1.0, 10);
    expect(meshOf(wm, 'w1').rotation.y).toBeCloseTo(1.0, 10);
    expect(wm.getWindow('w1')!.position).toEqual(new THREE.Vector3(2, 1, -3));
    expect(meshOf(wm, 'w1').position).toEqual(new THREE.Vector3(2, 1, -3));

    // The reverse order: a move before a rotate leaves the rotate exact.
    wm.createWindow('w2', 'B');
    wm.moveWindow('w2', new THREE.Vector3(0, 0, -2));
    wm.rotateWindow('w2', 0.7);
    expect(wm.getWindow('w2')!.rotation.y).toBeCloseTo(0.7, 10);
    expect(wm.getWindow('w2')!.position).toEqual(new THREE.Vector3(0, 0, -2));
  });
});

// M12 (D5): absolute zIndex writes for remote stacking orders — local
// allocation stays strictly monotonic above any remote value.
describe('WindowManager M12 setZIndex', () => {
  it('writes the absolute zIndex and lifts nextZIndex above it', () => {
    const scene = new THREE.Scene();
    const wm = new WindowManager(scene);
    const first = wm.createWindow('a', 'A');
    expect(first.zIndex).toBe(1);
    wm.setZIndex('a', 7);
    expect(wm.getWindow('a')!.zIndex).toBe(7);
    // A window created after the remote zIndex outranks it.
    const second = wm.createWindow('b', 'B');
    expect(second.zIndex).toBe(8);
    // Unknown ids are silent no-ops.
    wm.setZIndex('ghost', 99);
    expect(wm.getWindow('a')!.zIndex).toBe(7);
  });
});
