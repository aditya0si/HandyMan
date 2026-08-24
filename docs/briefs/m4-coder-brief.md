# JARVIS Milestone 4 — Coder Brief (Week 4: Polish & Prepare for Apps; closes Phase 1)

You are the Coder for JARVIS Milestone 4 in `C:\Users\oliad\Desktop\visionpro` (Windows / Git Bash; npm workspaces root; NOT a git repo). This brief is complete and self-contained. Implement EXACTLY this scope — Week 4 only: animation + smoothing, performance metrics, polish, tests, verifier, docs. When something is unspecified, follow the existing M1–M3 code conventions (they are deliberate) and document any deviation the way M2/M3 did (docblock "DEVIATION" notes).

## 0. Guardrails (read first)

- Run everything from the repo ROOT: `npm run test`, `npm run build`, `npm run dev:frontend`, `npm run lint --workspace @jarvis/frontend`. Python verifiers run as `python docs/scripts/verify_milestoneN.py [base_url]` against the dev server on http://localhost:5173 (start it in the background).
- TS constraints (tsconfig.app.json): `erasableSyntaxOnly` (NO `enum` — use the const-object + union pattern like `GestureType` in utils/gestures.ts), `verbatimModuleSyntax` (type-only imports MUST use `import type`), `noUnusedLocals` + `noUnusedParameters` (they compile tests too), `noFallthroughCasesInSwitch`.
- New unit tests run in vitest's default node environment (no DOM — see section 8 style notes). No new npm dependencies. Vanilla Three.js math only (THREE.Vector3 is pure and node-safe).
- Quality skills are mandatory on this task: run `test-guard` on the new test files, `clean-code-guard` on all new/changed production code, `docs-guard` on the README changes. Your report must include the evidence lines those checks produced.
- Milestone 3 semantics are FROZEN: grab-by-handedness, intensity-delta resize (|Δ|>0.05, else-if vs move), OPEN>0.8 release-all, event sequences asserted by interactionEngine.test.ts. Polish goes ON TOP, never through the engine.
- All 48 existing tests must stay green with ZERO edits to existing test files.

## 1. Codebase facts you will rely on

- `apps/frontend/src/App.tsx` — owns everything via refs: `windowManagerRef`, `interactionEngineRef`, `cameraRef`. `handleSceneReady` creates a FRESH WindowManager + InteractionEngine + 2 test windows on EVERY call (StrictMode-safe). `handleGesturesDetected` currently loops `engine.processGesture(gesture)` for non-NONE gestures and DISCARDS the returned `InteractionEvent[]`. `getWindowProjection(windowId)` is a stable callback the FloatingWindow rAF loop calls at ~30 Hz; it reads the live mesh and writes nothing. HUD title string is `"JARVIS · Milestone 3"`. React state syncs are throttled ~10 Hz (`syncWindowsThrottled`).
- `apps/frontend/src/utils/interactionEngine.ts` — `processGesture(gesture): InteractionEvent[]` returns events `{type: 'grab'|'release'|'move'|'resize', targetId, gesture, newPosition?, scaleChange?}`. A `move` event carries `newPosition` (gesture.position − grabOffset) and the engine has ALREADY applied it via `windowManager.moveWindow`. A `release` event carries only ids (positions already final). CHANGE NOTHING in this file.
- `apps/frontend/src/utils/windowManager.ts` — every mutation updates state AND mesh in lockstep and fires `onChange` (+version counter); `moveWindow` no-ops silently for unknown ids. `App` throttles onChange→setWindows, so per-tick onChange from animation is fine. CHANGE NOTHING in this file.
- `apps/frontend/src/components/FloatingWindow.tsx` — own ~30 Hz rAF loop calling `getProjection(window.id)` and writing styles through refs. DO NOT MODIFY.
- `apps/frontend/src/components/Scene3D.tsx` — owns the render rAF loop; logs `[Scene3D] FPS: N` ~1/s via `onFpsUpdate`; callbacks stored in refs so the effect never restarts.
- `apps/frontend/src/components/HandTracker.tsx` — inside `onResults`: `const now = performance.now(); const latencyMs = now - frameStart; recordLatency(latencyMs, now)` (logs `[HandTracker] detection latency: avg Xms over N frame(s)` ~1/s + `onLatencyUpdate(avg)`), then `const gestures = gestureRecognizer.recognizeGestures(detectedHands)` — THIS is the gesture-recognition cost to measure. Cleanup logs `[HandTracker] cleanup: camera stopped, hands solution closed`.
- `gesture.timestamp` is `Date.now()`-based (gestures.ts `buildGesture`); rAF timestamps and `performance.now()` are a DIFFERENT timebase (ms since navigation). Never mix them (see VelocityTracker design).
- Baseline (fake-webcam headless, do NOT treat as regression): FPS 45–61 during boot then 4–5 once WASM inference saturates SwiftShader; detection latency min-avg ~204–216 ms; cleanup counts 1/1; zero console/page errors.
- Verifiers 1–3 assert (grep-level) EXACT formats and MUST keep passing UNCHANGED: `[Scene3D] FPS: (\d+)`, `detection latency` lines `avg (\d+)ms`, `[CameraCapture] cleanup`, `[HandTracker] cleanup` (counts!), `[HandTracker] gestures` (must stay ABSENT on fake webcam), and — critically — verify_milestone3.py check f requires the HUD string `JARVIS · Milestone 3` to be present. THEREFORE the HUD title string STAYS `"JARVIS · Milestone 3"` in M4 (add a code comment explaining exactly this). New console output in M4 is limited to the single `[Performance] ...` summary line every ~5 s (section 4) — it contains none of the asserted substrings and is `[log]` type, so verifiers 1–3 are unaffected.

