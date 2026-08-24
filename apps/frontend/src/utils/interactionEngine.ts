import * as THREE from 'three';
import type { Gesture } from './gestures';
import { GestureType } from './gestures';
import type { WindowManager } from './windowManager';
import { wrapToPi } from './windowManager';
import type { Handedness } from '@jarvis/shared';

/**
 * Gesture positions span -5..5 in world X/Y (see landmarkToVector3 in
 * gestures.ts). NDC = position / GESTURE_WORLD_HALF_EXTENT with NO extra Y
 * mirror: landmarkToVector3 already mirrors Y (image-up = world-up). The
 * mirror direction is pinned empirically by a unit test (interactionEngine
 * "NDC mapping" suite) with a real PerspectiveCamera + Raycaster.
 */
export const GESTURE_WORLD_HALF_EXTENT = 5;

/** |pinch intensity delta| above which a frame counts as resize (guide 3.3). */
export const RESIZE_INTENSITY_DELTA = 0.05;

/** OPEN confidence required to release grabs (guide 3.3: > 0.8; OPEN emits 0.9). */
export const OPEN_RELEASE_CONFIDENCE = 0.8;

/** Hover raycast throttle (~15 Hz at 30 fps inference; D5). */
export const HOVER_CHECK_INTERVAL_MS = 66;

/** A hover slot whose hand has been silent this long is evicted (D5). */
export const HOVER_EVICT_MS = 500;

export type InteractionEventType =
  | 'grab'
  | 'release'
  | 'move'
  | 'resize'
  | 'hover'
  | 'rotate';

/**
 * Discriminated union (D8): the four M3/M4 event types keep their exact
 * shape (targetId is always a string); 'hover' is the M6 addition whose
 * targetId is nullable (a ray stopped hitting / hover ended). TS narrows on
 * `type`, so all existing consumers compile unchanged. DEVIATION: the
 * hover arm also declares `newPosition?: never` / `scaleChange?: never` —
 * pre-M6 test bodies read those fields off arm 1 without type narrowing
 * (vitest's `toBe` does not narrow), and the `never`-typed optionals keep
 * those reads legal while statically proving a hover event carries no
 * move/resize payload.
 * M7 (D6): the 'rotate' arm is added for the same ergonomic reason — it
 * declares the never-fields so frozen pre-M7 test bodies can keep reading
 * `newPosition`/`scaleChange` off the UN-narrowed union. Semantics: the
 * event's `gesture` is the frame that TRIGGERED the update (either hand's
 * continuation); consumers should read ONLY targetId/angleDelta (App
 * ignores the gesture entirely).
 */
export type InteractionEvent =
  | {
      type: 'grab' | 'release' | 'move' | 'resize';
      targetId: string;
      gesture: Gesture;
      /** move: the window's new world position (gesture.position - grabOffset). */
      newPosition?: THREE.Vector3;
      /** resize: multiplicative scale change applied (1 + intensityDelta). */
      scaleChange?: number;
    }
  | {
      type: 'hover';
      /** Hit window id, or null when the ray stopped hitting / hover ended. */
      targetId: string | null;
      gesture: Gesture;
      /** Always absent — hover carries no payload (see docblock DEVIATION). */
      newPosition?: never;
      /** Always absent — hover carries no payload (see docblock DEVIATION). */
      scaleChange?: never;
    }
  | {
      type: 'rotate';
      targetId: string;
      gesture: Gesture;
      /** Wrapped per-frame change of the window's rotation.y (radians). */
      angleDelta: number;
      /** Always absent — rotate carries no move/resize payload (see arm 1). */
      newPosition?: never;
      /** Always absent — rotate carries no move/resize payload (see arm 1). */
      scaleChange?: never;
    };

interface GrabState {
  targetId: string;
  /** Where the hand grabbed relative to the window center; keeps the grab anchored. */
  grabOffset: THREE.Vector3;
  lastIntensity: number;
  /** The hand's most recent gesture position (rotation line endpoint + takeover re-anchor). */
  lastPosition: THREE.Vector3;
}

