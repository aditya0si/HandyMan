import * as THREE from 'three';

/**
 * Window creation/shape constants (guide step 3.2). The default scale is a
 * 16:9 ratio in world units: scale.x is WINDOW_BASE_WIDTH and scale.y is
 * WINDOW_BASE_WIDTH / WINDOW_ASPECT (the guide hardcoded 0.844 for 1.5 wide —
 * 1.5 / (16/9) = 0.84375 — computed here so the ratio stays exact).
 */
export const WINDOW_ASPECT = 16 / 9;

/** Base world width (scale.x) of a created window. */
export const WINDOW_BASE_WIDTH = 1.5;

/** Thin "card" thickness so the plane reads as a 3D object from the side. */
export const WINDOW_DEPTH_SCALE = 0.1;

/** Resting emissiveIntensity of window meshes (unchanged from M1-M5). */
export const WINDOW_HIGHLIGHT_BASE = 0.1;

/** emissiveIntensity = WINDOW_HIGHLIGHT_BASE + level * WINDOW_HIGHLIGHT_RANGE. */
export const WINDOW_HIGHLIGHT_RANGE = 0.4;

/** Highlight level for a POINT-hovered window (D6). */
export const HIGHLIGHT_LEVEL_HOVER = 0.5;

/** Highlight level for a grabbed window (D6). */
export const HIGHLIGHT_LEVEL_GRABBED = 1;

/** M6 highlight priority rule (D6): grabbed wins over hover; none -> 0. */
export function resolveHighlightLevel(isGrabbed: boolean, isHovered: boolean): number {
  if (isGrabbed) return HIGHLIGHT_LEVEL_GRABBED;
  if (isHovered) return HIGHLIGHT_LEVEL_HOVER;
  return 0;
}

/**
 * Window state for one floating window (guide step 3.2), DEVIATION: the
 * guide's interface also carries `content: React.ReactNode`. Content is a
 * React concern owned by App, so it is NOT part of this state — keeping the
 * manager DOM-free makes it unit-testable in node (no jsdom/React needed).
 */
export interface FloatingWindow {
  id: string;
  title: string;
  position: THREE.Vector3;
  scale: THREE.Vector3;
  rotation: THREE.Euler;
  isMinimized: boolean;
  /** Stacking order; higher = closer to the user (HUD/panels use 20). */
  zIndex: number;
  /** Plane geometry aspect (width/height) — independent of scale. */
  aspect: number;
  /** M6 highlight level 0..1 (0 = resting). The mesh's emissiveIntensity is
   *  WINDOW_HIGHLIGHT_BASE + highlight * WINDOW_HIGHLIGHT_RANGE (D6). */
  highlight: number;
}

/** Wraps an angle in radians to [-PI, PI). +PI maps to -PI (same rotation,
 *  one canonical representation). */
export function wrapToPi(angle: number): number {
  const twoPi = Math.PI * 2;
  return (((angle + Math.PI) % twoPi) + twoPi) % twoPi - Math.PI;
}

/**
 * Owns floating windows as (state, mesh) pairs (guide step 3.2). Every
 * mutation updates BOTH the state record and the mesh so they can never
 * drift apart (the unit tests assert this lockstep after each op).
 *
 * - createWindow: 16:9 PlaneGeometry(1, 1/aspect) with an emissive
 *   MeshPhongMaterial, marked grabbable in userData.
 * - resizeWindow multiplies scale (compound), it does not set absolute.
 * - closeWindow disposes geometry + material (scene cleanup stays leak-free).
 * - getGrabbableMeshes returns only visible, non-minimized window meshes —
 *   the ONLY objects the InteractionEngine raycasts against (the guide
 *   raycasts the whole scene, where the GridHelper / M1 cube would intercept).
 * - onChange notification (callback + monotonic version counter) lets App
 *   re-sync React state without polling after any mutation.
 * - M6 highlight contract (D6): each window carries a `highlight` level
 *   0..1 (0 at creation). setWindowHighlight writes BOTH state and mesh
 *   material in lockstep: emissiveIntensity = WINDOW_HIGHLIGHT_BASE +
 *   level * WINDOW_HIGHLIGHT_RANGE (in [0.1, 0.5] by construction when the
 *   level is clamped to [0,1]). Setting the current level again is a
 *   no-op WITHOUT notify (idempotent — App's priority recompute on release
 *   must not churn); unknown ids are silent no-ops like every other op.
 * - M7 rotation (D3): rotateWindow sets the Y-axis rotation (absolute,
 *   wrapped to [-PI, PI)) in lockstep. createWindowMesh still does NOT copy
 *   rotation — a fresh window is always rotation 0 (mesh.rotation stays a
 *   zero Euler until the first rotateWindow).
 */