## 2. Design decisions (decided by the Orchestrator — implement as specified, document in code)

**D1 — Smoothing strategy: BOTH options, in two deliberately different layers.**

- **Layer 1 (option b, primary): release momentum via AnimationController writing THROUGH `WindowManager.moveWindow`.** On `release` events the window glides in the hand's direction for 0.5 s with an ease-out curve (TECHNICAL_SPEC §2.2 "Momentum: when releasing, object continues in hand's direction for 0.5s"). Lockstep is preserved BY CONSTRUCTION: the only writer is `moveWindow`, which updates state+mesh+onChange atomically. It cannot fight the engine: it runs only when no grab is active, and any new `grab` cancels it.
- **Layer 2 (option a, secondary): presentation-only smooth-follow in the projection path.** `getWindowProjection` lerps a per-window presentation vector toward the live mesh position each ~30 Hz tick (factor 0.3). It is read-side only: it writes nothing to the manager/mesh, so it can never desync state from mesh or fight the engine's direct `moveWindow` writes; it denoises landmark jitter and eases the 30 Hz snap. The user-sanctioned factor band is 0.15–0.3; 0.3 (least lag) is the default, exported as a named constant — the single tuning knob if manual testing finds drag lag excessive.

Why not smooth the mesh itself while grabbed: the 16 interactionEngine tests assert `wm.getWindow(id).position === newPosition` immediately after `processGesture`, so the engine's snap-to-target postcondition is frozen; any mesh-level easing while grabbed would either break those tests or fight the engine (snap-then-pull-back). Presentation-layer smoothing delivers the perceived easing without touching that contract.

**D2 — AnimationController is DOM-free, THREE-agnostic-but-THREE-typed, clock-injectable.** It animates `THREE.Vector3` positions and applies them through a caller-supplied `apply(position)` callback (App wires `apply = pos => wm.moveWindow(id, pos)`). Guide 4.1's `object: THREE.Object3D` field is replaced by `apply` — DEVIATION to document: writing `mesh.position` directly would break WindowManager state/mesh lockstep; the callback routes writes through the manager instead. Clock: every time-taking method accepts an optional `nowMs` defaulting to `performance.now()` (DEVIATION from guide's `Date.now()`: monotonic, and injectable for deterministic tests).

**D3 — PerformanceLogger is an aggregator, never a replacement.** Existing per-second logs stay byte-identical; the logger consumes the SAME measurements one level up: `renderFPS` from Scene3D's existing 1/s value (App's `onFpsUpdate` handler), `handDetectionLatency` from HandTracker's existing 1/s average (App's `onLatencyUpdate` handler) — both via `logMetric` (plain setter, guide 4.2 semantics). Raw per-frame costs (`gestureRecognitionLatency` from a `performance.now()` pair around `recognizeGestures` inside HandTracker, reported through a NEW optional callback with NO console output; `interactionLatency` from timing the `processGesture` loop in App) feed `recordSample`, a NEW rolling-mean input (window = last 30 samples). DEVIATIONS to document: initial `renderFPS` is 0 (guide seeded 60 — dishonest before measurement); `logToConsole` prints ONE `console.log` line instead of `console.table` (console.table renders inconsistently in captured console streams; the strict single-line format is what the verifier asserts); `updateFPS` exists per the guide (self-contained frame windowing, injectable clock, unit-tested) but the app wires FPS via `logMetric` so there is exactly one frame counter in the render loop — document why.

**D4 — ~5 s summary cadence rides the render loop, no timers.** App's `handleFrame(now)` (called from Scene3D's rAF via the new `onFrame` prop) gates `logger.logToConsole()` on `now - last >= SUMMARY_INTERVAL_MS && logger.hasData()`. No `setInterval` exists to leak or fire after unmount (rAF is cancelled on unmount); `hasData()` guarantees it never fires before any metric exists.

**D5 — interactionLatency** = wall-clock cost of the per-frame `processGesture` loop in App, recorded only on frames that processed at least one gesture (empty frames would dilute the metric; document this). Expected single-digit ms — evidenced by (i) a vitest perf smoke (section 8) and (ii) real-webcam manual runs. The <100 ms spec target covers engine+render overhead, not the ~200 ms MediaPipe inference — state this in the README, do not conflate them.

