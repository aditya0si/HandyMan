import { useEffect, useRef, useState } from 'react';
// M14: @mediapipe ships legacy Closure-compiled bundles that DECLARE
// "sideEffects": [], so the bundler tree-shakes module-graph imports of them
// entirely — a latent production-build bug since M1 (the built app crashed
// with "window.Hands is not a constructor"; only the dev server — which
// serves the raw files — worked). They are now loaded as plain <script>
// ASSETS via ?url imports + runtime injection (see utils/mediaPipeLoader.ts):
// correct in every bundle, async (zero parse cost until used), and the same
// window.Hands/window.Camera globals land as before (mediapipe-globals.d.ts
// types them).
import type { Results } from '@mediapipe/hands';
import type { Hand, MediaPipeState } from '@jarvis/shared';
import {
  HANDS_MAX_NUM,
  HANDS_MODEL_COMPLEXITY,
  HANDS_MIN_DETECTION_CONFIDENCE,
  HANDS_MIN_TRACKING_CONFIDENCE,
  HANDS_CDN_BASE,
  HAND_CONNECTIONS,
  CAMERA_WIDTH,
  CAMERA_HEIGHT,
  CAMERA_TARGET_FPS,
} from '@jarvis/shared';
import { GestureRecognizer } from '../utils/gestures';
import type { Gesture } from '../utils/gestures';
import { createMediaPipeScriptLoader } from '../utils/mediaPipeLoader';
import {
  DEGRADED_TRACKING_CONFIDENCE_THRESHOLD,
  DEGRADED_TRACKING_WINDOW_MS,
  DegradedTrackingDetector,
} from '../utils/degradedTracking';
import { ErrorBanner } from './ErrorBanner';

// M14: lazy readonly loader for the MediaPipe solution scripts — idempotent
// (module-level promise shared across mounts, StrictMode double-mount safe).
const mediaPipeScriptLoader = createMediaPipeScriptLoader();

/** M15 (D4): degraded-tracking knobs — exported per the brief so the
 *  verifier/docs can reference them by name (the detector logic itself lives
 *  in the node-pure utils/degradedTracking.ts and is unit-tested there). */
export { DEGRADED_TRACKING_CONFIDENCE_THRESHOLD, DEGRADED_TRACKING_WINDOW_MS };

export interface HandTrackerProps {
  /** Real <video> element from CameraCapture (null until the camera is live). */
  videoElement: HTMLVideoElement | null;
  /** Called on every inference result with the detected hands. */
  onHandsDetected?: (hands: Hand[]) => void;
  /** Called on every inference result with the recognized gestures. */
  onGesturesDetected?: (gestures: Gesture[]) => void;
  /** MediaPipe model lifecycle (for the HUD). */
  onStateChange?: (state: MediaPipeState) => void;
  /** Average camera -> detection latency in ms, reported ~once per second. */
  onLatencyUpdate?: (latencyMs: number) => void;
  /** Per-frame cost of gesture recognition (per-hand + bimanual) in ms (no console output). */
  onGestureLatencyUpdate?: (latencyMs: number) => void;
}

// The overlay canvas is half the capture resolution (640x360).
const OVERLAY_WIDTH = CAMERA_WIDTH / 2;
const OVERLAY_HEIGHT = CAMERA_HEIGHT / 2;

// Inference input is downscaled to half resolution: the MediaPipe Hands
// solution processes at input resolution, so feeding it the raw 1280x720
// video costs ~4x the GPU time of 640x360 (matters a lot on software
// renderers) while detection quality stays adequate for gestures.
const INPUT_WIDTH = CAMERA_WIDTH / 2;
const INPUT_HEIGHT = CAMERA_HEIGHT / 2;

/**
 * MediaPipe Hands' initialize() bootstraps page-level WASM glue state and is
 * NOT safe under concurrent calls: React StrictMode's dev double-mount starts
 * two HandTracker initializations back-to-back, and the racing glue
 * executions abort with "Module.arguments has been replaced with plain
 * arguments_" inside the Emscripten runtime. Serialize initialize() across
 * instances with a module-level promise chain.
 */
