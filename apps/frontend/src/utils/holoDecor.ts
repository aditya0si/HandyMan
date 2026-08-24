import * as THREE from 'three';

/**
 * M12 Part A holographic scene decoration (brief A4): two slowly
 * counter-rotating cyan rings at floor level + one glowing connector spoke
 * per floating window, from a low hub point to the window's center — the
 * reference image's radial "energy lines" read.
 *
 * Contract:
 * - NEVER interaction-relevant: nothing here is added to the WindowManager,
 *   so getGrabbableMeshes() can never return it, and the engine raycasts
 *   that list non-recursively. Pure scene dressing.
 * - `sync` is called from App's rAF ONLY when the WindowManager version
 *   changed (cost guard — no per-frame allocation in the steady state);
 *   `update` is called every frame and only writes two ring rotations
 *   (deterministic from the timestamp — StrictMode-safe, unit-pinned).
 * - `dispose` removes the group and frees every geometry/material
 *   (per-scene replacement, the M11 manager pattern).
 */

/** Where the connector spokes originate (the central pearl orb). */
export const HOLO_HUB_POINT = new THREE.Vector3(0, 0, 0);

/** Ring spin rates (radians per ms) — slow, opposite directions. */
export const HOLO_RING_SPEED_INNER = 0.00012;
export const HOLO_RING_SPEED_OUTER = -0.00008;

/** One window reference for sync(): the live world position per id. */
export interface DecorWindowRef {
  id: string;
  position: THREE.Vector3;
}

function makeRing(
  innerRadius: number,
  outerRadius: number,
  opacity: number,
): THREE.Mesh {
  const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 64);
  geometry.rotateX(-Math.PI / 2); // lie flat on the floor
  const material = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.isDecor = true;
  // Raycast-inert dressing (see windowManager's edge frame): no caller's
  // ray, recursive or not, can ever hit the rings.
  mesh.raycast = () => {};
  return mesh;
}

export class HoloDecor {
  readonly group = new THREE.Group();
  private readonly scene: THREE.Scene;
  /** Turntables are public for unit-test rotation pins (M12 Part A). */
  readonly innerTurntable = new THREE.Object3D();
  readonly outerTurntable = new THREE.Object3D();
  private readonly connectors = new Map<string, THREE.Line>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const inner = makeRing(1.08, 1.1, 0.32);
    const outer = makeRing(1.68, 1.695, 0.16);
    this.innerTurntable.add(inner);
    this.outerTurntable.add(outer);
    this.group.add(this.innerTurntable, this.outerTurntable);
    this.group.position.y = -1.55; // below the window band, floating in the void
    scene.add(this.group);
  }

  /**
   * Reconciles one connector line per window id and rewrites its far
   * endpoint from the live position. Lines for gone ids are removed and
   * disposed (windows close; spokes must not linger).
   */
  sync(windows: readonly DecorWindowRef[]): void {
    const seen = new Set<string>();
    for (const win of windows) {
      seen.add(win.id);
      let line = this.connectors.get(win.id);
      if (!line) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          'position',
          new THREE.BufferAttribute(new Float32Array(6), 3),
        );
        const material = new THREE.LineBasicMaterial({
          color: 0x00e5ff,
          transparent: true,
          opacity: 0.15,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        line = new THREE.Line(geometry, material);
        line.userData.isDecor = true;
        line.raycast = () => {}; // raycast-inert dressing
        this.connectors.set(win.id, line);
        this.group.add(line);
      }
      const positions = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      positions.setXYZ(0, HOLO_HUB_POINT.x, HOLO_HUB_POINT.y - this.group.position.y, HOLO_HUB_POINT.z);
      positions.setXYZ(1, win.position.x, win.position.y - this.group.position.y, win.position.z);
      positions.needsUpdate = true;
    }
    for (const [id, line] of this.connectors) {
      if (seen.has(id)) continue;
      this.group.remove(line);
      line.geometry.dispose();
      if (Array.isArray(line.material)) {
        line.material.forEach((m) => m.dispose());
      } else {
        line.material.dispose();
      }
      this.connectors.delete(id);
    }
  }

  /** Ring rotation only — deterministic from the rAF timestamp. */
  update(nowMs: number): void {
    this.innerTurntable.rotation.y = nowMs * HOLO_RING_SPEED_INNER;
    this.outerTurntable.rotation.y = nowMs * HOLO_RING_SPEED_OUTER;
  }

  /** Connector count (unit tests + sanity). */
  get connectorCount(): number {
    return this.connectors.size;
  }

  /** Removes the group from the scene and frees every GPU resource. */
  dispose(): void {
    this.sync([]); // disposes all connector lines
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
        else mesh.material.dispose();
      }
    });
    this.scene.remove(this.group);
  }
}