**D6 — Momentum safety:** velocity z-component is ZEROED (`gesture.position.z` is wrist-relative and noisy — M3 fact); the animated end position is clamped to the interaction volume (|x| ≤ 5, |y| ≤ 5, −4 ≤ z ≤ 1); releases slower than `MOMENTUM_MIN_SPEED` (0.3 u/s) start no animation (a still release must not drift — this also keeps the headless no-hands soak perfectly still).

## 3. Work item A — CREATE `apps/frontend/src/utils/animation.ts`

Module docblock: "Animation & smoothing (guide step 4.1) with documented deviations: injectable clock, apply-callback instead of Object3D, plus momentum/velocity/smoothing helpers required by the M4 integration design (see docs/briefs/m4-coder-brief.md)."

Exact public API (signatures are contractual):

```ts
import * as THREE from 'three';

/** Guide 4.1 easing: 1 - (1 - t)^3. Exported for tests and tuning. */
export function easeOutCubic(t: number): number;

/** Smooth-follow lerp factor for the projection path (sanctioned band 0.15-0.3). */
export const SMOOTH_FOLLOW_FACTOR = 0.3;
/** Spec §2.2: momentum carries for 0.5 s after release. */
export const MOMENTUM_DURATION = 0.5;
/** Releases slower than this (world units / s) start no momentum animation. */
export const MOMENTUM_MIN_SPEED = 0.3;
/** Momentum end clamp: the interaction volume landmarks can reach. */
export const WORKSPACE_XY_LIMIT = 5;
export const WORKSPACE_Z_MIN = -4;
export const WORKSPACE_Z_MAX = 1;

export interface AnimationSpec {
  /** Start position (copied on add). */
  from: THREE.Vector3;
  /** End position (copied on add — callers may reuse their vectors). */
  to: THREE.Vector3;
  /** Seconds; default 0.3 (guide default). duration <= 0 completes on first update. */
  duration?: number;
  /**
   * Writes the eased position each tick. App wires this to
   * WindowManager.moveWindow so state and mesh move in lockstep. The vector is
   * a reused scratch buffer — consume or copy it synchronously (moveWindow copies).
   */
  apply: (position: THREE.Vector3) => void;
  /** Fires exactly once, after the final exact-`to` write. */
  onComplete?: () => void;
}

export class AnimationController {
  /** Adds or REPLACES the animation for `id` (guide Map.set semantics: the
   *  replaced animation's onComplete never fires). */
  addAnimation(id: string, spec: AnimationSpec, nowMs?: number): void;
  /** Advances all animations to nowMs (default performance.now()): writes
   *  eased positions via apply; completes/removes finished ones. */
  update(nowMs?: number): void;
  /** Removes the animation for `id` immediately: no onComplete, no final write. */
  cancelAnimation(id: string): void;
  hasAnimation(id: string): boolean;
  get activeAnimationCount(): number;
}

export class VelocityTracker {
  /** maxSamples: rolling window length; maxAgeMs: samples older than the
   *  NEWEST sample by more than this are ignored (no external clock — avoids
   *  mixing Date.now() gesture timestamps with performance.now()). */
  constructor(maxSamples?: number, maxAgeMs?: number); // defaults 5 and 250
  /** Records a position sample (copied) at timestampMs (caller's base). */
  push(position: THREE.Vector3, timestampMs: number): void;
  /** Mean velocity over the valid window (world units / s); zero vector when
   *  fewer than 2 valid samples. */
  getVelocity(): THREE.Vector3;
  clear(): void;
}

export class PositionSmoother {
  constructor(followFactor?: number); // default SMOOTH_FOLLOW_FACTOR
  /** First sample for an id SEEDS with target (returned exactly — no fly-in);
   *  afterwards the stored vector lerps toward target by followFactor and a
   *  clone is returned. */
  sample(id: string, target: THREE.Vector3): THREE.Vector3;
  /** Drops state for an id (window closed). */
  forget(id: string): void;
  clear(): void;
}

/** Momentum end-position math: end = clamp(from + velocity * MOMENTUM_DURATION)
 *  with the z-velocity zeroed. Returns null when |velocity| < MOMENTUM_MIN_SPEED. */
export function buildMomentumSpec(
  from: THREE.Vector3,
  velocity: THREE.Vector3,
): { to: THREE.Vector3; duration: number } | null;
```

Semantics to honor precisely (tested in section 8):
- `update` per animation: `elapsed = (now - startTime) / 1000`; `progress = min(elapsed / duration, 1)`; `eased = easeOutCubic(progress)`; write `from`→`to` lerped by `eased`; at `progress >= 1` write `to` EXACTLY (no float residue), fire `onComplete` once, delete. Iteration may delete the current entry (Map forEach semantics) — safe.
- `addAnimation` copies `from`/`to` (callers may mutate their vectors afterwards).
- No work happens at construction; the controller holds no THREE scene/object references.

## 4. Work item B — CREATE `apps/frontend/src/utils/logger.ts`

Module docblock explaining D3 (aggregator, deviations from guide 4.2: initial zeros, single-line output, injectable clock, recordSample addition).

