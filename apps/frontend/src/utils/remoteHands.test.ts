import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Hand, Landmark } from '@jarvis/shared';
import { landmarkToVector3 } from './gestures';
import {
  REMOTE_HAND_COLORS,
  RemoteHandsManager,
  colorForUser,
} from './remoteHands';

/** Quantized-wire-shaped landmark (M11 quantizes to 3 decimals). */
function lm(i: number): Landmark {
  return { x: 0.1 + i * 0.03, y: 0.8 - i * 0.02, z: -0.05 };
}

function hand(offset = 0): Hand {
  return {
    handedness: 'Right',
    confidence: 0.9,
    landmarks: Array.from({ length: 21 }, (_, i) => lm(i + offset)),
  };
}

describe('RemoteHandsManager (M12 D7)', () => {
  it('colorForUser is deterministic, palette-bounded, and stable', () => {
    const a = colorForUser('user-aaaaaaaa');
    expect(a).toBe(colorForUser('user-aaaaaaaa'));
    expect(REMOTE_HAND_COLORS).toContain(a);
    // Distinct users get more than one color across the palette (5 ids
    // into 5 bins — all-same has probability ~0.0016).
    const colors = new Set(
      ['u1', 'u2', 'u3', 'u4', 'u5'].map(colorForUser),
    );
    expect(colors.size).toBeGreaterThanOrEqual(2);
  });

  it('renders 21 spheres per hand at landmarkToVector3 positions', () => {
    const scene = new THREE.Scene();
    const manager = new RemoteHandsManager(scene);
    const h = hand();
    manager.update('user-b', [h]);
    expect(manager.userCount).toBe(1);
    expect(manager.handsCount).toBe(1);
    expect(manager.landmarkCount).toBe(21);
    const group = manager.group.children[0] as THREE.Group;
    expect(group.children.length).toBe(21);
    const first = group.children[0] as THREE.Mesh;
    expect(first.position.x).toBeCloseTo(landmarkToVector3(h.landmarks[0]).x, 6);
    expect(first.position.y).toBeCloseTo(landmarkToVector3(h.landmarks[0]).y, 6);
    expect(first.position.z).toBeCloseTo(landmarkToVector3(h.landmarks[0]).z, 6);
    manager.dispose();
  });

  it('update REPLACES the user hands (never accumulates)', () => {
    const scene = new THREE.Scene();
    const manager = new RemoteHandsManager(scene);
    manager.update('user-b', [hand(), hand()]);
    expect(manager.landmarkCount).toBe(42);
    manager.update('user-b', [hand()]);
    expect(manager.landmarkCount).toBe(21);
    manager.update('user-b', []);
    expect(manager.landmarkCount).toBe(0);
    manager.dispose();
  });

  it('removeUser clears only that user (userLeft)', () => {
    const scene = new THREE.Scene();
    const manager = new RemoteHandsManager(scene);
    manager.update('user-b', [hand()]);
    manager.update('user-c', [hand(), hand()]);
    manager.removeUser('user-b');
    expect(manager.userCount).toBe(1);
    expect(manager.handsCount).toBe(2);
    // Idempotent for unknown users.
    manager.removeUser('user-z');
    expect(manager.userCount).toBe(1);
    manager.dispose();
  });

  it('clear empties every user', () => {
    const scene = new THREE.Scene();
    const manager = new RemoteHandsManager(scene);
    manager.update('user-b', [hand()]);
    manager.update('user-c', [hand()]);
    manager.clear();
    expect(manager.userCount).toBe(0);
    expect(manager.group.children.length).toBe(0);
    manager.dispose();
  });

  it('per-user spheres share the user material color from colorForUser', () => {
    const scene = new THREE.Scene();
    const manager = new RemoteHandsManager(scene);
    manager.update('user-b', [hand()]);
    const group = manager.group.children[0] as THREE.Group;
    const sphere = group.children[0] as THREE.Mesh;
    const material = sphere.material as THREE.MeshBasicMaterial;
    expect(material.color.getHexString()).toBe(
      new THREE.Color(colorForUser('user-b')).getHexString(),
    );
    manager.dispose();
  });

  it('dispose removes the group from the scene', () => {
    const scene = new THREE.Scene();
    const manager = new RemoteHandsManager(scene);
    manager.update('user-b', [hand()]);
    manager.dispose();
    expect(scene.children).not.toContain(manager.group);
    expect(manager.userCount).toBe(0);
  });
});