/** M7 two-hand twist state — a single slot (max 2 hands → max 1 rotation). */
interface RotationState {
  windowId: string;
  /** The hand that grabbed FIRST; keeps dragging during rotation (D7). */
  primaryHand: string;
  /** The hand that JOINED; twist-only frames + takeover candidate (D7). */
  secondaryHand: string;
  /** window.rotation.y captured at join. */
  baseRotationY: number;
  /** Line angle between the two grab points captured at join (planar). */
  baseLineAngle: number;
  /** Last applied absolute (wrapped) angle — per-frame delta source. */
  lastRotationY: number;
}

/** Per-hand POINT hover tracking (D5). */
interface HoverState {
  /** Currently hovered window id (null when the ray currently hits nothing). */
  targetId: string | null;
  /** Frame clock of the last ELIGIBLE (non-throttled) raycast. */
  lastCheckMs: number;
  /** Frame clock of the hand's last gesture (eviction sweep input). */
  lastSeenMs: number;
  /** The hand's last POINT gesture — reused by eviction events (the vanished
   *  hand leaves no gesture of its own). */
  lastGesture: Gesture;
}

/**
 * Translates gestures into window operations (guide step 3.3) with three
 * REQUIRED fixes:
 *
 * FIX A — the guide raycasts `scene.children`, so the GridHelper and the M1
 * test cube (both scene children) can intercept rays. Only the manager's
 * grabbable meshes are raycast; nearest hit wins.
 *
 * FIX B — the guide only continues a grab while the current frame's ray still
 * intersects the window, so a fast swipe (hand off the window) stalls the
 * grab. Grabs are keyed by HANDEDNESS and continue without any raycast;
 * raycasts only ever start NEW grabs.
 *
 * FIX C — NDC mapping (position/5, no Y re-mirror) verified against a real
 * headless THREE.PerspectiveCamera/Raycaster in the unit tests.
 *
 * DEVIATION — constructor takes (camera, windowManager) instead of the
 * guide's (scene, camera, windowManager): Fix A removes the only use of the
 * scene, and an unused field would be dead code.
 *
 * M6 (Phase 2 part 2) additions:
 *
 * - GRAB shares the PINCH grab path (processGrab — same handedness-keyed
 *   grab state, same NDC raycast of gesture.position to start new grabs:
 *   palm center for GRAB, pinch midpoint for PINCH). Continuation is
 *   MOVE-ONLY for GRAB frames (D4): the resize branch is gated to PINCH
 *   frames. Rationale: PINCH intensity is thumb-index tightness — a
 *   deliberate squeeze signal; GRAB intensity is mean curledness, which
 *   drifts with incidental fist flex (a ~0.005 normalized finger shift
 *   moves curledness by ~0.06 > 0.05), so resize-on-GRAB would fire
 *   spurious resizes mid-drag. The rule is per-FRAME, not per-grab-origin:
 *   a grab started by PINCH and held as a fist stops resizing for the GRAB
 *   frames and resumes if the hand pinches again (pinned by the cross-type
 *   tests).
 * - Release semantics (D3): OPEN > 0.8 keeps release-ALL verbatim; ADDED
 *   per-hand release when the grabbed hand's emitted type is NONE or POINT.
 *   Safety proof (why NONE/POINT from a grabbing hand always means the grip
 *   opened): classifyHand checks PINCH (thumb-index < 0.03) BEFORE POINT,
 *   so a PINCH frame can never classify as POINT — thumb and index are
 *   touching, so the index tip sits at the pinch point near the palm/thumb,
 *   and any frame where thumb-index >= 0.03 with the index extended means
 *   the pinch has physically released; GRAB requires all five fingertips
 *   curled while POINT requires the index extended — contradictory, so a
 *   held GRAB cannot flicker to POINT either. Therefore NONE covers a fist
 *   loosening into unclassifiable shapes and POINT covers the fist→index-
 *   first opening and the "drop, then point at the next thing" follow-up.
 *   Accidental-release risk is nil for the same reason; the 3-frame
 *   debounce (~100 ms at 30 fps) additionally filters transients and
 *   delays every release ~100 ms — accepted. The new release path does NOT
 *   check window existence (matches releaseAll; App's release branch
 *   already no-ops on a closed window).
 * - Hover (D5): POINT hands emit 'hover' events for grabbable windows,
 *   throttled to ~15 Hz (HOVER_CHECK_INTERVAL_MS, per-hand lastCheckMs),
 *   evicted after HOVER_EVICT_MS of hand silence. Emit-on-new-hit, emit-
 *   null-on-ray-stop, NEVER re-emits the same target. Strictly read-only:
 *   raycast only, no WindowManager mutation. Eviction events REUSE the
 *   slot's last POINT gesture — consumers must read ONLY
 *   event.gesture.handedness from hover events (contract). Residual gap:
 *   if ALL hands vanish, no processGesture call ever runs again, so the
 *   last highlight can stick until any hand reappears (the next call
 *   sweeps); accepted for M6, M7 candidate is a rAF-side sweep.
 * - SWIPE / PINCH_ZOOM (requirement 2d): return [] unconditionally and
 *   FIRST — they never touch grabs or hover; App routes them to the
 *   CameraRig (so the engine never performs two-hand window resize).
 *
 * M7 (Phase 2 close-out) additions — two-hand twist rotation:
 *
 * - Join (D4): a second hand whose GRAB-or-PINCH frame raycasts onto a
 *   window already grabbed by the OTHER hand JOINS it in rotation mode
 *   (the M3 same-window refusal is lifted for exactly this case). The join
 *   frame is SILENT (no 'grab' — that would reset App's velocity tracker
 *   mid-drag — and no zero-delta rotate); the first twist motion emits the
 *   first 'rotate'. Type-agnostic (GRAB or PINCH) because M6 unified the
 *   grab path; raycast-gated: a miss emits [] and a different free window
 *   starts a normal grab. Single rotation slot (max 2 hands → max 1
 *   concurrent rotation).
 * - Twist math (D5): planar (z ignored — landmark z is wrist-relative per
 *   hand, same reasoning as M4 momentum zeroing and M5 planar pinch
 *   distance). At join: baseRotationY = the window's current rotation.y,
 *   baseLineAngle = atan2 of the two grab points (primary's stored
 *   lastPosition vs the joining hand's current position). Every
 *   continuation frame while rotation is active (either hand's frame —
 *   hands arrive as separate processGesture calls): recompute the line
 *   angle from the two grab states' lastPosition, delta = wrapToPi(line
 *   - base), target = wrapToPi(baseRotationY + delta), rotateWindow.
 *   Sign convention: world +x projects right, +y up (camera (0,0,5)
 *   lookAt origin), so a CCW on-screen twist yields positive delta →
 *   positive rotation.y (unit-pinned; a real-camera feel flip is a
 *   deliberate one-character change). No deadband (the recognizer's
 *   3-frame debounce smooths type noise; the update is change-gated). NO
 *   rotation momentum — a release fires the normal release path
 *   (position momentum still works); the angle stays where it was left.
 * - Continuation split (D7): PRIMARY-hand frames run the M6 continueGrab
 *   path VERBATIM (resize-gated-to-PINCH move) and THEN the rotation
 *   update — per-frame event order is [move|resize, rotate], deterministic
 *   and pinned. SECONDARY-hand frames are twist-only: they refresh
 *   lastPosition/lastIntensity and run the rotation update, but never
 *   move/resize (the secondary is the twist hand; its grabOffset exists
 *   only for the takeover re-anchor). GrabState.lastPosition is set at
 *   grab start and copied every continuation frame.
 * - Exit (D8): release-on-last-hand — 'release' means the window is no
 *   longer grabbed, so a release that leaves the OTHER hand holding emits
 *   NOTHING. Primary release: delete the primary grab, clear rotation,
 *   RE-ANCHOR the survivor (fresh grabOffset at its current position —
 *   no jump; pinned), from then on the survivor drags normally. Secondary
 *   release: delete, clear rotation, emit nothing (the primary's
 *   grabOffset was never disturbed). Strong OPEN keeps release-ALL
 *   verbatim plus rotation = null: a shared window yields TWO release
 *   events with the same targetId (App's release branch is idempotent for
 *   a repeated id — verified by reading App). A window closed mid-rotation
 *   clears the rotation slot in the continuation prelude; rotateWindow on
 *   a dead id is a manager no-op.
 */
