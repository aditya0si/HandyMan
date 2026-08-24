# JARVIS Milestone 6 — Coder Brief (Phase 2 part 2: GRAB drag, SWIPE pan, PINCH_ZOOM zoom, hover highlight)

You are the Coder for JARVIS Milestone 6 in `C:\Users\oliad\Desktop\visionpro` (Windows / Git Bash; npm workspaces root; NOT a git repo). This brief is complete and self-contained. Implement EXACTLY this scope: interaction wiring — a testable CameraRig (pan/zoom), GRAB grabs/drags/releases through the engine, POINT hover events, WindowManager highlight, App gesture routing, tests, the M6 verifier, the verifier-lockstep update, and README. NO new gesture classification (gestures.ts is fully DO-NOT-TOUCH), NO window rotation (M7), NO two-hand window resize (PINCH_ZOOM zooms the CAMERA). When something is unspecified, follow the existing M1–M5 code conventions (they are deliberate) and document deviations the way M2–M5 did (docblock "DEVIATION"/decision notes).

## 0. Guardrails (read first)

- Run everything from the repo ROOT: `npm run test`, `npm run build`, `npm run dev:frontend`, `npm run lint --workspace @jarvis/frontend`. Python verifiers run as `python docs/scripts/verify_milestoneN.py [base_url]` against the dev server on http://localhost:5173 (start it in the background).
- TS constraints (tsconfig.app.json): `erasableSyntaxOnly` (NO `enum`), `verbatimModuleSyntax` (type-only imports MUST use `import type`), `noUnusedLocals` + `noUnusedParameters` (they compile tests too), `noFallthroughCasesInSwitch`.
- New unit tests run in vitest's default node environment (no DOM). No new npm dependencies. `performance.now()` exists in Node — a legal default clock value.
- Quality skills are mandatory: `test-guard` on all test changes, `clean-code-guard` on all new/changed production code, `docs-guard` on the README changes. Your report must include the evidence lines those checks produced.
- NO new console output anywhere (verifiers assert formats byte-identically; M5 added none, M6 adds none). Every existing console line stays byte-identical.
- Baseline (do NOT regress): 113 vitest tests; build passes all three workspaces; fake-webcam latency min-avg ~200–216 ms (verifier band 150–260); single cleanup pairs; zero console/page errors.
- The ONLY existing test you may amend is the ONE enumerated in section 7.E0 (`interactionEngine.test.ts` "non-interactive gesture types produce no events" — it asserts GRAB/POINT/NONE inertness, which M6 by definition changes). Every other existing test body stays green and untouched.

## 1. Codebase facts you will rely on (verified by reading, 2026-08-16)

- `apps/frontend/src/utils/interactionEngine.ts` — constructor `(camera: THREE.PerspectiveCamera, windowManager: WindowManager)`; `processGesture(gesture)` currently: `PINCH → processPinch` (grabs keyed by `gesture.handedness` in `grabsByHand: Map<string, GrabState>`; new grabs raycast via `raycastGrabbable` with NDC = `position / GESTURE_WORLD_HALF_EXTENT` (5); continuation `continueGrab` does the else-if on `|intensityDelta| > RESIZE_INTENSITY_DELTA` (0.05) → resize, else move; `lastIntensity` updated per frame); `OPEN && confidence > OPEN_RELEASE_CONFIDENCE (0.8) → releaseAll`; everything else `[]`. `InteractionEvent {type: 'grab'|'release'|'move'|'resize', targetId: string, gesture, newPosition?, scaleChange?}`. The class docblock documents FIX A/B/C — keep those notes, extend them.
- `apps/frontend/src/utils/windowManager.ts` — `createWindowMesh` uses `MeshPhongMaterial({color 0x1a1a2e, emissive 0x0084ff, emissiveIntensity 0.1, side DoubleSide})`; state/mesh lockstep via `notifyChanged()` (version bump + onChange); unknown-id ops are silent no-ops; `FloatingWindow` state interface carries id/title/position/scale/rotation/isMinimized/zIndex/aspect.
- `apps/frontend/src/utils/animation.ts` (DO-NOT-TOUCH) — App's momentum path: `grab → cancelAnimation + fresh VelocityTracker`; `move → tracker.push(event.newPosition, event.gesture.timestamp)`; `release → buildMomentumSpec(win.position, velocity)` (world clamps |x|,|y| ≤ 5 — independent of camera pan, fine) then `addAnimation` writing through `wm.moveWindow`.
- `apps/frontend/src/components/Scene3D.tsx` — creates the camera (fov 75, z=5, NO explicit lookAt — default −Z orientation aims at origin), calls `onSceneReady(scene, camera)`, renders `renderer.render(scene, camera)` every rAF (so live camera-pose changes propagate with zero Scene3D knowledge), resize handler updates only `camera.aspect`. The camera is never `scene.add`ed; `WebGLRenderer.render` therefore updates its world matrices each frame.
- `apps/frontend/src/App.tsx` — `handleSceneReady(scene, camera)` creates a FRESH WindowManager + InteractionEngine + animation state per call (StrictMode) held in refs (`cameraRef`, `windowManagerRef`, `interactionEngineRef`, ...); `handleGesturesDetected` loops `detected` and currently SKIPS `NONE` (`if (gesture.type !== GestureType.NONE)`), feeding the rest to `engine.processGesture`, consuming events via `handleInteractionEvent` (grab/move/release branches exactly as animation.ts fact above); `interactionLatency` is sampled only when `processedAny`; `getWindowProjection` reads `cameraRef` + live meshes per rAF (`depth = camera.position.distanceTo(presented)`, `project(camera)`, off-screen cull `|ndc|>1 → null`); HUD title `"JARVIS · Milestone 5"` with the M5 lockstep comment; `summarizeGestures` already renders `zoom-in/out` tokens.
- `apps/frontend/src/utils/gestures.ts` (DO-NOT-TOUCH, facts only) — `classifyHand` order: **GRAB → PINCH → OPEN → POINT → NONE**; `buildGesture`: GRAB position = palm center, intensity = mean curledness; PINCH position = thumb-index midpoint, intensity = tightness; POINT position = INDEX TIP, intensity 0.5; SWIPE fires only when the STABILIZED type is OPEN (event channel), `swipeDirection` always present on SWIPE; PINCH_ZOOM only from `recognizeBimanual`, `zoomDirection` always present; `GESTURE_STABLE_FRAMES = 3` (~100 ms at 30 fps). Every detected hand yields a gesture each frame (possibly NONE) — so routing NONE through App reaches the engine whenever the hand is still in frame.
- Verifier title pins (grep-verified, premise CONFIRMED): ONLY `verify_milestone5.py` pins the exact title `"JARVIS · Milestone 5"` — three spots: docstring item e) (~line 12), the runtime-introspection HUD finder (~line 107), and check e (~line 283). v1 has NO title pin; v2/v3/v4 lookups are version-tolerant (`includes('JARVIS · Milestone')`). Current sha256: v1 `450c8386…`, v2 `2f9bc072…`, v3 `f186172c…`, v4 `d9d50566…`, v5 `399bd608…`.
- Test baseline (run today): 113 tests = logger 13 + windowManager 14 + gestures 39 + interactionEngine 16 + animation 31. `animation.test.ts` feeds the engine only PINCH/OPEN gestures (verified) — unaffected by M6. `gestures.test.ts` has `poseHand`/`fistPose`/`shiftHand` helpers you CANNOT import (test modules are not importable) — the engine test file gets its own local copy (7.E7).
- Existing engine test file rig: `setup()` builds a real headless `PerspectiveCamera(CAMERA_FOV 75, WINDOW_ASPECT, 0.1, 1000)` at `(0,0,5)` with `lookAt(0,0,0)`, `scene.add(camera)`, real WindowManager + engine; helpers `makeGesture`, `ndcThroughCenter`, `pinchOver`, `openHand`. Raycasts read `matrixWorld` — tests call `scene.updateMatrixWorld(true)` after placing meshes.

