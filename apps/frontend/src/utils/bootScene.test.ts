import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BOOT_APP_IDS,
  BOOT_WINDOW_COUNT,
  DEFAULT_SPAWN_POSITION,
  getSpawnPosition,
  SPAWN_CASCADE_STEP,
} from './bootScene';
import { WINDOW_ASPECT } from './windowManager';

/**
 * bootScene unit tests (node environment — pure projection math, no DOM).
 * Verifies that all boot/cascade/default spawns project inside |ndc| < 0.9.
 */

const CAMERA_FOV = 75;
const CAMERA_Z = 5;

function projectNdc(
  position: THREE.Vector3,
  aspect: number,
): { x: number; y: number } {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, aspect, 0.1, 1000);
  camera.position.set(0, 0, CAMERA_Z);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  scene.add(camera);
  scene.updateMatrixWorld(true);
  const ndc = position.clone().project(camera);
  return { x: ndc.x, y: ndc.y };
}

describe('bootScene (obsidian triad: news + weather + markets)', () => {
  it('boot + spawn positions project inside |ndc| < 0.9 at BOTH aspect 16:9 and 16:10', () => {
    const positions = [
      getSpawnPosition('news', 1),
      getSpawnPosition('weather', 1),
      getSpawnPosition('markets', 1),
      getSpawnPosition('dashboard', 1),
      getSpawnPosition('notes', 1),
      getSpawnPosition('chat', 1),
      getSpawnPosition('search', 1),
      // Cascades
      getSpawnPosition('news', 2),
      getSpawnPosition('news', 3),
      getSpawnPosition('news', 4),
      getSpawnPosition('weather', 2),
      getSpawnPosition('markets', 2),
      getSpawnPosition('dashboard', 2),
      getSpawnPosition('notes', 2),
      getSpawnPosition('chat', 2),
      getSpawnPosition('search', 2),
      // Default-spawn instances 1-4
      getSpawnPosition('future-app', 1),
      getSpawnPosition('future-app', 2),
    ];
    for (const aspect of [WINDOW_ASPECT, 16 / 10]) {
      for (const position of positions) {
        const ndc = projectNdc(position, aspect);
        expect(Math.abs(ndc.x)).toBeLessThan(0.9);
        expect(Math.abs(ndc.y)).toBeLessThan(0.9);
      }
    }
  });

  it('boot composition is exact: briefing, all on-screen', () => {
    expect(BOOT_APP_IDS).toEqual(['briefing']);
    expect(BOOT_WINDOW_COUNT).toBe(1);

    for (const aspect of [WINDOW_ASPECT, 16 / 10]) {
      for (const appId of BOOT_APP_IDS) {
        const ndc = projectNdc(getSpawnPosition(appId, 1), aspect);
        expect(Math.abs(ndc.x)).toBeLessThan(0.85);
        expect(Math.abs(ndc.y)).toBeLessThan(0.85);
      }
    }

    // The left pair (weather above, markets below) stays clear of the
    // news card's horizontal span at both aspects (NDC midpoint gaps).
    for (const aspect of [WINDOW_ASPECT, 16 / 10]) {
      const newsNdc = projectNdc(getSpawnPosition('news', 1), aspect);
      const weatherNdc = projectNdc(getSpawnPosition('weather', 1), aspect);
      const marketsNdc = projectNdc(getSpawnPosition('markets', 1), aspect);
      expect(weatherNdc.x).toBeLessThan(newsNdc.x - 0.05);
      expect(marketsNdc.x).toBeLessThan(newsNdc.x - 0.05);
      expect(weatherNdc.y).toBeGreaterThan(marketsNdc.y + 0.05);
    }

    const newsDepth = CAMERA_Z - getSpawnPosition('news', 1).z;
    expect(newsDepth.toFixed(6)).toBe('4.600000');
    const weatherDepth = CAMERA_Z - getSpawnPosition('weather', 1).z;
    expect(weatherDepth.toFixed(6)).toBe('4.650000');
    const marketsDepth = CAMERA_Z - getSpawnPosition('markets', 1).z;
    expect(marketsDepth.toFixed(6)).toBe('4.800000');
  });

  it('getSpawnPosition semantics: clones, cascades, defaults', () => {
    const first = getSpawnPosition('news', 1);
    const second = getSpawnPosition('news', 1);
    expect(first).not.toBe(second); // fresh clone per call
    first.set(99, 99, 99); // mutating one result does not affect the next
    expect(getSpawnPosition('news', 1)).not.toEqual({ x: 99, y: 99, z: 99 });

    // Cascade: instance 2 = base + step, instance 3 = base + 2 * step.
    const base = getSpawnPosition('news', 1);
    const inst2 = getSpawnPosition('news', 2);
    const inst3 = getSpawnPosition('news', 3);
    const expected2 = base.clone().add(SPAWN_CASCADE_STEP);
    const expected3 = base.clone().add(SPAWN_CASCADE_STEP.clone().multiplyScalar(2));
    expect(inst2.x).toBeCloseTo(expected2.x, 6);
    expect(inst2.y).toBeCloseTo(expected2.y, 6);
    expect(inst2.z).toBeCloseTo(expected2.z, 6);
    expect(inst3.x).toBeCloseTo(expected3.x, 6);
    expect(inst3.y).toBeCloseTo(expected3.y, 6);
    expect(inst3.z).toBeCloseTo(expected3.z, 6);

    // Instance 0 clamps to the base (1-based, clamped to >= 1).
    const inst0 = getSpawnPosition('news', 0);
    expect(inst0.x).toBe(base.x);
    expect(inst0.y).toBe(base.y);
    expect(inst0.z).toBe(base.z);

    // Unknown app id → the default spawn for instance 1.
    const unknown = getSpawnPosition('future-app', 1);
    expect(unknown.x).toBe(DEFAULT_SPAWN_POSITION.x);
    expect(unknown.y).toBe(DEFAULT_SPAWN_POSITION.y);
    expect(unknown.z).toBe(DEFAULT_SPAWN_POSITION.z);
  });
});
