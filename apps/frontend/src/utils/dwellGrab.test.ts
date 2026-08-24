import { describe, expect, it } from 'vitest';
import { DWELL_TARGET_MS, DwellGrabTracker } from './dwellGrab';

describe('hover dwell-to-grab tracker (700ms user-tuned lock)', () => {
  it('charges dwell progress over continuous hover up to DWELL_TARGET_MS', () => {
    const tracker = new DwellGrabTracker();

    // Half-target hover (350ms at the tuned 700ms = 50% progress)
    const mid = tracker.update(true, 350);
    expect(mid.dwellMs).toBe(350);
    expect(mid.progress).toBeCloseTo(0.5, 5);
    expect(mid.isLocked).toBe(false);

    // The remaining half -> 100% progress, lock activates
    const full = tracker.update(true, 350);
    expect(full.dwellMs).toBe(DWELL_TARGET_MS);
    expect(full.progress).toBe(1.0);
    expect(full.isLocked).toBe(true);
    expect(full.justLocked).toBe(true);
  });

  it('locks at the tuned 700ms budget (the responsiveness pin)', () => {
    expect(DWELL_TARGET_MS).toBe(700);
    const tracker = new DwellGrabTracker();
    const state = tracker.update(true, 700);
    expect(state.isLocked).toBe(true);
    expect(state.progress).toBe(1.0);
  });

  it('decays dwell progress when hover is lost before the target', () => {
    const tracker = new DwellGrabTracker();
    tracker.update(true, 350); // 50%

    // Unhover for 300ms -> decays
    const decayed = tracker.update(false, 300);
    expect(decayed.progress).toBeLessThan(0.5);
    expect(decayed.isLocked).toBe(false);
  });

  it('unlocks and resets cleanly', () => {
    const tracker = new DwellGrabTracker();
    tracker.update(true, 700); // locked
    tracker.unlock();

    const fresh = tracker.update(false, 0);
    expect(fresh.isLocked).toBe(false);
    expect(fresh.progress).toBe(0);
  });

  it('supports custom configurable dwell durations from settings', () => {
    const tracker = new DwellGrabTracker(1200);
    tracker.update(true, 600); // 50% at 1200ms
    expect(tracker.update(false, 0).progress).toBeCloseTo(0.5, 5);
    expect(tracker.update(false, 0).isLocked).toBe(false);

    tracker.setTargetMs(400);
    tracker.reset();
    const state = tracker.update(true, 400);
    expect(state.isLocked).toBe(true);
    expect(state.progress).toBe(1.0);
  });
});