## 2. Design decisions (decided by the Orchestrator — implement as specified, document in code)

**D1 — CameraRig ownership: App-constructed, ZERO Scene3D changes.** App already receives the camera in `onSceneReady`; Scene3D's render loop renders whatever pose the camera has and its resize handler only touches `camera.aspect`, so it needs no knowledge of the rig. `handleSceneReady` constructs `new CameraRig(camera)` into a new `cameraRigRef` (fresh per scene — the exact StrictMode pattern of `windowManagerRef`/`interactionEngineRef`). The alternative (extend the `onSceneReady` payload or expose a ref from Scene3D) was REJECTED: it adds API surface to a component that needs zero changes and couples renderer setup to interaction policy. Scene3D goes on the DO-NOT-TOUCH list. The M3 projection loop reads `cameraRef` every rAF (`distanceTo`, `project`), so pan/zoom propagate to the DOM windows automatically and the `|ndc|>1` off-screen cull keeps working unchanged (pinned by a cameraRig unit test, 7.A).

**D2 — CameraRig API, constants, lookAt maintenance, matrix freshness.** Pure math over the camera; no DOM; node-testable.
```ts
export const RIG_PAN_LIMIT = 4;  // |camera.x|, |camera.y| clamp (world units)
export const RIG_ZOOM_MIN = 2;   // nearest camera z (dolly-in limit)
export const RIG_ZOOM_MAX = 12;  // farthest camera z (dolly-out limit)
export class CameraRig {
  constructor(camera: THREE.PerspectiveCamera);
  /** Pan in WORLD x/y at the current z, clamped to ±RIG_PAN_LIMIT, then
   *  re-aim at the origin. */
  pan(dx: number, dy: number): void;
  /** Dolly along z: positive step moves AWAY from origin, negative toward.
   *  Clamps z to [RIG_ZOOM_MIN, RIG_ZOOM_MAX], then re-aims at the origin. */
  zoom(step: number): void;
}
```
Both ops end with `camera.lookAt(ORIGIN)` (module const `new THREE.Vector3(0,0,0)`) and then `camera.updateMatrixWorld()` — the self-update keeps `matrixWorld`/`matrixWorldInverse` (THREE.Camera.updateMatrixWorld refreshes both) fresh for same-tick engine raycasts and projections, and neutralizes the known headless-test pitfall (stale camera matrix after rig ops). No getters: the caller already holds the camera (constructor takes it); the camera IS the state. Pan is world-axis ("x/y at current z" per spec); with `lookAt(origin)` maintained, panning ORBITS the camera around the scene — see D7 for why that matters. **Zoom moves the CAMERA, never a scene-root scale**: the M3 projection loop derives depth from `camera.position.distanceTo(mesh)` and size from `camera.fov` — scaling the scene root would desync that math; dollying the camera keeps every existing projection equation correct untouched.

**D3 — Release semantics: keep OPEN > 0.8 release-ALL; ADD per-hand release when the grabbed hand's emitted type is NONE *or* POINT.** New private `releaseHand(gesture)`: if `grabsByHand.has(gesture.handedness)`, emit `{type:'release', targetId, gesture}` and delete that hand's grab (per-hand — OPEN keeps its M3 release-ALL semantics verbatim). Why POINT is SAFE (document this proof in the code): `classifyHand` checks PINCH (thumb-index < 0.03) BEFORE POINT, so a PINCH frame can never classify as POINT — thumb and index are touching, so the index tip sits at the pinch point near the palm/thumb, and any frame where thumb-index ≥ 0.03 with the index extended means the pinch has physically released; GRAB requires all five fingertips curled while POINT requires the index extended — contradictory, so a held GRAB cannot flicker to POINT either. Therefore NONE/POINT from a grabbing hand always means the grip opened: NONE covers a fist loosening into unclassifiable shapes, POINT covers the fist→index-first opening and the natural "drop, then point at the next thing" follow-up (which M6's hover makes meaningful). Accidental-release risk is nil for the same reason; the 3-frame debounce (~100 ms at 30 fps) additionally filters transients and delays every release ~100 ms — documented as accepted. The new release path does NOT check window existence (matches `releaseAll`; App's release branch already no-ops on a closed window).

