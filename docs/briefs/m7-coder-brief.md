# JARVIS Milestone 7 — Coder Brief (Phase 2 close-out: two-hand twist rotation, 4-window demo scene, demo-ready state)

You are the Coder for JARVIS Milestone 7 in `C:\Users\oliad\Desktop\visionpro` (Windows / Git Bash; npm workspaces root; NOT a git repo). This brief is complete and self-contained. Implement EXACTLY this scope: WindowManager Y-axis rotation, InteractionEngine two-hand twist (join/rotate/exit), a 4-window demo scene with placeholder content, a Reset-view button (`CameraRig.reset()`), App wiring, tests, `verify_milestone7.py`, the verifier-lockstep update (v3/v4/v5/v6), and the README M7 section with the demo script and Phase 2 COMPLETE. NO Phase 3 work (real apps/AppRegistry), NO backend/shared changes, NO new gesture classification (gestures.ts frozen), NO window X/Z tilt, NO scene-root scaling, NO rotation momentum. When something is unspecified, follow the existing M1–M6 code conventions (they are deliberate) and document deviations the way M2–M6 did (docblock "DEVIATION"/decision notes).

## 0. Guardrails (read first)

- Run everything from the repo ROOT: `npm run test`, `npm run build`, `npm run dev:frontend`, `npm run lint --workspace @jarvis/frontend`. Python verifiers run as `python docs/scripts/verify_milestoneN.py [base_url]` against the dev server on http://localhost:5173 (start it in the background).
- TS constraints (tsconfig.app.json): `erasableSyntaxOnly` (NO `enum`), `verbatimModuleSyntax` (type-only imports MUST use `import type`), `noUnusedLocals` + `noUnusedParameters` (they compile tests too), `noFallthroughCasesInSwitch`.
- New unit tests run in vitest's default node environment (no DOM). No new npm dependencies.
- Quality skills are mandatory: `test-guard` on all test changes, `clean-code-guard` on all new/changed production code, `docs-guard` on the README changes. Your report must include the evidence lines those checks produced.
- NO NEW console output anywhere. The ONLY existing console line you may amend is enumerated in section 6 (`[App] interaction engine ready: 2 windows created` → `4 windows created` — grep-verified that NO verifier pins it). Every other existing console line stays byte-identical (verifiers pin formats: `[Performance]` four-key lines, `[Scene3D] FPS:`, `[HandTracker] detection latency:`, cleanup lines, hands/gesture lines).
- Baseline (do NOT regress, verified today): **155 vitest tests** (logger 13 + windowManager 21 + gestures 39 + interactionEngine 39 + animation 31 + cameraRig 12); build passes all three workspaces; fake-webcam latency min-avg ~200–216 ms (verifier band 150–260); single cleanup pairs; zero console/page errors.
- The ONLY existing tests you may amend are the TWO enumerated in section 8.E0 (`interactionEngine.test.ts` "two hands can each grab a window, but one window cannot be double-grabbed" and "double-grab refusal is type-agnostic: GRAB vs GRAB across hands"). Both amend the SAME observable: the M3 same-window-two-hands refusal is lifted for the M7 join. Every other existing test body stays green and untouched.

## 1. Codebase facts you will rely on (verified by reading, 2026-08-16)

- `apps/frontend/src/utils/interactionEngine.ts` — `processGesture(gesture, nowMs?)` dispatch: SWIPE/PINCH_ZOOM → `[]` first; hover eviction sweep; `GRAB|PINCH` → `processGrab`; `OPEN>0.8` → `releaseAll`; `NONE|POINT` → `releaseHand`; `POINT` → `processHover`; non-POINT one-shot hover clear. `processGrab`: existing-grab continuation via `continueGrab` (closed-window drop, per-frame `lastIntensity`, resize gated to PINCH frames with `|delta| > RESIZE_INTENSITY_DELTA` 0.05, else move); new grab raycasts via `raycastGrabbable` (NDC = `position / GESTURE_WORLD_HALF_EXTENT` 5), then the SAME-WINDOW refusal loop `for (const grab of this.grabsByHand.values()) if (grab.targetId === targetId) return [];` — THIS loop is what M7 replaces with the join. `GrabState = {targetId, grabOffset, lastIntensity}` keyed by handedness in `grabsByHand: Map<string, GrabState>`. `InteractionEvent` is a discriminated union: arm 1 `{type:'grab'|'release'|'move'|'resize', targetId: string, gesture, newPosition?, scaleChange?}`, arm 2 `{type:'hover', targetId: string|null, gesture, newPosition?: never, scaleChange?: never}` (the never-typed optionals exist so pre-M6 test bodies can read those fields without narrowing).
- `apps/frontend/src/utils/windowManager.ts` — `FloatingWindow.rotation: THREE.Euler` exists since M3 and is NEVER written by any op; `createWindowMesh` copies `position`/`scale` but NOT rotation (mesh.rotation stays 0 — M7 changes that). Ops pattern: lockstep state+mesh write → `notifyChanged()` (version bump + onChange); unknown-id silent no-ops. `snapshotWindow` in App already clones `rotation`.
- `apps/frontend/src/utils/cameraRig.ts` — pan/zoom clamps (`RIG_PAN_LIMIT` 4, `RIG_ZOOM_MIN` 2, `RIG_ZOOM_MAX` 12), both ops end with private `aimAndRefresh()` = `lookAt(ORIGIN)` + `updateMatrixWorld()`. Module const `ORIGIN`. M7 adds `reset()` (additive).
- `apps/frontend/src/App.tsx` — `handleSceneReady` creates 2 windows at `(-1.5, 1.5, -2)`/`(1.5, 1.5, -2)` with `console.log('[App] interaction engine ready: 2 windows created')`; `WINDOW_CONTENT: Record<string, ReactNode>` keyed by id; `handleInteractionEvent` branches grab/move/release (+hover; resize is a trailing comment no-op); routing SWIPE→`swipeToPan`+`rig.pan`, PINCH_ZOOM→`zoomToStep`+`rig.zoom`, else→engine; HUD title `"JARVIS · Milestone 6"` with the lockstep comment; `windowsCount={windows.length}` (auto-updates to 4 once 4 windows exist); `getWindowProjection` is position/size-based (`distanceTo`, `project`, `|ndc|>1` cull) and NEVER reads rotation.
- `apps/frontend/src/components/FloatingWindow.tsx` — DOM window; does NOT render rotation (accepted for M7, D10). DO-NOT-TOUCH.
- `apps/frontend/src/components/HandTracker.tsx` (facts only, DO-NOT-TOUCH) — `gestures = [...perHand, ...bimanual]`: the bimanual PINCH_ZOOM gesture rides ALONGSIDE the per-hand PINCH gestures, it does NOT replace them — so during a two-hand pinch-twist the per-hand PINCHes still reach the engine every frame (grabs + rotation updates never starve), while a separation-changing twist may ALSO fire PINCH_ZOOM → camera zoom (see D12).
- `apps/frontend/src/utils/gestures.ts` (DO-NOT-TOUCH, facts only) — GRAB = palm-center position, PINCH = thumb-index midpoint position; both flow through `processGrab` (M6 shared path); the join trigger types are exactly `GRAB|PINCH` (SWIPE/PINCH_ZOOM return `[]` before `processGrab`).
- Engine test rig (interactionEngine.test.ts): `setup()` builds a real headless `PerspectiveCamera(75, WINDOW_ASPECT, 0.1, 1000)` at `(0,0,5)` with `lookAt(0,0,0)`, real WindowManager + engine; helpers `makeGesture`, `ndcThroughCenter`, `pinchOver`, `grabOver`, `openHand`, `pointOver`, `pointMiss`. Raycasts read `mesh.matrixWorld` — tests call `scene.updateMatrixWorld(true)` after placing/rotating meshes.
- `animation.test.ts` feeds the engine single-hand 'Right' gestures only (grep-verified) — unaffected by join semantics.
- Verifier pins (grep-verified; current sha256 recorded in section 10): v1 has NO title/window pins; v2/v3/v4/v5 HUD lookups are version-tolerant (`includes('JARVIS · Milestone')`); v3 check f, v4 check e, v5 check e each assert `"2" in hud` (Windows count); v6 pins the EXACT `"JARVIS · Milestone 6"` in three spots (docstring item e, introspection finder, check e) AND `"2" in hud`; v3/v4/v5/v6 check c asserts "Test Window" AND "Second Window" visible; v3/v4/v5/v6 check b asserts `>= 2` floating windows (4 still passes — NO edit); v4 check l asserts `post_reload_windows_on_screen >= 2` (4 passes — NO edit). NO verifier pins the `[App] interaction engine ready` console line or any window POSITION.
- GestureDebug is fixed `top: 16, right: 16`; HUD is `top: 16, left: 16` (minWidth 260) — a top-CENTER button collides with neither.

