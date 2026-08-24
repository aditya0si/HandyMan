import { describe, expect, it } from 'vitest';
import {
  PinchSpreadZoomTracker,
  calculatePinchDistance,
} from './pinchZoom';

describe('single-hand pinch zoom tracking (Session 1)', () => {
  it('calculates 3D Euclidean distance between thumb and index landmarks', () => {
    const thumb = { x: 0.5, y: 0.5, z: 0.1 };
    const index = { x: 0.53, y: 0.54, z: 0.1 };
    const dist = calculatePinchDistance(thumb, index);
    expect(dist).toBeCloseTo(0.05, 5);
  });

  it('detects pinch initiation when distance is below touch threshold', () => {
    const tracker = new PinchSpreadZoomTracker();
    const thumb = { x: 0.5, y: 0.5, z: 0 };
    const index = { x: 0.52, y: 0.52, z: 0 }; // distance ~0.028 <= 0.055

    const res = tracker.update(thumb, index);
    expect(res.isPinching).toBe(true);
    expect(res.scaleFactor).toBe(1.0);
  });

  it('emits scale factor > 1.0 when fingers separate/spread', () => {
    const tracker = new PinchSpreadZoomTracker();
    const thumb = { x: 0.5, y: 0.5, z: 0 };
    // Step 1: initiate pinch
    tracker.update(thumb, { x: 0.52, y: 0.52, z: 0 });

    // Step 2: spread fingers slightly apart (distance increases to 0.06)
    const res = tracker.update(thumb, { x: 0.54, y: 0.54, z: 0 });
    expect(res.isPinching).toBe(true);
    expect(res.scaleFactor).toBeGreaterThan(1.0);
  });

  it('resets when fingers open beyond open threshold', () => {
    const tracker = new PinchSpreadZoomTracker();
    const thumb = { x: 0.5, y: 0.5, z: 0 };
    // Pinch
    tracker.update(thumb, { x: 0.52, y: 0.52, z: 0 });

    // Open hand wide
    const res = tracker.update(thumb, { x: 0.65, y: 0.65, z: 0 }); // dist > 0.20
    expect(res.isPinching).toBe(false);
    expect(res.scaleFactor).toBe(1.0);
  });
});
