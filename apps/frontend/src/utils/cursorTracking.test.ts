import { describe, expect, it } from 'vitest';
import {
  getPointerLandmark,
  landmarkToScreen,
  smoothCursor,
  INDEX_FINGER_TIP,
} from './cursorTracking';
import type { Hand, Landmark } from '@jarvis/shared';

describe('cursorTracking (Session 3 hand cursor)', () => {
  it('correctly maps normalized coordinates to screen pixels with horizontal mirror', () => {
    const width = 1920;
    const height = 1080;

    // Center (0.5, 0.5) -> (960, 540)
    const center = landmarkToScreen({ x: 0.5, y: 0.5 }, width, height);
    expect(center.x).toBeCloseTo(960, 1);
    expect(center.y).toBeCloseTo(540, 1);

    // Left landmark (0.2, 0.3) -> mirrored right screen (0.8 * 1920 = 1536, 0.3 * 1080 = 324)
    const left = landmarkToScreen({ x: 0.2, y: 0.3 }, width, height);
    expect(left.x).toBeCloseTo(1536, 1);
    expect(left.y).toBeCloseTo(324, 1);
  });

  it('smooths position updates via exponential moving average', () => {
    const current = { x: 100, y: 100 };
    const target = { x: 200, y: 200 };

    const smoothed = smoothCursor(current, target, 0.5);
    expect(smoothed.x).toBe(150);
    expect(smoothed.y).toBe(150);

    // First frame seeds target directly
    const firstFrame = smoothCursor(null, target, 0.5);
    expect(firstFrame.x).toBe(200);
    expect(firstFrame.y).toBe(200);
  });

  it('extracts index fingertip landmark from hand accurately', () => {
    const dummyLandmarks: Landmark[] = Array.from({ length: 21 }, (_, i) => ({
      x: i * 0.04,
      y: i * 0.03,
      z: 0,
    }));

    dummyLandmarks[INDEX_FINGER_TIP] = { x: 0.42, y: 0.77, z: -0.1 };

    const hand: Hand = {
      handedness: 'Right',
      landmarks: dummyLandmarks,
      confidence: 0.95,
    };

    const pointer = getPointerLandmark(hand);
    expect(pointer).not.toBeNull();
    expect(pointer?.x).toBe(0.42);
    expect(pointer?.y).toBe(0.77);
  });
});