export class InteractionEngine {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly windowManager: WindowManager;
  private readonly isEditable: (windowId: string) => boolean;
  private readonly gazeTargetId: () => string | null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly grabsByHand = new Map<string, GrabState>();
  private readonly hoverStates = new Map<Handedness, HoverState>();
  /** M7 (D4): the single active rotation slot (null when none). */
  private rotation: RotationState | null = null;

  /**
   * M12 (D3): optional `isEditable(windowId)` predicate — the OWNER-MUTATES
   * gate. Default () => true keeps every pre-M12 behavior (all existing
   * tests run against the default). Non-editable windows (remote-owned, App
   * registry) reject grab starts, rotation joins, and grab continuations
   * SILENTLY — no events, no error spam. Hover is deliberately NOT gated:
   * it is read-only highlight feedback (documented deviation, brief D3).
   *
   * Phase 7: optional `gazeTargetId()` provider — assists raycast target
   * disambiguation when multiple windows overlap along the ray.
   */
  constructor(
    camera: THREE.PerspectiveCamera,
    windowManager: WindowManager,
    options?: {
      isEditable?: (windowId: string) => boolean;
      gazeTargetId?: () => string | null;
    },
  ) {
    this.camera = camera;
    this.windowManager = windowManager;
    this.isEditable = options?.isEditable ?? (() => true);
    this.gazeTargetId = options?.gazeTargetId ?? (() => null);
  }