```ts
export interface PerformanceMetrics {
  handDetectionLatency: number;      // ms — 1/s averages pushed by App (from HandTracker)
  renderFPS: number;                 // 1/s value pushed by App (from Scene3D)
  gestureRecognitionLatency: number; // ms — rolling mean of per-frame samples
  interactionLatency: number;        // ms — rolling mean of per-frame samples
}

/** Keys that accept raw per-frame samples (rolling-mean inputs). */
export type SampleMetricKey = 'gestureRecognitionLatency' | 'interactionLatency';

/** Rolling sample window for recordSample (~1 s at 30 Hz). */
export const METRIC_SAMPLE_WINDOW = 30;
/** Console summary cadence used by App's frame gate. */
export const SUMMARY_INTERVAL_MS = 5000;

export class PerformanceLogger {
  /** Sets the latest value for a metric (guide 4.2 semantics). */
  logMetric(key: keyof PerformanceMetrics, value: number): void;
  /** Records a raw sample; getMetrics() reports the mean of the last
   *  METRIC_SAMPLE_WINDOW samples for sample keys. */
  recordSample(key: SampleMetricKey, value: number): void;
  /** Defensive copy of the current metrics. */
  getMetrics(): PerformanceMetrics;
  /** Guide 4.2 updateFPS: self-contained 1 s frame window (injectable clock).
   *  Unit-tested; the app instead feeds Scene3D's existing FPS measurement via
   *  logMetric so the render loop keeps exactly one frame counter. */
  updateFPS(nowMs?: number): void;
  /** ONE console.log line with all four metrics (exact format below). */
  logToConsole(): void;
  /** True once any metric has been set or sampled. */
  hasData(): boolean;
}
```

`logToConsole` EXACT format (the verifier regexes this):

```
[Performance] handDetectionLatency=212ms renderFPS=4 gestureRecognitionLatency=0.3ms interactionLatency=0.0ms
```

- `handDetectionLatency` and `renderFPS`: integers. The two sample metrics: `toFixed(1)`. Unmeasured values print as `0`/`0.0`.
- `updateFPS` follows guide 4.2 exactly (frameCount++; when `now - lastFrameTime >= 1000` set `renderFPS = frameCount`, reset) with `nowMs` injectable.

## 5. Work item C — MODIFY `apps/frontend/src/components/Scene3D.tsx` (minimal delta)

1. Add optional prop: `/** Called every render frame with the rAF timestamp (animation + metrics ticks). */ onFrame?: (nowMs: number) => void;` — stored via the existing callback-in-ref pattern (`onFrameRef`), never an effect dependency.
2. `animate` becomes `(now: number) => { rafId = requestAnimationFrame(animate); onFrameRef.current?.(now); renderer.render(scene, camera); ... }` — `onFrame` fires BEFORE render so animation writes are drawn the same frame. The FPS accounting block (including the byte-identical `[Scene3D] FPS: ${fps}` log) is untouched.

Nothing else in the file changes.

## 6. Work item D — MODIFY `apps/frontend/src/components/HandTracker.tsx` (minimal, format-preserving delta)

1. Add optional prop: `/** Per-frame cost of recognizeGestures in ms (no console output). */ onGestureLatencyUpdate?: (latencyMs: number) => void;` — add it to `callbacksRef`.
2. In `onResults`, around the existing call: `const gestureStart = now; const gestures = gestureRecognizer.recognizeGestures(detectedHands); callbacksRef.current.onGestureLatencyUpdate?.(performance.now() - gestureStart);`
3. EVERY existing console line stays byte-identical. No other change.

## 7. Work item E — MODIFY `apps/frontend/src/App.tsx` (the wiring)

Keep every existing convention: callbacks stable via `useCallback` + refs, no effect deps on managers, throttled React syncs. Update the component docblock (M4 wiring summary). Specifics:

