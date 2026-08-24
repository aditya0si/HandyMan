# M14 Coder Brief — Performance optimization (Phase 5 part 1)

Self-authored (solo mode). Scope: the M14 milestone prompt verbatim —
performance ONLY, no behavior/UX/API changes ("a user must not be able to
tell the app apart except by its speed"). Standing constraints: NOT a git
repo; no new npm deps; no MediaPipe swap; no M15/M16 work; 301+43 tests
keep passing; verifiers 1–13 keep passing (title lockstep excepted);
latency band holds; zero console errors with everything default.

## Decisions

- **D1 baseline (honest)**: current production build = ONE JS chunk,
  750.20 kB min / 203.61 kB gzip (+0.21 kB css) — measured fresh before
  any change (the prompt's ~683/184 was the M1-era figure).
- **D2 code-splitting**: `vite.config.ts` gains
  `build.rolldownOptions.output.advancedChunks.groups` (rolldown-vite's
  manualChunks successor) with three groups: `three`,
  `react` (react/react-dom/scheduler), `mediapipe` (@mediapipe/*). The
  legacy Closure bundles are side-effect-only imports — if they split,
  fine; if the graph resists, they stay in main and the build output
  proves it either way. HONEST reporting: with a single entry and no
  dynamic imports, every chunk still loads at boot — the win is CACHE
  STABILITY (vendor chunks survive app deploys) + smaller parse units,
  NOT fewer boot bytes. Before/after table comes from the build output.
- **D3 renderer**: `WebGLRenderer({ antialias: true, powerPreference:
  'high-performance' })` (dual-GPU laptops pick the discrete card) +
  `MAX_PIXEL_RATIO = 2` exported from Scene3D;
  `setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))`
  (a 3x hidpi screen renders 2.25x the pixels for no visual gain in a
  debug-overlay app — documented tradeoff).
- **D4 perf-debug (opt-in)**: `?perf=1` URL param (chosen over a
  VITE_PERF_DEBUG env flag: no rebuild, identical in dev/preview/
  verifier; document). `utils/perfDebug.ts` node-pure:
  `isPerfDebugEnabled()` (module-cached, `typeof location` guard → false
  in node/tests), `recordPerf(bucket, ms)` + `dumpPerf(nowMs)` — a
  no-op unless enabled; Scene3D's EXISTING 1-second gate calls dump,
  printing exactly one line/second:
  `[PerfDebug] render_avg=X.Xms n=N inference_avg=…ms n=N
  projection_avg=… interaction_avg=… sync_avg=…` (fixed key order,
  omitted when a bucket has no samples). Default OFF ⇒ verifier console
  byte-identical to M13; the [Performance] line + every M1–M13 format
  untouched.
- **D5 measurement points (all pre-existing)**: render = the
  renderer.render call (Scene3D); inference = HandTracker's avg detection
  latency (App's onLatencyUpdate); projection = FloatingWindow's 30 Hz
  tick section; interaction = App's per-frame gesture/engine loop;
  sync = SyncManager.sendHands body (quantize+throttle+send). Each wrap
  is two performance.now() calls around existing code — gated by the
  module-cached boolean, zero cost when off.
- **D6 soak (v14 evidence, not a unit test)**: preview-build page, apps
  open; N open/close cycles via launcher + chrome close (heap must
  RETURN after the cycles — M3 disposal + M8 storage must not leak);
  ws-driven window moves (the REAL M12 remoteApply path — python client
  upserts a window repeatedly; no runtime hooks added); heap series +
  plateau check; rAF-rate delta before/after; reload → single cleanup
  pairs. Report heap_series / raf deltas / cleanup counts like the M4
  soak.
- **D7 verifier v14** runs against `vite preview` (:4173) — the
  production SPLIT bundle is what boots (the strongest "still boots"
  proof), with the backend up (ws moves + Sync connected). Checks: build
  chunk report (>1 JS chunk + sizes recorded), boot exact (title M14),
  default console has NO [PerfDebug] line, `?perf=1` DOES show it, soak
  summary, zero errors, latency band, evidence m14-*.
- **D8 title lockstep**: HUD → `JARVIS · Milestone 14`; v13's exact pins
  downgraded to tolerant; v1–v12 untouched (already tolerant + the M13
  data resets); v14 owns the exact pin.
- **D9 tests**: perfDebug.test.ts — default-off in node, record/dump
  no-ops when disabled (console spy), bucket math + exact line format,
  MAX_PIXEL_RATIO === 2 pin. No other new suites.

## Out of scope (hard)

Behavior/UX/API changes; MediaPipe API swap (worker/tasks-vision is the
documented future escalation); deployment (M16); edge-case/monitoring
work (M15); new dependencies.


## D10 — mid-milestone discovery (adds to the record): the production build was BROKEN since M1

The milestone requires the production build to boot, and the first preview
boot exposed a latent M1 bug: `window.Hands is not a constructor` + a
blank page (HandTracker's throw unmounts the whole React tree). No
verifier ever caught it — all fourteen ran the DEV server, where
optimizeDeps.exclude serves the raw MediaPipe files.

Root cause: `@mediapipe/hands` + `camera_utils` declare `"sideEffects": []`
in their package.json, so rolldown tree-shakes side-effect-only imports of
them entirely, and even `treeshake.moduleSideEffects: true`/per-module
overrides do NOT retain them (verified in isolation with the rolldown API:
the imports resolve to nothing in every configuration).

Fix (D10): the Closure bundles leave the module graph — they load as
plain `<script>` ASSETS via `?url` imports + a lazy runtime loader in
HandTracker (`ensureMediaPipeScripts()`, module-level promise,
StrictMode-safe, idempotent); `window.Hands`/`window.Camera` land exactly
as before; hands creation is deferred into the already-async init() until
the scripts resolve; a script-load failure shows the same error panel as
the WASM-load failure. Dev behavior is unchanged (vite serves the raw
files as assets in dev too). The export is now HONEST: JS graph =
app + vendor-react + vendor-three (cache-stable), mediapipe = two async
assets (45.6 kB + 7.9 kB), zero parse cost until the tracker mounts.