  /**
   * Event order is deterministic: (1) SWIPE/PINCH_ZOOM passthrough; (2)
   * hover eviction sweep; (3) per-hand gesture dispatch (grab / release-all
   * / release-hand); (4) hover emit-or-clear for this hand.
   */
  processGesture(gesture: Gesture, nowMs: number = performance.now()): InteractionEvent[] {
    // Requirement 2d: SWIPE and PINCH_ZOOM never touch grabs or hover —
    // App routes them to the CameraRig, so the engine returns [] first.
    if (gesture.type === GestureType.SWIPE || gesture.type === GestureType.PINCH_ZOOM) {
      return [];
    }

    const events: InteractionEvent[] = [];

    // Eviction sweep (D5): a hand that has gone silent emits its final
    // hover-null carrying the hand's stored last POINT gesture.
    for (const [handedness, slot] of this.hoverStates) {
      if (nowMs - slot.lastSeenMs > HOVER_EVICT_MS) {
        if (slot.targetId !== null) {
          events.push({ type: 'hover', targetId: null, gesture: slot.lastGesture });
        }
        this.hoverStates.delete(handedness);
      }
    }

    // Phase 2: Confidence Gate & Hysteresis
    // If tracking confidence is too low, we drop the frame to prevent erratic mutations.
    // If the hand is already holding a grab, we apply hysteresis (lower threshold)
    // so we don't accidentally drop the window just because confidence flickered.
    const isGrabbed = this.grabsByHand.has(gesture.handedness);
    const minConfidence = isGrabbed ? 0.3 : 0.6;
    const confidence = gesture.trackingConfidence ?? gesture.confidence;
    if (confidence < minConfidence) {
      return events;
    }

    // The hand is present: refresh its slot's last-seen stamp.
    const slot = this.hoverStates.get(gesture.handedness);
    if (slot) slot.lastSeenMs = nowMs;

    if (gesture.type === GestureType.GRAB || gesture.type === GestureType.PINCH) {
      events.push(...this.processGrab(gesture));
    } else if (
      gesture.type === GestureType.OPEN &&
      gesture.confidence > OPEN_RELEASE_CONFIDENCE
    ) {
      events.push(...this.releaseAll(gesture));
    } else if (gesture.type === GestureType.NONE || gesture.type === GestureType.POINT) {
      events.push(...this.releaseHand(gesture));
    }

    if (gesture.type === GestureType.POINT) {
      events.push(...this.processHover(gesture, nowMs));
    } else {
      // One-shot transition (not throttled): any non-POINT frame ends an
      // active hover immediately — POINT→PINCH/OPEN/NONE/GRAB.
      const handSlot = this.hoverStates.get(gesture.handedness);
      if (handSlot && handSlot.targetId !== null) {
        handSlot.targetId = null;
        events.push({ type: 'hover', targetId: null, gesture });
      }
    }

    return events;
  }