**D4 — GRAB wiring: same grab path as PINCH; GRAB continuation is MOVE-ONLY.** `processGesture` routes both `PINCH` and `GRAB` to the grab path (rename the private `processPinch` → `processGrab`, docblock "grab path shared by PINCH and GRAB — M6 2a"). New-grab start is byte-identical for both types: same NDC raycast of `gesture.position` (palm center for GRAB, pinch midpoint for PINCH — the code already uses `gesture.position`), same `grabsByHand` handedness key, same double-grab refusal, same `grabOffset` anchoring. Continuation: the existing resize-else-if branch is now gated to `gesture.type === GestureType.PINCH` frames; GRAB frames always take the move branch. Rationale (document): PINCH intensity is thumb-index tightness — a deliberate squeeze signal; GRAB intensity is mean curledness, which drifts with incidental fist flex (a ~0.005 normalized finger shift moves curledness by ~0.06 > 0.05), so resize-on-GRAB would fire spurious resizes mid-drag. The rule is per-FRAME, not per-grab-origin: a grab started by PINCH and held as a fist stops resizing for the GRAB frames and resumes if the hand pinches again (cross-type continuation is pinned by tests 7.E5–E6).

**D5 — Hover: new 'hover' event, ~15 Hz throttle, per-hand tracking, read-only.** `processGesture(gesture: Gesture, nowMs: number = performance.now())` — existing callers keep working via the default clock. Engine state (one map):
```ts
interface HoverState { targetId: string | null; lastCheckMs: number; lastSeenMs: number; lastGesture: Gesture; }
private readonly hoverStates = new Map<Handedness, HoverState>();
export const HOVER_CHECK_INTERVAL_MS = 66;  // ~15 Hz raycast throttle
export const HOVER_EVICT_MS = 500;          // hand-silence eviction
```
`processGesture` order (build one events array; deterministic order documented): (1) `SWIPE` / `PINCH_ZOOM` → **`return []` unconditionally and FIRST** (requirement 2d — they never touch grabs or hover; App routes them to the rig); (2) sweep `hoverStates` for `nowMs - lastSeenMs > HOVER_EVICT_MS` — an evicted slot with `targetId !== null` emits `{type:'hover', targetId: null, gesture: slot.lastGesture}` (a hand that vanished leaves no gesture of its own; the event REUSES the hand's last POINT gesture — consumers must read only `event.gesture.handedness` from hover events, document this contract); (3) if this hand has a slot, update `lastSeenMs = nowMs`; (4) `GRAB|PINCH` → processGrab; (5) `OPEN && conf > 0.8` → releaseAll; (6) `NONE|POINT` → releaseHand (D3); (7) `POINT` → hover: create-or-load slot (`lastGesture = gesture`), if `nowMs - lastCheckMs < HOVER_CHECK_INTERVAL_MS` skip (throttled frame), else `lastCheckMs = nowMs`, raycast via the SAME `raycastGrabbable` path (POINT position = index tip), and if the hit id `?? null` differs from `slot.targetId`, emit `{type:'hover', targetId: hit ?? null, gesture}` and update the slot — this gives emit-on-new-hit, emit-null-on-ray-stop, and NEVER re-emits the same target; (8) for any non-POINT type, if the hand's slot has `targetId !== null`, clear it and emit `{type:'hover', targetId: null, gesture}` immediately (one-shot transition, not throttled) — this ends hover when the hand changes shape (POINT→PINCH/OPEN/NONE/GRAB) and, because App now routes NONE to the engine, also when the grip dissolves into NONE. Hover is strictly read-only: it never calls a WindowManager mutation (raycast only). Per-hand independence: hover belongs to a POINT-ing hand, which by definition is not grabbing; the OTHER hand may be pinching — hover events are still emitted (even for the grabbed window); priority is App policy (D6). Residual gap (document honestly): if ALL hands vanish, no `processGesture` call ever runs again, so the last highlight can stick until any hand reappears (the next call sweeps); accepted for M6, noted as an M7 candidate (rAF-side sweep).

**D6 — Highlight: WindowManager writes emissive; App owns priority and recomputes on release.** In `windowManager.ts`:
```ts
export const WINDOW_HIGHLIGHT_BASE = 0.1;    // resting emissiveIntensity
export const WINDOW_HIGHLIGHT_RANGE = 0.4;   // emissiveIntensity = base + level * range
export const HIGHLIGHT_LEVEL_HOVER = 0.5;
export const HIGHLIGHT_LEVEL_GRABBED = 1;
/** Priority rule: grabbed wins over hover; none → 0. */
export function resolveHighlightLevel(isGrabbed: boolean, isHovered: boolean): number;
```
`FloatingWindow` state gains `highlight: number` (0 at creation; `createWindowMesh` sets `emissiveIntensity: WINDOW_HIGHLIGHT_BASE` — value unchanged from today). New method `setWindowHighlight(id: string, level: number): void` — unknown id → silent no-op; clamp level to [0,1]; if equal to the current `highlight` → no-op WITHOUT notify (idempotent — App's priority recompute must not churn); else write `state.highlight` AND `mesh.material.emissiveIntensity = WINDOW_HIGHLIGHT_BASE + level * WINDOW_HIGHLIGHT_RANGE` (clamp the product to [0.1, 0.5] by construction), then `notifyChanged()`. The state field IS the test getter (`getWindow(id).highlight`) — no separate getter method (the mesh material is the second witness). DOM border: **deferred** — `FloatingWindow.tsx` is DO-NOT-TOUCH, so M6 highlight is the mesh's emissive glow (partially visible through the 0.9-alpha DOM panel and around its 1px border); the highlight level already rides the throttled React snapshot (`notifyChanged` → `syncWindowsThrottled` ~10 Hz), so an M7 border is a pure FloatingWindow change. App keeps two per-scene refs reset in `handleSceneReady`: `hoveredByHandRef: Map<Handedness, string | null>` and `grabbedIdsRef: Set<string>`, and an `applyHighlight(id)` that calls `wm.setWindowHighlight(id, resolveHighlightLevel(grabbedIds.has(id), [...hoveredByHand.values()].includes(id)))`. Wiring: `grab` → add id + apply; `release` → delete id + apply (**this recomputes, so a release restores 0.5 automatically when a pointer still hovers the window — the honest fix for "the engine never re-emits the same target"**); `hover` → update that hand's slot (`event.gesture.handedness` → `event.targetId`), then apply to the hand's PREVIOUS target (if different) and the new one (if non-null); `handleCloseWindow` also deletes the id from both structures (hygiene). No extra throttle: engine hover is already ≤ 15 Hz and notify is idempotent + throttled downstream.

**D7 — Swipe sign table + zoom mapping + step constants (with a premise correction you must implement as pinned, not as intuition).** Constants and pure helpers in `cameraRig.ts` (unit-testable sign policy; App stays a thin router):
```ts
export const SWIPE_PAN_STEP = 0.5;  // world units per swipe event at intensity 1
export const ZOOM_STEP = 0.4;       // world units of camera z per zoom event at intensity 1
export function swipeToPan(direction: SwipeDirection, intensity: number): { dx: number; dy: number };
export function zoomToStep(direction: ZoomDirection, intensity: number): number;
```
(`SwipeDirection`/`ZoomDirection` are `import type` from `'./gestures'` — no cycle.) Both clamp `intensity` to [0, 1]. **Sign table (content-follows-the-hand):**

| swipeDirection | swipeToPan       | camera moves | scene on screen |
| -------------- | ---------------- | ------------ | --------------- |
| `left`         | `{dx: -s, dy: 0}` | −x           | slides LEFT (follows the hand) |
| `right`        | `{dx: +s, dy: 0}` | +x           | slides RIGHT |
| `up`           | `{dx: 0, dy: +s}` | +y           | slides UP |
| `down`         | `{dx: 0, dy: -s}` | −y           | slides DOWN |

`s = SWIPE_PAN_STEP * clamp01(intensity)`. Zoom: `zoomToStep('in', i) = -ZOOM_STEP * clamp01(i)` (camera z DEcreases toward the origin), `'out' → +ZOOM_STEP * i`. **Premise correction (document in the cameraRig docblock and README):** the delegation's inline recommendation ("swipe 'left' moves camera +x so the scene appears to move left") reasons with a PURE-TRANSLATION camera. The M6 rig is mandated to KEEP `lookAt(origin)`, which makes pan an ORBIT, and under an orbit the sign inverts: moving the camera +x rotates the view toward −x, so on-screen content shifts +x (numerically: camera (1,0,5) lookAt origin → the view center hits the z=−2 plane at world x = −0.4, so a fixed point at x=0 lands RIGHT of center; camera −x → left; camera +y → up). Unified rule: **camera pan direction = on-screen content direction = hand direction on both axes.** The unit test pins the OBSERVABLE (projected NDC shifts), not the reasoning — implement the table above and let 7.A.8 be the contract.

**D8 — InteractionEvent interface evolution: discriminated union, fully backward compatible.**
```ts
export type InteractionEventType = 'grab' | 'release' | 'move' | 'resize' | 'hover';
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
    };
```
Every existing consumer/test compiles unchanged: TS narrows the union on `type`, so App's grab/move/release branches still see `targetId: string` (no non-null assertions), and existing assertions (`events[0].targetId`, `newPosition`, `scaleChange`) read the same fields off arm 1.

**D9 — App routing by type; NONE now reaches the engine.** In `handleGesturesDetected`, replace the `!== NONE` filter with explicit routing: `SWIPE` → `const dir = gesture.swipeDirection; if (dir) { rig.pan(...swipeToPan(dir, gesture.intensity)); processedAny = true; }` (a SWIPE without `swipeDirection` is impossible from the recognizer — defensive skip, documented); `PINCH_ZOOM` → same pattern with `zoomToStep(gesture.zoomDirection, gesture.intensity)` and `rig.zoom(step)`; everything else (PINCH/GRAB/OPEN/POINT/**NONE**) → `engine.processGesture(gesture)` (NONE is REQUIRED for D3 release-on-NONE and D5 hover clearing). `processedAny` becomes true for any routed gesture INCLUDING NONE and rig events — update the comment: NONE frames now run the engine loop by design (release + hover-clear semantics) and sampling them keeps `interactionLatency` honest about the loop's real cost. All M3 semantics stay intact: intensity-delta resize (PINCH frames), release-all on strong OPEN, closed-window grab drop, double-grab refusal — untouched code paths, re-pinned by tests.

**D10 — Momentum on GRAB releases: zero App changes, pinned by tests.** App's momentum path consumes exactly `grab.targetId`, `move.newPosition` + `move.gesture.timestamp`, `release.targetId`. GRAB drags produce move events through the same `continueGrab` path, and D3 releases emit standard `release` events — so momentum fires unchanged. Pin it with engine test 7.E9 (field-level) and cite `animation.test.ts`'s M4 integration suite as the existing tracker→momentum proof.

## 3. Work item A — CREATE `apps/frontend/src/utils/cameraRig.ts`

Implement D2 + D7 exactly: constants `RIG_PAN_LIMIT 4`, `RIG_ZOOM_MIN 2`, `RIG_ZOOM_MAX 12`, `SWIPE_PAN_STEP 0.5`, `ZOOM_STEP 0.4`; `CameraRig` class (`pan`, `zoom`, both ending with `lookAt(ORIGIN)` + `camera.updateMatrixWorld()`); pure `swipeToPan` / `zoomToStep` with `clamp01`. Module docblock: fixed-camera rig purpose, orbit-vs-translation sign derivation (D7 premise correction with the numeric example), camera-dolly-over-scene-scale rationale (D2), matrix-freshness note, and the M6 scope (pan/zoom only — no rotation, M7).

## 4. Work item B — `apps/frontend/src/utils/windowManager.ts` additions

Additive only (no existing method changes): constants + `resolveHighlightLevel` + `highlight` field on `FloatingWindow` (initialized 0; `createWindowMesh` explicitly sets `emissiveIntensity: WINDOW_HIGHLIGHT_BASE`) + `setWindowHighlight` per D6 (unknown-id no-op, clamp, idempotent-no-notify, state+mesh lockstep write, `notifyChanged`). Extend the class docblock with the highlight contract.

## 5. Work item C — `apps/frontend/src/utils/interactionEngine.ts` (SANCTIONED unfreeze; M3 behavior preserved)

1. Constants: `HOVER_CHECK_INTERVAL_MS = 66`, `HOVER_EVICT_MS = 500` (exported, doc comments).
2. `InteractionEventType` + `InteractionEvent` discriminated union per D8; `HoverState` map per D5.
3. `processGesture(gesture, nowMs = performance.now())` restructured per the D5 order (SWIPE/PINCH_ZOOM early `return []` FIRST, eviction sweep, lastSeen update, type dispatch, POINT hover block, non-POINT hover clear).
4. Rename private `processPinch` → `processGrab`, called for `PINCH` and `GRAB`; gate the resize branch inside `continueGrab`... (the gate reads the FRAME gesture's type — implement inside `processGrab`/`continueGrab` where the frame gesture is in scope) to `gesture.type === GestureType.PINCH`; docblock the curledness-noise rationale (D4).
5. New private `releaseHand(gesture)` per D3 (per-hand, no window-existence check).
6. Hover raycast reuses `raycastGrabbable` unchanged (same NDC mapping, nearest-hit-wins, grabbable-only).
7. Update the class docblock: M6 additions (GRAB path, release semantics with the classifyHand-order safety proof, hover contract incl. "consumers read handedness only from hover events" and the all-hands-vanish residual, SWIPE/PINCH_ZOOM passthrough) on top of the preserved FIX A/B/C notes.

## 6. Work item D — `apps/frontend/src/App.tsx` (surgical)

1. Imports: `CameraRig`, `swipeToPan`, `zoomToStep` from `'./utils/cameraRig'`; `resolveHighlightLevel` from `'./utils/windowManager'`.
2. `cameraRigRef = useRef<CameraRig | null>(null)`; in `handleSceneReady`: `cameraRigRef.current = new CameraRig(camera);` next to the engine construction; also reset `hoveredByHandRef`/`grabbedIdsRef` (new refs per D6).
3. `applyHighlight(id)` helper per D6; wire it into `handleInteractionEvent` (grab/release/hover branches per D6); `handleCloseWindow` additionally drops the id from both highlight refs.
4. `handleGesturesDetected`: per-type routing per D9 (SWIPE → rig.pan, PINCH_ZOOM → rig.zoom, everything else incl. NONE → engine). Update the interactionLatency comment.
5. HUD title `"JARVIS · Milestone 5"` → `"JARVIS · Milestone 6"` with the comment block:
```tsx
{/* HUD title bumps per milestone (now "JARVIS · Milestone 6").
    docs/scripts/verify_milestone6.py pins this exact string; prior
    verifiers' HUD lookups are version-tolerant (verify_milestone5.py
    was made tolerant in this change — see README M6 deviations). */}
```
6. Component docblock: add the M6 paragraph (rig routing table with the sign convention, highlight priority + release-recompute, NONE routing) alongside the existing M4/M5 notes. NOTHING else — no new console lines, no FloatingWindow/GestureDebug changes.

## 7. Work item E — tests (test-guard; report skill evidence)

**E0 — The ONE sanctioned existing-test amendment** (`interactionEngine.test.ts`, "non-interactive gesture types produce no events", ~lines 224–232): its GRAB/POINT/NONE inertness assertions contradict M6 by design (GRAB now grabs; POINT now hovers; that test aims the gesture AT a window so a POINT would emit hover). Replace its body with the requirement-2d passthrough pin, renamed `"SWIPE and PINCH_ZOOM pass through untouched; NONE is inert with nothing grabbed"`: build a SWIPE gesture (add `swipeDirection: 'left'`) and a PINCH_ZOOM gesture (add `zoomDirection: 'in'`) over the window → `[]` each; a NONE gesture with nothing grabbed and no hover state → `[]`. GRAB/POINT behavior is covered by the new suites below. List this amendment with rationale in your report. NO other existing test body changes anywhere.

**E1 — NEW `apps/frontend/src/utils/cameraRig.test.ts` (≥ 10 tests, node env, real PerspectiveCamera fov 75 z 5 like the engine rig):**
1. `pan` moves camera world x/y at constant z (pan(1.5, -1) from (0,0,5) → (1.5, -1, 5)).
2. `pan` clamps: pan(100, 0) → x = RIG_PAN_LIMIT; pan(-100, -100) → (−4, −4); z untouched.
3. `zoom` clamps: zoom(-100) → z = RIG_ZOOM_MIN; zoom(+100) → RIG_ZOOM_MAX; x/y untouched.
4. `zoom` sign: zoom(-0.4) at z 5 → 4.6 (toward origin); zoom(+0.4) → 5.4.
5. lookAt maintained: after every op, `camera.getWorldDirection(v)` ≈ `origin − camera.position` normalized (toBeCloseTo, 10 digits).
6. No drift: a fixed deterministic op sequence (e.g. 1000 alternating pan/zoom calls with varied steps, or a seeded LCG) ends within clamps AND still lookAt-origin (assert both after the loop, plus z monotone-clamped invariants spot-checked).
7. Sign table: `swipeToPan` all four directions at intensity 1 and 0.5 (and clamp: intensity 2 ≡ 1); `zoomToStep('in'|'out', i)` values and clamping.
8. **Observable pin (the contract for D7 — pins the orbit rule empirically):** with a real camera (fov 75, aspect 16/9, z 5): the point `P = (9, 0, -2)` projects at rest to `ndc.x ≈ 0.94` (compute; assert `0.9 < ndc.x < 1` — inside the frustum); after `pan(+RIG_PAN_LIMIT, 0)` its projected x EXCEEDS +1 (content shifted +x with the camera — assert `ndc.x > 1`, i.e. the App's `|ndc|>1` off-screen cull would now fire); after `pan(-4, 0)` a centered point `(0, 0, -2)` projects to NEGATIVE x (content moved left with the hand); after `pan(0, +4)` the centered point projects to POSITIVE y (content moved up with the hand). These four assertions pin the convention by observable projection behavior, independent of the derivation.
9. Zoom propagates to projection: depth `camera.position.distanceTo(P)` decreases after `zoomToStep('in', 1)`; an off-axis point's projected magnitude grows.
10. Matrix freshness: after `pan` + `zoom`, `camera.matrixWorld` reflects the new position WITHOUT any manual `updateMatrixWorld` call (rig self-updates — pins D2).

**E2 — `interactionEngine.test.ts` ADDITIONS (existing suites untouched except E0):**
- *GRAB lifecycle suite:* (1) GRAB over a window emits `grab` (targetId, no newPosition/scaleChange — same shape assertions as the pinch test; build via `makeGesture(GestureType.GRAB, ...)` at `ndcThroughCenter`); (2) GRAB miss → `[]`; (3) GRAB continuation moves the window far off-window (fix-B inheritance: `move` with `newPosition = position − grabOffset`); (4) **GRAB intensity drift never resizes** (D4): grab at intensity 0.3, continue at 0.9 (Δ 0.6 ≫ 0.05) → `move` only, window scale unchanged; (5) strong OPEN releases a GRAB-started grab (release-all) and the hand can re-grab; (6) **release-on-NONE**: GRAB grab → NONE (same hand) → exactly `[release w/ targetId]`, grab cleared (next GRAB over the window grabs again); (7) **release-on-POINT**: GRAB grab → POINT aimed OFF-window → exactly `[release]` (off-window keeps hover silent); (8) weak OPEN (conf 0.5) does NOT release a GRAB grab (M3 carryover); (9) closing a grabbed window mid-GRAB drops the grab silently (carryover).
- *Cross-type grab suite:* (10) PINCH starts, GRAB frames continue (moves), a later PINCH frame with a big intensity delta RESIZES (frame-type rule); (11) GRAB starts, PINCH continues and can resize; (12) double-grab refusal is type-agnostic: hand R GRAB-holds w1, hand L GRAB over w1 → `[]`, over w2 → `grab`.
- *Hover suite (ALL clocks injected via `processGesture(g, nowMs)`):* (13) first POINT over w1 emits `hover {targetId 'w1'}` once; later POINT frames ≥ 66 ms apart over the same window re-emit NOTHING; (14) throttle: frames 30 ms apart skip the raycast entirely (no events, and — assert via a follow-up eligible frame — the check timestamp only advances on eligible frames); (15) POINT over w1 then POINT missing → `hover {targetId null}`; a missing POINT with no prior hit → no event; (16) non-POINT clears: POINT hit w1 → same-hand PINCH aimed off-window emits `hover null` (alongside that gesture's own events); (17) per-hand independence: Right POINTs w1, Left POINTs w2 → one hover each; each hand's no-re-emit tracked independently; (18) hover is read-only: after a hover hit + hover null, `wm.version` unchanged, no move/resize events, window state untouched; (19) hover during the OTHER hand's grab: R PINCH-grabs w1, L POINTs at w1 → hover `{w1}` still emitted (engine does not suppress — App resolves priority); (20) eviction: R POINTs w1 at t0; only L gestures until t > t0 + HOVER_EVICT_MS → L's call emits `hover null` carrying R's handedness (`event.gesture.handedness === 'Right'`).
- *Recognizer+engine integration (requirement 2e):* (21) fast-moving fist: per 100 ms frame, shift a fist hand +0.04 normalized x (4 u/s > SWIPE_VELOCITY_THRESHOLD 2.5); `recognizeGestures([hand], t)` yields GRAB every frame (NEVER SWIPE — SWIPE requires stabilized OPEN, pin it with an explicit type assertion per frame) and the engine yields exactly one `grab` then `move`s — never resize/release/hover; (22) momentum fields: GRAB grab + several GRAB moves with increasing `gesture.timestamp`s → NONE release carries `targetId` and the moves carry `newPosition` (the exact fields App's momentum path consumes — cite animation.test.ts M4 integration as the tracker→momentum proof); (23) default-clock no-throw: one `processGesture(pointGesture)` without nowMs.

**E3 — `windowManager.test.ts` ADDITIONS (new describe `WindowManager.setWindowHighlight`):** (1) createWindow defaults: `highlight === 0` and material `emissiveIntensity === WINDOW_HIGHLIGHT_BASE`; (2) `setWindowHighlight(id, 0.5)` → state `0.5`, material `emissiveIntensity === 0.1 + 0.5 * 0.4` (toBeCloseTo), onChange fired, version +1; (3) clamps: level 2 → 0.5 state / 0.5 emissive; level −1 → 0 / 0.1; (4) idempotent: same level twice → second call does NOT notify (version unchanged); (5) unknown id: silent no-op, no notify; (6) lockstep: highlight survives `moveWindow`/`resizeWindow` (state + material still agree); (7) `resolveHighlightLevel` truth table: (true, *) → 1; (false, true) → 0.5; (false, false) → 0.

Target: 113 existing (E0 amended in place, count unchanged) + ≥ 10 cameraRig + ≥ 23 engine + ≥ 7 windowManager ≥ **153 total**; report the exact totals.

**E7 — engine-test hand builder note:** `interactionEngine.test.ts` needs a local fist-pose builder for E2(21) (gestures.test.ts is frozen and not importable). Mirror its geometry with a doc comment "local copy of the M5 fist pose (gestures.test.ts is frozen)": wrist `[0.5, 0.8]`, middle MCP `[0.5, 0.6]` (palm center `(0.5, 0.7)` → world `(0, -2, 0)` — create the test window THERE so the GRAB raycast hits), tips: thumb `[0.487, 0.685]`, index `[0.513, 0.685]`, middle `[0.53, 0.67]`, ring `[0.52, 0.73]`, pinky `[0.49, 0.74]`; interpolate the 21 landmarks like `poseHand` does; plus a local `shiftHand(hand, dx, dy)` (0.04 per 100 ms frame = 4 u/s).

## 8. Work item F — Verifier lockstep (SAME change as the title bump; hash discipline)

Grep FIRST (`grep -n "JARVIS ·" docs/scripts/verify_milestone*.py`) and update ONLY what actually pins — expected: only `verify_milestone5.py`. Record `sha256sum` of ALL FIVE verifiers before and after; v1–v4 must be byte-identical.

- `docs/scripts/verify_milestone5.py` — three edits, nothing else: (1) docstring item e) (~line 12): reword to the version-tolerant form ("HUD intact: `JARVIS · Milestone` title (version-tolerant lookup — verifiers assert milestone-owned features, never the mutable HUD title; the title moved to Milestone 6 in M6)…"); (2) runtime-introspection HUD finder (~line 107): `includes('JARVIS · Milestone 5')` → `includes('JARVIS · Milestone')` with the policy comment block copied from v3/v4's wording, updated to name M6; (3) check e (~line 283): `"JARVIS · Milestone 5" in hud` → `"JARVIS · Milestone" in hud`, label updated to `e: HUD intact (version-tolerant title), Camera active, MediaPipe ready, Windows = 2`.
- Re-run ALL FIVE prior verifiers after the bump; each must print `OVERALL: PASS`. Paste all five CHECKS blocks and the sha256 table (v1–v4 identical before/after; v5 before `399bd608…` → after recorded).

## 9. Work item G — CREATE `docs/scripts/verify_milestone6.py` + evidence

Clone the `verify_milestone5.py` pattern exactly (Playwright sync API; headless Chromium with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required --mute-audio`; console/pageerror capture; runtime introspection; summary JSON written even on mid-flight failure via `finally`; PASS/FAIL checks; `sys.exit`). Boot-only (14 s wait; M6 adds no timers or loops). Usage `python docs/scripts/verify_milestone6.py [base_url]`; evidence `m6-scene.png`, `m6-full.png`, `m6-console.txt`, `m6-summary.json` to `docs/screenshots/`. Checks (print and evaluate all; exit non-zero on any FAIL):
- a: zero `[error]` console lines and zero pageerrors.
- b: ≥ 2 floating windows, distinct ids, on screen (non-zero rect).
- c: titles "Test Window" and "Second Window" visible.
- d: gesture-debug panel present, visible, showing "No hands detected".
- e: HUD shows the EXACT title `JARVIS · Milestone 6` (v6 owns the current title — pins it in BOTH the introspection finder and this check), Camera active, MediaPipe ready, Windows = 2.
- f: `[Scene3D] FPS:` max ≥ 30 (boot window; headless steady-state 4–5 is the documented SwiftShader baseline).
- g: detection latency ≥ 2 lines, min avg in 150–260 ms, < 300 ms.
- h: no `[HandTracker] gestures:` lines (no hands on the fake webcam).
- i: cleanup counts balanced: `[CameraCapture] cleanup` == `[HandTracker] cleanup`, each 1–2.
- j: exactly 1 live video track.
- k: ≥ 1 `[Performance]` line and EVERY such line matches the M4 four-key regex `\[Performance\] handDetectionLatency=(\d+)ms renderFPS=(\d+) gestureRecognitionLatency=(\d+(?:\.\d+)?)ms interactionLatency=(\d+(?:\.\d+)?)ms`.
Docstring (honest scope, M5 style): the fake webcam produces no hands, so GRAB drag / SWIPE pan / PINCH_ZOOM zoom / POINT hover are evidenced by the vitest suites (cameraRig, interactionEngine, windowManager); this script proves the app boots clean with the M6 wiring present, the HUD title and GestureDebug render the M6 state, and no M1–M5 assertion regressed. Run it against the dev server; it must end `OVERALL: PASS` and the four `m6-*` files must exist.

## 10. Work item H — README.md (run `docs-guard`)

1. Top status paragraph: Milestone 6 — interaction wiring shipped (GRAB drags windows, SWIPE pans the camera, two-hand PINCH_ZOOM zooms the camera, POINT hovers highlight grabbable windows), on top of the M5 stack; quote the new test total; note M7 (window rotation) untouched.
2. "Build & check" section: update the test total to the real number.
3. Append "Milestone 6 — Interaction wiring: GRAB drag, SWIPE pan, PINCH_ZOOM zoom, hover highlight (Phase 2 part 2)" following the M5 section's structure: **What was built** (CameraRig + constants and the pan/zoom clamps; engine GRAB/release/hover semantics; WindowManager highlight + `resolveHighlightLevel`; App routing table with the exact sign table; test additions per file), **How to run** (npm run test; dev server; `python docs/scripts/verify_milestone6.py`; real-webcam instructions: close a fist over a window and drag, swipe an open hand to pan the camera, pinch with both hands and spread/close to zoom, point to highlight), **Deviations & decisions (D1–D10 digest)** — MUST include: the D7 premise correction with the orbit-vs-translation explanation and the sign table; D4's GRAB-move-only rationale; D3's release-on-NONE+POINT classifyHand-order safety proof; D6's highlight honesty (mesh-emissive only, DOM border deferred to M7; release-recompute restoring hover; the all-hands-vanish residual gap); D2's camera-dolly-over-scene-scale rationale; the verifier-lockstep note with v5 before/after sha256; **Evidence paths** (`m6-*`); **honest acceptance mapping** — automated items checked with evidence, and manual real-webcam items explicitly unchecked (swipe step 0.5 / zoom step 0.4 feel, highlight visibility behind the DOM panel, POINT hover feel).
4. Do not rewrite M1–M5 history sections.

## 11. DO-NOT-TOUCH list (zero changes; the overseer will verify)

- `apps/frontend/src/utils/gestures.ts` (fully frozen — no classification changes), `animation.ts`, `logger.ts`.
- Existing tests other than the ONE E0 amendment: `gestures.test.ts`, `animation.test.ts`, `logger.test.ts`, `windowManager.test.ts` (additive describe block only), and all untouched bodies in `interactionEngine.test.ts`.
- `components/Scene3D.tsx` (D1: zero changes), `HandTracker.tsx`, `GestureDebug.tsx`, `FloatingWindow.tsx`, `CameraCapture.tsx`, `ErrorBanner.tsx`.
- `packages/shared/*`, `apps/backend/*`, `vite.config.ts`, all `tsconfig*.json`, both relevant `package.json` files (no new deps/scripts).
- `docs/scripts/verify_milestone1.py` … `verify_milestone4.py` — byte-identical (sha256 before == after).
- Every existing console format byte-identical; M6 adds NO new console output anywhere.
- No window rotation, no two-hand window resize (PINCH_ZOOM must keep returning `[]` from the engine), no backend work, no new UI panels.

## 12. Implementation order

1. `cameraRig.ts` + `cameraRig.test.ts` (no consumers yet) — build + full tests green.
2. `windowManager.ts` highlight additions + E3 tests — green.
3. `interactionEngine.ts` M6 changes + E0 amendment + E2 additions — green.
4. `App.tsx` wiring (D6/D9, rig ref, docblocks) — build + full suite green.
5. Title bump + v5 lockstep TOGETHER (sections 6.5 + 8) — one change; re-run verifiers 1–5 (`OVERALL: PASS` each), record hashes.
6. `verify_milestone6.py` (section 9) + evidence.
7. README M6 (section 10) + docs-guard.
8. Final verification sweep (section 13) and the evidence report.

## 13. Verification & evidence you MUST paste in your report

1. `npm run test` — tail with file counts and exact totals (113 existing incl. the E0 amendment + N new, 0 failures).
2. `npm run build` — tail (all three workspaces succeed).
3. `npm run lint --workspace @jarvis/frontend` — 0 problems.
4. `python docs/scripts/verify_milestone6.py` — full CHECKS block + `OVERALL: PASS`; confirm the four `m6-*` evidence files exist; quote the summary's `hud_text` (title proof).
5. `python docs/scripts/verify_milestone1.py` … `...5.py` — each `OVERALL: PASS`, plus the sha256 table: v1–v4 before == after (`450c8386…`, `2f9bc072…`, `f186172c…`, `d9d50566…`); v5 `399bd608…` → after.
6. `grep -c` from `m6-console.txt` for `\[Scene3D\] FPS:`, `detection latency`, `\[Performance\]` and one sample of each — proof the old formats are byte-identical and no new console lines appeared.
7. A list of every file created/modified (must match sections 3–10 exactly) and the E0 amendment rationale.
8. test-guard / clean-code-guard / docs-guard evidence lines.

## 14. Overseer review checklist (1:1 with the M6 acceptance criteria)

Each item names the evidence the Coder must have pasted; the overseer spot-checks the code against it.

1. **GRAB grab/drag/release unit-verified (release on OPEN, NONE, and POINT per D3)** — E2 GRAB lifecycle + cross-type suites green (GRAB over window grabs; continuation moves off-window; intensity drift never resizes; OPEN release-all; NONE and POINT per-hand releases; weak OPEN does not release; closed-window drop; PINCH↔GRAB continuation and shared handedness key). Spot-check: `processGesture` routes GRAB and PINCH to one grab path; resize gated to PINCH frames; `releaseHand` per-handedness; the classifyHand-order safety proof in the docblock.
2. **SWIPE pans with clamping + documented convention (unit + routing)** — cameraRig suite green (sign table, clamps ±4, lookAt maintained, observable NDC pin); App routes SWIPE → `swipeToPan` → `rig.pan` with the defensive `swipeDirection` guard; the orbit-vs-translation premise correction documented in cameraRig.ts and README.
3. **PINCH_ZOOM zooms with clamping, intensity-scaled (unit)** — cameraRig zoom tests (z clamps [2,12], 'in' decreases z, intensity scaling) + `zoomToStep` tests; App routes PINCH_ZOOM → `rig.zoom`; E0 pins engine passthrough `[]` (never touches grabs — no two-hand window resize).
4. **POINT hovers highlight grabbable windows; grabbed stay highlighted; release restores (unit + browser where possible)** — E2 hover suite (emit-on-new-hit, no re-emit, null-on-stop, throttle, per-hand, read-only, during-other-hand's-grab, eviction) + E3 highlight suite (emissive math 0.1 + level·0.4, clamps, lockstep, idempotence, `resolveHighlightLevel` grabbed-wins) + cameraRig E1.8 culling propagation. Spot-check: App `applyHighlight` recompute on release (restores 0.5 when still hovered); `hoveredByHandRef`/`grabbedIdsRef` reset per scene; honesty notes present (no DOM border change, all-hands-vanish residual). Browser: boot-only (no hands on fake webcam) — v6 checks a–e prove the wiring shipped clean.
5. **Momentum still fires on GRAB releases (unit)** — E2(22) pins the exact consumed fields (move.newPosition + gesture.timestamp, release.targetId); App's momentum branches unchanged; animation.test.ts M4 integration still green untouched.
6. **All suites + build + verify 1–6 pass with title pins updated in lockstep** — evidence items 1–5; v6 checks a–k all PASS; v1–v4 hashes identical; v5 lockstep hash recorded in README M6; HUD comment references verify_milestone6.py.
7. **Dev server zero console errors** — v6 check a (zero `[error]` console lines, zero pageerrors); no new console output (evidence item 6).
8. **Scope discipline + user review gate** — gestures.ts/animation.ts/logger.ts/Scene3D/HandTracker/GestureDebug/FloatingWindow/shared/backend byte-identical; only the ONE E0 existing-test amendment; verifiers 1–4 byte-identical. After the overseer pass, present the result (tests, verifier outputs, README, evidence paths, the sign-table correction, the manual real-webcam tuning list) to the user before the milestone is called done; fold feedback into a follow-up Coder round if needed.

## 15. Pitfalls (each has bitten someone before)

- `enum` keyword → build fails (`erasableSyntaxOnly`). Missing `import type` for `SwipeDirection`/`ZoomDirection`/`Handedness` → build fails (`verbatimModuleSyntax`). Unused import/param → build fails (tests compile too).
- **Sign-table second-guessing:** do NOT "fix" the D7 table to match the pure-translation intuition (camera +x → content left). The rig keeps `lookAt(origin)` (orbit): content moves WITH the camera pan. Test E1.8 pins the observable NDC behavior — the table and the test must agree with THIS brief, not with intuition.
- Stale camera matrices: raycasts/projections read `camera.matrixWorld`/`matrixWorldInverse`. The rig self-updates (`camera.updateMatrixWorld()` — THREE.Camera's override refreshes the inverse too), so rig ops are same-tick safe; if a test moves the camera by hand, it must call `camera.updateMatrixWorld(true)` (the scene-wide `scene.updateMatrixWorld(true)` after placing meshes stays).
- Amending more than the ONE sanctioned E0 test — the overseer diffs test bodies; anything beyond E0 + additive describes is a rejection.
- Hover-event handedness: App MUST key `hoveredByHandRef` on `event.gesture.handedness`, and must read NOTHING else from hover-event gestures (eviction events reuse the hand's stored last POINT gesture — the contract is documented in the engine docblock).
- Mixing timebases: hover throttle/eviction use ONLY the injected `nowMs` (performance.now base); `gesture.timestamp` stays Date.now-based (momentum tracker input) — never compare them.
- Forgetting the `swipeDirection`/`zoomDirection` optional-field guards in App (`noUnusedLocals`-safe `if (dir)` pattern) or asserting they're always present.
- `setWindowHighlight` churn: without the idempotent no-notify branch, App's release-recompute would bump `wm.version` and re-sync React state on every release — keep it.
- StrictMode: every new ref (`cameraRigRef`, `hoveredByHandRef`, `grabbedIdsRef`) is replaced wholesale in `handleSceneReady`; nothing scene-scoped may live in module scope.
- Editing an asserted console line or adding console output — verifier regression. App diffs must be surgical.
- Bumping the HUD title WITHOUT the v5 lockstep edits in the same change — v5 pins the old string in THREE spots (docstring e, introspection finder, check e). Record hashes before you start; v1–v4 must come out byte-identical.
- Non-deterministic tests: inject every `nowMs` for hover/throttle/eviction timing; the only clock-free call allowed is the E2(23) default-clock no-throw check.
- The M4 perf smoke (200 iterations < 5 ms) now runs with the M6 engine: hover adds one raycast only on eligible POINT frames — if it regresses, you added something heavy (you shouldn't have).
