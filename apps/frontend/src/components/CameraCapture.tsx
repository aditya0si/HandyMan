import { useEffect, useRef, useState } from 'react';
import type { CameraState } from '@jarvis/shared';
import {
  CAMERA_WIDTH,
  CAMERA_HEIGHT,
  CAMERA_TARGET_FPS,
} from '@jarvis/shared';
import { ErrorBanner } from './ErrorBanner';
import {
  classifyCameraAccessError,
  ERROR_BUSY,
  ERROR_DISCONNECTED,
  ERROR_UNSUPPORTED,
  monitorTrackEnded,
} from '../utils/cameraErrors';

export interface CameraCaptureProps {
  /** Called with the live <video> element once the stream is playing.
   *  The HandTracker consumes this same element — this is the fix for the
   *  guide's step 1.6 bug (a canvas was passed where a video is required). */
  onVideoReady?: (video: HTMLVideoElement) => void;
  /** Called with the latest captured frame (throttled to targetFPS). */
  onFrameAvailable?: (canvas: HTMLCanvasElement) => void;
  /** Camera pipeline lifecycle changes (for the HUD). */
  onStateChange?: (state: CameraState) => void;
  /** Capture loop rate; defaults to 30 fps. */
  targetFPS?: number;
}

/**
 * Webcam capture (guide step 1.4): getUserMedia at 1280x720 ideal, a hidden
 * <video> + 1280x720 <canvas>, and a capture loop throttled to targetFPS.
 *
 * - Exposes its real <video> element via onVideoReady.
 * - Shows a visible error panel with a Retry button when the camera is
 *   denied, missing, unavailable, unsupported, or DISCONNECTED mid-session.
 * - M15 (D3): while the pipeline is active the video track is monitored for
 *   the 'ended' event. The monitor FOLLOWS the element's current srcObject —
 *   HandTracker's camera_utils Camera replaces our stream with its own a
 *   moment after 'active', so the real unplug case is caught on the
 *   tracker's track. A stream that was SUPERSEDED (the tracker took over) is
 *   the expected handoff — its 'ended' is ignored; only a live-attached
 *   stream ending (or our own stream ending while still attached, in the
 *   pre-takeover window) transitions to error + Retry.
 * - Fully cleans up tracks, rAF, and the track monitor on unmount; guards
 *   against the StrictMode mount -> cleanup -> mount race (a stream that
 *   resolves after cleanup is stopped immediately instead of leaking).
 */
