import { describe, expect, it, vi } from 'vitest';
import {
  ERROR_BUSY,
  ERROR_NOT_ALLOWED,
  ERROR_NO_DEVICE,
  classifyCameraAccessError,
  monitorTrackEnded,
} from './cameraErrors';
import type { TrackLike } from './cameraErrors';

/** Minimal fake MediaStreamTrack (structural TrackLike). */
class FakeTrack implements TrackLike {
  readyState: 'live' | 'ended' = 'live';
  private listeners = new Set<() => void>();

  addEventListener(_type: string, listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: () => void): void {
    this.listeners.delete(listener);
  }

  /** Transitions to 'ended' and fires the listeners once. */
  end(): void {
    this.readyState = 'ended';
    for (const listener of [...this.listeners]) listener();
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

describe('cameraErrors (M15 D1/D2)', () => {
  describe('classifyCameraAccessError', () => {
    it('maps NotAllowedError/PermissionDeniedError to the denied message', () => {
      expect(
        classifyCameraAccessError(new DOMException('denied', 'NotAllowedError')).message,
      ).toBe(ERROR_NOT_ALLOWED);
      expect(
        classifyCameraAccessError(
          new DOMException('denied', 'PermissionDeniedError'),
        ).message,
      ).toBe(ERROR_NOT_ALLOWED);
    });

    it('maps NotFoundError/DevicesNotFoundError to the no-device message', () => {
      expect(
        classifyCameraAccessError(new DOMException('none', 'NotFoundError')).message,
      ).toBe(ERROR_NO_DEVICE);
      expect(
        classifyCameraAccessError(
          new DOMException('none', 'DevicesNotFoundError'),
        ).message,
      ).toBe(ERROR_NO_DEVICE);
    });

    it('maps NotReadableError/OverconstrainedError + anything else to the busy message', () => {
      expect(
        classifyCameraAccessError(new DOMException('busy', 'NotReadableError')).message,
      ).toBe(ERROR_BUSY);
      expect(
        classifyCameraAccessError(
          new DOMException('constraints', 'OverconstrainedError'),
        ).message,
      ).toBe(ERROR_BUSY);
      // Unknown name / plain Error / non-object → safe fallthrough.
      expect(classifyCameraAccessError(new DOMException('x', 'FancyNewError')).message).toBe(
        ERROR_BUSY,
      );
      expect(classifyCameraAccessError(new Error('boom')).message).toBe(ERROR_BUSY);
      expect(classifyCameraAccessError('not an error object').message).toBe(ERROR_BUSY);
      expect(classifyCameraAccessError(null).message).toBe(ERROR_BUSY);
    });
  });

  describe('monitorTrackEnded', () => {
    it('fires onEnded once when a live tracked track ends, then detaches', () => {
      const onEnded = vi.fn();
      const a = new FakeTrack();
      const b = new FakeTrack();
      const unsubscribe = monitorTrackEnded([a, b], onEnded);

      b.end(); // one live track ends -> onEnded fires
      expect(onEnded).toHaveBeenCalledTimes(1);
      // The other track (and the ended one) are no longer listened to.
      expect(a.listenerCount).toBe(0);
      expect(b.listenerCount).toBe(0);

      // A later end on a (detached) track must NOT re-fire.
      a.end();
      expect(onEnded).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    it('skips tracks that are already ended', () => {
      const onEnded = vi.fn();
      const ended = new FakeTrack();
      ended.readyState = 'ended';
      monitorTrackEnded([ended], onEnded);
      expect(ended.listenerCount).toBe(0);
      expect(onEnded).not.toHaveBeenCalled();
    });

    it('unsubscribe removes every listener before any track ends', () => {
      const onEnded = vi.fn();
      const a = new FakeTrack();
      const unsubscribe = monitorTrackEnded([a], onEnded);
      unsubscribe();
      a.end();
      expect(onEnded).not.toHaveBeenCalled();
    });

    it('fires at most once even when multiple tracks end together', () => {
      const onEnded = vi.fn();
      const a = new FakeTrack();
      const b = new FakeTrack();
      monitorTrackEnded([a, b], onEnded);
      a.end();
      b.end();
      expect(onEnded).toHaveBeenCalledTimes(1);
    });
  });
});