let handsInitQueue: Promise<void> = Promise.resolve();

function initializeHands(
  hands: InstanceType<typeof window.Hands>,
): Promise<void> {
  const run = handsInitQueue.then(() => hands.initialize());
  // Keep the chain alive even if one initialization fails.
  handsInitQueue = run.catch(() => undefined);
  return run;
}

/**
 * MediaPipe Hands integration (guide step 1.5), fixed up:
 *
 * - Camera is configured with fps: CAMERA_TARGET_FPS AND onFrame is
 *   additionally throttled so inference can never spin unbounded.
 * - The full 21-landmark HAND_CONNECTIONS skeleton is drawn (the guide only
 *   showed a truncated connection list).
 * - If the MediaPipe WASM/model fails to load from the CDN, a visible error
 *   panel is shown (no silent hang) and the failure is logged.
 * - Cleanup stops the camera and closes the Hands solution; a cancelled flag
 *   protects against the StrictMode double-mount race.
 */
export function HandTracker({
  videoElement,
  onHandsDetected,
  onGesturesDetected,
  onStateChange,
  onLatencyUpdate,
  onGestureLatencyUpdate,
}: HandTrackerProps) {
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const inputCanvasRef = useRef<HTMLCanvasElement>(null);
  const [mediaPipeState, setMediaPipeState] = useState<MediaPipeState>('loading');

  // Latest callbacks via ref so the effect is not restarted by re-renders.
  const callbacksRef = useRef({
    onHandsDetected,
    onGesturesDetected,
    onStateChange,
    onLatencyUpdate,
    onGestureLatencyUpdate,
  });
  callbacksRef.current = {
    onHandsDetected,
    onGesturesDetected,
    onStateChange,
    onLatencyUpdate,
    onGestureLatencyUpdate,
  };

  // Gesture recognizer held in a ref (guide step 2.2): the instance must not
  // be an effect dependency — it keeps per-hand temporal-filter state across
  // re-renders while onResults stays the only writer.
  const gestureRecognizerRef = useRef<GestureRecognizer | null>(null);

  useEffect(() => {
    if (!videoElement) return;

    // Reuse the recognizer across effect re-runs (same ref, not a dependency)
    // so per-hand temporal-filter state survives re-renders.
    const gestureRecognizer = gestureRecognizerRef.current ?? new GestureRecognizer();
    gestureRecognizerRef.current = gestureRecognizer;

    let cancelled = false;
    let camera: InstanceType<typeof window.Camera> | null = null;
    // M14: Hands is created LAZILY inside init() once the asset scripts have
    // loaded (window.Hands is not available until then).
    let hands: InstanceType<typeof window.Hands> | null = null;

    const updateState = (state: MediaPipeState) => {
      setMediaPipeState(state);
      callbacksRef.current.onStateChange?.(state);
    };

    // Per-second latency window: aggregates send->results latencies and
    // reports/logs the average once per second.
    let latencySum = 0;
    let latencyCount = 0;
    let lastLogTime = 0;

    const recordLatency = (latencyMs: number, now: number) => {
      latencySum += latencyMs;
      latencyCount += 1;
      if (now - lastLogTime < 1000) return;

      const avgLatency = Math.round(latencySum / Math.max(1, latencyCount));
      console.log(
        `[HandTracker] detection latency: avg ${avgLatency}ms over ${latencyCount} frame(s)`,
      );
      callbacksRef.current.onLatencyUpdate?.(avgLatency);
      latencySum = 0;
      latencyCount = 0;
      lastLogTime = now;
    };

    const logLandmarksPerSecond = (detectedHands: Hand[], now: number) => {
      if (detectedHands.length === 0 || now - lastLogTime < 1000) return;
      const first = detectedHands[0];
      console.log(
        `[HandTracker] ${detectedHands.length} hand(s): ${first.handedness} (conf ${first.confidence.toFixed(3)}), ` +
          `21 landmarks: ${JSON.stringify(first.landmarks)}`,
      );
    };

    // Gesture classification runs inside onResults (same tick as hand
    // emission), so gesture updates can never lag a frame behind the hands.
    let lastGestureLogTime = 0;
    const logGesturesPerSecond = (gestures: Gesture[], now: number) => {
      if (gestures.length === 0 || now - lastGestureLogTime < 1000) return;
      lastGestureLogTime = now;
      const summary = gestures
        .map(
          (g) =>
            `${g.handedness}=${g.type} (conf ${g.confidence.toFixed(2)}, intensity ${g.intensity.toFixed(2)})`,
        )
        .join(', ');
      console.log(`[HandTracker] gestures: ${summary}`);
    };

    let frameStart = 0;
    let lastSendTime = 0;
    let lastHandTime = performance.now();
    // M15 (D4): per-effect degraded-tracking detector.
    const degraded = new DegradedTrackingDetector();

    const wireResults = (handsInstance: InstanceType<typeof window.Hands>): void => {
      handsInstance.onResults((results: Results) => {
      if (cancelled) return;

      const now = performance.now();
      const latencyMs = frameStart > 0 ? now - frameStart : 0;
      recordLatency(latencyMs, now);

      const detectedHands = buildHandsFromResults(results);
      if (detectedHands.length > 0) {
        lastHandTime = now;
      }
      // M15 (D4): sustained-low-confidence warning — fires once per full
      // degraded window (unit-tested detector), one throttled console.warn,
      // no UI surface.
      if (degraded.feed(now, detectedHands.map((h) => h.confidence))) {
        console.warn(
          '[HandTracker] Degraded tracking: hand confidence is low (' +
            `avg < ${DEGRADED_TRACKING_CONFIDENCE_THRESHOLD} over ${DEGRADED_TRACKING_WINDOW_MS} ms) ` +
            '— improve lighting, keep your hand within reach, avoid strong backlight.',
        );
      }
      // M4/M5: measure the gesture-recognition cost per frame (no console
      // output — App feeds it into the PerformanceLogger's rolling mean).
      // M5: both channels share the same frame clock `now` (per D8 the
      // velocity/rate math must never mix timebases).
      const gestureStart = now;
      const perHand = gestureRecognizer.recognizeGestures(detectedHands, now);
      const bimanual = gestureRecognizer.recognizeBimanual(detectedHands, now);
      const gestures = [...perHand, ...bimanual];
      callbacksRef.current.onGestureLatencyUpdate?.(performance.now() - gestureStart);
      callbacksRef.current.onHandsDetected?.(detectedHands);
      callbacksRef.current.onGesturesDetected?.(gestures);
      logLandmarksPerSecond(detectedHands, now);
      logGesturesPerSecond(gestures, now);

      drawSkeletonOverlay(overlayCanvasRef.current, results, detectedHands);
      });
    };

    const init = async () => {
      try {
        // M14: the asset scripts must be in place before window.Hands exists.
        await mediaPipeScriptLoader.load();
      } catch (error) {
        if (cancelled) return;
        console.error('[HandTracker] MediaPipe script load failed:', error);
        updateState('error');
        return;
      }
      if (cancelled) return;
      const h = new window.Hands({
        locateFile: (file) => `${HANDS_CDN_BASE}${file}`,
      });
      hands = h;
      h.setOptions({
        maxNumHands: HANDS_MAX_NUM,
        modelComplexity: HANDS_MODEL_COMPLEXITY,
        minDetectionConfidence: HANDS_MIN_DETECTION_CONFIDENCE,
        minTrackingConfidence: HANDS_MIN_TRACKING_CONFIDENCE,
      });
      wireResults(h);
      const activeHands = h; // non-null local for the nested camera closure
      updateState('loading');
      try {
        await initializeHands(h);
        if (cancelled) {
          void hands.close();
          return;
        }
        updateState('ready');
        console.log('[HandTracker] MediaPipe Hands model loaded from CDN');

        camera = new window.Camera(videoElement, {
          onFrame: async () => {
            const now = performance.now();
            const timeSinceLastHand = now - lastHandTime;
            
            // Throttle inference to CAMERA_TARGET_FPS, or 4 FPS when idle.
            let throttleMs = 1000 / CAMERA_TARGET_FPS;
            if (timeSinceLastHand > 3000) {
              throttleMs = 250; // Idle mode: 4 FPS (250ms)
            }
            
            if (now - lastSendTime < throttleMs) return;
            lastSendTime = now;

            // Downscale the frame for inference (see INPUT_WIDTH comment).
            const input = inputCanvasRef.current;
            const inputCtx = input?.getContext('2d');
            if (!input || !inputCtx) return;
            inputCtx.drawImage(videoElement, 0, 0, input.width, input.height);

            frameStart = now;
            try {
              await activeHands.send({ image: input });
            } catch (err) {
              console.error('[HandTracker] hands.send failed:', err);
            }
          },
          width: CAMERA_WIDTH,
          height: CAMERA_HEIGHT,
        });
        void camera.start();
      } catch (err) {
        if (cancelled) return;
        console.error('[HandTracker] MediaPipe model/WASM load failed:', err);
        updateState('error');
      }
    };

    void init();

    return () => {
      cancelled = true;
      if (camera) {
        void camera.stop().catch(() => undefined);
      }
      if (hands) void hands.close();
      console.log('[HandTracker] cleanup: camera stopped, hands solution closed');
    };
  }, [videoElement]);

  return (
    <>
      <canvas
        ref={inputCanvasRef}
        width={INPUT_WIDTH}
        height={INPUT_HEIGHT}
        style={{ display: 'none' }}
      />
      <canvas
        ref={overlayCanvasRef}
        width={OVERLAY_WIDTH}
        height={OVERLAY_HEIGHT}
        style={{
          position: 'fixed',
          left: 16,
          bottom: 16,
          zIndex: 10,
          width: OVERLAY_WIDTH,
          height: OVERLAY_HEIGHT,
          border: '1px solid rgba(0, 229, 255, 0.6)',
          borderRadius: 6,
          background: '#000',
        }}
      />
      {mediaPipeState === 'error' && (
        <ErrorBanner
          title="Hand tracking model failed to load"
          message="MediaPipe Hands could not be downloaded from the CDN (network/firewall issue or CDN outage). Reload the page to retry."
        />
      )}
    </>
  );
}

