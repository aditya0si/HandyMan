/**
 * M15 camera-failure classification (brief D1/D2). A node-pure module that
 * turns a rejected getUserMedia call into a user-readable message + camera
 * state, and monitors video tracks for the mid-session 'ended' case —
 * the two pieces of camera resilience that must be unit-testable without a
 * DOM (structural track-like + real DOMException work under node vitest).
 */

/** User-facing message constants (kept verbatim where they pre-existed). */
export const ERROR_NOT_ALLOWED =
  'Camera permission denied. Allow camera access for this site, then press Retry.';
export const ERROR_BUSY =
  'Camera unavailable or already in use by another application. Close other apps using the webcam, then press Retry.';
export const ERROR_NO_DEVICE =
  'No camera detected. Connect a webcam, then press Retry.';
export const ERROR_DISCONNECTED =
  'Camera was disconnected mid-session. Reconnect it, then press Retry.';
export const ERROR_UNSUPPORTED =
  'This browser does not support camera capture (getUserMedia unavailable).';

export interface CameraAccessFailure {
  message: string;
}

function nameOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name: unknown }).name)
    : undefined;
}

/**
 * Maps a caught getUserMedia rejection to a user-readable message.
 * The component handles the no-getUserMedia 'unsupported' branch itself
 * (there is no error to classify); every reached failure is an error with
 * a Retry button.
 * - NotAllowedError / PermissionDeniedError -> denied (permission).
 * - NotFoundError / DevicesNotFoundError -> no camera detected.
 * - NotReadableError / TrackStartError / OverconstrainedError + everything
 *   else -> "busy/unavailable" (the safe fallthrough; a raw crash is never
 *   allowed to reach the user blank).
 */
export function classifyCameraAccessError(error: unknown): CameraAccessFailure {
  const name = nameOf(error);
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return { message: ERROR_NOT_ALLOWED };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return { message: ERROR_NO_DEVICE };
  }
  return { message: ERROR_BUSY };
}

/** Structural slice of MediaStreamTrack (fakes satisfy it in node). */
export interface TrackLike {
  readyState: 'live' | 'ended';
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/**
 * Subscribes ONE 'ended' listener per LIVE track and calls onEnded at most
 * once (the first ended track). Returns the unsubscribe. Guards: tracks that
 * are already ended are skipped; the unsubscribe removes every listener.
 */
export function monitorTrackEnded(
  tracks: readonly TrackLike[],
  onEnded: () => void,
): () => void {
  const listeners = new Map<TrackLike, () => void>();
  let fired = false;
  for (const track of tracks) {
    if (track.readyState !== 'live') continue;
    const handle = (): void => {
      if (fired) return;
      fired = true;
      for (const [target, listener] of listeners) {
        target.removeEventListener('ended', listener);
      }
      listeners.clear();
      onEnded();
    };
    listeners.set(track, handle);
    track.addEventListener('ended', handle);
  }
  return () => {
    for (const [track, listener] of listeners) {
      track.removeEventListener('ended', listener);
    }
    listeners.clear();
  };
}