  /** Grab path shared by PINCH and GRAB (M6 2a) — see the class docblock. */
  private processGrab(gesture: Gesture): InteractionEvent[] {
    // Fix B: an active grab for this hand continues WITHOUT raycasting, so
    // the hand may move anywhere on screen and the window still follows.
    const existing = this.grabsByHand.get(gesture.handedness);
    if (existing) {
      // Hoisted from continueGrab (single source): the window may have been
      // closed mid-grab — drop the grab silently; if a rotation targeted it,
      // clear that too (closed-window hygiene, D8).
      if (!this.windowManager.getWindow(existing.targetId)) {
        this.grabsByHand.delete(gesture.handedness);
        if (this.rotation?.windowId === existing.targetId) this.rotation = null;
        return [];
      }
      // M12 (D3): a continuation frame whose target became non-editable
      // drops the grab the same way — silent, no events. Unreachable in
      // practice (a locally-grabbed id can never enter the App's remote
      // registry), defensive + unit-pinned.
      if (!this.isEditable(existing.targetId)) {
        this.grabsByHand.delete(gesture.handedness);
        if (this.rotation?.windowId === existing.targetId) this.rotation = null;
        return [];
      }
      existing.lastPosition.copy(gesture.position);
      const events: InteractionEvent[] = [];
      const twistOnly =
        this.rotation?.windowId === existing.targetId &&
        gesture.handedness === this.rotation.secondaryHand;
      if (twistOnly) {
        // D7: the secondary hand never moves/resizes — it only twists.
        existing.lastIntensity = gesture.intensity;
      } else {
        events.push(...this.continueGrab(existing, gesture));
      }
      if (this.rotation?.windowId === existing.targetId) {
        events.push(...this.updateRotation(gesture));
      }
      return events;
    }

    // New grab: raycast only grabbable window meshes (Fix A).
    const hit = this.raycastGrabbable(gesture);
    if (!hit) return [];
    const targetId = hit.userData.windowId as string;

    // M12 (D3): OWNER-MUTATES — a non-editable (remote-owned) window
    // rejects the grab start SILENTLY: no grab state, no events, nothing
    // for a continuation frame to continue.
    if (!this.isEditable(targetId)) return [];

    // M7 (D4): a second hand grabbing the window the OTHER hand already
    // holds JOINS it in rotation mode (the M3 same-window refusal is lifted
    // for exactly this case). A second hand hitting a free window still
    // starts a normal grab.
    const holder = [...this.grabsByHand.entries()].find(
      ([, grab]) => grab.targetId === targetId,
    );
    if (holder) return this.joinRotation(gesture, hit, holder);

    this.grabsByHand.set(gesture.handedness, {
      targetId,
      grabOffset: gesture.position.clone().sub(hit.position),
      lastIntensity: gesture.intensity,
      lastPosition: gesture.position.clone(),
    });
    return [{ type: 'grab', targetId, gesture }];
  }