1. **Refs:** `loggerRef` (lazy-init once per component instance: `if (!loggerRef.current) loggerRef.current = new PerformanceLogger();` — pure data, StrictMode-safe), `animationControllerRef`, `smootherRef`, `velocityTrackersRef` (`Map<string, VelocityTracker>`), `lastPerfSummaryRef` (0).
2. **`handleSceneReady`:** after creating the fresh `WindowManager`/`InteractionEngine`, also create a fresh `AnimationController` and `PositionSmoother` and clear the tracker map (all scene-scoped, replaced wholesale per scene — the dead controller's closures die with the old manager and nothing ticks them: the old Scene3D rAF is cancelled).
3. **`handleFrame = useCallback((now: number) => ...)`:** `animationControllerRef.current?.update(now);` then the D4 summary gate (`now - lastPerfSummaryRef.current >= SUMMARY_INTERVAL_MS && loggerRef.current.hasData()` → set the ref, `logToConsole()`). Pass as `onFrame` to `<Scene3D>`.
4. **Metrics handlers:** `onFpsUpdate={(fps) => { setFps(fps); loggerRef.current.logMetric('renderFPS', fps); }}`, `onLatencyUpdate={(ms) => { setLatencyMs(ms); loggerRef.current.logMetric('handDetectionLatency', ms); }}`, new `onGestureLatencyUpdate={(ms) => loggerRef.current.recordSample('gestureRecognitionLatency', ms)}` prop on `<HandTracker>`.
5. **`handleGesturesDetected` rewrite (the core):**
```ts
const engine = interactionEngineRef.current;
let processedAny = false;
const t0 = performance.now();
for (const gesture of detected) {
  if (gesture.type === GestureType.NONE) continue;
  processedAny = true;
  for (const event of engine.processGesture(gesture)) handleInteractionEvent(event);
}
if (processedAny) loggerRef.current.recordSample('interactionLatency', performance.now() - t0);
// existing ~10 Hz gestures HUD throttle + syncWindowsThrottled() stay as-is
```
`handleInteractionEvent(event)`:
- `grab` → `controller.cancelAnimation(event.targetId)` (a new grab kills in-flight momentum); reset the tracker (`velocityTrackers.set(id, new VelocityTracker())`).
- `move` → get-or-create the tracker for `event.targetId`, `tracker.push(event.newPosition, event.gesture.timestamp)`.
- `release` → momentum per D6: read current position from the manager, `velocity = tracker?.getVelocity()` (delete the tracker entry), `const spec = buildMomentumSpec(win.position, velocity)`; if non-null, `controller.addAnimation(event.targetId, { from: win.position, to: spec.to, duration: spec.duration, apply: (p) => wm.moveWindow(event.targetId, p) })` (closure captures the CURRENT scene's manager).
- `resize` → nothing.
6. **`getWindowProjection`:** keep all existing checks (`!win || !mesh || !mesh.visible` → null; when `win`/`mesh` are gone entirely also `smootherRef.current.forget(windowId)` for state hygiene). Then `const presented = smootherRef.current.sample(windowId, mesh.position);` and use `presented` (not `mesh.position`) for `depth` and `ndc`. Size still derives from `mesh.scale`/`win.aspect` (scale is not smoothed). Off-screen NDC check unchanged, applied to `presented`.
7. **Window controls:** `handleCloseWindow` also cancels the animation + forgets the smoother entry + deletes the tracker for that id; `handleMinimizeWindow` cancels the animation + deletes the tracker.
8. **HUD:** the title string REMAINS `"JARVIS · Milestone 3"` with a comment: "Kept intentionally: docs/scripts/verify_milestone3.py check f asserts this exact string and must keep passing unchanged." No other HUD changes.

## 8. Work item F — tests (CREATE `animation.test.ts` and `logger.test.ts`)

Style: follow `utils/windowManager.test.ts` — vitest node env, real THREE objects, docblock per suite, constants imported (never hardcoded), `toBeCloseTo` for floats. All clocks injected; zero real timing dependencies except one no-throw smoke. Run `test-guard` on both files.

`apps/frontend/src/utils/animation.test.ts` — required cases (merge freely, do not drop coverage):
- easeOutCubic: endpoints (0→0, 1→1); monotonic non-decreasing over a [0,1] grid; ease-out property (segment deltas shrink: f(.25)−f(0) > f(.5)−f(.25) > f(.75)−f(.5) > 1−f(.75); f(0.5) = 0.875).
- AnimationController: (1) eased midpoint — from (0,0,0) to (10,0,0), 1 s, `update(t0)`, `update(t0+500)` → last applied x ≈ 8.75; (2) completion exactness — `update(t0+1000)` → last apply x exactly 10, animation removed; (3) clamping — further over-deadline updates apply nothing more; (4) onComplete fires exactly once across multiple over-deadline updates; (5) cancel mid-flight → no further applies, onComplete never fires, `hasAnimation` false; (6) re-adding an id replaces (first onComplete never fires, new target wins); (7) `from`/`to` copied (mutate caller vectors after add — animation unaffected); (8) two concurrent ids animate independently; (9) duration ≤ 0 completes on first update with exact `to`; (10) default-duration is 0.3 s (progress math at t+300ms); (11) `update()` with the default clock does not throw; (12) first `update` at `startTime` applies exactly `from`.
- VelocityTracker: constant velocity (5 samples 100 ms apart, +1 x each → 10 u/s on x); <2 samples → zero; stale samples dropped relative to the NEWEST sample (age > 250 ms → zero); `clear()` resets; y-axis velocity correct with x untouched.
- PositionSmoother: first sample returns target exactly (seeding); successive samples approach the target monotonically (distances strictly decreasing at factor 0.3); converges (after ~15 samples distance < 1% of the initial gap); `forget()` re-seeds at the next target.
- buildMomentumSpec: straight-line math (from (0,1,−2), v (2,0,0) → to (1,1,−2), duration 0.5); z-velocity zeroed; clamps hit (|x|,|y| ≤ 5, z ∈ [−4,1]); below MOMENTUM_MIN_SPEED → null.
- Integration with REAL WindowManager + InteractionEngine (the App wiring, replicated with the same helpers): (1) an animation applied through `moveWindow` keeps state == mesh == applied value after EVERY tick; (2) the momentum pipeline — grab → two moves (tracker pushes) → open-hand release returns release events → momentum animation drives the window monotonically toward the clamped end, completion leaves state == mesh == `to`, and a subsequent grab cancels (position frozen mid-flight); (3) perf smoke — ~200 iterations of `processGesture` + momentum bookkeeping on a real engine/manager average < 5 ms per frame (the automated single-digit-ms interactionLatency evidence; assert a generous bound, log the measured average via `console.info` so the report can quote it).
- Total new tests in this file: at least 20.

`apps/frontend/src/utils/logger.test.ts` — required cases:
- Initial metrics are all 0; `getMetrics()` returns a copy (mutating it does not affect the logger).
- `logMetric` sets each of the four keys (loop all four).
- `recordSample` rolling mean: 30 samples of 10 → 10.0; then 5 samples of 20 → (25·10+5·20)/30; window is exactly the last METRIC_SAMPLE_WINDOW samples (push 40, verify mean over the last 30); sample keys do not affect setter keys and vice versa.
- `updateFPS(nowMs)` windowing: frames counted at t=0…999 do not publish; the first call with now ≥ 1000 publishes the integer count and resets; the next second re-accumulates independently.
- `logToConsole()`: `vi.spyOn(console, 'log').mockImplementation(() => {})` — exactly ONE call; message matches `^\[Performance\] handDetectionLatency=\d+ms renderFPS=\d+ gestureRecognitionLatency=\d+(\.\d+)?ms interactionLatency=\d+(\.\d+)?ms$` and reflects current values.
- `hasData()`: false initially, true after `logMetric`, true after `recordSample`.
- Total new tests in this file: at least 9.

Do NOT edit any existing test file. After implementation, `npm run test` must report 48 old + new tests, all green (report the exact totals).

## 9. Work item G — CREATE `docs/scripts/verify_milestone4.py` + evidence

Follow the `verify_milestone3.py` pattern exactly (Playwright sync API, headless Chromium with the same four fake-webcam args, console/pageerror capture, runtime introspection, summary JSON, PASS/FAIL checks, `sys.exit`). Same usage: `python docs/scripts/verify_milestone4.py [base_url]`, evidence to `docs/screenshots/`: `m4-scene.png`, `m4-full.png`, `m4-console.txt`, `m4-summary.json`.

Additions over M3:

1. **Init-script instrumentation (BEFORE app load, via `page.add_init_script`):** wrap `window.requestAnimationFrame`/`cancelAnimationFrame` to count grants/revocations (`window.__rafStats = {granted, revoked}`), and `EventTarget.prototype.addEventListener`/`removeEventListener` to count adds/removes (`window.__listenerStats`) — wrappers must call through unchanged (preserve `this`, args, return value). Do NOT patch console.log.
2. **Phases:** boot wait 14 s (parity with M3) → screenshots + runtime introspection → **soak**: ~10 samples 15 s apart (~150 s), each sample running `page.evaluate` that returns the rAF/listener stats, `performance.memory` (`usedJSHeapSize`, `totalJSHeapSize` — Chromium-only, assert present), and both floating-window DOM rects → **reload** → wait ~8 s → final introspection. Total runtime ≈ 3–4 minutes. Keep the M3-style `finally` block that persists console evidence on mid-flight failure.
3. **Runtime introspection additions:** heap series, rAF/listener net counters over time, per-sample window rects. Everything M3 captured stays (windows, HUD text, gesture panel, video meta).
4. **Checks (print and evaluate all; exit non-zero on any FAIL):**
   - a: zero `[error]` console lines and zero pageerrors across the WHOLE session (boot + soak + reload), and no console spam: average ≤ 5 console lines/s over the soak.
   - b: ≥ 2 floating windows, distinct ids, on screen (non-zero rect) after boot.
   - c: titles "Test Window" and "Second Window" visible.
   - d: gesture-debug panel shows "No hands detected".
   - e: HUD intact AND title string `JARVIS · Milestone 3` present (kept deliberately — M3 verifier contract), Camera active, MediaPipe ready, Windows 2.
   - f: `[Scene3D] FPS:` max ≥ 30 (boot window; headless steady-state 4–5 is the known SwiftShader baseline, not a regression).
   - g: detection latency ≥ 2 lines, min avg within 150–260 ms, < 300 ms.
   - h: **metric summary** — ≥ 3 `[Performance]` lines; EVERY line matches the full four-key regex `\[Performance\] handDetectionLatency=(\d+)ms renderFPS=(\d+) gestureRecognitionLatency=(\d+(?:\.\d+)?)ms interactionLatency=(\d+(?:\.\d+)?)ms`; ≥ 1 summary with renderFPS ≥ 1; cadence sane (median gap between consecutive summaries in [4, 15] s).
   - i: **no-drift soak** — both window rects move < 1.5 px between the first and last soak sample (animations must be inert with no hands; guards against spontaneous momentum).
   - j: no `[HandTracker] gestures:` lines (no hands on the fake webcam).
   - k: pre-reload cleanup counts balanced: `[CameraCapture] cleanup` == `[HandTracker] cleanup`, each 1–2.
   - l: post-reload: cleanup DELTA == 1 for each (balanced), exactly 1 live video track again, ≥ 2 floating windows on screen again (remount healthy).
   - m: **rAF leak check** — net granted−revoked stable across the soak: |net_last − net_first| ≤ 2.
   - n: **listener leak check** — net added−removed stable across the soak: |net_last − net_first| ≤ 2.
   - o: **heap check** — `performance.memory` defined; median of the last 3 samples − median of the first 3 ≤ 30 MB growth; no sample exceeds first + 60 MB. (Honest-heuristic framing in the docstring: counter stability (m/n) is the deterministic detector; the heap bound is a coarse backstop.)
5. **Docstring (honest scope, like M3):** the fake webcam produces no hands, so grab/momentum paths are exercised by the unit tests; `interactionLatency` will read 0.0 ms headless (no gestures processed) — its single-digit-ms evidence is the vitest perf smoke + manual real-webcam runs; the soak proves inertness and leak-freedom, not interaction.

Run the verifier against the dev server; it must end `OVERALL: PASS`. The four `m4-*` evidence files must exist afterwards.

## 10. Work item H — README.md (run `docs-guard`)

1. Update the top status paragraph: Phase 1 is COMPLETE (Milestones 1–4) — mention motion smoothing + release momentum + performance metrics on top of the M1–M3 stack; keep GRAB/SWIPE classification and two-hand pinch-zoom flagged as Phase 2, and DROP "animations" from the "comes in later milestones" list (it has now shipped).
2. Update the "Build & check" section's test description (all suites, new totals — quote the real number).
3. Append an "Milestone 4 — Polish: animation & performance metrics (Week 4)" section following the M3 section's structure: What was built (animation.ts exports with semantics, logger.ts, the three wiring points, the verifier), How to run (npm run test; dev server; `python docs/scripts/verify_milestone4.py`), documented deviations from guide 4.1/4.2 (D1–D6 list), evidence paths, and the guide 4.3 checklist mapped honestly: `60fps with multiple windows` → checked for real GPUs / boot window; headless SwiftShader steady-state 4–5 fps is the documented baseline; `<100ms interaction latency` → interactionLatency measured (engine+render overhead; MediaPipe's ~200 ms inference is separate and unchanged); `no memory leaks` → 3-min automated soak + suggested 10-min manual session; `lighting conditions` / `>90% accuracy` → unchecked manual items; `organized and documented` → done. End with a one-line "Phase 1 complete — Phase 2 (advanced gestures) is next" pointer.
4. Do not rewrite M1–M3 history sections.

## 11. DO-NOT-TOUCH list (zero changes; the overseer will verify)

- `apps/frontend/src/utils/interactionEngine.ts` and `windowManager.ts` — the whole point of the design is that they are untouched.
- Existing tests: `gestures.test.ts`, `interactionEngine.test.ts`, `windowManager.test.ts`.
- `components/FloatingWindow.tsx`, `components/CameraCapture.tsx`, `components/GestureDebug.tsx`, `components/ErrorBanner.tsx`.
- `packages/shared/*`, `apps/backend/*`, `vite.config.ts`, all `tsconfig*.json`, both `package.json` files (no new deps/scripts).
- `docs/scripts/verify_milestone1.py`, `verify_milestone2.py`, `verify_milestone3.py` — must keep passing UNCHANGED. Before starting, record `sha256sum` of all three; re-run and paste before/after hashes plus each script's `OVERALL: PASS` line in your report.
- The HUD title string `"JARVIS · Milestone 3"` (see section 7.8).
- Every asserted console format byte-identical: `[Scene3D] FPS: N`; `[HandTracker] detection latency: avg Xms over N frame(s)`; `[CameraCapture] cleanup: capture stopped, tracks released`; `[HandTracker] cleanup: camera stopped, hands solution closed`; `[App] Hands detected: ...`; `[App] test cube added to scene`; `[App] interaction engine ready: 2 windows created`; `[HandTracker] MediaPipe Hands model loaded from CDN`; `[HandTracker] gestures: ...` (still absent on fake webcam). The ONLY new console output in the entire milestone is the `[Performance]` summary line at ~5 s cadence.
- No Phase 2 features: no GRAB/SWIPE classification, no two-hand pinch-zoom, no swipe panning, no apps, no backend changes, no new UI panels.

## 12. Implementation order

1. `animation.ts` + `animation.test.ts` (TDD: tests red → green).
2. `logger.ts` + `logger.test.ts`.
3. `Scene3D.tsx` onFrame delta; `HandTracker.tsx` gesture-latency delta.
4. `App.tsx` wiring (events → momentum/cancel; projection smoothing; metrics; 5 s gate).
5. Full `npm run test` (48 + new, green) and `npm run build`; `npm run lint --workspace @jarvis/frontend` clean.
6. `verify_milestone4.py`; boot dev server; run verifiers 1→4; collect evidence.
7. README M4 + docs-guard pass.
8. Final verification sweep (section 13) and the evidence report.

## 13. Verification & evidence you MUST paste in your report

1. `npm run test` — tail with file counts and total (48 old + N new, 0 failures). Quote the perf-smoke measured average.
2. `npm run build` — tail (all three workspaces succeed).
3. `npm run lint --workspace @jarvis/frontend` — 0 problems.
4. Dev server boot: zero console errors at startup (quote the verifier's check a instead of a manual claim if you prefer).
5. `python docs/scripts/verify_milestone4.py` — full CHECKS block + `OVERALL: PASS`; confirm `docs/screenshots/m4-scene.png`, `m4-full.png`, `m4-console.txt`, `m4-summary.json` exist (quote the heap series and rAF/listener nets from the summary).
6. `python docs/scripts/verify_milestone1.py`, `...2.py`, `...3.py` — each `OVERALL: PASS`, plus sha256 of each script before and after your work (identical).
7. `grep -c` from `m4-console.txt` for `\[Scene3D\] FPS:`, `detection latency`, `\[Performance\]` and one sample of each line — proof the old formats are byte-identical and the new one is exactly as specified.
8. A list of every file you created/modified (must match sections 3–10 exactly).
9. test-guard / clean-code-guard / docs-guard evidence lines.

## 14. Overseer review checklist (1:1 with the acceptance criteria)

The overseer reviews personally (no Reviewer agent this milestone). Each item names the evidence the Coder must have pasted; the overseer spot-checks the code against it.

1. **AnimationController eases window motion (unit-verified curve/completion)** — animation.test.ts cases all green (easing monotonic + f(0.5)=0.875; progress clamps at 1 with exact final write; onComplete exactly once; cancel works; id-replacement copies). Evidence: test-run tail. Spot-check: `easeOutCubic` formula `1 - (1-t)^3`; scratch-vector reuse documented; injectable clock on every time-taking method.
2. **Browser check: windows still track the mesh** — verifier checks b/c/i PASS (2 windows on screen, titles visible, < 1.5 px drift over the soak). Spot-check `App.getWindowProjection`: presentation vector used for depth+NDC, scale unsmoothed, seeding prevents fly-in, `forget()` on closed windows.
3. **PerformanceLogger reports all four metrics; interaction latency measured, single-digit ms expected** — verifier check h (≥ 3 four-key `[Performance]` lines, cadence 4–15 s) + the vitest perf-smoke average (< 5 ms). Spot-check: `logMetric` used for the two pre-averaged sources; `recordSample` rolling mean window 30; summary gated by `hasData()` and driven by the rAF frame gate (no timers); HandTracker's only delta is the optional callback (all old lines byte-identical — compare against m3-console.txt formats).
4. **Soak: no listener/rAF leak growth, single cleanup pairs on unmount** — verifier checks k/l/m/n/o PASS with the series in m4-summary.json. Spot-check the init-script wrappers call through unchanged.
5. **M3 engine semantics intact; lockstep preserved** — interactionEngine.ts and windowManager.ts byte-identical (no git: verify by reading; also the 16 engine tests green). Momentum writes only through `moveWindow` (the `apply` closure); grab cancels in-flight momentum; release-below-min-speed starts nothing.
6. **Code organized + documented** — module docblocks on both new utils with the D1–D6 deviations; exported constants named; no `enum`; `import type` everywhere applicable; no unused locals; oxlint clean.
7. **All vitest suites + build pass** — evidence items 1–3.
8. **Dev server boots with zero console errors** — verifier check a (whole session).
9. **verify_milestone1/2/3.py pass unchanged** — evidence item 6, hashes identical.
10. **Docs** — README M4 section present and accurate (docs-guard run): commands runnable, honest checklist mapping, evidence paths exist, M1–M3 sections untouched, HUD-title constraint explained (README or code comment).
11. **Scope discipline** — file list matches sections 3–10 exactly; no Phase 2 features; no backend/shared/package changes; the only new console output is `[Performance]`.
12. **User review gate** — after the overseer's own pass, the result is presented to the user before the milestone is called done; fold feedback into a follow-up Coder round if needed.

## 15. Pitfalls (each has bitten someone before)

- `enum` keyword anywhere → build fails (`erasableSyntaxOnly`). Missing `import type` → build fails (`verbatimModuleSyntax`). Unused import/param → build fails (tests compile too).
- Mixing timebases: `gesture.timestamp` (Date.now base) vs rAF/performance.now(). VelocityTracker ages samples relative to its NEWEST sample precisely so no cross-base comparison exists — keep it that way.
- Writing `mesh.position` directly in the animation path → breaks WindowManager lockstep. Only `moveWindow`.
- Forgetting `cancelAnimation` on grab/close/minimize → a re-grabbed window fights a zombie momentum animation.
- Firing the summary before metrics exist (boot) or after unmount — the frame-gate design removes both; do not reintroduce timers.
- Editing an asserted console line "just to tidy it" → verifier regression. The HandTracker/Scene3D diffs must be surgical.
- Bumping the HUD title to "Milestone 4" → verify_milestone3.py check f fails. It stays "Milestone 3" (comment why).
- Floating-point completion residue — the final write must be the exact `to`, not a last lerp.
- Non-deterministic tests: never rely on real elapsed time except the single no-throw smoke; inject every clock.
- Headless FPS steady-state is 4–5 (SwiftShader): never assert summary renderFPS ≥ 30; only the boot-window max (check f), exactly like M3.
