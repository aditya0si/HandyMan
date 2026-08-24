import * as THREE from 'three';
import type { Hand } from '@jarvis/shared';
import { landmarkToVector3 } from './gestures';

/**
 * M12 remote hand rendering (brief D7). Holds every OTHER user's hands from
 * the handSync stream and renders them as per-user colored landmark spheres
 * in one THREE.Group — the multi-user presence layer of the shared space.
 *
 * - Deterministic color per user: a stable 32-bit FNV-1a hash of the userId
 *   indexes a small exported palette — the same user is the same color on
 *   every client and across reconnects (ids are server-assigned UUIDs, so
 *   collisions map to the same color everywhere).
 * - Positioning uses the EXISTING landmarkToVector3 mapping — the SAME
 *   world-space convention as local gestures. Landmark z stays
 *   wrist-relative (the documented MediaPipe caveat shared with M4 momentum
 *   and M7 planar rotation), so a remote hand's depth is indicative only.
 * - `update` REPLACES the user's landmark set (never accumulates);
 *   `removeUser` clears a departed user (userLeft); windows persist — that
 *   is M11 D7 and untouched here.
 * - Cost guard (brief D11): spheres are rebuilt ONLY on handSync messages
 *   (~20 Hz max after the server throttle), NEVER per rAF. One shared
 *   sphere geometry + one material per user keeps rebuilds allocation-light.
 * - The group is never raycast: the engine only raycasts the WindowManager's
 *   grabbable meshes, non-recursively.
 */

/** Per-user palette (M12 D7): cyan-first, then warm/violet separation. */
export const REMOTE_HAND_COLORS: readonly string[] = [
  '#00e5ff',
  '#ff9f43',
  '#b18cff',
  '#5eff8f',
  '#ff5a8f',
];

/** Stable 32-bit FNV-1a hash -> palette index (same input, same color). */
export function colorForUser(userId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i += 1) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return REMOTE_HAND_COLORS[Math.abs(hash) % REMOTE_HAND_COLORS.length];
}

/** Shared sphere size (world units) — reads as a glowing joint dot. */
const LANDMARK_SPHERE_RADIUS = 0.045;

interface UserHands {
  hands: readonly Hand[];
  group: THREE.Group;
  material: THREE.MeshBasicMaterial;
}

export class RemoteHandsManager {
  readonly group = new THREE.Group();
  private readonly scene: THREE.Scene;
  private readonly users = new Map<string, UserHands>();
  private readonly sphereGeometry = new THREE.SphereGeometry(
    LANDMARK_SPHERE_RADIUS,
    10,
    10,
  );

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group.userData.isDecor = true;
    scene.add(this.group);
  }

  /** REPLACES the user's hands (wire hands are already quantized, M11). */
  update(userId: string, hands: readonly Hand[]): void {
    let entry = this.users.get(userId);
    if (!entry) {
      entry = {
        hands: [],
        group: new THREE.Group(),
        // MeshBasic: unlit flat color — the holographic dot look, and it
        // reads cleanly under any lighting changes Part A made.
        material: new THREE.MeshBasicMaterial({
          color: new THREE.Color(colorForUser(userId)),
          transparent: true,
          opacity: 0.9,
        }),
      };
      this.users.set(userId, entry);
      this.group.add(entry.group);
    }
    entry.hands = hands;
    entry.group.clear(); // replace, never accumulate
    for (const hand of hands) {
      for (const landmark of hand.landmarks) {
        const sphere = new THREE.Mesh(this.sphereGeometry, entry.material);
        sphere.position.copy(landmarkToVector3(landmark));
        sphere.userData.userId = userId;
        // Raycast-inert: a remote hand floating in front of a window must
        // never intercept an interaction ray under any caller.
        sphere.raycast = () => {};
        entry.group.add(sphere);
      }
    }
  }

  /** userLeft: the user's hands go (their windows persist, M11 D7). */
  removeUser(userId: string): void {
    const entry = this.users.get(userId);
    if (!entry) return;
    entry.group.clear();
    this.group.remove(entry.group);
    entry.material.dispose();
    this.users.delete(userId);
  }

  /** Clears every user (per-scene reset / snapshot replacement). */
  clear(): void {
    for (const userId of [...this.users.keys()]) this.removeUser(userId);
  }

  /** Users currently rendered with a hand set. */
  get userCount(): number {
    return this.users.size;
  }

  /** Total rendered hands across users (HUD "Remote" row source). */
  get handsCount(): number {
    let total = 0;
    for (const entry of this.users.values()) total += entry.hands.length;
    return total;
  }

  /** Total landmark spheres (verifier/debug introspection). */
  get landmarkCount(): number {
    let total = 0;
    for (const entry of this.users.values()) {
      total += entry.hands.reduce((n, hand) => n + hand.landmarks.length, 0);
    }
    return total;
  }

  /** Removes the group and frees the shared geometry + per-user materials. */
  dispose(): void {
    this.clear();
    this.sphereGeometry.dispose();
    this.scene.remove(this.group);
  }
}