## 2. Design decisions (decided by the Orchestrator — implement as specified, document in code)

**D1 — Window titles: keep 1/2, add Notes + Clock, drop "Dashboard".** window-1 stays `"Test Window"`, window-2 stays `"Second Window"` (v3/v4/v5/v6 check c asserts BOTH strings — keeping them means ZERO title-check edits across four verifiers), window-3 = `"Notes"`, window-4 = `"Clock"`. The user's suggested window-2 rename ("Notes") and window-4 ("Dashboard") were adapted: renaming window-2 would force a four-verifier title-check lockstep for zero functional value, and "Dashboard" awaits a real Phase 3 AppRegistry window — dropped, documented in README deviations.

**D2 — Demo scene positions (computed, margin-verified).** Four windows at four distinct depths/heights, ALL projecting on-screen at the default camera pose (0,0,5), fov 75:

| id | title | position | depth | ndc @16:9 (x,y) | ndc @16:10 (x,y) | max abs ndc |
| --- | --- | --- | --- | --- | --- | --- |
| window-1 | Test Window | `(-2.5, 2.2, -3.0)` | 8.0 | (-0.229, 0.358) | (-0.255, 0.358) | 0.358 |
| window-2 | Second Window | `(2.4, 1.4, -1.6)` | 6.6 | (0.267, 0.276) | (0.296, 0.276) | 0.296 |
| window-3 | Notes | `(-2.7, -0.7, -0.8)` | 5.8 | (-0.341, -0.157) | (-0.379, -0.157) | 0.379 |
| window-4 | Clock | `(2.8, -1.5, -2.4)` | 7.4 | (0.277, -0.264) | (0.308, -0.264) | 0.308 |