/**
 * Maps MediaPipe results to the shared Hand[] shape (handedness label,
 * normalized landmarks, classification score).
 */
function buildHandsFromResults(results: Results): Hand[] {
  const detectedHands: Hand[] = [];
  if (results.multiHandLandmarks && results.multiHandedness) {
    results.multiHandLandmarks.forEach((landmarks, index) => {
      const classification = results.multiHandedness[index];
      detectedHands.push({
        handedness: classification.label === 'Left' ? 'Left' : 'Right',
        landmarks: landmarks.map((lm) => ({ x: lm.x, y: lm.y, z: lm.z ?? 0 })),
        confidence: classification.score,
      });
    });
  }
  return detectedHands;
}

/**
 * Draws the camera frame plus the complete hand skeleton — all 21 landmarks
 * and the full HAND_CONNECTIONS set (21 segments) — onto the overlay canvas.
 */
function drawSkeletonOverlay(
  canvas: HTMLCanvasElement | null,
  results: Results,
  detectedHands: Hand[],
): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (results.image) {
    // results.image is the input frame (downscaled canvas); the overlay
    // canvas has the same dimensions, so it maps 1:1.
    ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
  }

  // Landmarks are normalized (0..1) to the input frame size.
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#00ff88';
  ctx.fillStyle = '#00ff88';

  detectedHands.forEach((hand) => {
    HAND_CONNECTIONS.forEach(([a, b]) => {
      const p1 = hand.landmarks[a];
      const p2 = hand.landmarks[b];
      if (!p1 || !p2) return;
      ctx.beginPath();
      ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
      ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
      ctx.stroke();
    });

    hand.landmarks.forEach((lm) => {
      ctx.fillRect(lm.x * canvas.width - 2, lm.y * canvas.height - 2, 4, 4);
    });
  });
}