  /**
   * M7 (D4): the second hand joins the primary's window in rotation mode.
   * SILENT — no event on the join frame (a 'grab' would reset App's velocity
   * tracker mid-drag; a zero-delta rotate is noise): the first twist motion
   * emits the first 'rotate'. Rotation math is planar (z ignored — landmark
   * z is wrist-relative per hand).
   */
  private joinRotation(
    gesture: Gesture,
    hit: THREE.Object3D,
    [primaryHand, primaryGrab]: [string, GrabState],
  ): InteractionEvent[] {
    // Defensive: rotation active means both hands already hold (unreachable
    // via this path — the joining hand would have continued, not started).
    if (this.rotation) return [];
    // M12 (D3): joining a non-editable window in rotation mode is a grab
    // start by the second hand — rejected silently (defensive; the primary
    // grab could only exist on an editable window).
    if (!this.isEditable(primaryGrab.targetId)) return [];
    this.grabsByHand.set(gesture.handedness, {
      targetId: primaryGrab.targetId,
      grabOffset: gesture.position.clone().sub(hit.position),
      lastIntensity: gesture.intensity,
      lastPosition: gesture.position.clone(),
    });
    const baseRotationY =
      this.windowManager.getWindow(primaryGrab.targetId)?.rotation.y ?? 0;
    const baseLineAngle = Math.atan2(
      gesture.position.y - primaryGrab.lastPosition.y,
      gesture.position.x - primaryGrab.lastPosition.x,
    );
    this.rotation = {
      windowId: primaryGrab.targetId,
      primaryHand,
      secondaryHand: gesture.handedness,
      baseRotationY,
      baseLineAngle,
      lastRotationY: baseRotationY,
    };
    return [];
  }

  /**
   * M7 (D5): recompute the twist angle from the two grab states' stored
   * positions and apply it. Runs on EITHER hand's continuation frame while
   * rotation is active (per-hand gestures arrive as separate processGesture
   * calls). delta and target are wrapped; the event carries the wrapped
   * PER-FRAME delta. Stationary hold (target unchanged) emits nothing and
   * does not call rotateWindow (no notify churn).
   */
  private updateRotation(gesture: Gesture): InteractionEvent[] {
    const rotation = this.rotation;
    if (!rotation) return [];
    const primary = this.grabsByHand.get(rotation.primaryHand);
    const secondary = this.grabsByHand.get(rotation.secondaryHand);
    const win = this.windowManager.getWindow(rotation.windowId);
    if (!primary || !secondary || !win) {
      this.rotation = null; // defensive hygiene (grabs/window vanished)
      return [];
    }
    const lineAngle = Math.atan2(
      secondary.lastPosition.y - primary.lastPosition.y,
      secondary.lastPosition.x - primary.lastPosition.x,
    );
    const target = wrapToPi(
      rotation.baseRotationY + wrapToPi(lineAngle - rotation.baseLineAngle),
    );
    if (target === rotation.lastRotationY) return [];
    const angleDelta = wrapToPi(target - rotation.lastRotationY);
    this.windowManager.rotateWindow(rotation.windowId, target);
    rotation.lastRotationY = target;
    return [{ type: 'rotate', targetId: rotation.windowId, gesture, angleDelta }];
  }

  private continueGrab(grab: GrabState, gesture: Gesture): InteractionEvent[] {
    const intensityDelta = gesture.intensity - grab.lastIntensity;
    // Per-frame delta (guide only updates lastIntensity on resize, which
    // turns slow intensity drift into delayed jump-resizes; per-frame
    // semantics are predictable: only a sudden squeeze of > 0.05 resizes).
    grab.lastIntensity = gesture.intensity;

    // M6 (D4): resize is gated to PINCH frames — GRAB intensity is mean
    // curledness, which drifts with incidental fist flex, so GRAB frames
    // always take the move branch (see the class docblock).
    if (
      gesture.type === GestureType.PINCH &&
      Math.abs(intensityDelta) > RESIZE_INTENSITY_DELTA
    ) {
      const scaleChange = 1 + intensityDelta;
      this.windowManager.resizeWindow(grab.targetId, scaleChange);
      return [{ type: 'resize', targetId: grab.targetId, gesture, scaleChange }];
    }

    const newPosition = gesture.position.clone().sub(grab.grabOffset);
    this.windowManager.moveWindow(grab.targetId, newPosition);
    return [{ type: 'move', targetId: grab.targetId, gesture, newPosition }];
  }

