import type { GazeZone, EyeAttentionState } from '@jarvis/shared';
import {
  EYE_ATTENTION_CONFIDENCE_THRESHOLD,
  EYE_ATTENTION_AWAY_THRESHOLD_MS,
  EYE_ATTENTION_DWELL_CONFIRM_MS,
} from '@jarvis/shared';

export interface FaceDetectionFrame {
  /** Face detected in frame */
  hasFace: boolean;
  /** Normalized face center x (-1..1) */
  faceCenterX: number;
  /** Normalized face center y (-1..1) */
  faceCenterY: number;
  /** Estimated face yaw in degrees (-45..45, negative is looking left) */
  yawAngle: number;
  /** Estimated face pitch in degrees (-45..45, negative is looking down) */
  pitchAngle: number;
  /** Detection confidence (0..1) */
  confidence: number;
}

export interface WindowSpatialInfo {
  id: string;
  positionX: number; // world x
  positionY: number; // world y
}

export class EyeAttentionDetector {
  private enabled: boolean = false;
  private lastSeenFaceMs: number = 0;
  private currentZone: GazeZone | null = null;
  private zoneHistory: GazeZone[] = [];
  private lastTargetCandidate: string | null = null;
  private targetDwellStartMs: number = 0;
  private confirmedAttentionTarget: string | null = null;

  constructor(initialEnabled = false) {
    this.enabled = initialEnabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.reset();
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public reset(): void {
    this.currentZone = null;
    this.zoneHistory = [];
    this.lastTargetCandidate = null;
    this.targetDwellStartMs = 0;
    this.confirmedAttentionTarget = null;
  }

  /**
   * Process a detection frame and return the updated attention state.
   */
  public processFrame(
    frame: FaceDetectionFrame | null,
    activeWindows: WindowSpatialInfo[] = [],
    nowMs: number = performance.now(),
  ): EyeAttentionState {
    if (!this.enabled) {
      return {
        enabled: false,
        present: false,
        confidence: 0,
        gazeZone: null,
        targetWindowId: null,
        isLookingAway: false,
        normalizedGazePoint: null,
      };
    }

    if (!frame || !frame.hasFace || frame.confidence < EYE_ATTENTION_CONFIDENCE_THRESHOLD) {
      // Degraded / low-confidence path: check if user has been away long enough
      const isLookingAway = this.lastSeenFaceMs > 0 && nowMs - this.lastSeenFaceMs > EYE_ATTENTION_AWAY_THRESHOLD_MS;
      return {
        enabled: true,
        present: false,
        confidence: frame ? frame.confidence : 0,
        gazeZone: isLookingAway ? 'away' : null,
        targetWindowId: null,
        isLookingAway,
        normalizedGazePoint: null,
      };
    }

    this.lastSeenFaceMs = nowMs;

    // Detect if head is turned away (e.g. extreme yaw or looking down/away)
    const isAway = Math.abs(frame.yawAngle) > 35 || frame.pitchAngle < -25 || frame.pitchAngle > 30;
    let rawZone: GazeZone = 'center';

    if (isAway) {
      rawZone = 'away';
    } else {
      // Approximate gaze vector based on face center + yaw bias
      const gazeX = frame.faceCenterX + (frame.yawAngle / 45) * 0.5;
      if (gazeX < -0.28) {
        rawZone = 'left';
      } else if (gazeX > 0.28) {
        rawZone = 'right';
      } else {
        rawZone = 'center';
      }
    }

    // Temporal smoothing (hysteresis) over 5 frames
    this.zoneHistory.push(rawZone);
    if (this.zoneHistory.length > 5) {
      this.zoneHistory.shift();
    }

    // Determine majority zone
    const counts = this.zoneHistory.reduce((acc, z) => {
      acc[z] = (acc[z] || 0) + 1;
      return acc;
    }, {} as Record<GazeZone, number>);

    let smoothedZone: GazeZone = rawZone;
    let maxCount = 0;
    for (const [zone, count] of Object.entries(counts) as [GazeZone, number][]) {
      if (count > maxCount) {
        maxCount = count;
        smoothedZone = zone;
      }
    }
    this.currentZone = smoothedZone;

    // Calculate candidate target window based on zone and window positions
    let targetWindowId: string | null = null;
    if (smoothedZone !== 'away' && activeWindows.length > 0) {
      targetWindowId = this.resolveTargetWindowForZone(smoothedZone, activeWindows);
    }

    // Dwell tracking for confirmed attention target
    if (targetWindowId && targetWindowId === this.lastTargetCandidate) {
      if (nowMs - this.targetDwellStartMs >= EYE_ATTENTION_DWELL_CONFIRM_MS) {
        this.confirmedAttentionTarget = targetWindowId;
      }
    } else {
      this.lastTargetCandidate = targetWindowId;
      this.targetDwellStartMs = nowMs;
      this.confirmedAttentionTarget = null;
    }

    const normalizedGazePoint = isAway
      ? null
      : {
          x: Math.max(-1, Math.min(1, frame.faceCenterX + (frame.yawAngle / 45) * 0.4)),
          y: Math.max(-1, Math.min(1, frame.faceCenterY + (frame.pitchAngle / 45) * 0.4)),
        };

    return {
      enabled: true,
      present: true,
      confidence: frame.confidence,
      gazeZone: smoothedZone,
      targetWindowId: this.confirmedAttentionTarget || targetWindowId,
      isLookingAway: smoothedZone === 'away',
      normalizedGazePoint,
    };
  }

  /**
   * Disambiguate overlapping or nearby windows when pointing or raycasting.
   * Biases towards the window matching current gaze attention zone.
   */
  public disambiguateTargets(
    candidateIds: string[],
    activeWindows: WindowSpatialInfo[],
  ): string | null {
    if (candidateIds.length === 0) return null;
    if (candidateIds.length === 1 || !this.enabled || !this.currentZone || this.currentZone === 'away') {
      return candidateIds[0];
    }

    const candidates = activeWindows.filter((w) => candidateIds.includes(w.id));
    if (candidates.length === 0) return candidateIds[0];

    // Score candidates by spatial alignment with current gaze zone
    const scored = candidates.map((w) => {
      let score = 0;
      if (this.currentZone === 'left' && w.positionX < -0.5) score += 2;
      else if (this.currentZone === 'right' && w.positionX > 0.5) score += 2;
      else if (this.currentZone === 'center' && Math.abs(w.positionX) <= 0.8) score += 2;
      return { id: w.id, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0].id;
  }

  private resolveTargetWindowForZone(
    zone: GazeZone,
    windows: WindowSpatialInfo[],
  ): string | null {
    if (windows.length === 0) return null;

    if (zone === 'left') {
      // Find leftmost window
      const sorted = [...windows].sort((a, b) => a.positionX - b.positionX);
      return sorted[0].id;
    } else if (zone === 'right') {
      // Find rightmost window
      const sorted = [...windows].sort((a, b) => b.positionX - a.positionX);
      return sorted[0].id;
    } else if (zone === 'center') {
      // Find window closest to origin center
      const sorted = [...windows].sort((a, b) => Math.abs(a.positionX) - Math.abs(b.positionX));
      return sorted[0].id;
    }

    return null;
  }
}