Every |ndc| ≤ 0.379 < 0.9 at BOTH aspect 16:9 (unit-test rig) and 16:10 (the verifier's 1280×800 viewport) — huge margin against the App `|ndc|>1` cull. At 1280×800 the projected rects (px) are approximately: w1 L428 T241, w2 L770 T271, w3 L330 T442, w4 L784 T489 — all four lefts distinct, all four tops distinct, all rects fully inside the viewport, none overlapping the HUD (top-left), GestureDebug (top-right), or the Reset button (top-center). The table lives as the docblock of a NEW module `apps/frontend/src/utils/demoScene.ts` (section 3) so it is unit-testable without importing App/React. Moving window-1/2 from their M3–M6 spots `(-1.5,1.5,-2)`/`(1.5,1.5,-2)` is deliberate (depth spread + distinct tops); nothing pins the old positions.

**D3 — `rotateWindow(id, angleY)`: absolute Y-set, wrapped, lockstep, Y-AXIS ONLY.** Writes `state.rotation.y = wrapToPi(angleY)` AND `mesh.rotation.y = state.rotation.y`, then `notifyChanged()` — exactly the move/resize pattern (unknown id → silent no-op; always notifies on a real write, like `moveWindow`). Y-axis only (turntable spin): wrist-relative landmark z-noise and the absence of reliable wrist orientation from MediaPipe make X/Z tilt unusable — simplest robust choice; document. New exported helper in windowManager.ts:

```ts
/** Wraps an angle in radians to [-PI, PI). +PI maps to -PI (same rotation,
 *  one canonical representation). */
export function wrapToPi(angle: number): number {
  const twoPi = Math.PI * 2;
  return (((angle + Math.PI) % twoPi) + twoPi) % twoPi - Math.PI;
}
```

(The engine imports `wrapToPi` as a VALUE from `'./windowManager'` — windowManager imports nothing from the engine, so no cycle.)

**D4 — Join trigger: type-agnostic (GRAB or PINCH), SILENT, raycast-gated, single slot.** A second hand whose GRAB-or-PINCH frame raycasts onto a window already grabbed by the other hand JOINS it in rotation mode. Type-agnostic because M6 unified the grab path and the lifted refusal was itself documented as type-agnostic (a fist "grabbing" the same window is consistent). Raycast-gated: a second-hand pinch that MISSES the grabbed window and hits nothing emits `[]` exactly as today; hitting a DIFFERENT free window starts a normal grab exactly as today. The join frame emits NO event (not a `'grab'` — that would reset App's velocity tracker mid-drag — and not a zero-delta rotate): the first twist motion emits the first `'rotate'`. Single rotation slot (max 2 hands → max 1 concurrent rotation): `private rotation: RotationState | null`.

**D5 — Rotation math (planar, base+delta, normalized, per-frame).** At join: `baseRotationY = window.rotation.y` (current), `baseLineAngle = atan2(sec.y - pri.y, sec.x - pri.x)` where pri = the primary hand's stored `lastPosition` and sec = the joining hand's current `gesture.position` — PLANAR, z ignored (landmark z is wrist-relative per hand; same reasoning as M4 momentum zeroing z and M5 pinch-zoom planar distance). Every continuation frame while rotation is active (either hand's frame — hands arrive as separate `processGesture` calls): recompute `lineAngle` from the two grab states' `lastPosition`, `delta = wrapToPi(lineAngle - baseLineAngle)`, `target = wrapToPi(baseRotationY + delta)`, call `rotateWindow(windowId, target)`. Sign convention (document): world +x projects right, +y up (camera (0,0,5) lookAt origin), so a CCW on-screen twist yields positive `delta` → positive `rotation.y`; the unit tests pin THIS convention — any real-camera feel flip is a deliberate one-character later change. No deadband: the recognizer's 3-frame debounce already smooths type noise, and the update is change-gated (below). NO rotation momentum (M4 position momentum only, unchanged): a release fires the normal release path → position momentum still works; the rotation angle just stays where it was left.

**D6 — `'rotate'` event arm (clean arm + required never-fields).**

```ts
export type InteractionEventType = 'grab' | 'release' | 'move' | 'resize' | 'hover' | 'rotate';
```

The union gains a third arm:

```ts
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
  }
```

The `newPosition?: never` / `scaleChange?: never` declarations are REQUIRED (not optional polish): frozen pre-M7 test bodies read `events[0].newPosition` / `events[0].scaleChange` off the UN-narrowed union, which only compiles when every arm declares the field — same reason the M6 hover arm got them. Do NOT add `angleDelta` to the other arms; M7 tests read it through a narrowing helper:

```ts
type RotateEvent = Extract<InteractionEvent, { type: 'rotate' }>;
const rotateEvents = (events: InteractionEvent[]): RotateEvent[] =>
  events.filter((e): e is RotateEvent => e.type === 'rotate');
```

Semantics: `angleDelta = wrapToPi(target - lastRotationY)` — the wrapped PER-FRAME delta (stays correctly signed across absolute wrap-around; pinned by test 8.G11). The event's `gesture` is the gesture of the frame that TRIGGERED the update (whichever hand's continuation computed it — with interleaved per-hand frames, restricting to the secondary hand would drop primary-frame updates). App's rotate branch ignores it entirely (D9), so the contract is: consumers may read `targetId`/`angleDelta`; treat `gesture` as informational. Emit + `rotateWindow` call are gated on `target !== lastRotationY` (a stationary two-hand hold emits nothing and does not churn notify).

**D7 — Continuation split: primary drags, secondary twists.** While rotation is active, PRIMARY-hand frames run the M6 `continueGrab` path VERBATIM (resize-gated-to-PINCH move) and THEN the rotation update — moves and rotation coexist per frame; per-frame event order is `[move|resize, rotate]` (deterministic, documented, pinned). SECONDARY-hand frames are twist-only: they update `lastPosition`/`lastIntensity` and run the rotation update, but never move/resize (two hands both writing position would fight; the secondary is the "twist hand" whose `grabOffset` exists only for takeover). New `GrabState` field (the enabler): `lastPosition: THREE.Vector3` — set at grab start (`gesture.position.clone()`), copied every continuation frame. It is read by the join (primary's base point) and by the rotation update (both endpoints) and by the exit re-anchor.

**D8 — Exit semantics: release-on-last-hand, re-anchor on takeover.** The `'release'` event means "this window is no longer grabbed" (App removes it from `grabbedIdsRef` and fires momentum) — so a release that leaves the OTHER hand holding the window must NOT emit:
- PRIMARY releases (its frame is NONE/POINT → `releaseHand`): delete the primary's grab, clear `rotation`, and RE-ANCHOR the survivor: `survivor.grabOffset.copy(survivor.lastPosition).sub(window.position)` — the secondary's next move computes `newPosition = its position - fresh offset` = the window's current position if the hand is still (NO JUMP, pinned); from then on the secondary is the normal dragger. Emit NOTHING.
- SECONDARY releases: delete the secondary's grab, clear `rotation`, emit NOTHING. The primary's `grabOffset` was never disturbed — it continues exactly as before (pinned).
- EITHER hand strong-OPEN (> 0.8): `releaseAll` keeps M3 semantics verbatim PLUS `this.rotation = null` — it clears both grabs and emits one `'release'` per GRAB. For a shared window that is TWO release events with the same `targetId` (document): App's release branch is idempotent for a repeated id (`grabbedIds.delete` idempotent; `applyHighlight` idempotent; the second pass finds the tracker already deleted → zero velocity → `buildMomentumSpec` returns null → no second animation — verified by reading App).
- Window closed mid-rotation: the continuation prelude's existing closed-window drop (hoisted, see section 4) also clears `rotation` when it targets the closed window; `rotateWindow` on a dead id is a manager no-op.

**D9 — App rotate branch: explicit no-op.** Rotation state already rode `WindowManager.rotateWindow` → `notifyChanged` → the throttled React snapshot (`snapshotWindow` clones `rotation`), so App has nothing to sync. Momentum is position-only by design (D5): the tracker is fed by the primary's `'move'` events which keep flowing during rotation. The DOM overlay does NOT visually rotate — the 3D mesh yaws beneath an unrotated projected DOM rect (the M3 projection loop is position/size-based and never reads rotation; ACCEPTED simplification, document in code + README — the emissive mesh edge turning is the visible cue). Raycast correctness on rotated meshes relies on three.js `intersectObjects` honoring `matrixWorld` (unit-pinned by test 8.G8 after an explicit `updateMatrixWorld`).

**D10 — Reset view (SHIP IT): `CameraRig.reset()` + top-center button.** In cameraRig.ts: `export const RIG_HOME_Z = 5;` and

```ts
/** M7: restores the camera to the home pose (0, 0, RIG_HOME_Z) and
 *  re-aims at the origin. Resets NOTHING else (windows, highlights, grabs
 *  are untouched) — it is the demo "get back to the boot view" affordance. */
reset(): void {
  this.camera.position.set(0, 0, RIG_HOME_Z);
  this.aimAndRefresh();
}
```

App renders (inside the root div, after `<GestureDebug/>`, before `<Hud/>` — order irrelevant):

```tsx
<button
  type="button"
  data-testid="reset-view"
  onClick={() => cameraRigRef.current?.reset()}
  style={{
    position: 'fixed',
    top: 16,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 20,
    padding: '4px 14px',
    background: 'rgba(10, 14, 39, 0.85)',
    border: '1px solid rgba(0, 132, 255, 0.5)',
    borderRadius: 8,
    color: '#0084ff',
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 1,
    cursor: 'pointer',
    userSelect: 'none',
  }}
>
  Reset view
</button>
```

Top-center: HUD ends ~x300 at 1280px, GestureDebug starts ~x1000, the button spans ~x590-690 — no collision (D2 rect table). No console output. No `stopPropagation` (the root div has no click handler; only FloatingWindow roots do). Render unconditionally (the rig exists from the first `handleSceneReady`, which fires at mount).

**D11 — `verify_milestone7.py` owns the current title pin.** The title-policy chain continues: v7 pins the EXACT `"JARVIS · Milestone 7"` in its three spots (docstring, finder, check); v6 is made version-tolerant IN THE SAME CHANGE (the exact edits are enumerated in section 10). v1/v2 stay untouched.

**D12 — Known interplay, accepted and documented (no code change).** During a two-hand twist about a STATIONARY hand, the hand separation changes, so the frozen M5 bimanual channel may fire PINCH_ZOOM (deadband 0.5 u/s on separation rate) and the camera zooms while the window rotates; the per-hand PINCHes still reach the engine every frame (`[...perHand, ...bimanual]`), so grabs/rotation never starve. A twist about the MIDPOINT keeps separation constant → below the deadband → no zoom. Suppression would need new classification state (forbidden); the demo script (section 9) advises midpoint twists. Document in README deviations.

## 3. Work item A — CREATE `apps/frontend/src/utils/demoScene.ts`

```ts
import * as THREE from 'three';

export interface DemoWindowSpec {
  id: string;
  title: string;
  position: THREE.Vector3;
}

/**
 * The M7 demo scene seed: four placeholder-content windows spread across
 * x/y/z for depth, ALL projecting on-screen at the default camera pose
 * (0, 0, 5), fov 75 (D2 margin table — verified at aspect 16:9 AND 16:10,
 * every |ndc| <= 0.379 < 0.9 against App's |ndc|>1 off-screen cull):
 *
 *   window-1 Test Window   (-2.5,  2.2, -3.0)  depth 8.0
 *   window-2 Second Window ( 2.4,  1.4, -1.6)  depth 6.6
 *   window-3 Notes         (-2.7, -0.7, -0.8)  depth 5.8
 *   window-4 Clock         ( 2.8, -1.5, -2.4)  depth 7.4
 *
 * Titles: window-1/2 keep their M3 titles (verifiers v3-v6 check c asserts
 * both); "Dashboard" is deferred to Phase 3 (AppRegistry). Unit-pinned by
 * demoScene.test.ts; the browser verifier additionally asserts all four
 * rects fully inside the 1280x800 viewport.
 */
export const DEMO_WINDOWS: readonly DemoWindowSpec[] = [
  { id: 'window-1', title: 'Test Window', position: new THREE.Vector3(-2.5, 2.2, -3.0) },
  { id: 'window-2', title: 'Second Window', position: new THREE.Vector3(2.4, 1.4, -1.6) },
  { id: 'window-3', title: 'Notes', position: new THREE.Vector3(-2.7, -0.7, -0.8) },
  { id: 'window-4', title: 'Clock', position: new THREE.Vector3(2.8, -1.5, -2.4) },
];
```

## 4. Work item B — `apps/frontend/src/utils/windowManager.ts` additions

1. `wrapToPi` (D3 exact body) exported above the class.
2. `rotateWindow`:

```ts
/**
 * M7 (D3): sets the window's Y-axis rotation (absolute, normalized to
 * [-PI, PI)), writing BOTH the state record and the mesh in lockstep —
 * exactly the move/resize pattern. Y-axis only (turntable spin): X/Z tilt
 * needs wrist orientation MediaPipe does not provide reliably (landmark z
 * is wrist-relative). Unknown ids are silent no-ops; a real write always
 * notifies (like moveWindow — the ENGINE gates redundant calls).
 */
rotateWindow(id: string, angleY: number): void {
  const window = this.windows.get(id);
  if (!window) return;
  window.rotation.y = wrapToPi(angleY);
  this.windowMeshes.get(id)!.rotation.y = window.rotation.y;
  this.notifyChanged();
}
```

(Match the file's existing `meshOf`-style optional handling — the other ops use `this.windowMeshes.get(id)?.…`; use the same optional-chaining style: `this.windowMeshes.get(id)!.rotation.y` vs `?.` — follow `minimizeWindow`'s `!` precedent only if the window exists implies the mesh exists (it does, they are created/deleted together); use `?.` for consistency with moveWindow/resizeWindow.)

3. Extend the class docblock's op list with rotateWindow; note that `createWindowMesh` still does not copy rotation (a fresh window is always rotation 0).

## 5. Work item C — `apps/frontend/src/utils/interactionEngine.ts` changes

1. **`GrabState`**: add `/** The hand's most recent gesture position (rotation line endpoint + takeover re-anchor). */ lastPosition: THREE.Vector3;` — set in BOTH grab-creation sites (normal grab + join).
2. **`RotationState`** (new, after `GrabState`):

```ts
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
```

plus `private rotation: RotationState | null = null;`.

3. **`InteractionEvent`**: add the rotate arm + extend `InteractionEventType` (D6 exact shape). Extend the union docblock (D8 reasoning).
4. **`processGrab` continuation prelude** — hoist the closed-window drop, then branch:

```ts
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
```

Remove the now-dead closed-window check from `continueGrab` (hoisted; keep its docblock comment moved to the prelude). `continueGrab` is otherwise BYTE-IDENTICAL (M6 semantics preserved for the primary).

5. **`processGrab` new-grab path** — replace the same-window refusal loop with the join:

```ts
const hit = this.raycastGrabbable(gesture);
if (!hit) return [];
const targetId = hit.userData.windowId as string;

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
```

6. **`joinRotation`** (new private):

```ts
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
```

7. **`updateRotation`** (new private):

```ts
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
```

(Import `wrapToPi` as a value: `import { wrapToPi } from './windowManager';` alongside the existing `import type { WindowManager }`.)

8. **`releaseHand`** — release-on-last-hand + re-anchor (D8):

```ts
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
```

9. **`releaseAll`**: add `this.rotation = null;` next to `this.grabsByHand.clear();` + docblock note that a shared window yields TWO same-targetId releases (App-idempotent, verified).
10. Update the class docblock: add an "M7 additions" section summarizing D4–D8 (join, twist-only secondary, primary move+rotate coexistence, release-on-last-hand + re-anchor, no rotation momentum, Y-axis only, silent join).

## 6. Work item D — `apps/frontend/src/App.tsx` changes

1. `handleSceneReady`: replace the two hardcoded `wm.createWindow` calls with `for (const spec of DEMO_WINDOWS) wm.createWindow(spec.id, spec.title, spec.position);` (`import { DEMO_WINDOWS } from './utils/demoScene';`) and amend the console line to `console.log('[App] interaction engine ready: 4 windows created');` (the ONLY sanctioned console-text amendment — grep-verified unpinned; keeps the line truthful).
2. `WINDOW_CONTENT` gains:
```tsx
'window-3': <div>Notes — demo placeholder content.</div>,
'window-4': <div>Clock — demo placeholder content.</div>,
```
3. `handleInteractionEvent`: add the rotate branch (after the release/hover handling, before the resize comment):
```tsx
if (event.type === 'rotate') {
  // M7 (D9): rotation state already rode WindowManager.rotateWindow ->
  // notifyChanged -> the throttled React snapshot. Momentum is
  // position-only by design; the DOM overlay does not visually rotate
  // (accepted simplification — the mesh's yaw is the visible cue).
  return;
}
```
4. Render the Reset-view button (D10 exact JSX) inside the root div.
5. HUD title `JARVIS · Milestone 6` → `JARVIS · Milestone 7`; update the adjacent lockstep comment (v7 now owns the exact pin; v3/v4/v5/v6 lookups tolerant after this change's verifier lockstep).
6. Extend the App docblock with a short "M7 (Phase 2 close)" paragraph: 4-window demo scene from DEMO_WINDOWS, two-hand twist rotation through the engine, reset-view button, rotate no-op rationale.

## 7. Work item E — `apps/frontend/src/utils/cameraRig.ts` + `cameraRig.test.ts`

- `RIG_HOME_Z = 5` export + `reset()` (D10 exact body) + docblock line.
- cameraRig.test.ts additions (2 new `it`s in a new `describe('CameraRig.reset (M7)')`):
  1. "restores the exact home pose (0, 0, RIG_HOME_Z) and re-aims at the origin" — `rig.pan(2, 3); rig.zoom(4); rig.reset();` → `camera.position` equals `(0, 0, 5)` exactly; the existing `expectAimedAtOrigin` pattern (copy the local helper shape) holds; matrixWorld elements `[12..14]` are `(0, 0, 5)` (freshness, same pattern as the M6 matrix test).
  2. "reset is idempotent and clamps still hold afterwards" — two resets in a row, then a pan/zoom still clamp (guards against reset corrupting state).

## 8. Work item F — tests (test-guard ALL of these)

### 8.A windowManager.test.ts — new `describe('WindowManager.wrapToPi + rotateWindow (M7)')`

1. **wrapToPi truth table**: `wrapToPi(0)≈0`; `π/2≈π/2`; `π≈-π` AND `-π≈-π` (canonical edge: +PI maps to -PI); `3π/2≈-π/2`; `7π/4≈-π/4`; `2π+0.1≈0.1`; `-2π-0.1≈-0.1` (`toBeCloseTo(…, 10)`).
2. **rotateWindow lockstep + notify**: create w1; `rotateWindow('w1', 1.2)` → `getWindow('w1')!.rotation.y ≈ 1.2`, `meshOf.rotation.y ≈ 1.2`, `rotation.x === 0 && rotation.z === 0` (Y-axis only), `rotation.x/z` on the mesh likewise; onChange fired exactly once; `wm.version` bumped by exactly 1.
3. **normalization in BOTH witnesses**: `rotateWindow('w1', 7π/4)` → both state and mesh read `≈ -π/4`; `rotateWindow('w1', 3π)` → `≈ -π`; chaining `rotateWindow(π/2)` then `rotateWindow(3π/2)` lands `≈ -π/2`.
4. **unknown id**: silent no-op, no notify (the throw-in-callback pattern from the existing unknown-ids test).
5. **rotation survives move/resize (and vice versa)**: `rotateWindow('w1', 1.0)`; then `moveWindow` + `resizeWindow` → `rotation.y` still `≈ 1.0` (mesh too), position/scale changed as commanded; also assert a `moveWindow` before a rotate leaves the rotate exact.

### 8.B interactionEngine.test.ts — new `describe('InteractionEngine two-hand twist rotation (M7)')`

Shared scenario numbers (window at `(0, 0, -2)`, depth 7, camera (0,0,5) fov 75 aspect 16:9): gesture-position → plane-hit factor is `5/(7·tan(37.5°)·aspect) = 0.5236` on x and `5/(7·tan(37.5°)) = 0.9308` on y, so a Left pinch at `(0.5236·0.5, 0.9308·0.15, 0) = (0.2618, 0.13962, 0)` hits the window at `(0.5, 0.15, -2)` (inside its ±0.75 × ±0.237 half-extents). Compute expected angles in-test from the same `atan2`/`wrapToPi` expressions (the file's established formula-assertion style).

- **G1 `second hand pinching the grabbed window JOINS silently; twist frames emit rotate`**: Right `pinchOver` center → `['grab']`. Left pinch at `(0.2618, 0.13962)` → `toEqual([])` (silent join). Left twist continuation at `(0.2, 0.5, 0)` (same intensity — no resize concerns; secondary frames never resize anyway) → exactly `['rotate']`: `targetId 'w1'`, `gesture.handedness 'Left'`, `angleDelta ≈ wrapToPi(atan2(0.5, 0.2) - atan2(0.13962, 0.2618))`; `wm.getWindow('w1')!.rotation.y` matches; mesh rotation.y matches (lockstep); **window POSITION unchanged** (secondary frames never move — D7).
- **G2 `primary frames keep dragging while rotation is active ([move, rotate] order)`**: continue G1's state; Right continuation pinch at `(0.3, 0.1, 0)` (same intensity) → exactly `['move', 'rotate']`; the move's `newPosition = (0.3, 0.1, 0) - grabOffset` with the ORIGINAL offset `((0,0,0) - (0,0,-2)) = (0,0,2)` → `(0.3, 0.1, -2)` (manager position matches); the rotate's `angleDelta = wrapToPi(target - previousTarget)` with `target = atan2(0.5-0.1, 0.2-0.3)`-based recompute; rotate event `gesture.handedness 'Right'` (triggering frame, D6).
- **G3 `join is type-agnostic: a GRAB joins a PINCH-held window`**: Right `pinchOver` grab; Left `grabOver` same window → `[]`; Left GRAB twist frame → `['rotate']`. (Together with E0-b's GRAB+GRAB this pins all combinations.)
- **G4 `exit A: primary releases -> secondary takes over as dragger, no jump, no release event`**: setup grab(R)+join(L)+one twist (rotation.y = r). Right `pointMiss('Right')` (NONE/POINT release path) → `toEqual([])` (silent — Right hand leaves no hover events aimed off-window). Left STATIONARY continuation (same `(0.2, 0.5)` position) → exactly `['move']` with `newPosition` EQUAL to the window's pre-exit position (the re-anchor: offset = lastPosition - win.position → NO JUMP; assert `wm.getWindow('w1')!.position` unchanged through the whole takeover). Then Left at `(0.5, 0.5)` → `['move']` with `newPosition = (0.3, 0, -2)` (window follows the new dragger). No rotate events after exit.
- **G5 `exit B: secondary releases -> primary continues unchanged with its ORIGINAL offset; rotation persists`**: grab(R)+join(L)+twist. Left `makeGesture(NONE, …, 'Left')` → `[]`. Right continuation at `(0.4, 0.2, 0)` → exactly `['move']` with the ORIGINAL offset math (`newPosition = (0.4, 0.2, -2)`); `rotation.y` still `≈ r` (no snap-back); a further Left-position change emits nothing (Left has no grab).
- **G6 `strong OPEN during rotation: release-all, two same-id releases, rotation off, re-grab works`**: grab(R)+join(L)+twist; `openHand('Right')` → exactly two `'release'` events, both `targetId 'w1'` (documented App-idempotence); rotation.y persists; fresh `pinchOver` → `['grab']`; fresh Left join → `[]` then twist → `['rotate']` (rotation mode re-arms).
- **G7 (fold into G1) `secondary never resizes`**: in G1, use a Left twist frame with a large intensity jump — assert no `'resize'` event and scale unchanged.
- **G8 `rotated window is still grabbable at its projected position`**: create w1, `wm.rotateWindow('w1', THREE.MathUtils.degToRad(40))`, `scene.updateMatrixWorld(true)` (matrixWorld freshness — the render loop's job in the browser), `pinchOver(camera, w1)` → `['grab']` with `targetId 'w1'`; also `degToRad(-30)` variant; assert the grabbed window's mesh rotation survived.
- **G9 `one-hand grab never rotates (no join without the second grab)`**: Right pinch grab + 3 move frames at varying positions → events are `['grab','move','move','move']`; `rotation.y === 0` throughout; no rotate events.
- **G10 `closed window mid-rotation: continuations drop silently, no stuck rotation`**: grab(R)+join(L); `wm.closeWindow('w1')`; Right continuation → `[]`; Left continuation → `[]`; create w2 elsewhere; `pinchOver(w2)` → `['grab']`; Left join on w2 → `[]`; twist → `['rotate']` targeting `'w2'` (proves the old rotation slot cleared).
- **G11 `wrap-around: base near +PI stays normalized; per-frame angleDelta stays signed`**: `wm.rotateWindow('w1', 3.0)` BEFORE the grab (base 3.0); grab(R)+join(L); twist adding `+0.3` of line angle → `rotation.y ≈ wrapToPi(3.3) = 3.3 - 2π ≈ -2.9832` (normalized) while `angleDelta ≈ +0.3` (wrapped PER-FRAME delta — not the absolute).

### 8.C E0 — the TWO sanctioned existing-test amendments (interactionEngine.test.ts)

**E0-a** — replace the body (and title) of `'two hands can each grab a window, but one window cannot be double-grabbed'` (currently ~line 282) with:

```ts
// E0-a (M7, sanctioned amendment): the M3 same-window-two-hands refusal is
// lifted for the JOIN case — a second hand pinching the window the other
// hand already holds JOINS it in rotation mode (silent: no events that
// frame; both hands now hold it — the M7 rotation suite proves the twist).
// The DIFFERENT-window grab still works normally.
it('two hands can each grab a window; a second hand on the SAME window joins silently (M7)', () => {
  const { scene, camera, wm, engine } = setup();
  const w1 = wm.createWindow('w1', 'A', new THREE.Vector3(-1.5, 1.5, 0));
  const w2 = wm.createWindow('w2', 'B', new THREE.Vector3(1.5, 1.5, 0));
  scene.updateMatrixWorld(true);

  engine.processGesture(pinchOver(camera, w1, 0.8, 'Right'));
  // M7 join: Left pinching the SAME window emits nothing but takes hold.
  expect(engine.processGesture(pinchOver(camera, w1, 0.8, 'Left'))).toEqual([]);
  // Left exits (secondary release, D8): silent — Right still holds w1 —
  // and Left is free to grab a DIFFERENT window normally.
  expect(
    engine.processGesture(pointMiss('Left')),
  ).toEqual([]);
  const leftGrab = engine.processGesture(pinchOver(camera, w2, 0.8, 'Left'));
  expect(leftGrab.map((e) => e.type)).toEqual(['grab']);
});
```

**E0-b** — replace the body (and title) of `'double-grab refusal is type-agnostic: GRAB vs GRAB across hands'` (cross-type suite, currently ~line 727) with the GRAB-flavored twin (pins the type-agnostic join):

```ts
// E0-b (M7, sanctioned amendment): same observable as E0-a with GRAB
// gestures — the join is type-agnostic (a fist joins a fist-held window).
it('join is type-agnostic: a GRAB joins a GRAB-held window (M7)', () => {
  const { scene, camera, wm, engine } = setup();
  const w1 = wm.createWindow('w1', 'A', new THREE.Vector3(-1.5, 1.5, 0));
  const w2 = wm.createWindow('w2', 'B', new THREE.Vector3(1.5, 1.5, 0));
  scene.updateMatrixWorld(true);

  engine.processGesture(grabOver(camera, w1, 0.6, 'Right'));
  expect(engine.processGesture(grabOver(camera, w1, 0.6, 'Left'))).toEqual([]);
  expect(engine.processGesture(makeGesture(GestureType.POINT, new THREE.Vector3(4.5, 4.5, 0), 0.5, 0.85, 'Left'))).toEqual([]);
  const leftGrab = engine.processGesture(grabOver(camera, w2, 0.6, 'Left'));
  expect(leftGrab.map((e) => e.type)).toEqual(['grab']);
});
```

Enumeration proof (grep-audited): NO other existing test touches the same-window path or the event-type union un-narrowed — `animation.test.ts` is single-hand 'Right' only; the hover suite's two-hand test POINTS (POINT never joins); all other suites are single-window/single-hand. If you find a third failing test during implementation, STOP and report it — do not amend unilaterally.

### 8.D demoScene.test.ts — CREATE `apps/frontend/src/utils/demoScene.test.ts`

New `describe('demoScene (M7 demo layout)')`, real headless `PerspectiveCamera(75, aspect, 0.1, 1000)` at `(0,0,5)` `lookAt(0,0,0)`:
1. "four specs project inside |ndc| < 0.9 at BOTH aspect 16:9 and 16:10" — for each aspect, for each spec: `|ndc.x| < 0.9 && |ndc.y| < 0.9` (`toBeLessThan(0.9)`; margin vs App's `|ndc|>1` cull).
2. "ids/titles are exact and projected centers are pairwise distinct" — `DEMO_WINDOWS.length === 4`; `map(id)`/`map(title)` equal the D1 lists; for both aspects, all `(ndc.x, ndc.y)` tuples pairwise distinct (nested loop or a Set of `${x},${y}` keys); depths pairwise distinct (the z-spread pin: `5 - position.z`).

### 8.E expected totals

155 existing (2 amended in place — count unchanged) + 5 (windowManager) + 11 (engine G1–G11; G7 folded into G1 makes 10 new `it`s — count what you actually write) + 2 (cameraRig) + 2 (demoScene) = **~174 expected**. Report the exact vitest count in your evidence.

## 9. Work item G — CREATE `docs/scripts/verify_milestone7.py` (M6 pattern)

Copy `verify_milestone6.py` as the structural template (fake-webcam Chromium flags, 1280×800 viewport, 14 s boot wait, console/pageerror/request listeners, `PERF_LINE_PATTERN` four-key regex verbatim, runtime introspection, summary JSON, `OVERALL: PASS/FAIL`). Changes from the v6 template:

- Evidence files `m7-scene.png`, `m7-full.png`, `m7-console.txt`, `m7-summary.json` in `docs/screenshots/`.
- Docstring: M7 scope (window rotation is unit-evidenced — the fake webcam has no hands; the script proves the demo scene boots clean: 4 windows on screen at distinct projected positions, HUD bumped, reset button harmless).
- Introspection finder pins the EXACT `'JARVIS · Milestone 7'` (v7 owns the current title — D11) and ALSO reads the reset button: `resetButton: {present, visible, text}` via `[data-testid="reset-view"]` rect/computed style.
- Checks (all must PASS):
  - `a: zero console errors and zero page errors`
  - `b: exactly 4 floating windows with distinct ids, ALL fully on screen` — `len(windows) == 4`, `len(window_ids) == 4`, every window `display != 'none'`, `left > 0`, `top > 0`, `width > 0`, `height > 0`, AND `left + width <= innerWidth`, `top + height <= innerHeight` (full containment = the empirical |ndc|-margin proof at the real viewport; read `innerWidth/innerHeight` in the introspection).
  - `c: window titles visible` — "Test Window", "Second Window", "Notes", "Clock" all in the combined window text.
  - `d: pairwise-distinct projected positions` — the 4 `(left, top)` tuples are pairwise distinct AND the 4 `left` values are distinct AND the 4 `top` values are distinct (the D2 layout guarantees all three; comment why: four distinct depths/heights by design).
  - `e: gesture-debug panel shows 'No hands detected'` (present + visible + text).
  - `f: HUD shows exact M7 title, Camera active, MediaPipe ready, Windows = 4` — `'JARVIS · Milestone 7' in hud` AND the usual Camera/MediaPipe/Windows rows AND `'4' in hud`.
  - `g: >= 1 [Performance] line, every line matching the M4 four-key format` (same regex/fullmatch logic as v6).
  - `h: latency >= 2 lines, min avg in 150-260ms, < 300 ms`.
  - `i: no gesture log lines (no hands on fake webcam)`.
  - `j: cleanup counts balanced (CameraCapture == HandTracker, 1-2 each)`.
  - `k: exactly 1 live video track`.
  - `l: max logged FPS >= 30 (boot window)`.
  - `m (bonus, ships with D10): Reset view button present + clicking it stays error-free with 4 windows still on screen` — assert `resetButton.present`; snapshot console/pageerror counts; `page.click('[data-testid="reset-view"]')`; `page.wait_for_timeout(1000)`; re-introspect: zero NEW console errors / page errors, still 4 windows passing check b's filter. Include `reset_check` in the summary JSON.

## 10. Work item H — verifier lockstep (hash-disciplined, enumerated)

BEFORE any edit, record: `sha256sum docs/scripts/verify_milestone*.py` and paste the table in your report. Current (Orchestrator-recorded 2026-08-16):

```
450c8386…6a242b  verify_milestone1.py   (MUST stay identical)
2f9bc072…f662b44 verify_milestone2.py   (MUST stay identical)
f186172c…522c4c84 verify_milestone3.py  (count-only edits)
d9d50566…c765266  verify_milestone4.py  (count-only edits)
7c780ed3…b91f15  verify_milestone5.py  (count-only edits)
3f0c4f14…3378d18  verify_milestone6.py  (title-pin + count edits)
```

(Use the full hashes from your own `sha256sum` run; the table above is the abbreviated form.) EVERY edit below is exhaustive — nothing else in these files changes.

**v3 `verify_milestone3.py` (count only — 3 spots):**
1. Docstring item f (~line 16): `Windows count row = 2` → `Windows count row = 4`.
2. Check key (~line 260): `"f: HUD intact (version-tolerant title), Camera active, MediaPipe ready, Windows = 2"` → `…Windows = 4"`.
3. Assertion (~line 267): `and "2" in hud` → `and "4" in hud  # M7 demo scene: exactly 4 windows at boot, none closed`.

**v4 `verify_milestone4.py` (count only — 3 spots):**
1. Docstring item e (~line 13): `Windows = 2` → `Windows = 4`.
2. Check key (~line 509): `…Windows = 2` → `…Windows = 4`.
3. Assertion (~line 516): `and "2" in hud` → `and "4" in hud  # M7 demo scene: exactly 4 windows at boot, none closed`.
NO edit to check l's `post_reload_windows_on_screen >= 2` (4 passes) or the drift logic (works over all windows).

**v5 `verify_milestone5.py` (count only — 3 spots):**
1. Docstring item e (~line 15): `Windows count row = 2` → `Windows count row = 4`.
2. Check key (~line 284): `…Windows = 2` → `…Windows = 4`.
3. Assertion (~line 291): `and "2" in hud` → `and "4" in hud  # M7 demo scene: exactly 4 windows at boot, none closed`.

**v6 `verify_milestone6.py` (title pin → tolerant + count — 5 spots):**
1. Docstring item e (~lines 12-14): replace `e) HUD shows the EXACT title "JARVIS · Milestone 6" (v6 owns the current title — pins it in BOTH the introspection finder and this check), Camera active, MediaPipe ready, Windows count row = 2` with `e) HUD shows the title "JARVIS · Milestone" (version-tolerant lookup since M7 — the title moved to Milestone 7; v6 pinned the exact M6 string until then), Camera active, MediaPipe ready, Windows count row = 4 (M7 demo scene)`.
2. Introspection comment (~lines 106-108): replace the "M6 owns the CURRENT title…" comment with `// Version-tolerant since M7 (the title moved to Milestone 7); v7 pins the exact string.`
3. Introspection finder (~line 110): `includes('JARVIS · Milestone 6')` → `includes('JARVIS · Milestone')`.
4. Check key (~line 286): `"e: HUD shows exact M6 title, Camera active, MediaPipe ready, Windows = 2"` → `"e: HUD intact (version-tolerant title), Camera active, MediaPipe ready, Windows = 4"`.
5. Check body (~lines 287 + 293): `"JARVIS · Milestone 6" in hud` → `"JARVIS · Milestone" in hud`; `and "2" in hud` → `and "4" in hud  # M7 demo scene: exactly 4 windows at boot, none closed`.

**v1, v2: ZERO edits.** AFTER the edits: re-run `sha256sum` (v1/v2 identical; v3/v4/v5/v6 changed — record old→new), then run ALL SEVEN verifiers against the dev server: `python docs/scripts/verify_milestone1.py` … `verify_milestone7.py` — every one must print `OVERALL: PASS`.

## 11. Work item I — README.md M7 section

Append after the M6 section (docs-guard applies):

```
## Milestone 7 — Demo polish: window rotation, four-window demo scene, demo-ready state (Phase 2 close-out)

**Phase 2 status: COMPLETE** — M1–M7 all accepted (155+ tests, seven
verifiers green); Phase 3 (real app content / AppRegistry) starts fresh.
```

Then the M6-style structure: **What was built** (every file from sections 3–9 with one bullet each: WindowManager `rotateWindow`/`wrapToPi`, engine join/twist/exit semantics with the D4–D8 one-liners, demoScene module + margin table reference, App wiring + rotate no-op + reset button, tests with counts, verify_milestone7.py, verifier lockstep with the hash table) / **How to run** (`npm run test`, `npm run dev:frontend`, `python docs/scripts/verify_milestone7.py`) / **Demo script** / **Deviations & decisions (D1–D12 digested)** / **Evidence** (`docs/screenshots/m7-scene.png`, `m7-full.png`, `m7-console.txt`, `m7-summary.json`) / **Milestone 7 acceptance (mapped honestly)** with automated items checked and manual real-webcam items unchecked (twist feel/sign, zoom-during-twist interplay, reset button feel).

**Demo script (REQUIRED section — hands-on instructions, exact gestures):**

- **Grab & move** — pinch thumb+index over a window (or close a fist over it) and move your hand; the window follows.
- **Resize** — while pinching, squeeze tighter / loosen to shrink / grow the window.
- **Release** — open your hand (or relax the grip); the window glides with momentum.
- **Rotate (new)** — with one hand already pinching a window, pinch the SAME window with your other hand, then twist your hands around each other: the window spins on its vertical axis (turntable, Y-axis only). Twist about the midpoint between your hands; a stationary-hand twist also zooms the camera (known interplay, D12). Release either hand to go back to one-hand dragging.
- **Pan** — sweep an open hand left/right/up/down; the view follows the hand.
- **Zoom** — pinch with BOTH hands and spread them apart / bring them together.
- **Hover-highlight** — point your index finger at a window; it glows (grabbed glows brighter).
- **Reset view (new)** — click the "Reset view" button (top center) to snap the camera back to the boot pose.

## 12. Do-not-touch list

`utils/gestures.ts`, `utils/animation.ts`, `utils/logger.ts`, `components/Scene3D.tsx`, `components/FloatingWindow.tsx`, `components/CameraCapture.tsx`, `components/ErrorBanner.tsx`, `components/GestureDebug.tsx`, `components/HandTracker.tsx`, `src/types/*`, `apps/backend/**`, `packages/shared/**`, `docs/scripts/verify_milestone1.py` + `verify_milestone2.py` (hash-identical), every existing verifier line NOT enumerated in section 10, every console format except the one sanctioned amendment in section 6.

## 13. Implementation order (small batches, verify each)

1. `windowManager.ts` (wrapToPi + rotateWindow) + 8.A tests → `npm run test` green.
2. `cameraRig.ts` reset + section 7 tests → green.
3. `interactionEngine.ts` rotation (sections 5.1–5.10) + E0-a/E0-b amendments + 8.B tests → full `npm run test` green + `npm run build` green + `npm run lint --workspace @jarvis/frontend` clean.
4. `demoScene.ts` + `demoScene.test.ts` + App wiring (section 6) → build green; boot the dev server and eyeball: zero console errors, 4 windows on screen, HUD "JARVIS · Milestone 7" / Windows 4, reset button clickable without errors.
5. `verify_milestone7.py` + verifier lockstep (section 10, hashes before/after) → all seven verifiers `OVERALL: PASS`.
6. README M7 + demo script + Phase 2 COMPLETE (docs-guard).
7. Final evidence pass (section 14).

## 14. Evidence to paste in your report

1. `npm run test` — the summary block (expected ~174 passed).
2. `npm run build` — the three-workspace success tail.
3. `npm run lint --workspace @jarvis/frontend` — clean output.
4. `sha256sum docs/scripts/verify_milestone*.py` — BEFORE and AFTER tables with the v1/v2 identity called out.
5. All seven verifier runs — each one's `=== CHECKS ===` block + `OVERALL: PASS` line.
6. `ls docs/screenshots | grep m7` — the four m7-* evidence files.
7. Skill evidence: test-guard / clean-code-guard / docs-guard check lines for the files they covered.
8. Any deviation from this brief, with the reason (deviations are acceptable if documented; silent scope drift is not).

---

# Overseer review checklist (1:1 with the M7 acceptance criteria)

For each item: verify with the cited evidence, not the Coder's summary. FAIL = send back to the Coder with the finding.

**Rotation — engine + manager**
- [ ] `WindowManager.rotateWindow(id, angleY)` exists; writes state.rotation.y AND mesh.rotation.y in lockstep; normalizes to [-π, π); unknown id silent no-op; notifies on real writes (8.A2-4 green).
- [ ] Y-axis ONLY (no X/Z writes anywhere; docblock rationale present); `wrapToPi` exported and truth-table-pinned incl. the +π → -π edge (8.A1).
- [ ] Rotation survives move/resize and vice versa (8.A5).
- [ ] Two-hand twist: second hand (GRAB or PINCH) raycasting onto the already-grabbed window JOINS silently; different-window grabs still work; misses still `[]` (G1, G3, E0-a, E0-b).
- [ ] Twist math: planar atan2 line angle between the two grab points (z ignored — rationale documented), base captured at join, per-frame recompute, result normalized; `'rotate'` events carry correct wrapped per-frame deltas; rotateWindow actually called (state witness) (G1, G2, G11).
- [ ] Primary still drags during rotation — moves and rotation coexist per frame with deterministic `[move|resize, rotate]` order; secondary frames are twist-only (never move/resize) (G1, G2, G7-fold).
- [ ] BOTH exit branches unit-verified: primary releases → silent, secondary becomes dragger with fresh anchored offset (NO position jump asserted); secondary releases → silent, primary continues with its ORIGINAL offset, rotation persists (G4, G5).
- [ ] Release-on-last-hand rule documented; strong OPEN still release-ALL (two same-id releases for a shared window, App-idempotence verified and documented) (G6 + App release-branch reading).
- [ ] One-hand grab never rotates (G9); closed-window mid-rotation drops cleanly with no stuck rotation slot (G10).
- [ ] Rotated window (~30-45°) still grabbable at its projected screen position after `updateMatrixWorld` (G8).
- [ ] NO rotation momentum (M4 momentum code untouched; release path unchanged — position momentum still fires; rotation angle persists).
- [ ] The M3 projection loop untouched: `getWindowProjection` unchanged; DOM overlay does NOT rotate (FloatingWindow.tsx untouched — check the hash/diff); the accepted simplification is documented in code + README (D9/D10 README section).

**Demo scene**
- [ ] 4 windows at boot with placeholder content, spread across x/y/z (depths 8.0/6.6/5.8/7.4); all project on-screen at (0,0,5) with margin (demoScene.test.ts: |ndc| < 0.9 at BOTH aspects; v7 check b: full viewport containment).
- [ ] Titles: "Test Window", "Second Window" (unchanged), "Notes", "Clock"; "Dashboard" drop documented; the M1 test cube kept.
- [ ] Positions come from `DEMO_WINDOWS` (single source; App has no literal positions).

**Demo-ready state**
- [ ] README "Demo script" section covers ALL eight interactions (grab/move, resize, release, two-hand twist rotate, swipe pan, pinch zoom, point hover, reset view) in hands-on terms.
- [ ] Phase 2 marked COMPLETE in the README M7 section.
- [ ] `CameraRig.reset()` restores (0,0,5), re-aims, refreshes matrices (unit tests); resets nothing else.
- [ ] Reset button: top-center, HUD-chrome styled, `data-testid="reset-view"`, no console output, no collision with HUD/GestureDebug; v7 check m proves the click stays error-free.
- [ ] HUD title exactly "JARVIS · Milestone 7" (v7 check f).

**Tests + build**
- [ ] ALL pre-existing tests pass except the TWO enumerated amendments (E0-a, E0-b) — diff the test files: exactly those two bodies changed, nothing else.
- [ ] New suites present and green: 8.A (5), 8.B (G1–G11), 8.D (2), section 7 (2). Reported total matches the actual vitest count (~174).
- [ ] `npm run build` passes all three workspaces; lint clean; TS constraints honored (no enums; `import type` everywhere; no unused locals).
- [ ] test-guard / clean-code-guard / docs-guard evidence lines present.

**Verifier lockstep (exactness matters — re-grep yourself)**
- [ ] v1/v2 sha256 IDENTICAL before/after.
- [ ] v3/v4/v5 changed ONLY in the three enumerated count spots each; v6 changed ONLY in the five enumerated title+count spots — `git`-less repo, so verify by re-reading the diff regions and re-running `grep -n '"2" in hud\|Milestone 6' docs/scripts/*.py` (must return only the v6 docstring-history mentions if any, and NO `"2" in hud` anywhere; `"4" in hud` present in v3/v4/v5/v6 + v7).
- [ ] All SEVEN verifiers re-run to `OVERALL: PASS` (paste each block).
- [ ] v7 checks a–m all PASS; four m7-* evidence files exist.
- [ ] Latency band still 150–260 ms; FPS boot ≥ 30; cleanup pairs 1–2; 1 live track; zero console/page errors; perf lines all match the M4 regex.

**Constraints**
- [ ] NO Phase 3 work (no AppRegistry/app content), NO backend/shared changes, NO gesture-classification changes (gestures.ts untouched), NO X/Z tilt, NO scene-root scaling, NO rotation momentum.
- [ ] Do-not-touch list intact (section 12) — spot-check FloatingWindow.tsx, HandTracker.tsx, Scene3D.tsx, gestures.ts are unmodified.
- [ ] Console output: only the ONE sanctioned amendment (`4 windows created`); no new lines anywhere.
- [ ] Docs: README M7 section complete with deviations digest (D1–D12, including D12 zoom-during-twist honesty) and honest acceptance mapping (manual items unchecked).