export class WindowManager {
  private readonly scene: THREE.Scene;
  private readonly windows = new Map<string, FloatingWindow>();
  private readonly windowMeshes = new Map<string, THREE.Mesh>();
  private nextZIndex = 1;
  private versionCounter = 0;
  private onChangeCallback: (() => void) | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Registers a listener fired after every mutation (App syncs React state). */
  setOnChange(callback: (() => void) | null): void {
    this.onChangeCallback = callback;
  }

  /** Monotonic mutation counter (snapshot-based sync alternative to onChange). */
  get version(): number {
    return this.versionCounter;
  }

  createWindow(
    id: string,
    title: string,
    initialPosition: THREE.Vector3 = new THREE.Vector3(0, 0, 0),
    baseWidth: number = WINDOW_BASE_WIDTH,
  ): FloatingWindow {
    if (this.windows.has(id)) {
      throw new Error(`WindowManager: window "${id}" already exists`);
    }
    const window: FloatingWindow = {
      id,
      title,
      position: initialPosition.clone(),
      scale: new THREE.Vector3(
        baseWidth,
        baseWidth / WINDOW_ASPECT,
        WINDOW_DEPTH_SCALE,
      ),
      rotation: new THREE.Euler(),
      isMinimized: false,
      zIndex: this.nextZIndex++,
      aspect: WINDOW_ASPECT,
      highlight: 0,
    };

    this.windows.set(id, window);
    const mesh = this.createWindowMesh(window);
    this.windowMeshes.set(id, mesh);
    this.scene.add(mesh);
    this.notifyChanged();
    return window;
  }

  moveWindow(id: string, newPosition: THREE.Vector3): void {
    const window = this.windows.get(id);
    if (!window) return;
    window.position.copy(newPosition);
    this.windowMeshes.get(id)?.position.copy(newPosition);
    this.notifyChanged();
  }

  /** Multiplies the window's scale by `factor` with safe min/max scale clamping. */
  resizeWindow(id: string, factor: number): void {
    const window = this.windows.get(id);
    if (!window) return;
    const targetScaleX = window.scale.x * factor;
    const minScale = 0.4;
    const maxScale = 8.0;
    if (targetScaleX < minScale || targetScaleX > maxScale) {
      const clampedScaleX = Math.max(minScale, Math.min(maxScale, targetScaleX));
      const effectiveFactor = clampedScaleX / window.scale.x;
      window.scale.multiplyScalar(effectiveFactor);
    } else {
      window.scale.multiplyScalar(factor);
    }
    this.windowMeshes.get(id)?.scale.copy(window.scale);
    this.notifyChanged();
  }

  /**
   * M7 (D3): sets the window's Y-axis rotation (absolute, normalized to
   * [-PI, PI)), writing BOTH the state record and the mesh in lockstep —
   * exactly the move/resize pattern. Y-axis only (turntable spin): X/Z tilt
   * needs wrist orientation MediaPipe does not provide reliably (landmark z
   * is wrist-relative). Unknown ids are silent no-ops; a real write always
   * notifies (like moveWindow — the ENGINE gates redundant calls).
   */
  rotateWindow(id: string, angleY: number): void {
    const window = this.windows.get(id);
    if (!window) return;
    window.rotation.y = wrapToPi(angleY);
    this.windowMeshes.get(id)!.rotation.y = window.rotation.y;
    this.notifyChanged();
  }

  /** Removes the window and disposes its GPU resources (geometry/material). */
  closeWindow(id: string): void {
    const window = this.windows.get(id);
    if (!window) return;
    this.windows.delete(id);
    const mesh = this.windowMeshes.get(id);
    if (mesh) {
      this.scene.remove(mesh);
      // M12 Part A: dispose the wireframe edge child's resources too
      // (same leak-free contract as the pane itself).
      for (const child of mesh.children) {
        if (child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose());
      } else {
        mesh.material.dispose();
      }
    }
    this.windowMeshes.delete(id);
    this.notifyChanged();
  }