export function CameraCapture({
  onVideoReady,
  onFrameAvailable,
  onStateChange,
  targetFPS = CAMERA_TARGET_FPS,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Latest callbacks via ref so the effect does not restart on re-render.
  const callbacksRef = useRef({ onVideoReady, onFrameAvailable, onStateChange });
  callbacksRef.current = { onVideoReady, onFrameAvailable, onStateChange };

  const [cameraState, setCameraState] = useState<CameraState>('starting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Incremented by the Retry button to re-run the start effect.
  const [attempt, setAttempt] = useState(0);

  const notifyState = (state: CameraState) => {
    setCameraState(state);
    callbacksRef.current.onStateChange?.(state);
  };

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let rafId = 0;
    // M15 (D3): track monitor. `monitoredStream` is the srcObject we last
    // subscribed to; `trackMonitor` the unsubscribe. Both swap when the
    // tracker's camera replaces ours on the shared video element.
    let monitoredStream: MediaStream | null = null;
    let trackMonitor: (() => void) | null = null;

    notifyState('starting');
    setErrorMessage(null);

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (cancelled) return;
        notifyState('unsupported');
        setErrorMessage(ERROR_UNSUPPORTED);
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: CAMERA_WIDTH },
            height: { ideal: CAMERA_HEIGHT },
          },
          audio: false,
        });

        // StrictMode/cleanup race: the stream resolved after unmount.
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          console.log('[CameraCapture] stream resolved after unmount; tracks stopped');
          return;
        }

        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        video.srcObject = stream;
        const activeStream = stream; // narrowed const for closures
        await video.play();
        if (cancelled) return; // cleanup already ran; it stops the tracks

        const liveTracks = activeStream.getTracks().filter((t) => t.readyState === 'live').length;
        console.log(`[CameraCapture] stream active (${liveTracks} live track(s), ${activeStream.getVideoTracks().length} video)`);
        notifyState('active');
        callbacksRef.current.onVideoReady?.(video);

        // M15: mid-session camera-loss detection — 'ended' on the live
        // (element-attached) video track transitions to error + Retry. The
        // supersession check: when the tracker's camera replaces ours, the
        // old track's 'ended' is the expected handoff, never a loss.
        // NOTE: there is intentionally NO `cancelled` guard here — the
        // tracker-takeover path sets `cancelled` to retire the capture loop,
        // but camera-loss detection MUST keep working AFTER that (the real
        // unplug case fires on the TRACKER's track once it has taken over).
        const attachMonitor = (target: MediaStream): void => {
          trackMonitor?.();
          const tracks = target
            .getVideoTracks()
            .filter((t) => t.readyState === 'live');
          trackMonitor = monitorTrackEnded(tracks, () => {
            if (video.srcObject !== target) return; // superseded — expected
            console.log('[CameraCapture] video track ended; transitioning to error');
            activeStream.getTracks().forEach((track) => track.stop());
            cancelled = true;
            cancelAnimationFrame(rafId);
            notifyState('error');
            setErrorMessage(ERROR_DISCONNECTED);
          });
        };
        attachMonitor(activeStream);
        monitoredStream = activeStream;

        // Capture loop throttled to targetFPS
        const frameIntervalMs = 1000 / targetFPS;
        let lastFrameTime = performance.now();

        const tick = () => {
          if (cancelled) return;
          rafId = requestAnimationFrame(tick);

          const now = performance.now();
          if (now - lastFrameTime < frameIntervalMs) return;
          lastFrameTime = now;

          // Follow the element's srcObject: the tracker hands its camera to
          // the same element, so the monitor must re-attach to it.
          const currentStream = video.srcObject as MediaStream | null;
          if (currentStream && currentStream !== monitoredStream) {
            monitoredStream = currentStream;
            attachMonitor(currentStream);
          }

          // The HandTracker's camera_utils Camera opens its own stream and
          // replaces this element's srcObject. When that happens, release our
          // stream so the webcam is not held by a detached, never-stopped
          // stream (keeps the camera free for other apps on real hardware).
          // The monitor was already re-attached to the TRACKER's stream by
          // the follow check above, so stopping our own tracks below fires
          // 'ended' with no listener attached (the handoff is not a loss).
          if (video.srcObject !== activeStream) {
            cancelled = true;
            activeStream.getTracks().forEach((track) => track.stop());
            console.log('[CameraCapture] stream replaced by tracker camera; released');
            return;
          }

          const canvas = canvasRef.current;
          if (!canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            return;
          }
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          callbacksRef.current.onFrameAvailable?.(canvas);
        };
        rafId = requestAnimationFrame(tick);
      } catch (err) {
        if (cancelled) return;
        console.error('[CameraCapture] camera access failed:', err);
        notifyState('error');
        setErrorMessage(classifyCameraAccessError(err).message);
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      trackMonitor?.();
      trackMonitor = null;
      cancelAnimationFrame(rafId);

      // Stop only our own stream (the closure stream is always the one we
      // created and attached; if camera_utils later replaced the element's
      // srcObject, that stream belongs to HandTracker, not us).
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      console.log('[CameraCapture] cleanup: capture stopped, tracks released');
    };
  }, [attempt, targetFPS]);

  const retry = () => {
    setAttempt((n) => n + 1);
  };

  return (
    <>
      <video
        ref={videoRef}
        width={CAMERA_WIDTH}
        height={CAMERA_HEIGHT}
        style={{ display: 'none' }}
        playsInline
        muted
      />
      <canvas
        ref={canvasRef}
        width={CAMERA_WIDTH}
        height={CAMERA_HEIGHT}
        style={{ display: 'none' }}
      />

      {(cameraState === 'error' || cameraState === 'unsupported') && (
        <ErrorBanner
          title="Camera unavailable"
          message={errorMessage ?? ERROR_BUSY}
          onRetry={retry}
        />
      )}
    </>
  );
}
