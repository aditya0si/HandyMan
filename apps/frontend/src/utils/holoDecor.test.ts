import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HOLO_HUB_POINT, HOLO_RING_SPEED_INNER, HoloDecor } from './holoDecor';

describe('HoloDecor (M12 Part A scene dressing)', () => {
  it('adds the ring group to the scene and rotates rings deterministically', () => {
    const scene = new THREE.Scene();
    const decor = new HoloDecor(scene);
    expect(scene.children).toContain(decor.group);

    decor.update(1000);
    expect(decor.innerTurntable.rotation.y).toBeCloseTo(
      1000 * HOLO_RING_SPEED_INNER,
      10,
    );
    // Idempotent per timestamp (no accumulation — StrictMode-safe).
    decor.update(1000);
    expect(decor.innerTurntable.rotation.y).toBeCloseTo(
      1000 * HOLO_RING_SPEED_INNER,
      10,
    );
    decor.dispose();
  });

  it('creates one connector per window, follows positions, and drops gone ids', () => {
    const scene = new THREE.Scene();
    const decor = new HoloDecor(scene);
    const a = new THREE.Vector3(0.5, 0.2, -1);
    decor.sync([{ id: 'notes-1', position: a }]);
    expect(decor.connectorCount).toBe(1);

    // Far endpoint follows the live position (group-local: y offset by the
    // decor group's floor height).
    const line = decor.group.children.find(
      (c) => (c as THREE.Line).isLine,
    ) as THREE.Line;
    const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(pos.getX(0)).toBeCloseTo(HOLO_HUB_POINT.x, 6);
    expect(pos.getX(1)).toBeCloseTo(0.5, 6);
    expect(pos.getY(1)).toBeCloseTo(0.2 - decor.group.position.y, 6);

    decor.sync([
      { id: 'notes-1', position: a },
      { id: 'chat-1', position: new THREE.Vector3(-0.4, 0.1, 0.3) },
    ]);
    expect(decor.connectorCount).toBe(2);

    decor.sync([{ id: 'chat-1', position: new THREE.Vector3(-0.4, 0.1, 0.3) }]);
    expect(decor.connectorCount).toBe(1);
    decor.dispose();
  });

  it('dispose removes the group from the scene', () => {
    const scene = new THREE.Scene();
    const decor = new HoloDecor(scene);
    decor.sync([{ id: 'x', position: new THREE.Vector3() }]);
    decor.dispose();
    expect(scene.children).not.toContain(decor.group);
    expect(decor.connectorCount).toBe(0);
  });
});
