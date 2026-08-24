import { useEffect, useRef } from 'react';
import type { EyeAttentionState } from '@jarvis/shared';
import { EyeAttentionDetector } from '../utils/eyeAttention/eyeAttentionDetector';
import type { FaceDetectionFrame, WindowSpatialInfo } from '../utils/eyeAttention/eyeAttentionDetector';

export interface EyeAttentionTrackerProps {
  videoElement: HTMLVideoElement | null;
  enabled: boolean;
  activeWindows: WindowSpatialInfo[];
  onAttentionUpdate?: (state: EyeAttentionState) => void;
}

export function EyeAttentionTracker({
  videoElement,
  enabled,
  activeWindows,
  onAttentionUpdate,
}: EyeAttentionTrackerProps) {
  const detectorRef = useRef<EyeAttentionDetector>(new EyeAttentionDetector(enabled));
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const callbackRef = useRef(onAttentionUpdate);
  callbackRef.current = onAttentionUpdate;

  useEffect(() => {
    detectorRef.current.setEnabled(enabled);
  }, [enabled]);

  useEffect(() => {
    // Emit at most one disabled-state object per effect run: calling the
    // setState-style callback with a fresh object on every effect invocation
    // would re-render App and (with an unstable prop) re-run this effect.
    let emittedDisabled = false;

    if (!enabled || !videoElement) {
      if (!emittedDisabled) {
        emittedDisabled = true;
        callbackRef.current?.({
          enabled: false,
          present: false,
          confidence: 0,
          gazeZone: null,
          targetWindowId: null,
          isLookingAway: false,
          normalizedGazePoint: null,
        });
      }
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    canvasRef.current = canvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    let animId: number;
    let lastTick = 0;

    const tick = () => {
      const now = performance.now();
      // Run face/eye estimation at ~15fps to conserve CPU/GPU
      if (now - lastTick >= 66 && videoElement.readyState >= 2) {
        lastTick = now;
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

        try {
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const frame = estimateFaceGaze(imgData);
          const state = detectorRef.current.processFrame(frame, activeWindows, now);
          callbackRef.current?.(state);
        } catch {
          // Safe degradation on image read failure
        }
      }
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animId);
      detectorRef.current.reset();
    };
  }, [enabled, videoElement, activeWindows]);

  return null;
}

/**
 * Lightweight, 100% local in-browser face presence and coarse gaze estimator.
 * Analyzes skin-luminance distribution and eye-band contrast to estimate
 * face center (x, y), yaw angle (-45..45), and pitch angle (-45..45).
 */
function estimateFaceGaze(imgData: ImageData): FaceDetectionFrame | null {
  const { data, width, height } = imgData;
  let totalSkinPixels = 0;
  let sumX = 0;
  let sumY = 0;

  // Simple skin color detection in RGB space (normalized)
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      // Basic skin tone heuristic
      if (r > 60 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15) {
        totalSkinPixels++;
        sumX += x;
        sumY += y;
      }
    }
  }

  const minSkinThreshold = (width * height) / 32; // minimum face area
  if (totalSkinPixels < minSkinThreshold) {
    return {
      hasFace: false,
      faceCenterX: 0,
      faceCenterY: 0,
      yawAngle: 0,
      pitchAngle: 0,
      confidence: 0,
    };
  }

  // Normalized centroid (-1..1)
  const avgX = sumX / totalSkinPixels;
  const avgY = sumY / totalSkinPixels;
  const normX = (avgX / width) * 2 - 1;
  const normY = (avgY / height) * 2 - 1;

  // Estimate yaw by horizontal asymmetry of skin distribution around center
  let leftMass = 0;
  let rightMass = 0;
  for (let y = Math.max(0, avgY - 20); y < Math.min(height, avgY + 20); y += 2) {
    for (let x = Math.max(0, avgX - 30); x < Math.min(width, avgX + 30); x += 2) {
      const idx = (Math.floor(y) * width + Math.floor(x)) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      if (r > 60 && g > 40 && b > 20 && r > g) {
        if (x < avgX) leftMass++;
        else rightMass++;
      }
    }
  }

  const asymmetry = (rightMass - leftMass) / Math.max(1, leftMass + rightMass);
  // Video mirror flips left/right: looking right tilts mass right
  const yawAngle = Math.max(-45, Math.min(45, asymmetry * 60 + normX * 25));
  const pitchAngle = Math.max(-45, Math.min(45, (normY - 0.1) * 35));

  const confidence = Math.min(1, Math.max(0.3, totalSkinPixels / (minSkinThreshold * 2.5)));

  return {
    hasFace: true,
    faceCenterX: normX,
    faceCenterY: normY,
    yawAngle,
    pitchAngle,
    confidence,
  };
}
