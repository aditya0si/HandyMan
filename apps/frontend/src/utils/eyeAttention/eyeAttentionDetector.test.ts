import { describe, expect, it, beforeEach } from 'vitest';
import { EyeAttentionDetector } from './eyeAttentionDetector';
import type { FaceDetectionFrame, WindowSpatialInfo } from './eyeAttentionDetector';

describe('EyeAttentionDetector (Phase 7)', () => {
  let detector: EyeAttentionDetector;
  const windows: WindowSpatialInfo[] = [
    { id: 'left-card', positionX: -2.5, positionY: 0 },
    { id: 'center-card', positionX: 0, positionY: 0 },
    { id: 'right-card', positionX: 2.5, positionY: 0 },
  ];

  beforeEach(() => {
    detector = new EyeAttentionDetector(false);
  });

  it('is disabled by default and returns disabled state', () => {
    const state = detector.processFrame({
      hasFace: true,
      faceCenterX: 0,
      faceCenterY: 0,
      yawAngle: 0,
      pitchAngle: 0,
      confidence: 0.9,
    });
    expect(state.enabled).toBe(false);
    expect(state.present).toBe(false);
    expect(state.gazeZone).toBeNull();
  });

  it('detects center gaze zone when looking straight', () => {
    detector.setEnabled(true);
    const frame: FaceDetectionFrame = {
      hasFace: true,
      faceCenterX: 0,
      faceCenterY: 0,
      yawAngle: 0,
      pitchAngle: 0,
      confidence: 0.95,
    };
    const state = detector.processFrame(frame, windows, 1000);
    expect(state.enabled).toBe(true);
    expect(state.present).toBe(true);
    expect(state.gazeZone).toBe('center');
    expect(state.targetWindowId).toBe('center-card');
    expect(state.isLookingAway).toBe(false);
  });

  it('detects left and right gaze zones accurately', () => {
    detector.setEnabled(true);

    // Looking left
    const leftFrame: FaceDetectionFrame = {
      hasFace: true,
      faceCenterX: -0.4,
      faceCenterY: 0,
      yawAngle: -20,
      pitchAngle: 0,
      confidence: 0.9,
    };
    const leftState = detector.processFrame(leftFrame, windows, 1000);
    expect(leftState.gazeZone).toBe('left');
    expect(leftState.targetWindowId).toBe('left-card');

    detector.reset();

    // Looking right
    const rightFrame: FaceDetectionFrame = {
      hasFace: true,
      faceCenterX: 0.4,
      faceCenterY: 0,
      yawAngle: 20,
      pitchAngle: 0,
      confidence: 0.9,
    };
    const rightState = detector.processFrame(rightFrame, windows, 1000);
    expect(rightState.gazeZone).toBe('right');
    expect(rightState.targetWindowId).toBe('right-card');
  });

  it('detects away state when head is turned excessively', () => {
    detector.setEnabled(true);
    const awayFrame: FaceDetectionFrame = {
      hasFace: true,
      faceCenterX: 0.5,
      faceCenterY: 0,
      yawAngle: 40, // > 35 deg
      pitchAngle: 0,
      confidence: 0.85,
    };
    const state = detector.processFrame(awayFrame, windows, 1000);
    expect(state.gazeZone).toBe('away');
    expect(state.isLookingAway).toBe(true);
    expect(state.targetWindowId).toBeNull();
  });

  it('degrades safely when confidence is below threshold (< 0.5)', () => {
    detector.setEnabled(true);
    const lowConfFrame: FaceDetectionFrame = {
      hasFace: true,
      faceCenterX: 0,
      faceCenterY: 0,
      yawAngle: 0,
      pitchAngle: 0,
      confidence: 0.35, // low confidence
    };
    const state = detector.processFrame(lowConfFrame, windows, 1000);
    expect(state.present).toBe(false);
    expect(state.gazeZone).toBeNull();
    expect(state.targetWindowId).toBeNull();
  });

  it('triggers isLookingAway when face has been missing for over 1000ms', () => {
    detector.setEnabled(true);
    // Initial face
    detector.processFrame({
      hasFace: true,
      faceCenterX: 0,
      faceCenterY: 0,
      yawAngle: 0,
      pitchAngle: 0,
      confidence: 0.9,
    }, windows, 1000);

    // Missing face after 500ms -> not yet away
    let state = detector.processFrame(null, windows, 1500);
    expect(state.isLookingAway).toBe(false);

    // Missing face after 1200ms -> away
    state = detector.processFrame(null, windows, 2201);
    expect(state.isLookingAway).toBe(true);
    expect(state.gazeZone).toBe('away');
  });

  it('tracks dwell time for sustained card focus confirmation', () => {
    detector.setEnabled(true);
    const frame: FaceDetectionFrame = {
      hasFace: true,
      faceCenterX: -0.4,
      faceCenterY: 0,
      yawAngle: -20,
      pitchAngle: 0,
      confidence: 0.9,
    };

    // Frame 1 at t=0ms
    let state = detector.processFrame(frame, windows, 0);
    expect(state.targetWindowId).toBe('left-card');

    // Frame 2 at t=400ms (< 700ms dwell)
    state = detector.processFrame(frame, windows, 400);
    expect(state.targetWindowId).toBe('left-card');

    // Frame 3 at t=750ms (> 700ms dwell)
    state = detector.processFrame(frame, windows, 750);
    expect(state.targetWindowId).toBe('left-card');
  });

  it('disambiguates overlapping candidate targets based on gaze zone', () => {
    detector.setEnabled(true);
    // User looking left
    detector.processFrame({
      hasFace: true,
      faceCenterX: -0.4,
      faceCenterY: 0,
      yawAngle: -20,
      pitchAngle: 0,
      confidence: 0.9,
    }, windows, 1000);

    const candidates = ['center-card', 'left-card'];
    const chosen = detector.disambiguateTargets(candidates, windows);
    expect(chosen).toBe('left-card');
  });
});
