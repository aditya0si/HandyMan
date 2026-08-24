import { describe, expect, it } from 'vitest';
import { PINCH_CLICK_MAX_MS, PinchClickTracker } from './pinchClick';

describe('pinch-click tracker', () => {
  it('budget is 400ms (absorbs the 3-frame stabilizer skew)', () => {
    expect(PINCH_CLICK_MAX_MS).toBe(400);
  });

  it('a quick pinch on a hovered card clicks exactly once', () => {
    const tracker = new PinchClickTracker();
    expect(tracker.update('Right', true, 'news-1', 1000)).toBeNull();
    expect(tracker.update('Right', true, 'news-1', 1150)).toBeNull();
    expect(tracker.update('Right', false, null, 1250)).toBe('news-1');
    // Already consumed: subsequent non-pinch frames emit nothing.
    expect(tracker.update('Right', false, null, 1300)).toBeNull();
  });

  it('a long pinch is a drag, not a click', () => {
    const tracker = new PinchClickTracker();
    tracker.update('Right', true, 'news-1', 1000);
    expect(tracker.update('Right', false, null, 1450)).toBeNull();
  });

  it('a pinch that began off-card never clicks', () => {
    const tracker = new PinchClickTracker();
    tracker.update('Right', true, null, 1000);
    // Hover arriving mid-pinch must not retro-activate the session.
    expect(tracker.update('Right', true, 'news-1', 1100)).toBeNull();
    expect(tracker.update('Right', false, 'news-1', 1150)).toBeNull();
  });

  it('hands are independent slots', () => {
    const tracker = new PinchClickTracker();
    tracker.update('Left', true, 'weather-1', 1000);
    tracker.update('Right', true, 'markets-1', 1010);
    expect(tracker.update('Left', false, null, 1100)).toBe('weather-1');
    expect(tracker.update('Right', false, null, 1380)).toBe('markets-1');
  });

  it('reset drops in-flight sessions', () => {
    const tracker = new PinchClickTracker();
    tracker.update('Right', true, 'news-1', 1000);
    tracker.reset();
    expect(tracker.update('Right', false, null, 1100)).toBeNull();
  });
});