  /** Open hand releases EVERY grabbed window (guide 3.3 release-all semantics).
   *  M7 (D8): also clears the rotation slot. NOTE: a shared window (two hands
   *  holding it in rotation mode) yields TWO release events with the same
   *  targetId — App's release branch is idempotent for a repeated id
   *  (grabbedIds.delete / applyHighlight idempotent; the second pass finds
   *  the tracker already deleted → zero velocity → no second animation). */
  private releaseAll(gesture: Gesture): InteractionEvent[] {
    const events: InteractionEvent[] = [];
    this.grabsByHand.forEach((grab) => {
      events.push({ type: 'release', targetId: grab.targetId, gesture });
    });
    this.grabsByHand.clear();
    this.rotation = null;
    return events;
  }

  /**
   * M6 (D3) per-hand release + M7 (D8) release-on-last-hand: if the OTHER
   * hand still holds this window, the drag continues under it — NO release
   * event ('release' means the window is no longer grabbed) — and the
   * survivor is re-anchored (fresh grabOffset at its current position) so
   * takeover does not jump. Window-existence is not checked (matches
   * releaseAll; App's release branch no-ops on a closed window).
   */
  private releaseHand(gesture: Gesture): InteractionEvent[] {
    const grab = this.grabsByHand.get(gesture.handedness);
    if (!grab) return [];
    const survivor = [...this.grabsByHand.entries()].find(
      ([hand, g]) => hand !== gesture.handedness && g.targetId === grab.targetId,
    );
    this.grabsByHand.delete(gesture.handedness);
    if (!survivor) {
      return [{ type: 'release', targetId: grab.targetId, gesture }];
    }
    const [, survivorGrab] = survivor;
    const win = this.windowManager.getWindow(grab.targetId);
    if (win) survivorGrab.grabOffset.copy(survivorGrab.lastPosition).sub(win.position);
    if (this.rotation?.windowId === grab.targetId) this.rotation = null;
    return [];
  }

  /** M6 (D5): POINT hover — throttled raycast, emit-on-new-hit, null-on-
   *  ray-stop, never re-emits the same target. Read-only (raycast only). */
  private processHover(gesture: Gesture, nowMs: number): InteractionEvent[] {
    let slot = this.hoverStates.get(gesture.handedness);
    if (!slot) {
      slot = {
        targetId: null,
        lastCheckMs: -Infinity,
        lastSeenMs: nowMs,
        lastGesture: gesture,
      };
      this.hoverStates.set(gesture.handedness, slot);
    }
    slot.lastGesture = gesture;

    if (nowMs - slot.lastCheckMs < HOVER_CHECK_INTERVAL_MS) {
      return []; // throttled frame: no raycast, check timestamp untouched
    }
    slot.lastCheckMs = nowMs;

    const hit = this.raycastGrabbable(gesture);
    const hitId = hit ? (hit.userData.windowId as string) : null;
    if (hitId === slot.targetId) return []; // never re-emit the same target
    slot.targetId = hitId;
    return [{ type: 'hover', targetId: hitId, gesture }];
  }

  private raycastGrabbable(gesture: Gesture): THREE.Object3D | null {
    // Fix C: NDC = (x / 5, y / 5). landmarkToVector3 already mirrored Y —
    // re-mirroring here would aim the ray at the wrong half of the screen.
    const ndc = new THREE.Vector2(
      gesture.position.x / GESTURE_WORLD_HALF_EXTENT,
      gesture.position.y / GESTURE_WORLD_HALF_EXTENT,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const intersects = this.raycaster.intersectObjects(
      this.windowManager.getGrabbableMeshes(),
      false,
    );
    // Nearest hit wins by default, but if gaze target is active and matches one of the hits, bias toward it
    if (intersects.length > 1) {
      const preferredId = this.gazeTargetId();
      if (preferredId) {
        const gazeMatch = intersects.find((hit) => hit.object.userData.windowId === preferredId);
        if (gazeMatch) return gazeMatch.object;
      }
    }
    return intersects.length > 0 ? intersects[0].object : null;
  }
}
