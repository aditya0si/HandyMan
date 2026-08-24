/** Target hover dwell duration in milliseconds before grab lock activates.
 *  700ms — fast enough to feel responsive, slow enough that passing over a
 *  card while pointing around does not lock it (user-tuned from the 2.0s
 *  original, which read as sluggish). */
export const DWELL_TARGET_MS = 700;

/** Rate at which dwell decays when hover is briefly interrupted. */
export const DWELL_DECAY_RATE = 1.5;

export interface DwellState {
  dwellMs: number;
  progress: number; // 0.0 to 1.0
  isLocked: boolean;
  justLocked: boolean;
}

/**
 * Tracks continuous hover dwell time over a card:
 * Charges smoothly up to DWELL_TARGET_MS (700ms). When reaching 100%
 * (progress = 1.0), enters locked/grabbed state.
 */
export class DwellGrabTracker {
  private dwellMs = 0;
  private isLocked = false;
  private previouslyLocked = false;
  private targetMs: number;

  constructor(targetMs: number = DWELL_TARGET_MS) {
    this.targetMs = targetMs;
  }

  setTargetMs(ms: number): void {
    this.targetMs = ms > 0 ? ms : DWELL_TARGET_MS;
  }

  update(isHovered: boolean, dtMs: number): DwellState {
    const target = this.targetMs || DWELL_TARGET_MS;
    if (this.isLocked) {
      // Already locked to hand: stays locked until explicit release / open palm
      return {
        dwellMs: target,
        progress: 1.0,
        isLocked: true,
        justLocked: false,
      };
    }

    if (isHovered) {
      this.dwellMs = Math.min(target, this.dwellMs + Math.max(0, dtMs));
    } else {
      // Hover lost: decay dwell progress
      this.dwellMs = Math.max(0, this.dwellMs - dtMs * DWELL_DECAY_RATE);
    }

    const progress = Math.min(1.0, this.dwellMs / target);
    const justLocked = !this.previouslyLocked && progress >= 1.0;

    if (progress >= 1.0) {
      this.isLocked = true;
      this.previouslyLocked = true;
    }

    return {
      dwellMs: this.dwellMs,
      progress,
      isLocked: this.isLocked,
      justLocked,
    };
  }

  /** Releases the lock when user gestures open-palm or detaches. */
  unlock(): void {
    this.isLocked = false;
    this.previouslyLocked = false;
    this.dwellMs = 0;
  }

  reset(): void {
    this.unlock();
  }
}