  bringToFront(id: string): void {
    const window = this.windows.get(id);
    if (!window) return;
    window.zIndex = this.nextZIndex++;
    this.notifyChanged();
  }

  /**
   * M12 (D5): sets an ABSOLUTE zIndex (a remote owner's stacking order
   * arriving over the wire). nextZIndex is lifted above it so local
   * bringToFront allocation stays strictly monotonic — a later local
   * raise always wins over any remote value. Unknown ids are silent
   * no-ops like every other op; a real write always notifies.
   */
  setZIndex(id: string, zIndex: number): void {
    const window = this.windows.get(id);
    if (!window) return;
    window.zIndex = zIndex;
    this.nextZIndex = Math.max(this.nextZIndex, zIndex + 1);
    this.notifyChanged();
  }

  minimizeWindow(id: string): void {
    const window = this.windows.get(id);
    if (!window) return;
    window.isMinimized = true;
    this.windowMeshes.get(id)!.visible = false;
    this.notifyChanged();
  }

  restoreWindow(id: string): void {
    const window = this.windows.get(id);
    if (!window) return;
    window.isMinimized = false;
    this.windowMeshes.get(id)!.visible = true;
    this.notifyChanged();
  }

  /**
   * M6 (D6): sets the window's highlight level (0..1, clamped) — written to
   * BOTH the state record and the mesh material in lockstep (emissive
   * glow). Unknown ids are silent no-ops; re-setting the current level does
   * NOT notify (idempotent — App's release-recompute must not churn).
   */
  setWindowHighlight(id: string, level: number): void {
    const window = this.windows.get(id);
    const mesh = this.windowMeshes.get(id);
    if (!window || !mesh) return;
    const clamped = Math.min(1, Math.max(0, level));
    if (clamped === window.highlight) return;
    window.highlight = clamped;
    (mesh.material as THREE.MeshPhongMaterial).emissiveIntensity =
      WINDOW_HIGHLIGHT_BASE + clamped * WINDOW_HIGHLIGHT_RANGE;
    this.notifyChanged();
  }

  getWindow(id: string): FloatingWindow | undefined {
    return this.windows.get(id);
  }

  getAllWindows(): FloatingWindow[] {
    return Array.from(this.windows.values());
  }

  /** The live mesh for a window (App's projection loop reads it every tick). */
  getWindowMesh(id: string): THREE.Mesh | undefined {
    return this.windowMeshes.get(id);
  }

  /**
   * Meshes the interaction engine may grab: only visible (non-minimized)
   * windows — never GridHelper/cube/other scene children.
   */
  getGrabbableMeshes(): THREE.Mesh[] {
    return Array.from(this.windowMeshes.values()).filter((mesh) => mesh.visible);
  }

  private createWindowMesh(window: FloatingWindow): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(1, 1 / window.aspect);
    // Obsidian restyle: near-black glass slab behind the DOM chrome; the
    // cyan emissive is reserved for interaction feedback (hover/grab
    // highlight rides WINDOW_HIGHLIGHT_BASE/RANGE, unchanged).
    const material = new THREE.MeshPhongMaterial({
      color: 0x050507,
      emissive: 0x00e5ff,
      emissiveIntensity: WINDOW_HIGHLIGHT_BASE,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    // Obsidian restyle: hairline neutral edge (the card's silhouette in the
    // void). The engine raycasts getGrabbableMeshes() NON-recursively
    // (intersectObjects false), so the child can never intercept a ray.
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: 0x9aa0a8,
        transparent: true,
        opacity: 0.3,
      }),
    );
    edges.userData.isDecor = true;
    // Decor is raycast-INERT: the engine raycasts the grabbable list
    // non-recursively anyway, but three's intersectObject DEFAULTS to
    // recursive — stubbing raycast guarantees the frame can never
    // intercept any ray, from any caller (M12 Part A).
    edges.raycast = () => {};
    mesh.add(edges);
    mesh.position.copy(window.position);
    mesh.scale.copy(window.scale);
    mesh.userData.windowId = window.id;
    mesh.userData.isGrabbable = true;
    return mesh;
  }

  private notifyChanged(): void {
    this.versionCounter += 1;
    this.onChangeCallback?.();
  }
}
